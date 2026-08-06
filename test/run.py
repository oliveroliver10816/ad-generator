#!/usr/bin/env python3
"""Drive the generator against real websites and verify what comes out."""
import base64, http.server, io, pathlib, socketserver, sys, threading
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
QA = ROOT / "test" / "out"; QA.mkdir(parents=True, exist_ok=True)
PORT = 8941

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
        # A dead asset on the *scanned* site is that site's problem, not ours —
        # the scanner already skips it. Only script errors count.
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}")
              if m.type == "error" and "Failed to load resource" not in m.text else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.goto(f"http://localhost:{PORT}/", wait_until="networkidle")

        print(f"\n=== {target}")
        pg.fill("#site", target)
        pg.fill("#ref", "")
        pg.click("#scan")
        try:
            pg.wait_for_selector("#found:not([hidden])", timeout=90000)
        except Exception:
            print("  SCAN FAILED:", pg.text_content("#scanhint"))
            fails.append(f"{target}: scan failed")
            pg.close(); continue

        found = pg.evaluate("""() => {
            const cards = [...document.querySelectorAll('.fcard')].map(c => [
                c.querySelector('.k').textContent, c.querySelector('.v').textContent]);
            return Object.fromEntries(cards);
        }""")
        for k, v in found.items():
            print(f"  {k:22s} {v[:70]}")

        # pick a spread of sizes and 2 versions each
        pg.evaluate("""() => {
            document.querySelectorAll('.tile input').forEach(i => {
              if (i.checked) { i.checked = false; i.dispatchEvent(new Event('change')); }});
        }""")
        want = ["300×250", "728×90", "160×600", "320×100", "1200×628"]
        pg.evaluate("""(want) => {
            for (const t of document.querySelectorAll('.tile')) {
              const d = t.querySelector('.dim').textContent.trim();
              if (want.includes(d)) {
                const i = t.querySelector('input');
                if (!i.checked) { i.checked = true; i.dispatchEvent(new Event('change')); }
              }
            }
        }""", want)
        pg.evaluate("""() => [...document.querySelectorAll('#pervals button')]
                            .find(b => b.textContent === '2').click()""")
        print("  tally:", pg.text_content("#tally"))

        pg.click("#go")
        pg.wait_for_function(
            "document.getElementById('statusline').textContent.includes('ready')", timeout=180000)
        print("  status:", pg.text_content("#statusline"))

        n = pg.evaluate("document.querySelectorAll('.card canvas').length")
        misses = pg.evaluate("window.__fitMisses.length")
        dims = pg.evaluate("""() => [...document.querySelectorAll('.card')].map(c => {
            const cv = c.querySelector('canvas');
            const lbl = c.querySelector('.spec b').textContent.replace('×','x');
            return {real: cv.width + 'x' + cv.height, label: lbl};
        })""")
        bad = [d for d in dims if d["real"] != d["label"]]
        links = pg.evaluate("""() => {
            const a = [...document.querySelectorAll('.acts a.save')];
            return {n: a.length, blobs: a.filter(x => x.href.startsWith('blob:')).length};
        }""")
        print(f"  images {n} · fit misses {misses} · dim mismatches {len(bad)} · save links {links}")
        if n != 10: fails.append(f"{target}: expected 10 images, got {n}")
        if misses: fails.append(f"{target}: {misses} fit misses")
        if bad: fails.append(f"{target}: dim mismatch {bad[:2]}")
        if links["n"] != links["blobs"]: fails.append(f"{target}: broken save links")

        # "Another version" must actually change the picture
        before = pg.evaluate("document.querySelector('.card canvas').toDataURL().length")
        pg.evaluate("""() => document.querySelector('.acts button').click()""")
        pg.wait_for_timeout(2500)
        after = pg.evaluate("document.querySelector('.card canvas').toDataURL().length")
        changed = before != after
        print(f"  another-version changed the image: {changed}")
        if not changed: fails.append(f"{target}: reroll did not change output")

        with pg.expect_download(timeout=120000) as di:
            pg.click("#dlall")
        d = di.value
        zp = QA / f"{target.split('/')[2].replace('.','_')}.zip"
        d.save_as(zp)
        print(f"  zip: {d.suggested_filename} {zp.stat().st_size/1024:.0f} KB")

        shots = pg.evaluate("""() => [...document.querySelectorAll('.card canvas')]
            .slice(0,5).map(c => ({k: c.width+'x'+c.height, d: c.toDataURL('image/png')}))""")
        imgs = [(s["k"], Image.open(io.BytesIO(base64.b64decode(s["d"].split(",", 1)[1]))).convert("RGB"))
                for s in shots]
        if imgs:
            W = max(i.width for _, i in imgs) + 40
            Hh = sum(i.height + 26 for _, i in imgs) + 20
            sheet = Image.new("RGB", (W, Hh), (231, 226, 218))
            y = 16
            for _, im in imgs:
                sheet.paste(im, (20, y)); y += im.height + 26
            name = QA / f"strip-{target.split('/')[2].replace('.','_')}.png"
            sheet.save(name)
            print(f"  {name.name} {sheet.size}")

        print(f"  console errors: {len(errs)} {errs[:2]}")
        if errs: fails.append(f"{target}: {len(errs)} console errors: {errs[:1]}")
        pg.close()
    b.close()

print("\n" + ("FAILURES:\n  " + "\n  ".join(fails) if fails else "all checks passed"))
sys.exit(1 if fails else 0)
