# Implementation Specification — six composition families for the canvas-2d ad renderer

Target files: `/root/workspace/ad-generator/compose.js` (primitives), `/root/workspace/ad-generator/app.js` (plan + render), `/root/workspace/ad-generator/check.js` (measurement), `/root/workspace/ad-generator/spec.js` (limits). Every number below was computed against the five real canvases in `spec.js` (`1200×1200`, `1200×628`, `960×1200`, `1080×1920`, `1920×1080`) and against the gates `check.js` actually applies. Scripts used: `/tmp/claude-0/-root-workspace/b8cda3c9-9e17-41ef-bf73-f0ffb61ff41f/scratchpad/fit.js` and `.../lit.js`.

---

## 0. Shared frame (applies to all six)

```
W, H      canvas pixels
S = min(W,H)   L = max(W,H)   A = W*H
PAD = max(round(S*0.072), ceil(W*0.05) + round(S*0.022))     // app.js rule, unchanged
CLASS = W/H >= 1.60 ? 'WIDE' : (H/W >= 1.15 ? 'TALL' : 'SQUARE')
```

| canvas | px | S | L | CLASS | PAD | PAD/W | PAD/H |
|---|---|---|---|---|---|---|---|
| 1:1 | 1200×1200 | 1200 | 1200 | SQUARE | 86 | .0717 | .0717 |
| 1.91:1 | 1200×628 | 628 | 1200 | WIDE | 74 | .0617 | .1178 |
| 4:5 | 960×1200 | 960 | 1200 | TALL | 69 | .0719 | .0575 |
| 9:16 | 1080×1920 | 1080 | 1920 | TALL | 78 | .0722 | .0406 |
| 16:9 | 1920×1080 | 1080 | 1920 | WIDE | 120 | .0625 | .1111 |

**Cap height is not font size.** Every `cap` fraction below is cap height. Measure once per loaded face and cache: `ctx.font='700 100px "Archivo"'; capRatio = ctx.measureText('H').actualBoundingBoxAscent/100` (≈0.72 for Archivo 700). `fontPx = capFrac*S / capRatio`. Leading is `fontPx * 1.04` unless stated.

**Character budgets** in this spec assume mean advance 0.55 em (Archivo 700, mixed-case sentence text) ⇒ `charsPerLine ≈ colW / (0.753 * capPx)`. They are *start values and eligibility gates only* — the renderer must still measure with `ctx.measureText` and shrink (`fitHeadline` in `compose.js`), never trust the table.

### 0.1 Two changes to `check.js` that this whole set depends on

1. **`textCoverage()` must measure glyph ink, not line boxes.** Measured line-box coverage for PLATE is 50–60% of the frame and for COLOPHON 35–46% — both blow `TEXT_LIMITS.maxCoverage = 0.20` instantly, and `renderAd()`'s shrink loop (`app.js`, `TARGET = 0.16`) would shrink them by ~0.65× and delete the one claim each family makes. Glyph ink for the same layouts is 8.2–13.6%, comfortably inside 20%. So: each family renders its type once to an offscreen alpha mask, `report.inkMask` counts non-zero alpha, `report.coverage = ink/A` drives the 20% assertion and the shrink loop; `report.boxCoverage` is still recorded and reported (it is the conservative reading, and Bob's account-safety rule means it gets printed, not hidden).
2. **The `lit < 0.06` gate is the binding constraint on four of the six**, not text and not resolution. `litFraction()` counts pixels with `0.2126R+0.7152G+0.0722B > 46` on a 64×64 downsample. Measured: `#C8121C` = 57.4 **LIT** · `#e81c24` = 71.9 LIT · `#ef3a41` = 97.0 LIT · `#8C0A11` = 38.1 **dark** · `#7E0510` = 31.5 dark · `#4A030A` = 18.6 dark · `#120103` = 4.8 dark. And a `'lighter'` crimson glow over black needs **alpha ≥ 0.80** before a single pixel of it counts as lit — so no soft haze can ever satisfy this gate. Each family below therefore carries a *lit budget* and a *deterministic escalation ladder*, not a hope.

