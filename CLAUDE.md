# ad-generator — one-click Google Display ad packs, in the browser

**Status: BUILT + LIVE 2026-08-06.** Nothing uploaded to any ad account, $0 spent.

**LIVE:** https://oliveroliver10816.github.io/ad-generator/
**Repo:** oliveroliver10816/ad-generator (public) · local `/root/workspace/ad-generator/`

## What Bob asked for

Automation of the one-off `ribboncera-gdn` pack. His words: *"I just want it to be on
github · the process must be simple · It already has reference images, color theme and
all prompting json prebuilt · Everytime I generate something, it must be unique and
100% random in its own way, but the theme, colors, graphics must stay as given · I will
give: website, reference text."*

⚠ **I over-engineered the first answer** — pitched live brand-extraction from any URL,
three hosting architectures and a two-part clarifying question. He rejected it flat
(*"I don't know what you're talking about"*). **The right shape was much smaller than
what I proposed.** See memory [[keep-the-proposal-as-small-as-the-ask]].

## What it is

A static page. Type website + optional reference text → **68 files** (3 concepts × 22
GDN sizes + 2 logo assets), each with its own download button, plus a Download-all ZIP.

**Everything runs in the browser — no server, no build step, no libraries.** Ads are
drawn on `<canvas>` and exported with `toBlob`. The ZIP is a hand-written store-only
writer (~40 lines; PNG/JPEG are already compressed so deflate buys nothing).

- `kits/ribboncera/brand.json` — locked: 3 themes × 3 gradient fields, logo SVG, photos
- `kits/ribboncera/prompts.json` — 5 angles × pools of kicker/head/short/micro/sub/cta
- `app.js` — 8 layout archetypes, seeded planner (mulberry32), canvas renderer, ZIP
- `ui.js` — kit loading, form, download links

**Randomness model:** one item drawn from each copy pool, plus randomised theme
assignment, photo pick (tag-filtered), gradient variant, mirror, band ratio and focal
jitter. **Brand is never randomised.** Reference text is split into short/mid/long lines
and injected into the pools at 2× weight, so Bob's own words actually appear.

## Traps hit and fixed (do not regress)

- ⚠ **`→` (U+2192) is NOT in the Quicksand or PT Serif webfont subsets.** Proved by
  measuring it against a deliberately-missing font — identical width, i.e. it was coming
  from the OS fallback, so it would render differently on every machine or as tofu.
  **Arrows are now drawn as vector paths.** Google's `latin` subset covers U+2000-206F
  but the arrows block starts at U+2190 — only U+2191/2193 are included, not U+2192.
- ⚠ **The mirrored leaderboard drew the CTA pill on top of the headline.** Mirroring is
  random per run, so this only appeared on some seeds. Fix: the CTA is always
  right-aligned, tucking inside the photo when mirrored. **`test/mirror.py` now forces
  both branches of every archetype** — a random layout knob needs a test that pins it.
- ⚠ **Canvas clips silently.** `fitStack` shrinks until the text fits height *and*
  width, records any miss to `window.__fitMisses`, and the test fails on a non-empty
  list. Long unbroken words are char-broken (tested with a 51-char word).
- Fonts must be `document.fonts.load`ed before any `measureText`, or every layout is
  computed against the fallback metrics and silently wrong.

## QA that ran

`test/run.py` — 68 canvases, exact dimensions, 0 fit misses, 68 working download links,
valid ZIP, 0 console errors. `test/mirror.py` — 8 archetypes × both mirror states.
Contrast: **12/12 WCAG AA** across all 3 themes against their worst gradient stop.

## Open / next

- Only one kit exists (ribboncera). Adding a brand = copy the kit folder, swap the two
  JSONs and `img/`, repoint `KIT` in `ui.js`.
- ⚠ A GitHub-hosted page **cannot read another website live** (CORS). The typed URL is
  printed on the ads and selects the kit; it is not scraped. Told Bob plainly.
- Sizes are GDN only. Meta/social sizes would be a few rows in `SIZES`.

Related: [[ribboncera-gdn-project]] (the hand-built pack this automates).
