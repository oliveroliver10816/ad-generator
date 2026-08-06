/* Ad pack generator — draws a full Google Display size set on <canvas>.
   No build step, no libraries, no server. Everything below runs in the page. */

/* ------------------------------------------------------------ sizes ---- */
const SIZES = [
  [300, 50, 'micro', 'Mobile banner'],
  [320, 50, 'micro', 'Mobile banner'],
  [320, 100, 'mobilebig', 'Large mobile banner'],
  [468, 60, 'wide', 'Banner'],
  [728, 90, 'wide', 'Leaderboard'],
  [970, 90, 'wide', 'Large leaderboard'],
  [980, 120, 'wide', 'Panorama'],
  [930, 180, 'widetall', 'Top banner'],
  [970, 250, 'widetall', 'Billboard'],
  [200, 200, 'square', 'Small square'],
  [250, 250, 'square', 'Square'],
  [300, 250, 'square', 'Inline rectangle'],
  [336, 280, 'square', 'Large rectangle'],
  [580, 400, 'landscape', 'Netboard'],
  [240, 400, 'vertical', 'Vertical rectangle'],
  [250, 360, 'vertical', 'Triple widescreen'],
  [300, 600, 'vertical', 'Half-page'],
  [300, 1050, 'vertical', 'Portrait'],
  [120, 600, 'sky', 'Skyscraper'],
  [160, 600, 'sky', 'Wide skyscraper'],
  [1200, 628, 'landscape', 'Responsive · landscape 1.91:1'],
  [1200, 1200, 'square', 'Responsive · square 1:1'],
];
const LOGO_SIZES = [[1200, 1200, 'Responsive · logo 1:1'], [1200, 300, 'Responsive · logo 4:1']];
const MAX_BYTES = 145000;                 // Google's ceiling is 150 KB

/* -------------------------------------------------------------- rng ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ------------------------------------------------------- canvas utils -- */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fontStr(weight, size, fam) { return `${weight} ${size}px "${fam}", Georgia, serif`; }

const SUPPORTS_LS = (() => {
  try { const c = document.createElement('canvas').getContext('2d'); return 'letterSpacing' in c; }
  catch (e) { return false; }
})();

function setFont(ctx, it) {
  ctx.font = fontStr(it.weight, it.size, it.fam);
  ctx.letterSpacing = SUPPORTS_LS && it.ls ? `${it.ls}px` : '0px';
}

/** Draw an image cropped to fill (object-fit: cover) around a focal point.
 *  Some sites yield no usable photograph at all; rather than throw, the panel
 *  becomes a flat red block, which is a legitimate look in this palette. */
function drawCover(ctx, img, x, y, w, h, fx, fy) {
  if (!img || !img.width || !img.height) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#d01820'); g.addColorStop(1, '#6d0810');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    return;
  }
  const ir = img.width / img.height, br = w / h;
  let sw, sh;
  if (ir > br) { sh = img.height; sw = sh * br; } else { sw = img.width; sh = sw / br; }
  const sx = Math.max(0, Math.min(img.width - sw, (img.width - sw) * fx));
  const sy = Math.max(0, Math.min(img.height - sh, (img.height - sh) * fy));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/* A measure-then-draw text column, so every layout can shrink itself to fit. */
