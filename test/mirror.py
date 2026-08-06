#!/usr/bin/env python3
"""Render every archetype in BOTH mirror states.

Mirroring is chosen at random per run, so a layout bug in one branch only shows
on some seeds. This forces both and lays them side by side.
"""
import base64, http.server, io, pathlib, socketserver, threading, sys
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
QA = ROOT / "test" / "out"; QA.mkdir(parents=True, exist_ok=True)
PORT = 8937

REPS = [(728, 90, "wide"), (320, 100, "mobilebig"), (970, 250, "widetall"),
        (300, 250, "square"), (580, 400, "landscape"), (300, 600, "vertical"),
        (160, 600, "sky"), (300, 50, "micro")]


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
threading.Thread(target=lambda: socketserver.TCPServer(("", PORT), H).serve_forever(),
                 daemon=True).start()

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(f"http://localhost:{PORT}/", wait_until="networkidle")
    pg.wait_for_function("document.getElementById('status').textContent.startsWith('Ready')",
                         timeout=30000)

    shots = pg.evaluate("""async (reps) => {
      window.__fitMisses = [];
      const plan = buildPlan(12345, brand, prompts, '', 'ribboncera.com');
      const c = plan[0];
      const theme = brand.themes[c.themeName];
      const logo = await logoFor(theme.wick);
      const out = [];
      for (const [W,H,arch] of reps) {
        for (const mirror of [false, true]) {
          const v = Object.assign({}, c.variant, {
            img: images[c.photo.file], logo, brandName: brand.name,
            site: 'ribboncera.com', mirror, bandJit: 0.5, field: 0
          });
          const cv = document.createElement('canvas');
          render(cv, W, H, arch, c, theme, v);
          out.push({W,H,arch,mirror,d: cv.toDataURL('image/png')});
        }
      }
      return {shots: out, misses: window.__fitMisses};
    }""", REPS)

    rows = []
    for s in shots["shots"]:
        im = Image.open(io.BytesIO(base64.b64decode(s["d"].split(",", 1)[1]))).convert("RGB")
        rows.append((f'{s["arch"]} {s["W"]}x{s["H"]} mirror={s["mirror"]}', im))

    W = max(i.width for _, i in rows) + 40
    Hh = sum(i.height + 30 for _, i in rows) + 20
    sheet = Image.new("RGB", (W, Hh), (228, 228, 234))
    y = 16
    for _, im in rows:
        sheet.paste(im, (20, y + 12)); y += im.height + 30
    sheet.save(QA / "mirror.png")
    print(f"mirror.png {sheet.size}")
    for lbl, _ in rows: print("  ", lbl)
    print("fit misses:", len(shots["misses"]))
    b.close()

print("errors:", len(errs), errs[:3])
sys.exit(1 if (errs or shots["misses"]) else 0)
