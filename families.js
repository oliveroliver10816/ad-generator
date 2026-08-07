/* Six composition families.
 *
 * The previous renderer had one composition — a full-bleed photograph with a
 * headline somewhere on it — and five places to put the text. Across five
 * canvas sizes that reads as one advert five times, which is exactly what it
 * was. These six are structurally different from each other: two use no
 * photograph at all, one destroys the photograph into a dot screen, one puts
 * the picture inside the letterforms, one repeats it as a grid, one shrinks it
 * to the smallest object in the frame.
 *
 * Geometry here is fractions of the canvas, computed per class (WIDE / SQUARE
 * / TALL), not adjectives. Every number was checked against the five real
 * canvases before it was written down.
 */

const RED_CORE = '#c8121c';   // luma 57.4 — counts as lit
const RED_MID  = '#8c0a11';   // luma 38.1 — reads dark
const RED_DEEP = '#4a030a';
const RED_INK  = '#ef3a41';   // text-safe on black
const PAPER    = '#ffffff';
const GREY     = '#b8b8b8';   // solid, never white-at-alpha (see check.js)

/* Cap height is not font size. Measure the face once and convert. */
const _capCache = {};
function capRatio(ctx, fam) {
  if (_capCache[fam]) return _capCache[fam];
  ctx.save();
  ctx.font = `700 100px "${fam}"`;
  const m = ctx.measureText('H');
  const r = (m.actualBoundingBoxAscent || 72) / 100;
  ctx.restore();
  return (_capCache[fam] = r || 0.72);
}
const capToPx = (ctx, fam, cap) => cap / capRatio(ctx, fam);

function klass(W, H) {
  if (W / H >= 1.60) return 'WIDE';
  if (H / W >= 1.15) return 'TALL';
  return 'SQUARE';
}
function padOf(W, H) {
  const S = Math.min(W, H);
  return Math.max(Math.round(S * 0.072), Math.ceil(W * 0.05) + Math.round(S * 0.022));
}

/** Wrap to at most maxLines, shrinking cap until it fits. Never truncates. */
function fitLines(ctx, text, fam, colW, startCap, floorCap, maxLines, S) {
  let cap = startCap;
  for (let i = 0; i < 40; i++) {
    const px = capToPx(ctx, fam, cap * S);
    ctx.font = `700 ${px}px "${fam}"`;
    const words = String(text).split(/\s+/);
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(t).width > colW) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (lines.length <= maxLines && widest <= colW) return { cap, px, lines };
    cap *= 0.94;
    if (cap < floorCap) {
      const px2 = capToPx(ctx, fam, floorCap * S);
      ctx.font = `700 ${px2}px "${fam}"`;
      return { cap: floorCap, px: px2, lines, tight: true };
    }
  }
  return null;
}

/* Ink, not line boxes. A line box for a big headline covers half the frame;
   the glyphs cover a tenth. Measuring boxes made the shrink loop destroy the
   two type-led families before they could be drawn. */