class Stack {
  constructor(ctx, maxW) { this.ctx = ctx; this.maxW = maxW; this.items = []; }
  add(text, o) { if (text) this.items.push(Object.assign({ text, weight: 400, lh: 1.3, gap: 0 }, o)); return this; }
  layout() {
    const ctx = this.ctx;
    this.rows = []; let h = 0; this.maxLine = 0;
    this.items.forEach((it, i) => {
      setFont(ctx, it);
      const words = String(it.text).split(/\s+/);
      let lines = []; let cur = '';
      for (const w of words) {
        const trial = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(trial).width > this.maxW) { lines.push(cur); cur = w; }
        else cur = trial;
      }
      if (cur) lines.push(cur);
      // A single word longer than the column (a URL, a compound) would otherwise
      // be drawn straight past the edge — break it on characters.
      const broken = [];
      for (const ln of lines) {
        if (ctx.measureText(ln).width <= this.maxW) { broken.push(ln); continue; }
        let acc = '';
        for (const ch of ln) {
          if (acc && ctx.measureText(acc + ch).width > this.maxW) { broken.push(acc); acc = ch; }
          else acc += ch;
        }
        if (acc) broken.push(acc);
      }
      lines = broken;
      for (const ln of lines) this.maxLine = Math.max(this.maxLine, ctx.measureText(ln).width);
      const lh = it.size * it.lh;
      this.rows.push({ it, lines, lh });
      h += lines.length * lh;
      if (i < this.items.length - 1) h += it.gap;
    });
    this.h = h;
    return h;
  }
  draw(x, y) {
    const ctx = this.ctx;
    ctx.textBaseline = 'top';
    for (let i = 0; i < this.rows.length; i++) {
      const { it, lines, lh } = this.rows[i];
      setFont(ctx, it); ctx.fillStyle = it.color;
      for (const ln of lines) { ctx.fillText(ln, x, y + (lh - it.size) * 0.32); y += lh; }
      if (i < this.rows.length - 1) y += it.gap;
    }
    ctx.letterSpacing = '0px';
    return y;
  }
}

/** Shrink k until the built stack fits both the height and the width of its
 *  column. Canvas clips silently, so a miss is recorded rather than swallowed. */
window.__fitMisses = [];
function fitStack(build, availH, minK = 0.45) {
  let k = 1, s = build(k);
  const fits = () => s.layout() <= availH && s.maxLine <= s.maxW + 0.5;
  while (!fits() && k > minK) { k = Math.round((k - 0.03) * 100) / 100; s = build(k); }
  if (!fits()) window.__fitMisses.push({ h: Math.round(s.h), availH: Math.round(availH),
    line: Math.round(s.maxLine), maxW: Math.round(s.maxW), k });
  return { stack: s, k };
}

/* ------------------------------------------------------------ pieces --- */
/* The "→" character is absent from the Quicksand and PT Serif webfont subsets,
   so a glyph would silently fall back to whatever the viewer's OS supplies —
   a different shape on every machine, or tofu. Draw it instead. */
function drawArrow(ctx, x, cy, size, color) {
  const len = size * 0.82, hd = size * 0.26, lw = Math.max(1, size * 0.095);
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, cy); ctx.lineTo(x + len, cy);
  ctx.moveTo(x + len - hd, cy - hd); ctx.lineTo(x + len, cy); ctx.lineTo(x + len - hd, cy + hd);
  ctx.stroke();
  return len;
}
/** Largest size at which `text` fits maxW, or 0 if it never does. Scanned
 *  hosts can be very long (ribboncera.sfo3.digitaloceanspaces.com), so the
 *  url must shrink or stand down rather than run under the button. */
function fitSize(ctx, text, maxW, start, min, fam, weight) {
  let sz = start;
  while (sz >= min) {
    ctx.font = fontStr(weight, sz, fam); ctx.letterSpacing = '0px';
    if (ctx.measureText(text).width <= maxW) return sz;
    sz -= Math.max(0.4, sz * 0.06);
  }
  return 0;
}

function ctaWidth(ctx, text, size, padX, arrow) {
  ctx.font = fontStr(700, size, UI_FONT); ctx.letterSpacing = '0px';
  return ctx.measureText(text).width + (arrow ? size * 0.82 + size * 0.42 : 0) + padX * 2;
}
function pill(ctx, text, x, y, size, padX, padY, bg, fg, align, arrow) {
  ctx.font = fontStr(700, size, UI_FONT); ctx.letterSpacing = '0px';
  const tw = ctx.measureText(text).width;
  const aw = arrow ? size * 0.82 + size * 0.42 : 0;
  const w = tw + aw + padX * 2, h = size * 1.02 + padY * 2;
  if (align === 'right') x -= w;
  ctx.fillStyle = bg; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + h / 2 + size * 0.04);
  if (arrow) drawArrow(ctx, x + padX + tw + size * 0.42, y + h / 2, size, fg);
  ctx.textBaseline = 'top';
  return { w, h };
}

