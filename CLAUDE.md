# ad-generator — display ads read off any website

**Status: REWRITTEN 2026-08-06.** Nothing uploaded to any ad account, $0 spent.

**LIVE:** https://ad-generator.fleet-fefsba.workers.dev — verified end to end on the
live URL against ribboncera, gov.uk and blog.cloudflare.com.
**GitHub Pages:** https://oliveroliver10816.github.io/ad-generator/ (same code; new Pages
builds were queueing ~40 min on 2026-08-06 — see
[[github-pages-underscore-dir-and-stuck-deploy]]).
**Repos:** oliveroliver10816/ad-generator + opheliaclarke/ad-generator · local
`/root/workspace/ad-generator/`

## ⚠ The rewrite, and why

The first build shipped a **prebuilt kit** (`kits/ribboncera/brand.json` + `prompts.json`
+ six copied photos). It only ever worked for one site. Bob's verdict was blunt and
correct: *"it looks like its the worst ad generator there is in the world · it takes any
images not related to the website · it has text predecided · THE GENERATOR MUST BE FIRST
CHECKING THE WEBSITE PROPERLY, SCAN IT, AND FIND OUT WHAT IT IS ABOUT."*

⚠ **I had proposed exactly this scanning behaviour first, then abandoned it** when he
rejected the over-technical pitch, and built the prebuilt-kit version instead. The lesson
is not "he changed his mind" — a generator that cannot read its input is not a generator.
See [[a-generator-must-read-its-input]] and [[keep-the-proposal-as-small-as-the-ask]].

**`kits/` is deleted.** Nothing is authored in advance.

## How it works now

1. **`worker/src/worker.js`** — Cloudflare Worker with a `/fetch?url=` endpoint. A
   browser cannot read another site (same-origin), so fetching happens server-side.
   SSRF-guarded (private ranges, non-http schemes, size and time caps). It also serves
   the app, so one URL is self-sufficient.
2. **`scan.js`** — reads the page and pulls out brand name, description, headlines
   (h1/h2/h3/`<summary>`), supporting sentences, real button and link labels, nav items
   for kickers, photographs, the logo, and the site's typefaces.
3. **`app.js`** — red/black themes, duotone, 8 layout archetypes, seeded planner, ZIP.
4. **`ui.js` / `index.html` / `style.css`** — read the site → review what was found →
   pick sizes and versions → generate.

**Red and black, as briefed.** Two reds by necessity: `#ef3a41` clears AA on black at
body size (5.06:1) so it can carry text; `#d01820` is dark enough that white clears AA on
it (5.48:1) so it can carry a fill. One red cannot do both jobs. Values measured off
Bob's own reference creatives.

**Size selection**: true-scale tiles (the tile *is* the slot shape), three presets, and
1–6 versions per size. 5 sizes × 2 = 10 images, not 68.

## Traps hit and fixed (do not regress)

- ⚠ **The font probe was silently broken and looked like it worked.** It `fetch()`ed the
  Google Fonts CSS, which is **CORS-blocked**, so it always failed — and Ribboncera still
  reported "PT Serif · Quicksand" only because those are the self-hosted fallbacks. Fix:
  inject a `<link>`, then **measure a probe string against a deliberately missing
  family**. `document.fonts.check()` is useless here — it answers "can this render",
  which is true for any name because fallback covers it.
- ⚠ **`→` (U+2192) is not in Google's `latin` subset** (covers U+2000-206F plus
  U+2191/2193, not U+2192). Arrows are drawn as vector paths.
- ⚠ **A site's logo was being used as a photograph** (gov.uk had no other image). The
  logo is now found *before* the photo sweep and excluded from it, and `og:image` is a
  last resort because it is usually a branded share card.
- ⚠ **Titles are sentences, not brand names** — "Welcome to GOV.UK". Prefixes are
  stripped and anything still prose-like falls back to the domain.
- ⚠ **Cross-origin images taint a canvas and `toBlob()` then throws**, breaking every
  download silently. Images are proxied and converted to `blob:` URLs.
- ⚠ **The url ran under the CTA** on long hosts. It now shrinks to a measured budget and
  omits itself rather than collide.
- ⚠ Mirrored leaderboard drew the CTA over the headline (only on some seeds).
- ⚠ Canvas clips silently — `fitStack` records misses to `window.__fitMisses`; the test
  fails on any.

## QA

`test/run.py` (set `APP_URL` to test a deployed build) drives a real browser per site:
scan, size selection, generate, exact dimensions, fit misses, download links, reroll
actually changing the image, and the ZIP. **All checks pass on ribboncera, gov.uk and
blog.cloudflare.com, 0 console errors.**

## Open

- Themes are red/black only, by instruction. Deriving an accent from the scanned site is
  a small addition — `scan.colours` is already collected and unused.
- Sites that render content with JavaScript return little; the scanner says so rather
  than inventing copy.
- ⚠ **ribboncera.com does not resolve.** The live site is only on the Spaces URL, but its
  canonical and og:url point at ribboncera.com. Flagged to Bob.
