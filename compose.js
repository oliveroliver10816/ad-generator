/* Composition engine.
 *
 * The reference creatives are not "photo panel beside a colour panel". They are
 * a single full-bleed photograph sinking into black, lit with red, carrying very
 * little type. This file draws that, and nothing else.
 *
 * Every image is composed from an independent seed, so no two share a layout,
 * a crop, a light position or a grain field.
 */

/* ---------------------------------------------------------- treatment --- */
/* Luminance ramp taken from the reference look: the frame stays black, red
   appears only where the picture is genuinely lit, and the hottest highlights
   go to white. A flat mid-red ramp turns everything maroon — that was the
   first attempt and it read as a colour cast rather than as lighting. */
const NEON_RAMP = [
  ['#000000', 0.00], ['#020101', 0.50], ['#5c070d', 0.74],
  ['#e5252c', 0.90], ['#ff7a6e', 0.96], ['#ffb3a8', 1.00],
];
/* Shadow crush and midtone gamma matter as much as the ramp. Normalising from
   the 2nd percentile with no gamma left every photograph a flat red wash —
   lifting the black point to the 8th and bending midtones down is what turns
   it into black with red light on it. */
const CRUSH_LO = 0.08, CRUSH_HI = 0.99, MID_GAMMA = 1.45;

function buildLUT(stops) {
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const s = stops.map(([c, p]) => ({ c: hex(c), p }));
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = s[0], b = s[s.length - 1];
    for (let k = 0; k < s.length - 1; k++) {
      if (t >= s[k].p && t <= s[k + 1].p) { a = s[k]; b = s[k + 1]; break; }
    }
    const span = (b.p - a.p) || 1, f = Math.min(1, Math.max(0, (t - a.p) / span));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(a.c[k] + (b.c[k] - a.c[k]) * f);
  }
  return lut;
}
const NEON_LUT = buildLUT(NEON_RAMP);

/** Treat a photograph once, at load. Percentile normalisation first, otherwise a
 *  dim photograph never reaches the lit part of the ramp and comes out solid
 *  black, and a bright one blows out to white. */
function treatOnce(img, w, h, crushLo, gamma) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let d;
  try { d = ctx.getImageData(0, 0, w, h); } catch (e) { return cv; }
  const px = d.data, n = w * h;

  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const l = px[o] * 0.2126 + px[o + 1] * 0.7152 + px[o + 2] * 0.0722;
    lum[i] = l; hist[l | 0]++;
  }
  const pct = (target) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const lo = pct(n * crushLo), hi = pct(n * CRUSH_HI), span = Math.max(1, hi - lo);

  let sx = 0, sy = 0, sw = 0, bright = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    let t = (lum[i] - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = Math.pow(t, gamma);
    const k = (t * 255) | 0;
    const R = NEON_LUT[k * 3], G = NEON_LUT[k * 3 + 1], B = NEON_LUT[k * 3 + 2];
    px[o] = R; px[o + 1] = G; px[o + 2] = B;
    const l = R * 0.2126 + G * 0.7152 + B * 0.0722;
    if (l > 42) {
      const wgt = l - 42, pyy = (i / w) | 0, pxx = i % w;
      sx += pxx * wgt; sy += pyy * wgt; sw += wgt; bright++;
    }
  }
  ctx.putImageData(d, 0, 0);
  cv.focus = sw > 0 ? { x: sx / sw / w, y: sy / sw / h } : { x: 0.5, y: 0.5 };
  cv.litFraction = bright / n;
  return cv;
}

/** Treat a photograph once, at load.
 *
 *  The crush is adaptive. One fixed curve suits a bright photograph and turns a
 *  dim one into an almost entirely black rectangle — which then fails the
 *  image-quality check no matter what the composition does. So the curve is
 *  eased until enough of the frame carries light. */
function treatPhoto(img, maxSide = 1500) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));

  let lo = CRUSH_LO, gamma = MID_GAMMA;
  let out = treatOnce(img, w, h, lo, gamma);
  for (let i = 0; i < 4 && out.litFraction < 0.20; i++) {
    lo = Math.max(0.01, lo - 0.025);
    gamma = Math.max(0.85, gamma - 0.16);
    out = treatOnce(img, w, h, lo, gamma);
  }
  out.curve = { lo, gamma };
  return out;
}