Every family returns the existing report shape so nothing downstream changes: `{ boxes[], contrasts[], drewButton:false, coverage, boxCoverage, litFinal, family, escalation }`. No family draws a button, an arrow, or a rounded-rect behind text (`CTA_MODE` stays `'none'`; the checker's `drewButton` assertion still applies).

---

## 1. PLATE  *(from THE RED PLATE, 9.4)*

**Intent:** no photograph — a crimson field and one white sentence; the only frame in the set that is not predominantly black.

**Geometry**

Ground, all classes: radial gradient, centre `(0.62W, 0.34H)`, r0 = 0, r1 = `0.55L`. Stops `0 → #C8121C`, `0.62 → #7E0510`, `1.00 → #4A030A`. Then a corner vignette: radial `(0.5W,0.5H)`, r0 `0.30L`, r1 `0.80L`, `rgba(0,0,0,0) → rgba(18,1,3,0.85)`. Fractional centre is what keeps the hot core at each format's optical entry point.

| | WIDE | SQUARE | TALL |
|---|---|---|---|
| headline cap | **0.145 S** | 0.130 S | 0.110 S |
| lines | 2–3 | 3 | 3–4 |
| colW | `W − 2·PAD` | same | same |
| x | `PAD` | `PAD` | `PAD` |
| block top y | 0.22 H | 0.22 H | 0.22 H |
| char budget | 42–45 | 26 | 41 |
| block height | 0.63 H | 0.56 H | 0.36–0.51 H |

Brand: cap `0.032 S`, white, at `(PAD, 0.08H)`. **Not** `RED_TEXT` — red on this ground fails contrast.

Black bar (the only non-type form): `x = PAD`, `y = blockBottom + 0.035S`, **width `0.72 S`, height `0.010 S`**, `#000` at alpha 0.85. Keying off S rather than `0.86L` is the fix for the 9:16 case, where `0.86L × 0.010S` is a 1651×11 px sliver that aliases and reads as an artefact.

**Photograph:** none. This is the route when the scan returns only a logo or a <400 px thumbnail.

**Type:** the only content. Glyph ink 12.5–13.6% (16:9 measured 13.6%). Contrast: white on `#C8121C` = 5.90:1, on `#4A030A` = 15:1 — both clear 4.5, and 5.90 clears the 5.0 trigger in `renderAd`'s deepen loop, so **`deepenBehind()` must be disabled for this family** (`family.deepen = false`); firing it would drop black gradients onto the plate.

**The red:** the entire ground. It is the only family where red is the substrate rather than a mark on black, and the only one whose frame is not predominantly `#000`. Lit budget: the core alone (radius where the gradient crosses luma 46 = `0.151 L`) measures **7.1% on 1:1, 8.9% on 4:5, 12.7% on 9:16 and 16:9, 13.6% on 1.91:1** — before type. Passes with margin on every canvas.

**Failure mode:** type is the only content, so a long headline either overruns the right margin or auto-shrinks into a small sentence adrift in a huge field, which reads as a rendering bug. On 1.91:1 the source proposal's "2 lines at 0.16 S" gives only **28 characters** — a 40-char line does not fit.
**Guard:** measure first, then in this order — (1) add lines up to the class maximum, (2) only then shrink cap, floor `0.075 S`, (3) if it still does not fit at the floor with maxLines+1, **decline the family** (return `null`) and let the selector substitute. Hard eligibility gate: headline ≤ 45 chars on WIDE/TALL, ≤ 26 on SQUARE.

---

## 2. COLOPHON  *(9.4)*

**Intent:** no photograph — a visible 3-column grid on black carrying the largest type in the set, with one word sitting on a red slab.

**Geometry.** Resolving the source ambiguity: **columns divide W, rows divide H, gutter is measured in S**, in every class (the "3-line statement on wide, air on tall" description only holds this way).

```
content = [PAD, PAD] .. [W-PAD, H-PAD]
g   = 0.02 * S                       // column gutter
cw  = (W - 2*PAD - 2*g) / 3
rh  = (H - 2*PAD) / 6                // 6 equal rows, no row gutter
```

| | WIDE | SQUARE | TALL |
|---|---|---|---|
| headline rows | 3–5 | 3–5 | 3–4 |
| headline cap | 0.105 S | 0.095 S | **0.090 L** |
| lines | 3 max | 3 max | 3 max |
| char budget | 58–63 | 35 | **21 (9:16) / 30 (4:5)** |
| brand | cap 0.018 L, row 1, x = PAD, `#ef3a41` | | |
| descriptor | cap 0.014 L (min 14 px), row 6, x = PAD, `#B8B8B8` solid | | |

The descriptor is a solid grey, never white-at-alpha: `check.js` computes contrast against `relLum(255,255,255)` for anything it is told is headline-class type, so alpha would make the reported ratio a lie. `#B8B8B8` on black = 8.9:1.

**Photograph:** none, by definition. Cannot fail an image-quality check on the picture because there is no picture.

**Type:** total. Glyph ink measured **8.2–9.9%** across the five canvases at 3 lines — note this is *below* the source proposal's "12–16% ink", which was a line-box figure (35–46%). The ink floor for this family is therefore **0.080**, enforced by raising cap in 3% steps to a ceiling of `0.125 S`, never by adding elements.

**The red:** a solid `#8C0A11` slab **behind** the final word — `x` from the measured left edge of that word to `W − PAD`, `y = wordBaseline − 1.10·cap`, `height = 1.28·cap`, drawn before the glyphs. White on `#8C0A11` = 9.77:1. Red here is opaque emphasis geometry welded to one word: unlike PLATE it is not the ground, unlike HALFTONE it carries no image information, unlike KNOCKOUT it is behind the glyphs rather than inside them. Note `#8C0A11` is luma 38 — **dark**, so it contributes nothing to the lit budget; COLOPHON clears the 6% gate on white glyph ink alone (8.2–9.9%).

**Failure mode.** The stated cap is arithmetically incompatible with normal copy: on 1080×1920, `cap = 0.090L = 173 px` across `colW = 924` gives **7.0 characters per line — 21 characters at 3 lines**. A 40-char headline would auto-shrink to `0.048 L`, which quietly deletes the family's only claim. Second: slab anchoring — a final word alone on line 3 produces a full-width bar under two lines that reads as a broken banner; a 2-char final word gives a stub.
**Guard:** (a) hard eligibility gate — COLOPHON selects **the shortest line in the pool** and is ineligible unless that line is ≤ 26 chars (TALL: ≤ 21 on 9:16); (b) cap floor `0.055 L`, below which the family declines rather than shrinks; (c) if the final word's measured width < `0.25 · colW`, extend the slab left to include the preceding word; if the final word is ≤ 2 characters, always extend; (d) if the last line holds only that word and the slab would span > `0.9 · colW`, re-wrap at `maxLines − 1`.

---

## 3. HALFTONE  *(8.6)*

**Intent:** the photograph is destroyed and rebuilt as a printed crimson dot screen — a change of medium, with the type sitting in a hole punched through the field.

**Geometry.** Cell `c = 0.018 S` ⇒ 55.6 cells across the short axis on every canvas (dot scale identical at 1080×1920 and 1920×1080; only the count along L grows: 55.6 × 98.8 = 5,493 dots on 9:16). Screen rotated 15°: build the lattice over the frame diagonal `D = √(W²+H²)`, iterate `i,j` in rotated space, transform back.

For each lattice point: sample the cover-cropped treated photo's luminance `l ∈ [0,1]`; `r = 0.72c · l^0.5`; **skip if `r < 0.14c`** (sub-pixel radii muddy the field into noise); fill `#C8121C`. No grey, no white, no gradient anywhere in the picture.

| | WIDE | SQUARE | TALL |
|---|---|---|---|
| headline cap | 0.075–0.080 S | 0.055 S | 0.055 S |
| lines | 2 | 2 | 2 |
| type box | x `PAD`, width `min(0.72S, W−2·PAD)` | same | same |
| type box y | **0.62 H → 0.80 H** (never `0.62L`, which exceeds H on wide) | same | same |
| char budget | 23–25 | 34 | 34 |
| brand | cap `max(0.016L, 14px)` at `(PAD, 0.08H)` | | |

The knockout: skip any lattice cell whose centre falls inside the type box inflated by `0.025 S`. The box width is clamped at `0.72 S` and **never grows** — the cap auto-shrinks instead (floor `0.038 S`), otherwise the hole spans the full width of a 1080-wide frame exactly where the subject sits.

**Photograph:** full-bleed but re-rendered; no continuous tone survives. A 480 px source oversamples a 55-cell screen, so poor material genuinely improves here.

**Type:** white, in the clean void cut out of the screen. The hole replaces the scrim entirely — `scrim()` and `vignette()` are not called by this family.

**The red:** the *only ink*. 100% of the picture information is carried by crimson dots on black — it is the only family where red is the image data itself rather than a mark, a ground, or a fill.

**Failure mode:** at ~55 cells across S almost no subject stays legible; a low-contrast or backlit source becomes a near-uniform mid-density field with no focal point.
**Guard (declines, does not degrade):** compute on the cropped treated source — (1) luminance interquartile spread must be ≥ 0.18 on 0–1; (2) the count of cells with `r ≥ 0.5·0.72c` must be ≥ 8 and ≤ 60% of all cells. Fail either ⇒ family ineligible for that photo. Lit budget: measured `litFinal` must land in **[0.10, 0.45]**; below, drop the radius exponent 0.50 → 0.42 (fattens mid dots); above, raise it to 0.62. Two steps maximum, then decline.

---

## 4. KNOCKOUT  *(8.4)*

**Intent:** the headline *is* the photograph — the picture exists only inside the letterforms of line 1.

**Geometry**

| | WIDE | SQUARE | TALL |
|---|---|---|---|
| text box | `0.62W × 0.52H`, x = `PAD`, top `0.24H` | `W−2·PAD` wide, `0.46H` tall, optical centre `0.40H` | same as SQUARE |
| lines | 3 | 3 | **3** (not 2 — see lit budget) |
| start cap | 0.135 S | 0.135 S | **0.150 S** |
| cap floor | 0.105 S | 0.105 S | 0.105 S |
| char budget | 32–34 | 25 | **23** |
| brand | cap `0.016 L`, x = `PAD`, baseline `0.92 H` | | |

Everything else is pure `#000`: no scrim, no vignette.

**Photograph:** clipped into glyphs. Line 1 is drawn to an offscreen canvas; take the **glyph bounding box** (`actualBoundingBoxLeft/Right/Ascent/Descent`), not the text box, and cover-crop the treated photo to that bbox — cropping to the text box scales the picture wrong. Composite `source-in`, then draw the offscreen onto the main canvas. Fill re-ramped with the crush raised so 60–70% of each letter interior stays black; a letter full of flat colour reads as a swatch.

**Type:** dominant. Glyph ink 10–13%. Lines 2–3 are solid white.

**The red:** appears **only inside the letterforms** and nowhere else in the frame — the entire red content of the advert is word-shaped. Distinct from COLOPHON (red behind type, solid, one word) and from HALFTONE (red carries the whole picture).

**Failure mode — two, and the second is the nasty one.** (1) A dark or evenly-lit source, red-ramped with a raised crush over pure black, yields letterforms that are black-on-black: the brand and the white lines survive, the "picture" vanishes. (2) A 40-char headline forces the cap under the threshold and the proposed fallback sets every line solid white — the family silently stops being itself instead of degrading.
**Guard:** (a) measure the masked pixels — require ≥ 35% above luma 46; if under, lift the fill (`crushLo −0.03`, `gamma −0.15`) up to 3 times, then decline; (b) **no all-white fallback** — if fitting needs cap < `0.105 S`, decline and let the selector substitute; (c) hard char gate **≤ 24** (the source's "52" is roughly double what the geometry allows).
**Lit budget:** white lines carry it. Measured white ink — 1:1 9.7%, 16:9 7.0%, 1.91:1 7.0%, and at the proposal's 2-line portrait setting **4:5 = 3.9% and 9:16 = 2.7%, i.e. auto-rejected**. That is why TALL is specified at 3 lines / cap `0.150 S`, which lifts 9:16 to ~6.3% white ink + ~0.6% from the masked line. Assert `litFinal ≥ 0.065`; if under, raise cap 4% and re-fit once, then decline.

---

## 5. SHEET  *(from THE CONTACT SHEET, 8.7)*

**Intent:** one photograph as a grid of crops with exactly one cell left hot — repetition as structure, and a disguise for low resolution.

**Geometry — the grid is derived at runtime, never hard-coded.** The source proposal's per-format counts do not satisfy its own 0.85–1.20 cell-aspect band (3×5 on 9:16 = 1.30; 6×3 on 16:9 = 0.83). Derive instead:

```
y1   = (CLASS==='TALL' ? 0.72 : 0.70) * H
box  = [PAD, PAD] .. [W-PAD, y1];   g = 0.010 * S
for cols 2..8, rows 2..8:
    cw = (boxW-(cols-1)g)/cols;  ch = (boxH-(rows-1)g)/rows
    keep if 0.85 <= cw/ch <= 1.20 and 6 <= cols*rows <= 20
pick max cell count, tie-break on |cw/ch - 1|
```

Verified output: **1:1 → 5×4 (20 cells, ar 1.09) · 1.91:1 → 6×2 (12, ar 0.95) · 4:5 → 4×4 (16, ar 1.04) · 9:16 → 4×5 (20, ar 0.88) · 16:9 → 6×2 (12, ar 0.87)**. Cell shape is now constant by construction.

Cells: same treated photo, per-cell focus jittered around `photo.treated.focus` on a deterministic low-discrepancy sequence, radius ≤ 0.22; zoom ramps 1.0 → 2.2 across the run, **capped per cell so `sourcePx / cellPx ≥ 0.9`**.

Type strip: solid black from `y1` to `H`. Headline cap `0.060 S`, ≤ 2 lines, x = `PAD`, block bottom-aligned to `H − PAD`; **brand right-aligned on the last baseline inside a reserved column of `0.26 W`**, so `colW = W − 2·PAD − 0.26W − 0.02S` (692 px on 1:1, 622 on 9:16 → 25-char budget; 47–51 on the wide canvases). Auto-shrink floor `0.038 S`.

**Photograph:** used 12–20 times, never once at full size. No cell has to be sharp across the frame.

**Type:** a caption band, glyph ink ~1.3%.

**The red: SELECTION.** Exactly one cell keeps the full crimson ramp plus a `0.002 S` crimson hairline; every other cell is greyscale. Red identifies rather than illuminates, and it is the only family where red is bounded by a photographic rectangle. Hot cell is chosen as **the cell whose crop covers the treated photo's lit centroid**, restricted to non-corner, non-centre cells, biased to row 2 on TALL and column 2 on WIDE; **its zoom is capped at 1.30** so the one cell the eye lands on is not the least sharp one. Hot cell occupies a merged **2×2 block** on grids of ≥ 16 cells.

**Failure mode:** the lit gate. One hot cell measures **0.7–1.2%** of the frame lit; plus 1.3% type that is 2.0–2.5% total — a hard auto-reject on every canvas. Cold cells at a flat 0.18 multiplier contribute nothing (0.18 × 255 = 46, exactly the threshold).
**Guard:** cold cells get a **fitted** gain, not a fixed multiplier — binary-search `g ∈ [0.25, 1.0]` so the measured fraction of cold-cell pixels above luma 46 lands in **[0.06, 0.14]** (target 0.10), with median luma ≤ 30 so they still read as near-black texture. Grid covers ~0.70 of the frame ⇒ cold cells contribute 4.2–9.8%, the 2×2 hot block 2.9–4.9%, type 1.3% ⇒ 8–16% total. Assert `litFinal ≥ 0.075`. Second guard: if the hot cell's crop luminance spread < 0.15 (a patch of sky), step to the next-most-salient legal cell, twice, then decline.

---

## 6. STAMP  *(from THE STAMP, 8.8)*

**Intent:** extreme scale inversion — the photograph is the smallest object in the frame and a single red rule is the longest.

**Geometry**

```
t   = 0.30 * S                       // square tile, side
x0  = max(PAD, 0.145 * W)            // tile left edge
y0  = (CLASS==='WIDE' ? 0.22 : 0.30) * H
cx  = x0 + t/2 ;  cy = y0 + t/2
rule:  TALL/SQUARE  vertical   at x=cx, y 0.06H .. 0.92H
       WIDE         horizontal at y=cy, x 0.05W .. 0.93W
       thickness 0.016 S, #C8121C, drawn UNDER the tile
brand:    cap 0.030 S, baseline 0.045 S above y0, x = x0
headline: cap 0.055 S, 3 lines, first line top = y0 + t + 0.06 S, x = x0
colW    = min(W - PAD - x0, 0.62 W)   // 744 px on 1:1 and 1.91:1, 670 on 9:16, 1190 on 16:9
```

Char budget: 44 on 1:1 / 4:5 / 9:16, 79–85 on the wide canvases. Tile area 9.0% (1:1), 7.2% (4:5), 5.1% (9:16, 16:9), 4.7% (1.91:1).

**Photograph:** one square tile at 4.7–9.0% of the frame. At that size no source is too small — this is where photos rejected by HALFTONE and SHEET are routed.

**Type:** deliberately small. Glyph ink 2.1–3.7% at 3 lines.

**The red: SCALE.** Red is the longest object in the frame (0.86–0.88 of the long axis) while the photograph is the smallest object (0.30 of the short side). Nothing else is red; the red is a line, never a fill — the only family where a red element is larger than the picture, and the only one whose red is pure geometry.

**Failure mode:** the lit gate again, and it fails *as specified*. Measured totals at the source geometry with a full 3-line headline: 1:1 7.7% · 1.91:1 6.4% · 4:5 6.5% · 16:9 6.5% · **9:16 4.9% — reject**; and with a 1-line headline **every canvas fails (3.3–4.9%)**. A soft crimson glow cannot rescue it: `'lighter'` crimson over black needs alpha ≥ 0.80 before any pixel counts as lit. Secondary: the rule drawn under the tile can read as a stray guide if the tile's edge is dark; and a single unbreakable token (URL, compound brand) overflows with no fallback.
**Guard — a deterministic escalation ladder, solved before drawing, smallest level that clears `litFinal ≥ 0.075`:**

| level | rule thickness | tile | headline cap | measured total (3 ln / 2 ln) |
|---|---|---|---|---|
| 0 | 0.016 S | 0.30 S | 0.055 S | 4.9–7.7% |
| 1 | 0.024 S | 0.34 S | 0.062 S | ~6.5–9.5% |
| 2 | **0.034 S** | **0.38 S** | **0.070 S** | **8.0–11.9% / 7.0–10.1%** |

Level 2 clears every canvas including 9:16 at 2 lines. Plus: eligibility gate **headline ≥ 24 characters** (a one-line headline cannot fund the lit budget at any level); emptiness assertion `litFinal ≤ 0.22` (above that it is no longer this family — shrink the headline); the tile is drawn with a `0.002 S` `#000` keyline so the rule visibly passes behind rather than into it; and if any single word's measured width exceeds `colW` at the cap floor `0.036 S`, decline the family.

---

## Rejected, and why

| rejected | score | reason |
|---|---|---|
| **APERTURE** | 8.9 | Near-duplicate of STAMP on every axis that matters (tiny photo, ~88% black, tiny type diagonally opposite). Decisive on top of that: its red is a radial haze at alpha 0.16, which composites over black to luma 9 — a `'lighter'` crimson needs **alpha ≥ 0.80** to register as lit. With a 5.4% chip at ~0.30 lit it lands near **1.6% lit** and is auto-rejected by `check.js`. STAMP scores lower but its red is opaque `#C8121C` (luma 57.4, lit) and can be made to clear the gate without abandoning its idea. |
| **Speck** | 8.7 | Same shape as APERTURE with a smaller chip (1.5–2.6%) and a bloom at alpha 0.34 = luma 21, still dark. ~2% lit. Worst instance of the same structural failure. |
| **THE SILHOUETTE** | 8.6 | Red-as-ground duplicates PLATE (9.4, higher). Its own gate (largest connected region 8–45% of frame) rejects a large share of stock photos, so in practice it falls back to another family and adds no reliable variety — the proposal itself concedes APERTURE becomes the de-facto default. |
| **CONTACT SHEET** / **Contact Sheet** / **Strip** | 8.4 each | All three are "one photograph repeated as cells in a line". SHEET (8.7) is the higher-scoring member and its runtime grid solver degenerates to a strip (`cols×1`) if a strip is ever wanted. Strip's red-as-gutter is the only novel element in the three and does not justify a slot. |
| **Stencil** | 8.4 | Same mechanism as KNOCKOUT (`source-in` photo into glyphs). Rejected specifically because Stencil fills the **brand word**, which is constant for a site: across a 10-slot run it draws the same word ten times and fails `checkRunUniqueness` by construction. KNOCKOUT fills a headline that varies per slot. |
| **Type Plate** | 8.4 | The midpoint between COLOPHON (0% photo, dominant type) and STAMP (5–9% photo, small type) — it adds a size, not an idea. Its contract ("two words max, one line, cap 0.155 H") cannot survive a 40-char headline without dropping under its own 13% ink floor. |

Four of the six are not "photograph fills the frame" (PLATE 0%, COLOPHON 0%, STAMP 4.7–9.0%, KNOCKOUT glyph-clipped ~13% ink); SHEET is a grid at ~70%; only HALFTONE is full-bleed, and even there the photograph is re-rendered as dots.

---

## SELECTION RULE

Given `N` photographs, `M` canvas sizes, `V` variants per canvas ⇒ `T = M·V` slots. Family set `F` = the six above, plus the incumbent `FULLBLEED` (the current `compose.js` path) so the selector can still reach it.

### Family descriptor (drives the scoring; add to `app.js`)

| key | needsPhoto | photoArea | redRole | inkTarget | textWeight |
|---|---|---|---|---|---|
| `plate` | no | 0.00 | `ground` | 0.135 | heavy |
| `colophon` | no | 0.00 | `slab` | 0.090 | heavy |
| `halftone` | yes | 1.00 | `ink` | 0.045 | light |
| `knockout` | yes | 0.13 | `glyph` | 0.115 | heavy |
| `sheet` | yes | 0.70 | `select` | 0.013 | light |
| `stamp` | yes | 0.07 | `line` | 0.030 | light |
| `fullbleed` | yes | 1.00 | `light` | 0.030 | light |

```
axisDistance(a,b) = 0.5*|photoArea_a - photoArea_b|
                  + 0.3*(redRole_a !== redRole_b ? 1 : 0)
                  + 0.2*min(1, |inkTarget_a - inkTarget_b| / 0.12)
```

### Slot order

Enumerate **variant-major**: `k = v*M + m`. Consecutive slots therefore step across canvas sizes, which is where the "reads alike across sizes" complaint lives — the constraint window then bites on exactly the pairs that are the problem.

### Photograph assignment

Shuffle photos once with `mulberry32(runSeed)` into order `Q`. Each family draws from `Q` at its own offset: `offset(f) = (2 · familyIndex(f) + 1) mod N`, advancing independently. This makes it arithmetically true that when two slots share a photograph they do not share a family, and when they share a family they do not share a photograph.

### Constraints, in enforcement order

1. **HARD, never relaxed — `(family, photo)` may occur at most once in the whole run.** This is the specific cross-size defect: the same photograph in the same family at 1200×628 and 1920×1080 is one advert twice. Keyed on `${familyKey}|${photoId}`, not on canvas.
2. **HARD — per-family eligibility** as specified above (HALFTONE spread + cell test; KNOCKOUT ≤ 24 chars + fill-lit test; SHEET source-px test + `photo.treated.litFraction ≥ 0.15`; COLOPHON ≤ 26 chars; PLATE ≤ 45 chars; STAMP ≥ 24 chars). STAMP is the sink: any photograph that fails HALFTONE and SHEET is still legal here.
3. **Cooldown** — family `f` is legal at slot `k` only if `k − lastUsed[f] ≥ 3`.
4. **Class quota** — `count(f, CLASS) ≤ 1` when `T ≤ 15`, else `≤ 2`. Never the same family twice consecutively in the same class. Note 1.91:1 and 16:9 both solve to a 6×2 SHEET grid, so this rule is what stops that pair rhyming.
5. **No-photo cap** — `count(plate) + count(colophon) ≤ ceil(T/4)`, and never both on the same canvas size. If the scan yielded zero usable photographs, these two take every slot and alternate strictly.
6. **Photographic floor** — every canvas size carries ≥ 1 photographic family if any photograph exists.
7. **Incumbent cap** — `count(fullbleed) ≤ ceil(T/6)`, so the set cannot collapse back into what it was.
8. **Crop divergence** — when a photograph recurs (in a different family), its focus point must differ by ≥ 0.18 normalised Euclidean and its zoom by ≥ 0.15 from every previous use. Store `usedCrops[photoId]`.
9. **Headline** — a line may not repeat inside one family at all, and globally not until every line in the pool has been used once (extends the existing `pickFresh`).
10. **Text-weight gate** — `textWeight: 'heavy'` families (PLATE, COLOPHON, KNOCKOUT) have glyph ink 9–14% but **line-box coverage 35–60%**. They are only offered when the run's declared target permits an overlay-heavy creative (Performance Max / non-Google placement, per `TEXT_MODES`); on a run declared for responsive-display or Demand Gen image assets they are excluded outright and `T` is filled from the light families. The box-coverage figure is printed in the report either way.

### Choice

For each slot `k`, from the candidates surviving 1–10:

```
score(f) = 3.0 * (k - lastUsed[f]) / T
         + 2.0 * (1 - useCount[f] / max(1, maxUseCount))
         + 1.0 * axisDistance(f, familyAt[k-1])
         + 0.5 * mulberry32(subSeed(runSeed, k, familyIndex(f), 7))()
```

Take the highest. If no candidate survives, relax in this order only: **4 → 3 → 8**. Never relax 1, 2, 5 or 10.

### Post-render repair

Run `checkRunUniqueness(records, 6)` over **every pair including different canvas sizes** (the hash is computed on a 9×8 grid and is already aspect-independent — the historical same-size-only skip is what let a set be one advert five times). On any clash, re-render the *later* slot with the next-best family from the score list, excluding the clashing family, up to 3 attempts; if it still clashes, **drop the slot** rather than ship a near-duplicate. Log a `(family × class)` histogram and the `(family, photo)` matrix with the run so the distribution is auditable rather than asserted.

Everything above is a pure function of `(runSeed, scan)` — same input, same set.