#!/usr/bin/env python3
"""Drive the generator against real websites and verify every image."""
import base64, http.server, io, os, pathlib, socketserver, sys, threading
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
QA = ROOT / "test" / "out"; QA.mkdir(parents=True, exist_ok=True)
PORT = 8947
APP = os.environ.get("APP_URL", f"http://localhost:{PORT}/")
MODE = os.environ.get("TEXT_MODE", "full")
TARGETS = sys.argv[1:] or ["https://ribboncera.sfo3.digitaloceanspaces.com/index.html"]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
threading.Thread(target=lambda: socketserver.TCPServer(("", PORT), H).serve_forever(),
                 daemon=True).start()

fails = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for target in TARGETS:
        errs = []
        pg = b.new_page(viewport={"width": 1440, "height": 1000})
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}")
              if m.type == "error" and "Failed to load resource" not in m.text else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.goto(APP, wait_until="networkidle")

        print(f"\n=== {target}   [text mode: {MODE}]")
        pg.fill("#site", target)
        pg.fill("#ref", "")
        pg.click("#scan")
        try:
            pg.wait_for_selector("#found:not([hidden])", timeout=90000)
        except Exception:
            print("  SCAN FAILED:", pg.text_content("#scanhint"))
            fails.append(f"{target}: scan failed"); pg.close(); continue

        found = pg.evaluate("""() => Object.fromEntries(
            [...document.querySelectorAll('.fc')].map(c =>
              [c.querySelector('.k').textContent, c.querySelector('.v').textContent]))""")
        for k, v in found.items():
            print(f"  {k:18s} {v[:66]}")

        pg.evaluate("""(mode) => {
            const r = [...document.querySelectorAll('.md input')].find(i => i.value === mode);
            if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
            document.querySelectorAll('.rt input').forEach(i => {
              if (!i.checked) { i.checked = true; i.dispatchEvent(new Event('change')); }});
            [...document.querySelectorAll('#pervals button')].find(x => x.textContent === '3').click();
        }""", MODE)
        print("  tally:", pg.text_content("#tally"))

        pg.click("#go")
        pg.wait_for_function("!document.getElementById('verdict').hidden", timeout=300000)

        verdict = pg.evaluate("""() => [...document.querySelectorAll('#vgrid .v')].map(v => ({
            k: v.querySelector('.k').textContent,
            n: v.querySelector('.n').textContent,
            fail: v.classList.contains('fail')}))""")
        for v in verdict:
            print(f"  · {v['k']:26s} {v['n']}{'   FAIL' if v['fail'] else ''}")
            if v["fail"]: fails.append(f"{target}: {v['k']} = {v['n']}")

        lits = pg.evaluate("""() => (window.__lits || [])""")
        if lits: print("    lit photo->final:", ", ".join(f"{a:.2f}->{b:.2f}" for a, b in lits[:8]))

        allIssues = pg.evaluate("""() => [...document.querySelectorAll('.card .s')]
            .map(s => s.title).filter(t => t && t !== 'passes every mechanical check')""")
        for t in allIssues[:6]: print("    issue:", t.replace(chr(10), ' | ')[:130])

        n = pg.evaluate("document.querySelectorAll('.card img').length")
        dims = pg.evaluate("""() => [...document.querySelectorAll('.card')].map(c => ({
            spec: c.querySelector('.s b').textContent.replace('\\u00d7','x'),
            w: c.querySelector('img').naturalWidth, h: c.querySelector('img').naturalHeight}))""")
        bad = [d for d in dims if d["spec"] != f'{d["w"]}x{d["h"]}']
        print(f"  images {n} · dim mismatches {len(bad)}")
        expected = len(pg.evaluate("() => document.querySelectorAll('.rt input:checked').length")) \
            if False else pg.evaluate("() => document.querySelectorAll('.rt input:checked').length") * 3
        if n != expected: fails.append(f"{target}: expected {expected} images, got {n}")
        if bad: fails.append(f"{target}: dim mismatch {bad[:2]}")

        links = pg.evaluate("""() => {
            const a = [...document.querySelectorAll('.acts a.save')];
            return {n: a.length, blobs: a.filter(x => x.href.startsWith('blob:')).length};
        }""")
        if links["n"] != links["blobs"]: fails.append(f"{target}: broken save links")

        before = pg.evaluate("document.querySelector('.card img').src")
        pg.evaluate("() => document.querySelector('.acts button').click()")
        pg.wait_for_timeout(3500)
        after = pg.evaluate("document.querySelector('.card img').src")
        print(f"  again changed image: {before != after}")
        if before == after: fails.append(f"{target}: 'Again' did not change the image")

        with pg.expect_download(timeout=180000) as di:
            pg.click("#dlall")
        d = di.value
        zp = QA / f"{target.split('/')[2].replace('.','_')}-{MODE}.zip"
        d.save_as(zp)
        print(f"  zip: {d.suggested_filename} {zp.stat().st_size/1024:.0f} KB")

        srcs = pg.evaluate("() => [...document.querySelectorAll('.card img')].map(i => i.src)")
        imgs = []
        for src in srcs[:8]:
            data = pg.evaluate("""async (u) => {
                const b = await (await fetch(u)).blob();
                return await new Promise(r => { const fr = new FileReader();
                  fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
            }""", src)
            imgs.append(Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1]))).convert("RGB"))
        if imgs:
            imgs = [im.resize((max(1, int(im.width * 300 / im.height)), 300)) for im in imgs]
            W = sum(i.width + 12 for i in imgs) + 12
            sheet = Image.new("RGB", (W, 324), (233, 229, 223))
            x = 12
            for im in imgs:
                sheet.paste(im, (x, 12)); x += im.width + 12
            name = QA / f"strip-{target.split('/')[2].replace('.','_')}-{MODE}.png"
            sheet.save(name); print(f"  {name.name} {sheet.size}")

        print(f"  console errors: {len(errs)} {errs[:2]}")
        if errs: fails.append(f"{target}: {len(errs)} console errors: {errs[:1]}")
        pg.close()
    b.close()

print("\n" + ("FAILURES:\n  " + "\n  ".join(fails) if fails else "all checks passed"))
sys.exit(1 if fails else 0)
