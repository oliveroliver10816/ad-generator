#!/usr/bin/env python3
"""Drive the generator in a real browser and verify what it produces."""
import base64, http.server, io, pathlib, socketserver, threading, sys
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
QA = ROOT / "test" / "out"; QA.mkdir(parents=True, exist_ok=True)
PORT = 8931


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), H) as httpd:
        httpd.serve_forever()


threading.Thread(target=serve, daemon=True).start()

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    pg.goto(f"http://localhost:{PORT}/", wait_until="networkidle")
    pg.wait_for_function("document.getElementById('status').textContent.startsWith('Ready')",
                         timeout=30000)
    print("kit loaded ok")

    pg.fill("#ref", "Candle making, unhurried.\nWax families, wick sizing and pour-day "
                    "notes written at a kitchen table.\n"
                    "Supercalifragilisticexpialidociouslylongunbrokenword")
    pg.click("#go")
    pg.wait_for_function(
        "document.getElementById('status').textContent.includes('seed')", timeout=180000)
    print("status:", pg.text_content("#status"))

    n = pg.evaluate("document.querySelectorAll('canvas').length")
    print(f"canvases rendered: {n}")

    # exact-dimension check on every canvas
    dims = pg.evaluate("""() => [...document.querySelectorAll('canvas')].map(c => {
        const m = c.parentElement.parentElement.querySelector('.meta b').textContent
                   .replace(/[^0-9x×]/g,'').replace('×','x');
        return {real: c.width + 'x' + c.height, label: m};
    })""")
    bad = [d for d in dims if d["real"] != d["label"]]
    print(f"dimension mismatches: {len(bad)} {bad[:3]}")

    misses = pg.evaluate("window.__fitMisses")
    print(f"text that could not be fitted: {len(misses)} {misses[:3]}")

    # download-button sanity: every card has an href + download name
    dl = pg.evaluate("""() => {
        const a = [...document.querySelectorAll('a.dl')];
        return {count: a.length,
                blobs: a.filter(x => x.href.startsWith('blob:')).length,
                named: a.filter(x => (x.getAttribute('download')||'').length > 6).length};
    }""")
    print("download links:", dl)

    # pull a representative strip out for eyeball QA
    want = ["300x250", "728x90", "970x250", "160x600", "320x100", "1200x628", "300x1050", "200x200"]
    shots = pg.evaluate("""(want) => {
        const out = [];
        for (const c of document.querySelectorAll('canvas')) {
            const k = c.width + 'x' + c.height;
            if (want.includes(k) && !out.some(o => o.k === k))
                out.push({k, d: c.toDataURL('image/png')});
        }
        return out;
    }""", want)
    imgs = []
    for s in shots:
        im = Image.open(io.BytesIO(base64.b64decode(s["d"].split(",", 1)[1]))).convert("RGB")
        imgs.append((s["k"], im))
    if imgs:
        W = max(i.width for _, i in imgs) + 40
        Hh = sum(i.height + 34 for _, i in imgs) + 20
        sheet = Image.new("RGB", (W, Hh), (232, 232, 236))
        y = 20
        for k, im in imgs:
            sheet.paste(im, (20, y)); y += im.height + 34
        sheet.save(QA / "strip.png")
        print(f"strip.png {sheet.size} — {[k for k,_ in imgs]}")

    # ZIP path
    with pg.expect_download(timeout=120000) as di:
        pg.click("#dlall")
    d = di.value
    zp = QA / "pack.zip"; d.save_as(zp)
    print(f"zip: {d.suggested_filename} {zp.stat().st_size/1024:.0f} KB")

    b.close()

print("console errors:", len(errs))
for e in errs[:5]: print("  ", e)
sys.exit(1 if (errs or bad or misses or dl["blobs"] != dl["count"]) else 0)
