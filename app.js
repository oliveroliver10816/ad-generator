/* Ad renderer. Draws one image per job onto a canvas at an exact pixel size.
 *
 * Composition primitives live in compose.js. This file owns the plan: which
 * layout, which crop, which light, which words — and the export path.
 *
 * Canvas sizes, the call-to-action rule and the text limits are not invented
 * here; they come from spec.js, which records what Google actually publishes.
 */


/* ---------------------------------------------------------------- rng --- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
/** Prefer something not used yet; fall back to the whole pool when exhausted. */
function pickFresh(r, arr, avoid) {
  if (!avoid || !avoid.size) return pick(r, arr);
  const fresh = arr.filter(x => !avoid.has(x));
  return pick(r, fresh.length ? fresh : arr);
}
function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Mix a run seed with per-image coordinates: every image is independent, the
 *  whole run is still reproducible from one number. */
function subSeed(runSeed, a, b, salt) {
  let h = runSeed ^ 0x9E3779B9;
  h = Math.imul(h ^ (a + 1), 0x85EBCA6B);
  h = Math.imul(h ^ (b + 1), 0xC2B2AE35);
  h = Math.imul(h ^ ((salt || 0) + 1), 0x27D4EB2F);
  return (h ^ h >>> 15) >>> 0;
}

/* -------------------------------------------------------------- words --- */
/* Deliberately small: a brand name and one short line. More than that starts
   to look like a poster, and heavy text is the thing Google's own image
   guidance warns about. */