function drawLogo(ctx, logoImg, x, y, size) {
  if (logoImg) ctx.drawImage(logoImg, x, y, size, size);
}

function logoLockup(ctx, logoImg, x, y, size, word, color) {
  drawLogo(ctx, logoImg, x, y, size);
  if (!word) return size;
  // Plenty of sites have no extractable mark. The wordmark alone is the
  // fallback, so the lockup closes up rather than leaving a hole.
  const off = logoImg ? size * 1.22 : 0;
  const fs = size * 0.72;
  ctx.font = fontStr(700, fs, UI_FONT); ctx.letterSpacing = '0px';
  ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(word, x + off, y + size / 2 + fs * 0.03);
  ctx.textBaseline = 'top';
  return off + ctx.measureText(word).width;
}

function paintField(ctx, W, H, theme, variant) {
  const stops = theme.fields[variant % theme.fields.length];
  const g = ctx.createLinearGradient(0, 0, W * 0.45, H);
  stops.forEach(([c, p]) => g.addColorStop(p, c));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W * 0.84, H * 0.06, 0, W * 0.84, H * 0.06, Math.max(W, H) * 0.75);
  rg.addColorStop(0, theme.glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
}

/* ---------------------------------------------------------- archetypes -- */
let UI_FONT = 'Quicksand', DISPLAY_FONT = 'PT Serif';

const UNIT = {
  micro: (w, h) => h / 50, mobilebig: (w, h) => h / 100, wide: (w, h) => h / 90,
  widetall: (w, h) => h / 180, square: (w, h) => Math.min(w, h) / 250,
  landscape: (w, h) => h / 400, vertical: (w, h) => w / 300, sky: (w, h) => w / 160,
};

