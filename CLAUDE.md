# ad-generator — Google display images, read off any website

**Status: REBUILT 2026-08-06 (third pass).** Nothing uploaded to any ad account, $0 spent.

**LIVE:** https://ad-generator.fleet-fefsba.workers.dev — verified end to end on the live
URL against ribboncera, gov.uk and blog.cloudflare.com.
**GitHub Pages:** https://oliveroliver10816.github.io/ad-generator/ (same code).
**Repos:** oliveroliver10816/ad-generator + opheliaclarke/ad-generator.

## What changed, and why

Bob's verdict on pass two: *"So much text is not needed"*, ratios wrong, and — the
important one — *"DO NOT ADD BUTTONS ON THE IMAGES WITHOUT CHECKING. THOSE BUTTONS CAN
GET GOOGLE ADS ACCOUNT SUSPENDED."* He was right to stop me. A 43-agent workflow
researched Google's actual specs and policies and adversarially verified every claim;
**7 claims were refuted, two of which I had already written into the code.**

⚠️ **Conflict he asked for and cannot have:** "100% Google compliant" AND "safe from
detection". Circumventing systems is an account-suspension policy. Built the first;
the variation here exists to make a set of ads look like a set of ads, and is not
tuned against any detector. Told him plainly.

## The look

Reference creatives (CrimsonFit) are **full-bleed photography sinking into black with
red rim-light**, not a photo panel beside a colour panel — which is what pass two drew.
`compose.js` maps luminance onto a red/black ramp with an adaptive crush, then vignette,
scrim, a red neon bar/streak/bloom, and per-image grain.

## Researched facts now encoded in spec.js

- **1.19:1 does not exist** in any Google spec (13 pages checked). Two defensible
  readings — 1.91:1 transposed, or the 300×250 banner at 1.2:1. **The tool refuses to
  guess** and says so.
- **16:9 is a video ratio**, not an image-asset ratio. Generated but flagged.
- Real image ratios: **1:1 1200×1200 · 1.91:1 1200×628 · 4:5 960×1200 · 9:16 1080×1920**.
- **5 MB** ceiling for image assets. The 150 KB figure belongs to uploaded banners and
  the Demand Gen logo — pass two wrongly applied it here.
- **No button.** Policy is *conditional* ("Standalone buttons in image ads that lack
  clear context… or whose prominence… is disproportionate"), but a generator cannot
  judge its own proportionality, and the RDA guidance is unconditional: *"Don't add
  buttons to your image as they aren't a clickable element."* No arrows either.
- **Text overlay is "Not allowed" on image assets**, Performance Max excepted. Three
  text modes, each labelled with where it is usable.
- **20% text coverage** is best practice (Help page), **not** an Advertising Policies
  threshold — recorded as a quality ceiling, not quoted as law.
- **5% either side may be cropped** — nothing legible sits in that margin.

## Traps fixed (do not regress)

- ⚠️ **`coverDraw` treated a source-image coordinate as a CSS `object-position` value.**
  Different mappings, so the crop never centred on the lit subject and half the frames
  came out near-black. Fixing this doubled the lit fraction.
- ⚠️ **Padding derived from the short side is smaller than 5% of a wide canvas** —
  1920×1080 needs 96px, a short-side inset gave 78px. Text sat in the crop zone.
- ⚠️ Near-neutral top stop on the ramp turned large highlights grey; kept warm.
- ⚠️ A small headline pool put the same line on half the set — run-level no-repeat.
- ⚠️ Two crops of one photograph converge with no text — build-time pHash uniqueness.
- ⚠️ From pass two, still true: `→` is not in Google's `latin` subset; a site's logo
  will be used as a photograph unless excluded first; cross-origin images taint a canvas.

## QA

`check.js` measures every image: exact dimensions, aspect, file size, text coverage,
contrast sampled from the pixels *under* the text, lit fraction, safe margin, no button,
and pHash distance across the run. `test/run.py` (set `APP_URL`, `TEXT_MODE`) drives a
real browser. **All modes × all five ratios pass on three unrelated sites, 0 console
errors.**

## Open

- Only mechanical checks are automated. Whether a picture is honest about the product is
  a human call and the tool does not claim it.
- Sites that render content with JavaScript return little; the scanner says so.
- ⚠️ **ribboncera.com still does not resolve** — canonical and og:url point at a dead domain.
