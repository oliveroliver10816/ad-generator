/* Per-image checks. Every generated image is measured before it is offered for
 * download, so "compliant" is something observed rather than asserted.
 *
 * What is checked here is only what can be checked mechanically. Whether the
 * picture itself is honest about the product is a human judgement and is not
 * claimed by this file.
 */

/* Text coverage. Google's image guidance warns against text-heavy images; the
   renderer records the boxes it drew so the fraction is exact rather than
   estimated from pixels. */
function textCoverage(boxes, W, H) {
  if (!boxes || !boxes.length) return 0;
  // Union by scanline so overlapping boxes are not double counted.
  const ys = new Set();
  boxes.forEach(b => { ys.add(Math.max(0, b.y)); ys.add(Math.min(H, b.y + b.h)); });
  const edges = [...ys].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const y0 = edges[i], y1 = edges[i + 1], mid = (y0 + y1) / 2;
    const spans = boxes.filter(b => b.y <= mid && b.y + b.h >= mid)
                       .map(b => [Math.max(0, b.x), Math.min(W, b.x + b.w)])
                       .sort((a, b) => a[0] - b[0]);
    let cur = null, wsum = 0;
    for (const s of spans) {
      if (!cur) { cur = s.slice(); continue; }
      if (s[0] <= cur[1]) cur[1] = Math.max(cur[1], s[1]);
      else { wsum += cur[1] - cur[0]; cur = s.slice(); }
    }
    if (cur) wsum += cur[1] - cur[0];
    area += wsum * (y1 - y0);
  }
  return area / (W * H);
}

const srgb = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relLum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
function contrast(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mean background luminance under a box, sampled from the canvas BEFORE the
 *  text is drawn. Text over photography is the one place contrast cannot be
 *  reasoned about from the palette alone. */
function bgLuminance(ctx, box, W, H) {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.min(W - x, Math.round(box.w)), h = Math.min(H - y, Math.round(box.h));
  if (w <= 0 || h <= 0) return 0;
  let d;
  try { d = ctx.getImageData(x, y, w, h); } catch (e) { return 0; }
  const px = d.data;
  // 95th-percentile luminance: white text fails against the brightest patch it
  // covers, not against the average.
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < px.length; i += 16) {          // every 4th pixel is plenty
    const l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) | 0;
    hist[l]++; n++;
  }
  let acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.05) return relLum(v, v, v); }
  return 0;
}

/** Perceptual hash (64-bit dHash) so two outputs can be compared for real
 *  visual similarity, not just byte equality. */
function pHash(cv) {
  const s = document.createElement('canvas');
  s.width = 9; s.height = 8;
  const c = s.getContext('2d', { willReadFrequently: true });
  c.drawImage(cv, 0, 0, 9, 8);
  const d = c.getImageData(0, 0, 9, 8).data;
  const g = [];
  for (let i = 0; i < 72; i++) {
    const p = i * 4;
    g.push(d[p] * 0.2126 + d[p + 1] * 0.7152 + d[p + 2] * 0.0722);
  }
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
  }
  return bits;
}
function hamming(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Run every mechanical check on one rendered image. */
function checkImage(cv, job, report, bytes) {
  const { W, H } = job;
  const issues = [];

  if (cv.width !== W || cv.height !== H) {
    issues.push(`rendered ${cv.width}x${cv.height}, expected ${W}x${H}`);
  }
  const ratio = W / H;
  if (Math.abs(ratio - job.ratio) / job.ratio > 0.01) {
    issues.push(`aspect ${ratio.toFixed(3)} does not match ${job.ratio}`);
  }
  // Image assets are allowed 5 MB. The 150 KB figure belongs to uploaded
  // display banners and to the Demand Gen logo, not to these ratios.
  if (bytes != null && bytes > FILE_RULES.maxBytes) {
    issues.push(`${Math.round(bytes / 1024)} KB over Google's ${FILE_RULES.maxBytes / 1024} KB limit`);
  }

  const cover = textCoverage(report.boxes, W, H);
  if (cover > TEXT_LIMITS.maxCoverage) {
    issues.push(`text covers ${(cover * 100).toFixed(1)}% of the image (limit ${(TEXT_LIMITS.maxCoverage * 100)}%)`);
  }
  if (report.drewButton && CTA_MODE !== 'button') {
    issues.push('a button shape was drawn but the specification forbids it');
  }
  for (const c of report.contrasts || []) {
    if (c.ratio < 4.5) issues.push(`${c.what} sits at ${c.ratio.toFixed(1)}:1 on its background`);
  }
  /* Editorial > Image quality covers images that are essentially a solid
     block. A frame that is 97% black is not a photograph of anything. */
  const lit = litFraction(cv);
  if (lit < 0.06) issues.push(`only ${(lit * 100).toFixed(1)}% of the frame carries any light`);

  return { issues, coverage: cover, lit, hash: pHash(cv) };
}

/** How much of the finished frame is above near-black. */
function litFraction(cv) {
  const s = document.createElement('canvas');
  s.width = 64; s.height = 64;
  const c = s.getContext('2d', { willReadFrequently: true });
  c.drawImage(cv, 0, 0, 64, 64);
  const d = c.getImageData(0, 0, 64, 64).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722 > 46) n++;
  }
  return n / 4096;
}

/** Across a whole run: nothing may be a visual near-duplicate of anything else. */
function checkRunUniqueness(records, minDistance) {
  const min = minDistance == null ? 6 : minDistance;
  const clashes = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (records[i].job.W !== records[j].job.W || records[i].job.H !== records[j].job.H) continue;
      const d = hamming(records[i].check.hash, records[j].check.hash);
      if (d < min) clashes.push({ a: i, b: j, distance: d });
    }
  }
  return clashes;
}