function render(cv, W, H, arch, c, t, v) {
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const u = UNIT[arch](W, H);
  const site = v.site;
  ctx.textAlign = 'left';
  paintField(ctx, W, H, t, v.field);
  const F = (n) => n * u;

  const kickIt = (k) => ({ fam: UI_FONT, weight: 700, size: F(9) * k, lh: 1.15, color: t.kick, ls: F(1.2) * k, gap: F(5) * k });
  const headIt = (k, s) => ({ fam: DISPLAY_FONT, weight: 700, size: F(s) * k, lh: 1.1, color: t.text, gap: F(5) * k });
  const subIt = (k, s) => ({ fam: UI_FONT, weight: 500, size: F(s) * k, lh: 1.36, color: t.muted, gap: F(6) * k });

  const url = (x, y, size, align, maxW) => {
    const sz = fitSize(ctx, site, maxW == null ? 1e9 : maxW, size, size * 0.62, UI_FONT, 600);
    if (!sz) return;                       // no room: the brand name still carries it
    ctx.font = fontStr(600, sz, UI_FONT); ctx.letterSpacing = '0px'; ctx.fillStyle = t.muted;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'top';
    ctx.fillText(site, x, y); ctx.textAlign = 'left';
  };

  if (arch === 'micro') {
    const pad = F(12);
    drawLogo(ctx, v.logo, pad, (H - F(26)) / 2, F(26));
    const cx = pad + F(26) + F(8);
    const cta = { text: c.cta_short, size: F(11.5), padX: F(12), padY: F(6.5) };
    ctx.font = fontStr(700, cta.size, UI_FONT);
    const ctaW = ctaWidth(ctx, cta.text, cta.size, cta.padX, true);
    const availW = W - cx - ctaW - F(8) - pad;
    const { stack } = fitStack((k) => { const s = new Stack(ctx, availW); s.add(c.micro, headIt(k, 15.5)); return s; }, H - F(8));
    stack.draw(cx, (H - stack.h) / 2);
    pill(ctx, cta.text, W - pad, (H - (cta.size * 1.02 + cta.padY * 2)) / 2, cta.size, cta.padX, cta.padY, t.cta_bg, t.cta_fg, 'right', true);
  }

  else if (arch === 'mobilebig') {
    const pad = F(13), ph = H;
    if (v.mirror) { drawCover(ctx, v.img, W - ph, 0, ph, H, v.fx, v.fy); }
    else { drawCover(ctx, v.img, 0, 0, ph, H, v.fx, v.fy); }
    const tx = v.mirror ? pad : ph + pad;
    const availW = W - ph - pad * 2;
    const ctaSize = F(11), ctaPadY = F(6.5), ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, availW);
      s.add(c.kicker.toUpperCase(), kickIt(k)); s.add(c.short, headIt(k, 17));
      return s;
    }, H - pad * 1.6 - ctaH - F(4));
    const total = stack.h + F(4) + ctaH;
    let y = (H - total) / 2;
    y = stack.draw(tx, y) + F(4);
    const p = pill(ctx, c.cta_short, tx, y, ctaSize, F(12), ctaPadY, t.cta_bg, t.cta_fg, 'left', true);
    url(tx + p.w + F(7), y + p.h / 2 - F(4.2), F(8.5), 'left', W - ph - p.w - F(20));
  }

  else if (arch === 'wide') {
    const pad = F(14), ph = H;
    const px = v.mirror ? W - ph : 0;
    drawCover(ctx, v.img, px, 0, ph, H, v.fx, v.fy);
    const ctaSize = F(13), ctaPadX = F(17), ctaPadY = F(9);
    ctx.font = fontStr(700, ctaSize, UI_FONT);
    const ctaW = ctaWidth(ctx, c.cta_short, ctaSize, ctaPadX, true);
    const ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const tx = (v.mirror ? 0 : ph) + pad;
    const availW = W - ph - pad * 3 - ctaW;
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, availW);
      s.add(v.brandName, { fam: UI_FONT, weight: 700, size: F(10) * k, lh: 1.2, color: t.text, gap: F(4) * k });
      s.add(c.short, headIt(k, 20));
      return s;
    }, H - pad);
    stack.draw(tx, (H - stack.h) / 2);
    // The CTA is always right-aligned — when the photo is mirrored to the right
    // it tucks just inside it. Anchoring it left would land it on the headline.
    const cx = v.mirror ? W - ph - pad : W - pad;
    pill(ctx, c.cta_short, cx, (H - ctaH) / 2 - F(5), ctaSize, ctaPadX, ctaPadY, t.cta_bg, t.cta_fg, 'right', true);
    url(cx, (H + ctaH) / 2 - F(2), F(9.5), 'right', ctaW);
  }

  else if (arch === 'widetall') {
    const pad = F(26), pw = W * (0.36 + v.bandJit * 0.08);
    const px = v.mirror ? 0 : W - pw;
    drawCover(ctx, v.img, px, 0, pw, H, v.fx, v.fy);
    const tx = v.mirror ? pw + pad : pad;
    const availW = W - pw - pad * 2;
    const ctaSize = F(13.5), ctaPadY = F(10), ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, availW);
      s.add(c.kicker.toUpperCase(), kickIt(k)); s.add(c.head, headIt(k, 27)); s.add(c.sub, subIt(k, 12.5));
      return s;
    }, H - pad * 1.7 - ctaH);
    let y = (H - (stack.h + F(9) + ctaH)) / 2;
    y = stack.draw(tx, y) + F(9);
    const p = pill(ctx, c.cta, tx, y, ctaSize, F(19), ctaPadY, t.cta_bg, t.cta_fg, 'left', true);
    logoLockup(ctx, v.logo, tx + p.w + F(12), y + p.h / 2 - F(9.5), F(19), v.brandName, t.text);
  }

  else if (arch === 'square') {
    const pad = F(16), band = H * (0.34 + v.bandJit * 0.08);
    const top = !v.mirror;
    drawCover(ctx, v.img, 0, top ? 0 : H - band, W, band, v.fx, v.fy);
    const ty = top ? band : 0;
    const availH = H - band - pad * 1.75;
    const ctaSize = F(12), ctaPadY = F(8.5), ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const showSub = H >= 300, showUrl = W >= 250;
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, W - pad * 2);
      s.add(c.kicker.toUpperCase(), Object.assign(kickIt(k), { size: F(8.6) * k, gap: F(4.5) * k }));
      s.add(H < 250 ? c.short : c.head, headIt(k, 17.5));
      if (showSub) s.add(c.sub, subIt(k, 10.5));
      return s;
    }, availH - ctaH - F(7));
    const cy = ty + (H - band) - pad * 0.9 - ctaH;
    // Centre the wording in the space above the button; top-aligning it left a
    // void whenever the headline was short and there was no sub-line.
    const zoneTop = ty + pad * 0.85, zoneBot = cy - F(7);
    stack.draw(pad, zoneTop + Math.max(0, (zoneBot - zoneTop - stack.h) / 2));
    const p = pill(ctx, c.cta_short, pad, cy, ctaSize, F(15), ctaPadY, t.cta_bg, t.cta_fg, 'left', true);
    if (showUrl) url(W - pad, cy + p.h / 2 - F(4.3), F(8.6), 'right', W - pad * 2 - p.w - F(8));
  }

  else if (arch === 'landscape') {
    const pad = F(26), pw = W * (0.38 + v.bandJit * 0.08);
    const px = v.mirror ? 0 : W - pw;
    drawCover(ctx, v.img, px, 0, pw, H, v.fx, v.fy);
    const tx = v.mirror ? pw + pad : pad;
    const availW = W - pw - pad * 2;
    const ctaSize = F(13), ctaPadY = F(10), ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const lock = F(21);
    let y = pad;
    logoLockup(ctx, v.logo, tx, y, lock, v.brandName, t.text);
    y += lock + F(9);
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, availW);
      s.add(c.kicker.toUpperCase(), Object.assign(kickIt(k), { size: F(9.5) * k }));
      s.add(c.head, headIt(k, 26)); s.add(c.sub, subIt(k, 12));
      return s;
    }, H - y - pad - ctaH - F(10));
    stack.draw(tx, y);
    const cy = H - pad - ctaH;
    const p = pill(ctx, c.cta, tx, cy, ctaSize, F(18), ctaPadY, t.cta_bg, t.cta_fg, 'left', true);
    url(tx + availW, cy + p.h / 2 - F(4.7), F(9.5), 'right', availW - p.w - F(10));
  }

  else if (arch === 'vertical') {
    const pad = F(20);
    const base = H >= 800 ? 0.46 : H >= 500 ? 0.38 : 0.36;
    const band = H * (base + v.bandJit * 0.07);
    const top = !v.mirror;
    drawCover(ctx, v.img, 0, top ? 0 : H - band, W, band, v.fx, v.fy);
    const ty = top ? band : 0, zoneH = H - band;
    const showSub = H >= 360;
    const ctaSize = F(12.5), ctaPadY = F(9.5), ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const lock = F(19);
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, W - pad * 2);
      s.add(c.kicker.toUpperCase(), Object.assign(kickIt(k), { size: F(9) * k }));
      s.add(c.head, headIt(k, 24));
      if (showSub) s.add(c.sub, subIt(k, 11.5));
      return s;
    }, zoneH - pad * 2 - lock - ctaH - F(28));
    const total = lock + F(8) + stack.h + F(14) + ctaH + F(13);
    let y = ty + Math.max(pad * 0.9, (zoneH - total) / 2);
    logoLockup(ctx, v.logo, pad, y, lock, v.brandName, t.text); y += lock + F(8);
    y = stack.draw(pad, y) + F(14);
    const p = pill(ctx, c.cta_short, pad, y, ctaSize, F(17), ctaPadY, t.cta_bg, t.cta_fg, 'left', true);
    url(pad, y + p.h + F(7), F(9), 'left', W - pad * 2);
  }

  else if (arch === 'sky') {
    const pad = F(14), band = W * (1.45 + v.bandJit * 0.3);
    drawCover(ctx, v.img, 0, 0, W, band, v.fx, v.fy);
    const zoneH = H - band;
    const ctaSize = F(11.5), ctaPadY = F(8.5), ctaH = ctaSize * 1.02 + ctaPadY * 2;
    const lock = F(22), showUrl = W >= 160;
    const { stack } = fitStack((k) => {
      const s = new Stack(ctx, W - pad * 1.7);
      s.add(c.kicker.toUpperCase(), Object.assign(kickIt(k), { size: F(8.5) * k, ls: F(1) * k }));
      s.add(c.short, headIt(k, 20));
      return s;
    }, zoneH - pad * 2 - lock - ctaH - F(30));
    const blockH = stack.h + lock + ctaH + (showUrl ? F(12) : 0) + F(26);
    let y = band + Math.max(pad, (zoneH - blockH) / 2);
    y = stack.draw(pad * 0.85, y) + F(14);
    drawLogo(ctx, v.logo, (W - lock) / 2, y, lock); y += lock + F(8);
    ctx.font = fontStr(700, ctaSize, UI_FONT);
    const cw = ctaWidth(ctx, c.cta_short, ctaSize, F(12), false);
    const p = pill(ctx, c.cta_short, (W - cw) / 2, y, ctaSize, F(12), ctaPadY, t.cta_bg, t.cta_fg);
    y += p.h + F(7);
    if (showUrl) { ctx.textAlign = 'center'; url(W / 2, y, F(8.2), 'center', W - pad); }
  }
  return cv;
}

