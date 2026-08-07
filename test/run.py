#!/usr/bin/env python3
"""Drive the single-step flow against real websites and verify every image."""
import base64, http.server, io, os, pathlib, socketserver, sys, threading
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
QA = ROOT / "test" / "out"; QA.mkdir(parents=True, exist_ok=True)
PORT = 8975
APP = os.environ.get("APP_URL", f"http://localhost:{PORT}/")
MODE = os.environ.get("TEXT_MODE", "brand")
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
        pg = b.new_page(viewport={"width": 1400, "height": 1000})
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}")
              if m.type == "error" and "Failed to load resource" not in m.text else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.goto(APP, wait_until="networkidle")
        print(f"\n=== {target}   [{MODE}]")

        pg.fill("#site", target)
        pg.evaluate("""(mode) => {
            const r = [...document.querySelectorAll('.md input')].find(i => i.value === mode);
            if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
            document.querySelectorAll('.rt input').forEach(i => {
              if (!i.checked) { i.checked = true; i.dispatchEvent(new Event('change')); }});
            [...document.querySelectorAll('.counts button')].find(x => x.textContent === '2').click();
        }""", MODE)
        print("  tally:", pg.text_content("#tally"))

        pg.click("#run")
        try:
            pg.wait_for_function(
                "document.querySelector('[data-k=check]')?.dataset.s !== 'wait' && "
                "document.querySelector('[data-k=check]')?.dataset.s !== 'now'", timeout=300000)
        except Exception:
            print("  RUN DID NOT FINISH")
            fails.append(f"{target}: run did not finish"); pg.close(); continue

        steps = pg.evaluate("""() => [...document.querySelectorAll('#steplist li')].map(l =>
            ({k: l.dataset.k, s: l.dataset.s, note: l.querySelector('.note').textContent}))""")
        for s in steps:
            print(f"  {s['k']:6s} {s['s']:5s} {s['note'][:60]}")
            if s['s'] == 'fail' and s['k'] != 'check':
                fails.append(f"{target}: step {s['k']} failed — {s['note']}")

        verdict = pg.evaluate("""() => [...document.querySelectorAll('#reportgrid .c')].map(c =>
            ({k: c.querySelector('.k').textContent, v: c.querySelector('.v').textContent,
              bad: c.classList.contains('bad')}))""")
        for v in verdict:
            print(f"  · {v['k']:16s} {v['v']}{'   FAIL' if v['bad'] else ''}")
            if v['bad']: fails.append(f"{target}: {v['k']} = {v['v']}")

        iss = pg.evaluate("""() => [...document.querySelectorAll('.card .s')].map(s=>s.title)
            .filter(t=>t && t!=='passes every check')""")
        for t in iss[:8]: print("    issue:", t.replace(chr(10),' | ')[:120])

        n = pg.evaluate("document.querySelectorAll('.card img').length")
        expect = pg.evaluate("document.querySelectorAll('.rt input:checked').length") * 2
        print(f"  images {n} (expected {expect})")
        if n != expect: fails.append(f"{target}: expected {expect} images, got {n}")

        links = pg.evaluate("""() => {const a=[...document.querySelectorAll('.acts a.save')];
            return {n:a.length, b:a.filter(x=>x.href.startsWith('blob:')).length}}""")
        if links["n"] != links["b"]: fails.append(f"{target}: broken save links")

        with pg.expect_download(timeout=180000) as di:
            pg.click("#dlall")
        d = di.value
        zp = QA / f"{target.split('/')[2].replace('.','_')}.zip"
        d.save_as(zp); print(f"  zip {zp.stat().st_size/1024:.0f} KB")

        srcs = pg.evaluate("() => [...document.querySelectorAll('.card img')].map(i=>i.src)")
        imgs = []
        for src in srcs[:6]:
            data = pg.evaluate("""async (u) => { const b = await (await fetch(u)).blob();
                return await new Promise(r => {const f=new FileReader();
                  f.onload=()=>r(f.result); f.readAsDataURL(b);}); }""", src)
            imgs.append(Image.open(io.BytesIO(base64.b64decode(data.split(",",1)[1]))).convert("RGB"))
        if imgs:
            imgs = [im.resize((max(1,int(im.width*260/im.height)), 260)) for im in imgs]
            W = sum(i.width+12 for i in imgs)+12
            sheet = Image.new("RGB",(W,284),(250,247,242)); x=12
            for im in imgs: sheet.paste(im,(x,12)); x+=im.width+12
            p = QA/f"strip-{target.split('/')[2].replace('.','_')}.png"
            sheet.save(p); print(f"  {p.name}")

        pg.screenshot(path=str(QA/f"page-{target.split('/')[2].replace('.','_')}.png"), full_page=False)
        print(f"  console errors: {len(errs)} {errs[:2]}")
        if errs: fails.append(f"{target}: console errors {errs[:1]}")
        pg.close()
    b.close()

print("\n" + ("FAILURES:\n  " + "\n  ".join(fails) if fails else "all checks passed"))
sys.exit(1 if fails else 0)
