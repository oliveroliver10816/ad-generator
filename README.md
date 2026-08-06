# Ad Pack Generator

Type a website and (optionally) some reference text, press **Generate**, and get a
complete set of Google Display Network ads — every standard size, each with its own
download button, plus a Download-all ZIP.

Every run is a different pack: new wording, new crops, new arrangement, a different
photo per angle. The **brand never changes** — colours, fonts, logo and photography
are fixed in the kit.

**Live:** https://oliveroliver10816.github.io/ad-generator/
**Mirror:** https://ad-generator.fleet-fefsba.workers.dev

## How it works

Everything runs in the browser. There is no server, no build step and no libraries —
the ads are drawn on `<canvas>` and handed to you as real PNG/JPEG files.

- `kits/<brand>/brand.json` — colours, fonts, logo, photo list. The locked part.
- `kits/<brand>/prompts.json` — copy pools. One line is drawn from each pool per run,
  which is where the variety comes from. Every line is true of the site.
- `app.js` — the renderer: 8 layout archetypes, a seeded random planner, and a
  store-only ZIP writer.
- `ui.js` — loads the kit, wires the form, builds the download links.

### Sizes

300×50 · 320×50 · 320×100 · 468×60 · 728×90 · 970×90 · 980×120 · 930×180 · 970×250 ·
200×200 · 250×250 · 300×250 · 336×280 · 580×400 · 240×400 · 250×360 · 300×600 ·
300×1050 · 120×600 · 160×600 · 1200×628 · 1200×1200, plus the 1:1 and 4:1 logo assets
that responsive display ads ask for. **68 files per run.**

Every file is an exact slot size and under Google's 150 KB limit (PNG where that fits,
progressive JPEG where it doesn't).

## Adding another brand

Copy `kits/ribboncera/` to `kits/<name>/`, replace `brand.json`, `prompts.json` and
`img/`, then point `KIT` at it in `ui.js`. Nothing else changes.

⚠ A page hosted on GitHub cannot read another website live — browsers block
cross-origin reads. That is why the kit is prebuilt. The URL typed into the form is
printed on the ads; it is not scraped.

## Tests

    python3 test/run.py      # end-to-end: renders 68, checks sizes, downloads, ZIP
    python3 test/mirror.py   # every archetype in both mirror states

Both drive a real headless browser and fail on console errors, wrong dimensions,
un-fitted text, or a broken download link.