function renderLogoAsset(cv, W, H, brandName, logoImg, theme) {
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  paintField(ctx, W, H, theme, 0);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const square = W === H;
  const m = square ? 340 : 150;
  let fs = square ? 118 : 108;
  ctx.font = fontStr(700, fs, UI_FONT);
  // A long brand name overruns a 4:1 plate — shrink to fit rather than clip.
  const budget = square ? W * 0.86 : W - (logoImg ? m + 26 : 0) - 60;
  while (ctx.measureText(brandName).width > budget && fs > 22) {
    fs -= 2; ctx.font = fontStr(700, fs, UI_FONT);
  }
  const tw = ctx.measureText(brandName).width;
  ctx.fillStyle = theme.text;
  if (square) {
    if (logoImg) ctx.drawImage(logoImg, (W - m) / 2, H / 2 - m / 2 - 60, m, m);
    ctx.fillText(brandName, (W - tw) / 2, H / 2 + (logoImg ? m / 2 - 10 : 0));
  } else {
    const total = (logoImg ? m + 26 : 0) + tw, x = (W - total) / 2;
    if (logoImg) ctx.drawImage(logoImg, x, (H - m) / 2, m, m);
    ctx.fillText(brandName, x + (logoImg ? m + 26 : 0), H / 2 + 3);
  }
  return cv;
}