function makeInk(W, H) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W / 4));
  c.height = Math.max(1, Math.round(H / 4));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.scale(0.25, 0.25);
  x.fillStyle = '#fff';
  return { c, x };
}
function inkFraction(ink) {
  const d = ink.x.getImageData(0, 0, ink.c.width, ink.c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
  return n / (ink.c.width * ink.c.height);
}
/** Draw one line to both the frame and the ink mask. */
function ink(ctx, m, text, x, y, font) {
  ctx.font = font; ctx.fillText(text, x, y);
  m.x.font = font; m.x.fillText(text, x, y);
}

/* --------------------------------------------------------------- 1 ------ */
/* PLATE — no photograph. A crimson field and one white sentence. The only
   frame in the set that is not predominantly black. */
function famPlate(ctx, W, H, j, F) {
  const S = Math.min(W, H), L = Math.max(W, H), C = klass(W, H), PAD = padOf(W, H);
  const m = makeInk(W, H);
  const g = ctx.createRadialGradient(W * 0.62, H * 0.34, 0, W * 0.62, H * 0.34, L * 0.55);
  g.addColorStop(0, RED_CORE); g.addColorStop(0.62, '#7e0510'); g.addColorStop(1, RED_DEEP);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, L * 0.30, W / 2, H / 2, L * 0.80);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(18,1,3,0.85)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);

  const capH = C === 'WIDE' ? 0.145 : C === 'SQUARE' ? 0.130 : 0.110;
  const maxL = C === 'WIDE' ? 3 : C === 'SQUARE' ? 3 : 4;
  const fit = fitLines(ctx, j.headline, F.disp, W - PAD * 2, capH, 0.075, maxL, S);
  if (!fit) return null;

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  m.x.textAlign = 'left'; m.x.textBaseline = 'top';
  const bcap = capToPx(ctx, F.ui, 0.032 * S);
  ctx.fillStyle = PAPER;
  if (F.brand) ink(ctx, m, j.brandName.toUpperCase(), PAD, H * 0.08, `700 ${bcap}px "${F.ui}"`);

  let y = H * 0.22;
  const lh = fit.px * 1.04;
  ctx.fillStyle = PAPER;
  for (const ln of fit.lines) { ink(ctx, m, ln, PAD, y, `700 ${fit.px}px "${F.disp}"`); y += lh; }

  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(PAD, y + S * 0.035, S * 0.72, Math.max(2, S * 0.010));
  return { ink: inkFraction(m), deepen: false, note: 'plate' };
}

/* --------------------------------------------------------------- 2 ------ */
/* COLOPHON — no photograph. A visible three-column grid on black carrying the
   largest type in the set. */
function famColophon(ctx, W, H, j, F) {
  const S = Math.min(W, H), L = Math.max(W, H), C = klass(W, H), PAD = padOf(W, H);
  const m = makeInk(W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const gut = 0.02 * S;
  const cw = (W - 2 * PAD - 2 * gut) / 3;
  const rh = (H - 2 * PAD) / 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const x = PAD + i * (cw + gut) - gut / 2;
    ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke();
  }

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  m.x.textAlign = 'left'; m.x.textBaseline = 'top';
  const bcap = capToPx(ctx, F.ui, Math.max(0.018 * L, 14));
  ctx.fillStyle = RED_INK;
  if (F.brand) ink(ctx, m, j.brandName.toUpperCase(), PAD, PAD, `700 ${bcap}px "${F.ui}"`);

  const capH = C === 'WIDE' ? 0.105 : C === 'SQUARE' ? 0.095 : 0.090;
  const fit = fitLines(ctx, j.headline, F.disp, W - 2 * PAD, capH, 0.05, 3, S);
  if (!fit) return null;
  let y = PAD + rh * 1.6;
  ctx.fillStyle = PAPER;
  const lh = fit.px * 1.04;
  for (const ln of fit.lines) { ink(ctx, m, ln, PAD, y, `700 ${fit.px}px "${F.disp}"`); y += lh; }

  /* one word on a red slab — the family's single mark */
  const w0 = fit.lines[0].split(/\s+/)[0] || '';
  if (w0) {
    ctx.font = `700 ${fit.px}px "${F.disp}"`;
    const ww = ctx.measureText(w0).width;
    ctx.fillStyle = RED_CORE;
    ctx.fillRect(PAD - S * 0.012, PAD + rh * 1.6 - fit.px * 0.06,
                 Math.min(ww + S * 0.024, W - 2 * PAD), fit.px * 1.02);
    ctx.fillStyle = PAPER;
    ink(ctx, m, fit.lines[0], PAD, PAD + rh * 1.6, `700 ${fit.px}px "${F.disp}"`);
  }

  const dcap = capToPx(ctx, F.ui, Math.max(0.014 * L, 14));
  ctx.fillStyle = GREY;
  ink(ctx, m, j.site, PAD, H - PAD - dcap * 1.2, `500 ${dcap}px "${F.ui}"`);
  return { ink: inkFraction(m), deepen: false, note: 'colophon' };
}