function splitRef(text) {
  return String(text || '').split(/[\n\r]+|(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function buildPools(scan, refText) {
  const L = TEXT_LIMITS;
  const ref = splitRef(refText);
  const fit = (arr, max) => (arr || []).filter(s => s && s.length <= max);
  const weighted = (base, extra) => extra.length ? [...extra, ...extra, ...base] : base;

  const heads = weighted(fit(scan.headlinePool, L.headlineMax), fit(ref, L.headlineMax));
  const shorts = weighted(fit(scan.headlinePool, L.shortMax), fit(ref, L.shortMax));
  const ctas = fit(scan.ctaPool, L.ctaMax);

  return {
    headline: heads.length ? heads : [scan.brandName],
    short: shorts.length ? shorts : (heads.length ? heads : [scan.brandName]),
    cta: ctas.length ? ctas : ['Learn more'],
  };
}

/* --------------------------------------------------------------- plan --- */
const LAYOUTS = ['bottom-left', 'bottom-center', 'top-left', 'center-left', 'edge-left'];
const LIGHTS = ['bar', 'streak', 'bloom', 'none'];

function makeJob(scan, pools, runSeed, aspect, aspectIdx, varIdx, salt, avoid) {
  const seed = subSeed(runSeed, aspectIdx, varIdx, salt);
  const r = mulberry32(seed);
  /* Weight the choice toward photographs that carry light. A near-black source
     can still be used, just less often. */
  let photo = null;
  if (scan.photos.length) {
    const weights = scan.photos.map(p => 0.25 + (p.treated ? p.treated.litFraction : 0.2) * 4);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = r() * total;
    for (let i = 0; i < scan.photos.length; i++) {
      t -= weights[i];
      if (t <= 0) { photo = scan.photos[i]; break; }
    }
    photo = photo || scan.photos[0];
  }

  const tall = aspect.h / aspect.w > 1.1;
  const wide = aspect.w / aspect.h > 1.7;
  let layout = pick(r, LAYOUTS);
  if (wide && layout === 'bottom-center') layout = 'edge-left';
  if (tall && layout === 'edge-left') layout = 'bottom-left';

  return {
    seed, aspect, aspectIdx, varIdx,
    W: aspect.w, H: aspect.h, label: aspect.label, ratio: aspect.ratio,
    photo,
    brandName: scan.brandName,
    site: scan.host,
    // Don't repeat a line inside one run — a pool of four headlines otherwise
    // puts the same three words on half the set.
    headline: pickFresh(r, (wide || tall) ? pools.short : pools.headline, avoid),
    cta: pick(r, pools.cta),
    layout,
    light: pick(r, LIGHTS),
    scrimKind: layout.startsWith('bottom') ? 'bottom'
             : layout === 'top-left' ? 'top'
             : layout === 'edge-left' ? 'left' : 'corner',
    scrimStrength: 0.60 + r() * 0.26,
    vignetteAmt: 0.30 + r() * 0.22,
    // Crop around where the light is, with enough jitter that two versions of
    // the same ratio still frame the subject differently.
    fx: clamp01((photo && photo.treated ? photo.treated.focus.x : 0.5) + (r() - 0.5) * 0.34),
    fy: clamp01((photo && photo.treated ? photo.treated.focus.y : 0.5) + (r() - 0.5) * 0.30),
    zoom: (photo && photo.treated
             ? 1.0 + Math.max(0, 0.34 - photo.treated.litFraction) * 1.5
             : 1.0) + r() * 0.16,
    grainSeed: (r() * 1e9) >>> 0,
    grainAmount: 0.030 + r() * 0.026,
    lightSeed: (r() * 1e9) >>> 0,
  };
}

/* ------------------------------------------------------------- render --- */

/* Where the type sits and how big it is, for a given scale. Pure measurement —
   nothing is drawn, so it can be run repeatedly until it fits. */
function layoutText(ctx, job, mode, scale) {
  const { W, H } = job, MIN = Math.min(W, H);
  /* Padding is driven by the short side for looks, but it can never be less
     than the 5% either side that Google may crop off a wide canvas — on a
     1920 × 1080 that margin is 96px, well past a short-side-derived inset. */
  const pad = Math.max(Math.round(MIN * 0.072),
                       Math.ceil(W * TEXT_LIMITS.safeMarginX) + Math.round(MIN * 0.022));
  const centre = job.layout === 'bottom-center';
  const colW = centre ? W - pad * 2
             : Math.min(W - pad * 2, W * (job.layout === 'edge-left' ? 0.60 : 0.84));
  const x = centre ? W / 2 : pad;
  const boxX = centre ? (W - colW) / 2 : pad;

  const brandPx = Math.max(8, Math.round(MIN * 0.034 * scale));
  const startPx = Math.round(MIN * (job.layout === 'edge-left' ? 0.095 : 0.106) * scale);
  const maxLines = (H / W > 1.05) ? 3 : (W / H > 1.7 ? 2 : 2);

  let head = null, lineH = 0;
  if (mode.headline) {
    head = fitHeadline(ctx, job.headline, colW, H * 0.34, maxLines, DISPLAY_FONT, startPx);
    lineH = head.size * 1.1;
  }
  const blockH = (mode.brand ? brandPx * 1.85 : 0) + (head ? head.lines.length * lineH : 0);

  let y = job.layout.startsWith('bottom') ? H - pad - blockH
        : job.layout === 'top-left' ? pad
        : (H - blockH) / 2;
  y = Math.max(pad, Math.min(y, H - pad - blockH));

  const boxes = [];
  let cy = y;
  if (mode.brand) {
    const label = job.brandName.toUpperCase();
    ctx.font = `700 ${brandPx}px "${UI_FONT}", sans-serif`;
    ctx.letterSpacing = `${(brandPx * 0.14).toFixed(2)}px`;
    const bw = Math.min(colW, ctx.measureText(label).width);
    ctx.letterSpacing = '0px';
    boxes.push({ kind: 'brand', label, x: centre ? (W - bw) / 2 : boxX, y: cy, w: bw, h: brandPx * 1.2 });
    cy += brandPx * 1.85;
  }
  if (head) {
    ctx.font = `700 ${head.size}px "${DISPLAY_FONT}", Georgia, serif`;
    const widest = Math.max(...head.lines.map(l => ctx.measureText(l).width));
    boxes.push({ kind: 'head', x: centre ? (W - widest) / 2 : boxX, y: cy,
                 w: Math.min(colW, widest), h: head.lines.length * lineH });
  }
  return { boxes, brandPx, head, lineH, x, centre, colW, y, pad };
}

/** A soft, local darkening behind one text box. Shaped like a gradient rather
 *  than a panel, so it reads as lighting rather than as a label. */
function deepenBehind(ctx, box, W, H, amount) {
  const padX = box.w * 0.35 + W * 0.05, padY = box.h * 0.9 + H * 0.04;
  const x0 = box.x - padX, y0 = box.y - padY;
  const w = box.w + padX * 2, h = box.h + padY * 2;
  const g = ctx.createRadialGradient(box.x + box.w / 2, box.y + box.h / 2, 0,
                                     box.x + box.w / 2, box.y + box.h / 2, Math.max(w, h) * 0.62);
  g.addColorStop(0, `rgba(0,0,0,${amount})`);
  g.addColorStop(0.55, `rgba(0,0,0,${amount * 0.7})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x0 - w * 0.4, y0 - h * 0.4, w * 1.8, h * 1.8);
}

/* Returns a report the checker consumes: the boxes the text occupied, and the
   contrast each achieved against the picture underneath. Background is sampled
   before the text is drawn — over photography, contrast cannot be reasoned
   about from the palette. */
function renderAd(cv, job, textModeKey) {
  const { W, H } = job;
  const mode = TEXT_MODES[textModeKey] || TEXT_MODES.brand;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const report = { boxes: [], contrasts: [], drewButton: false, mode: textModeKey, shrunk: 1, deepened: 0 };

  /* Compose the picture, then look at it. If the frame came out nearly empty —
     a dim photograph plus a vignette plus a scrim can do that — ease the
     darkening and tighten the crop, and try again. Four attempts converge;
     the alternative is shipping a black rectangle and calling it an ad. */
  let lit = 0, easeMul = 1, zoomMul = 1, attempts = 0;
  for (; attempts < 4; attempts++) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (job.photo && job.photo.treated) {
      coverDraw(ctx, job.photo.treated, W, H, job.fx, job.fy, job.zoom * zoomMul);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#170609'); g.addColorStop(1, '#000');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (job.light !== 'none') redLight(ctx, W, H, job.light, mulberry32(job.lightSeed), RED_GLOW);

    const litPhoto = litFraction(cv);
    if (attempts === 0) report.litPhoto = litPhoto;
    const ease = (litPhoto < 0.34 ? Math.max(0.18, litPhoto / 0.34) : 1) * easeMul;
    vignette(ctx, W, H, job.vignetteAmt * ease);
    if (mode.brand || mode.headline) scrim(ctx, W, H, job.scrimKind, job.scrimStrength * ease);

    lit = litFraction(cv);
    if (lit >= 0.11) break;
    easeMul *= 0.45;
    zoomMul += 0.26;
  }

  /* Last resort for a photograph that simply has very little light in it:
     ambient glow rather than an empty frame. Reads as part of the lighting,
     and it is the same red the rest of the composition uses. */
  for (let i = 0; i < 5 && lit < 0.11; i++) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(W * 0.5, H * 0.52, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.85);
    g.addColorStop(0, 'rgba(176,22,30,0.34)');
    g.addColorStop(0.6, 'rgba(120,14,20,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    lit = litFraction(cv);
    report.lifted = (report.lifted || 0) + 1;
  }
  report.attempts = attempts;
  report.litComposed = lit;

  const wantsText = mode.brand || mode.headline;
  if (!wantsText) {
    grainPass(ctx, job, W, H);
    report.litFinal = litFraction(cv);
    return report;
  }

  /* Size the type down until it sits under the coverage limit. Google's
     responsive display guidance: "Text may cover no more than 20% of the
     image." Aiming at 16% leaves room for the measurement to be imperfect. */
  const TARGET = TEXT_LIMITS.maxCoverage * 0.8;
  let scale = 1, L = layoutText(ctx, job, mode, scale);
  for (let i = 0; i < 14 && textCoverage(L.boxes, W, H) > TARGET && scale > 0.35; i++) {
    scale *= 0.92;
    L = layoutText(ctx, job, mode, scale);
  }
  report.shrunk = scale;

  /* White type over a photograph can land on a blown highlight. Deepen the
     picture locally until it clears AA, rather than accepting 1.6:1 or moving
     the text somewhere the composition did not intend. */
  for (const box of L.boxes) {
    const fg = box.kind === 'brand' ? relLum(239, 58, 65) : relLum(255, 255, 255);
    let amount = 0.34, tries = 0;
    while (tries < 7 && contrast(fg, bgLuminance(ctx, box, W, H)) < 5.0) {
      deepenBehind(ctx, box, W, H, amount);
      amount = Math.min(0.72, amount + 0.1);
      tries++;
    }
    report.deepened += tries;
    report.contrasts.push({
      what: box.kind === 'brand' ? 'brand name' : 'headline',
      ratio: contrast(fg, bgLuminance(ctx, box, W, H)),
    });
    report.boxes.push({ x: box.x, y: box.y, w: box.w, h: box.h });
  }

  ctx.textAlign = L.centre ? 'center' : 'left';
  ctx.textBaseline = 'top';
  for (const box of L.boxes) {
    if (box.kind === 'brand') {
      ctx.font = `700 ${L.brandPx}px "${UI_FONT}", sans-serif`;
      ctx.letterSpacing = `${(L.brandPx * 0.14).toFixed(2)}px`;
      ctx.fillStyle = RED_TEXT;
      ctx.fillText(box.label, L.x, box.y);
      ctx.letterSpacing = '0px';
    } else {
      ctx.font = `700 ${L.head.size}px "${DISPLAY_FONT}", Georgia, serif`;
      ctx.fillStyle = '#ffffff';
      let y = box.y;
      for (const ln of L.head.lines) { ctx.fillText(ln, L.x, y); y += L.lineH; }
    }
  }
  ctx.textAlign = 'left';

  /* No button is drawn anywhere in this file; CTA_MODE exists so the checker
     can assert that rather than trusting the code simply never does it. */
  if (CTA_MODE === 'button') report.drewButton = true;

  grainPass(ctx, job, W, H);
  report.litFinal = litFraction(cv);
  return report;
}

function grainPass(ctx, job, W, H) {
  const tile = grainTile(mulberry32(job.grainSeed));
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = job.grainAmount;
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ---------------------------------------------------------------- zip --- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ c >>> 8;
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/** Store-only ZIP: PNG and JPEG are already compressed. */
function makeZip(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, v >> 8 & 255];
  const u32 = (v) => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...name]);
    chunks.push(local, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0),
      ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...name]));
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

/* ------------------------------------------------------------- export --- */
/* Canvas exports carry no EXIF, so nothing from the source photograph or this
   machine travels with the file. */
async function canvasToBlob(cv, name) {
  // Image assets are allowed 5 MB, so quality is nearly free — but a 1200px
  // photographic PNG is several MB for no visible gain, so JPEG is the default
  // and PNG is only kept when it happens to be smaller.
  const png = await new Promise(res => cv.toBlob(res, 'image/png'));
  let best = { blob: png, ext: 'png' };
  for (const q of [0.94, 0.9, 0.86, 0.82, 0.76, 0.7]) {
    const jpg = await new Promise(res => cv.toBlob(res, 'image/jpeg', q));
    if (jpg.size < best.blob.size) best = { blob: jpg, ext: 'jpg' };
    if (best.blob.size <= FILE_RULES.targetBytes) break;
  }
  return { blob: best.blob, name: `${name}.${best.ext}`, bytes: best.blob.size, ext: best.ext };
}

let UI_FONT = 'Archivo', DISPLAY_FONT = 'Archivo';