/* ------------------------------------------------------------ themes ---- */
/* Red and black, as briefed. Two reds by necessity, not decoration: #ef3a41
   clears AA on black at body size (5.06:1) so it can carry text, and #d01820
   is dark enough that white clears AA on it (5.48:1) so it can carry a fill.
   One red cannot do both jobs. Values sampled from the reference creatives. */
const THEMES = {
  onyx: {
    fields: [
      [['#0a090c', 0], ['#17171c', 0.6], ['#241d21', 1]],
      [['#08070a', 0], ['#141319', 0.55], ['#2a1f24', 1]],
      [['#0d0c10', 0], ['#1b1a20', 0.5], ['#312228', 1]],
    ],
    glow: 'rgba(224,27,34,0.26)',
    text: '#f5f1ec', muted: '#b9b3b6', kick: '#ef3a41',
    cta_bg: '#d01820', cta_fg: '#ffffff', wick: '#f5f1ec',
  },
  crimson: {
    fields: [
      [['#6d0810', 0], ['#a3101a', 0.6], ['#b01018', 1]],
      [['#7a0912', 0], ['#9b0e18', 0.5], ['#8f0d16', 1]],
      [['#5e070d', 0], ['#a3101a', 0.55], ['#c41320', 1]],
    ],
    glow: 'rgba(0,0,0,0.32)',
    text: '#ffffff', muted: '#f4d9db', kick: '#ffd7d9',
    cta_bg: '#f5f1ec', cta_fg: '#0a090c', wick: '#ffffff',
  },
  ink: {
    fields: [
      [['#000000', 0], ['#0e0e12', 0.6], ['#16161b', 1]],
      [['#000000', 0], ['#120b0d', 0.5], ['#1d1216', 1]],
      [['#050508', 0], ['#101015', 0.55], ['#1a1a20', 1]],
    ],
    glow: 'rgba(224,27,34,0.18)',
    text: '#f5f1ec', muted: '#b9b3b6', kick: '#ef3a41',
    cta_bg: '#f5f1ec', cta_fg: '#0a090c', wick: '#f5f1ec',
  },
};
const THEME_NAMES = Object.keys(THEMES);