/* --------------------------------------------------------------- 3 ------ */
/* HALFTONE — the photograph rebuilt as a crimson dot screen. A change of
   medium: a low-resolution source genuinely improves here. */
function famHalftone(ctx, W, H, j, F) {
  if (!j.photo || !j.photo.treated) return null;
  const S = Math.min(W, H), L = Math.max(W, H), C = klass(W, H), PAD = padOf(W, H);
  const m = makeInk(W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const src = document.createElement('canvas');
  src.width = Math.round(W / 3); src.height = Math.round(H / 3);
  const sx = src.getContext('2d', { willReadFrequently: true });
  coverDraw(sx, j.photo.treated, src.width, src.height, j.fx, j.fy, 1);
  const sd = sx.getImageData(0, 0, src.width, src.height).data;
  const lum = (px, py) => {
    const ix = Math.max(0, Math.min(src.width - 1, Math.round(px / 3)));
    const iy = Math.max(0, Math.min(src.height - 1, Math.round(py / 3)));
    const o = (iy * src.width + ix) * 4;
    return (sd[o] * 0.2126 + sd[o + 1] * 0.7152 + sd[o + 2] * 0.0722) / 255;
  };

  const capH = C === 'WIDE' ? 0.078 : 0.055;
  const colW = Math.min(0.72 * S, W - 2 * PAD);
  const fit = fitLines(ctx, j.headline, F.disp, colW, capH, 0.038, 2, S);
  if (!fit) return null;
  const boxY0 = H * 0.62, boxY1 = H * 0.80;
  const infl = 0.025 * S;
  const inBox = (x, y) => x > PAD - infl && x < PAD + colW + infl &&
                          y > boxY0 - infl && y < boxY1 + infl;

  const c = 0.018 * S, D = Math.hypot(W, H), a = 15 * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  ctx.fillStyle = RED_CORE;
  for (let u = -D; u < D; u += c) {
    for (let v = -D; v < D; v += c) {
      const x = u * cos - v * sin + W / 2, y = u * sin + v * cos + H / 2;
      if (x < -c || y < -c || x > W + c || y > H + c) continue;
      if (inBox(x, y)) continue;
      const r = 0.72 * c * Math.sqrt(lum(x, y));
      if (r < 0.14 * c) continue;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
  }

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  m.x.textAlign = 'left'; m.x.textBaseline = 'top';
  const bcap = capToPx(ctx, F.ui, Math.max(0.016 * L, 14));
  ctx.fillStyle = RED_INK;
  if (F.brand) ink(ctx, m, j.brandName.toUpperCase(), PAD, H * 0.08, `700 ${bcap}px "${F.ui}"`);
  let y = boxY0;
  ctx.fillStyle = PAPER;
  for (const ln of fit.lines) { ink(ctx, m, ln, PAD, y, `700 ${fit.px}px "${F.disp}"`); y += fit.px * 1.06; }
  return { ink: inkFraction(m), deepen: false, note: 'halftone' };
}

/* --------------------------------------------------------------- 4 ------ */
/* KNOCKOUT — the headline is the photograph. The picture exists only inside
   the letterforms of the first line. */
function famKnockout(ctx, W, H, j, F) {
  if (!j.photo || !j.photo.treated) return null;
  const S = Math.min(W, H), L = Math.max(W, H), C = klass(W, H), PAD = padOf(W, H);
  const m = makeInk(W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const boxW = C === 'WIDE' ? W * 0.62 : W - 2 * PAD;
  const top = C === 'WIDE' ? H * 0.24 : H * 0.40 - (H * 0.46) / 2;
  const startCap = C === 'TALL' ? 0.150 : 0.135;
  const fit = fitLines(ctx, j.headline, F.disp, boxW, startCap, 0.105, 3, S);
  if (!fit) return null;

  const lh = fit.px * 1.02;
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const mx = mask.getContext('2d');
  mx.textAlign = 'left'; mx.textBaseline = 'top';
  mx.font = `700 ${fit.px}px "${F.disp}"`;
  mx.fillStyle = '#fff';
  mx.fillText(fit.lines[0], PAD, top);

  const cut = document.createElement('canvas');
  cut.width = W; cut.height = H;
  const cx = cut.getContext('2d');
  coverDraw(cx, j.photo.treated, W, H, j.fx, j.fy, 1.15);
  /* Inside letterforms the picture is seen through a few hundred px of stroke,
     so a treated plate that reads fine full-bleed disappears entirely. Lift it
     until the glyphs carry an image rather than a shadow. */
  cx.globalCompositeOperation = 'lighter';
  cx.fillStyle = 'rgba(190,22,30,0.42)'; cx.fillRect(0, 0, W, H);
  cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = 'rgba(255,120,110,0.16)'; cx.fillRect(0, 0, W, H);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(mask, 0, 0);
  ctx.drawImage(cut, 0, 0);
  m.x.textAlign = 'left'; m.x.textBaseline = 'top';
  m.x.fillText(fit.lines[0], PAD, top);

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = PAPER;
  let y = top + lh;
  for (const ln of fit.lines.slice(1)) {
    ink(ctx, m, ln, PAD, y, `700 ${fit.px}px "${F.disp}"`); y += lh;
  }
  const bcap = capToPx(ctx, F.ui, 0.016 * L);
  ctx.fillStyle = RED_INK;
  if (F.brand) ink(ctx, m, j.brandName.toUpperCase(), PAD, H * 0.92, `700 ${bcap}px "${F.ui}"`);
  return { ink: inkFraction(m), deepen: false, note: 'knockout' };
}

/* --------------------------------------------------------------- 5 ------ */
/* SHEET — one photograph as a grid of crops with exactly one cell left hot.
   Repetition as structure, and a disguise for low resolution. */
function famSheet(ctx, W, H, j, F) {
  if (!j.photo || !j.photo.treated) return null;
  const S = Math.min(W, H), C = klass(W, H), PAD = padOf(W, H);
  const m = makeInk(W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const y1 = (C === 'TALL' ? 0.72 : 0.70) * H;
  const bw = W - 2 * PAD, bh = y1 - PAD, g = 0.010 * S;
  let best = null;
  for (let cols = 2; cols <= 8; cols++) for (let rows = 2; rows <= 8; rows++) {
    const cw = (bw - (cols - 1) * g) / cols, ch = (bh - (rows - 1) * g) / rows;
    const ar = cw / ch, n = cols * rows;
    if (ar < 0.85 || ar > 1.20 || n < 6 || n > 20) continue;
    if (!best || n > best.n || (n === best.n && Math.abs(ar - 1) < Math.abs(best.ar - 1))) {
      best = { cols, rows, cw, ch, n, ar };
    }
  }
  if (!best) return null;

  const r = mulberry32(j.seed ^ 0x5EE7);
  const hot = Math.floor(r() * best.n);
  for (let i = 0; i < best.n; i++) {
    const col = i % best.cols, row = (i / best.cols) | 0;
    const x = PAD + col * (best.cw + g), y = PAD + row * (best.ch + g);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, best.cw, best.ch); ctx.clip();
    const fx = Math.min(1, Math.max(0, j.fx + (r() - 0.5) * 0.44));
    const fy = Math.min(1, Math.max(0, j.fy + (r() - 0.5) * 0.44));
    const zoom = 1.0 + (i / best.n) * 1.2;
    ctx.translate(x, y);
    coverDraw(ctx, j.photo.treated, best.cw, best.ch, fx, fy, zoom);
    ctx.restore();
    if (i === hot) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = RED_CORE; ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y, best.cw, best.ch);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(x, y, best.cw, best.ch);
    }
  }

  ctx.fillStyle = '#000'; ctx.fillRect(0, y1, W, H - y1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  m.x.textAlign = 'left'; m.x.textBaseline = 'top';
  const reserve = 0.26 * W;
  const colW = W - 2 * PAD - reserve - 0.02 * S;
  const fit = fitLines(ctx, j.headline, F.disp, colW, 0.060, 0.038, 2, S);
  if (!fit) return null;
  const lh = fit.px * 1.05;
  let y = H - PAD - fit.lines.length * lh;
  ctx.fillStyle = PAPER;
  for (const ln of fit.lines) { ink(ctx, m, ln, PAD, y, `700 ${fit.px}px "${F.disp}"`); y += lh; }
  if (F.brand) {
    const bcap = capToPx(ctx, F.ui, 0.026 * S);
    ctx.font = `700 ${bcap}px "${F.ui}"`;
    ctx.textAlign = 'right'; m.x.textAlign = 'right';
    ctx.fillStyle = RED_INK;
    ink(ctx, m, j.brandName.toUpperCase(), W - PAD, H - PAD - bcap * 1.2, `700 ${bcap}px "${F.ui}"`);
    ctx.textAlign = 'left'; m.x.textAlign = 'left';
  }
  return { ink: inkFraction(m), deepen: false, note: 'sheet' };
}

/* --------------------------------------------------------------- 6 ------ */
/* STAMP — extreme scale inversion. The photograph is the smallest object in
   the frame and a single red rule is the longest. Any source is big enough. */
function famStamp(ctx, W, H, j, F) {
  if (!j.photo || !j.photo.treated) return null;
  const S = Math.min(W, H), C = klass(W, H), PAD = padOf(W, H);
  const m = makeInk(W, H);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const t = 0.30 * S;
  const x0 = Math.max(PAD, 0.145 * W);
  const y0 = (C === 'WIDE' ? 0.22 : 0.30) * H;
  const cx = x0 + t / 2, cy = y0 + t / 2;
  const th = Math.max(2, 0.016 * S);

  ctx.fillStyle = RED_CORE;
  if (C === 'WIDE') ctx.fillRect(0.05 * W, cy - th / 2, 0.88 * W, th);
  else ctx.fillRect(cx - th / 2, 0.06 * H, th, 0.86 * H);

  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, t, t); ctx.clip();
  ctx.translate(x0, y0);
  coverDraw(ctx, j.photo.treated, t, t, j.fx, j.fy, 1.05);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(170,20,26,0.30)';
  ctx.fillRect(0, 0, t, t);
  ctx.restore();

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  m.x.textAlign = 'left'; m.x.textBaseline = 'top';
  const bcap = capToPx(ctx, F.ui, 0.030 * S);
  ctx.fillStyle = RED_INK;
  if (F.brand) ink(ctx, m, j.brandName.toUpperCase(), x0, y0 - S * 0.045 - bcap, `700 ${bcap}px "${F.ui}"`);

  const colW = Math.min(W - PAD - x0, 0.62 * W);
  const fit = fitLines(ctx, j.headline, F.disp, colW, 0.055, 0.036, 3, S);
  if (!fit) return null;
  let y = y0 + t + S * 0.06;
  ctx.fillStyle = PAPER;
  for (const ln of fit.lines) { ink(ctx, m, ln, x0, y, `700 ${fit.px}px "${F.disp}"`); y += fit.px * 1.06; }
  return { ink: inkFraction(m), deepen: false, note: 'stamp' };
}

const FAMILIES = [
  { key: 'plate',    fn: famPlate,    needsPhoto: false },
  { key: 'colophon', fn: famColophon, needsPhoto: false },
  { key: 'halftone', fn: famHalftone, needsPhoto: true },
  { key: 'knockout', fn: famKnockout, needsPhoto: true },
  { key: 'sheet',    fn: famSheet,    needsPhoto: true },
  { key: 'stamp',    fn: famStamp,    needsPhoto: true },
];