/* -------------------------------------------------------------- grain --- */
/* A seeded noise tile per image. Cheap, and it means two images that happened
   to land on the same layout still differ pixel for pixel. */
function grainTile(rand, size = 180) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const d = ctx.createImageData(size, size), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = 118 + ((rand() - 0.5) * 84) | 0;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return cv;
}

/* ------------------------------------------------------------- pieces --- */
/** Cover-crop so that the point (fx, fy) OF THE SOURCE IMAGE lands in the
 *  middle of the frame.
 *
 *  Not the same thing as CSS object-position: there, the value is an alignment
 *  between the overflow edges, so passing a source coordinate straight in aims
 *  at the wrong place entirely and the crop never finds the subject. */
function coverDraw(ctx, src, W, H, fx, fy, zoom) {
  const iw = src.width, ih = src.height;
  const scale = Math.max(W / iw, H / ih) * (zoom || 1);
  const dw = iw * scale, dh = ih * scale;
  const ox = Math.min(0, Math.max(W - dw, W / 2 - fx * dw));
  const oy = Math.min(0, Math.max(H - dh, H / 2 - fy * dh));
  ctx.drawImage(src, ox, oy, dw, dh);
}

/** Sink the picture into black so type has somewhere to sit. This is the
 *  reference look, not a rescue for a bad photo. */
function scrim(ctx, W, H, kind, strength) {
  let g;
  if (kind === 'bottom') {
    g = ctx.createLinearGradient(0, H * 0.30, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  } else if (kind === 'left') {
    g = ctx.createLinearGradient(0, 0, W * 0.78, 0);
    g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  } else if (kind === 'right') {
    g = ctx.createLinearGradient(W, 0, W * 0.22, 0);
    g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  } else if (kind === 'top') {
    g = ctx.createLinearGradient(0, 0, 0, H * 0.62);
    g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  } else {                                   // corner
    g = ctx.createRadialGradient(W * 0.72, H * 0.28, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.92);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

/** Vignette. Always on, quietly — it is what makes the frame read as black. */
function vignette(ctx, W, H, amount) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.24,
                                     W / 2, H / 2, Math.max(W, H) * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${amount})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

/** The red light. In the reference this is neon: a bar, a raking streak or a
 *  soft bloom — never a flat red rectangle. */
function redLight(ctx, W, H, kind, rand, red) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const D = Math.max(W, H);
  if (kind === 'bar') {
    const x = (0.08 + rand() * 0.84) * W, w = Math.max(2, D * 0.006);
    const g = ctx.createLinearGradient(x - w * 9, 0, x + w * 9, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, red);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - w * 9, 0, w * 18, H);
    ctx.fillStyle = red; ctx.globalAlpha = 0.75; ctx.fillRect(x - w / 2, 0, w, H);
  } else if (kind === 'streak') {
    const a = (-32 + rand() * 64) * Math.PI / 180;
    ctx.translate(W * (0.2 + rand() * 0.6), H * (0.15 + rand() * 0.7));
    ctx.rotate(a);
    const g = ctx.createLinearGradient(-D, 0, D, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, red); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(-D, -Math.max(1.5, D * 0.0035), D * 2, Math.max(3, D * 0.007));
  } else if (kind === 'bloom') {
    const cx = (0.1 + rand() * 0.8) * W, cy = (0.1 + rand() * 0.8) * H;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, D * (0.28 + rand() * 0.28));
    g.addColorStop(0, red); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/* --------------------------------------------------------------- type --- */
function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; }
    else cur = t;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** Fit a headline to a box by size, never by cutting words. */
function fitHeadline(ctx, text, maxW, maxH, maxLines, family, startPx) {
  let size = startPx;
  for (let i = 0; i < 60 && size > 8; i++) {
    ctx.font = `700 ${size}px "${family}", Georgia, serif`;
    const lines = wrapLines(ctx, text, maxW, maxLines);
    const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
    const wanted = String(text).replace(/\s+/g, ' ').trim();
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (joined === wanted && widest <= maxW && lines.length * size * 1.1 <= maxH) {
      return { size, lines };
    }
    size *= 0.94;
  }
  ctx.font = `700 ${size}px "${family}", Georgia, serif`;
  return { size, lines: wrapLines(ctx, text, maxW, maxLines) };
}