/* ----------------------------------------------------------- duotone ---- */
/* Photographs come from whatever site was scanned, lit however they were lit.
   Mapping luminance onto one red/black ramp is what makes a stranger's photos
   sit inside this palette. Done once per image at load, never per render. */
const DUOTONE_RAMP = [['#07060a', 0], ['#5e0d15', 0.34], ['#c8202a', 0.66], ['#ffd2b4', 1]];

function rampLUT(ramp) {
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const stops = ramp.map(([c, p]) => ({ c: hex(c), p }));
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].p && t <= stops[s + 1].p) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const span = (b.p - a.p) || 1, f = Math.min(1, Math.max(0, (t - a.p) / span));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(a.c[k] + (b.c[k] - a.c[k]) * f);
  }
  return lut;
}
const LUT = rampLUT(DUOTONE_RAMP);

function duotone(img, maxSide = 1400) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  let d;
  try { d = ctx.getImageData(0, 0, w, h); }
  catch (e) { return cv; }             // tainted canvas — return the plain draw
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) | 0;
    px[i] = LUT[l * 3]; px[i + 1] = LUT[l * 3 + 1]; px[i + 2] = LUT[l * 3 + 2];
  }
  ctx.putImageData(d, 0, 0);
  return cv;
}

/* --------------------------------------------------------- copy pools --- */
function splitRef(text) {
  return String(text || '')
    .split(/[\n\r]+|(?<=[.!?])\s+/).map(s => s.trim())
    .filter(s => s.length > 2);
}

/* Build the wording pools from what the scan actually found on the page.
   Nothing here is authored — every candidate is a whole heading, question or
   sentence lifted from the site, plus whatever reference text was typed in. */
function buildPools(scan, refText) {
  const ref = splitRef(refText);
  const w = (base, extra, weight) => {
    const out = base.slice();
    for (let i = 0; i < weight; i++) out.push(...extra);
    return out.length ? out : base;
  };
  const fit = (arr, max) => arr.filter(s => s.length <= max);

  const heads = scan.headlinePool.length ? scan.headlinePool
              : [scan.title, scan.brandName].filter(Boolean);
  const subs = scan.subPool.length ? scan.subPool
             : [scan.description].filter(Boolean);
  const ctas = scan.ctaPool.length ? scan.ctaPool : ['Learn more'];
  const kickers = scan.navItems.length ? scan.navItems : [scan.brandName];

  const pools = {
    kicker: kickers,
    head: w(fit(heads, 68), fit(ref, 68), 2),
    short: w(fit(heads, 42), fit(ref, 42), 2),
    micro: w(fit(heads, 26), fit(ref, 26), 2),
    sub: w(fit(subs, 145), ref.filter(s => s.length > 30 && s.length <= 145), 2),
    cta: fit(ctas, 26),
    cta_short: fit(ctas, 16),
  };
  // Never hand an empty pool to pick(). Fall back up the chain.
  if (!pools.head.length) pools.head = [scan.title || scan.brandName];
  if (!pools.short.length) pools.short = fit(pools.head, 68).length ? pools.head : [scan.brandName];
  if (!pools.micro.length) pools.micro = [scan.brandName];
  if (!pools.sub.length) pools.sub = [scan.description || scan.title || ''].filter(Boolean);
  if (!pools.cta.length) pools.cta = ['Learn more'];
  if (!pools.cta_short.length) pools.cta_short = pools.cta.slice();
  if (!pools.kicker.length) pools.kicker = [scan.brandName];
  return pools;
}

/* One image = one job. Sizes and the number of variations are chosen in the
   UI, so a job is addressed by (size index, variation index) and reproducible
   from the run seed. */
function makeJob(scan, pools, runSeed, sizeSpec, sizeIdx, varIdx, salt) {
  const [W, H, arch, slot] = sizeSpec;
  const seed = (Math.imul(runSeed ^ (sizeIdx + 1), 0x9E3779B1) ^
                Math.imul(varIdx + 1, 0x85EBCA6B) ^ (salt || 0)) >>> 0;
  const r = mulberry32(seed);

  const photo = scan.photos.length ? scan.photos[Math.floor(r() * scan.photos.length)] : null;
  // Variations of one size step through the themes so two proofs of the same
  // slot never come back looking like the same ad.
  const theme = THEMES[THEME_NAMES[(varIdx + Math.floor(r() * THEME_NAMES.length)) % THEME_NAMES.length]];

  return {
    W, H, arch, slot, sizeIdx, varIdx, seed,
    theme,
    copy: {
      kicker: pick(r, pools.kicker),
      head: pick(r, pools.head),
      short: pick(r, pools.short),
      micro: pick(r, pools.micro),
      sub: pick(r, pools.sub),
      cta: pick(r, pools.cta),
      cta_short: pick(r, pools.cta_short),
    },
    variant: {
      img: photo ? photo.canvas : null,
      logo: scan.logoCanvas || null,
      brandName: scan.brandName,
      site: scan.host,
      field: Math.floor(r() * 3),
      mirror: r() < 0.5,
      bandJit: r(),
      fx: 0.5 + (r() - 0.5) * 0.3,
      fy: 0.45 + (r() - 0.5) * 0.3,
    },
  };
}

/* -------------------------------------------------------------- zip ----- */
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
/** Store-only ZIP. PNG/JPEG are already compressed, so deflate buys nothing. */
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

/* ------------------------------------------------------------ export --- */
async function canvasToBlob(cv, name) {
  let blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  let ext = 'png';
  if (blob.size > MAX_BYTES) {
    for (const q of [0.92, 0.88, 0.84, 0.8, 0.74, 0.68, 0.62, 0.55]) {
      const b = await new Promise(res => cv.toBlob(res, 'image/jpeg', q));
      if (b.size <= MAX_BYTES) { blob = b; ext = 'jpg'; break; }
      blob = b; ext = 'jpg';
    }
  }
  return { blob, name: `${name}.${ext}`, bytes: blob.size };
}
