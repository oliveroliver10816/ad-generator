import { scanSite } from './scan.js';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('form'), site: $('site'), ref: $('ref'), scan: $('scan'), hint: $('scanhint'),
  found: $('found'), foundgrid: $('foundgrid'), copyout: $('copyout'), copylists: $('copylists'),
  setup: $('setup'), sizes: $('sizes'), pervals: $('pervals'), tally: $('tally'),
  go: $('go'), dlall: $('dlall'), bar: $('bar'), barfill: $('barfill'),
  out: $('out'), status: $('statusline'),
};

const GROUPS = [
  ['Rectangles', [[300, 250], [336, 280], [250, 250], [200, 200], [580, 400]]],
  ['Leaderboards', [[728, 90], [970, 250], [930, 180], [970, 90], [980, 120], [468, 60]]],
  ['Skyscrapers', [[300, 600], [160, 600], [120, 600], [300, 1050], [240, 400], [250, 360]]],
  ['Mobile', [[320, 100], [320, 50], [300, 50]]],
  ['Responsive display', [[1200, 628], [1200, 1200]]],
  ['Logo assets', [[1200, 1200, 'logo'], [1200, 300, 'logo']]],
];
const COMMON = ['300x250', '336x280', '728x90', '300x600', '160x600', '320x100', '970x250', '320x50'];

const state = { scan: null, pools: null, per: 2, chosen: new Set(COMMON), jobs: [], seed: 0 };

const key = (w, h, kind) => `${w}x${h}${kind === 'logo' ? 'L' : ''}`;
const say = (m) => { els.status.textContent = m; };
const specFor = (w, h) => SIZES.find(s => s[0] === w && s[1] === h);

/* ------------------------------------------------------------ picker --- */
function buildPicker() {
  els.sizes.innerHTML = '';
  for (const [title, list] of GROUPS) {
    const g = document.createElement('div');
    g.className = 'sgroup';
    g.innerHTML = `<h3>${title}</h3><div class="tiles"></div>`;
    const tiles = g.querySelector('.tiles');
    for (const [w, h, kind] of list) {
      const k = key(w, h, kind);
      const box = 54, sc = Math.min(box / w, box / h);
      const t = document.createElement('label');
      t.className = 'tile';
      t.dataset.on = state.chosen.has(k) ? '1' : '0';
      t.innerHTML =
        `<input type="checkbox" ${state.chosen.has(k) ? 'checked' : ''} aria-label="${w} by ${h}${kind === 'logo' ? ' logo' : ''}">
         <span class="shapebox"><span class="shape" style="width:${Math.max(6, w * sc)}px;height:${Math.max(4, h * sc)}px"></span></span>
         <span class="dim">${w}&times;${h}</span>`;
      const cb = t.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) state.chosen.add(k); else state.chosen.delete(k);
        t.dataset.on = cb.checked ? '1' : '0';
        tally();
      });
      tiles.appendChild(t);
    }
    els.sizes.appendChild(g);
  }
}

function buildStepper() {
  els.pervals.innerHTML = '';
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = n;
    b.setAttribute('aria-pressed', String(n === state.per));
    b.addEventListener('click', () => {
      state.per = n;
      [...els.pervals.children].forEach(c => c.setAttribute('aria-pressed', String(c.textContent === String(n))));
      tally();
    });
    els.pervals.appendChild(b);
  }
}

function tally() {
  const n = state.chosen.size, total = n * state.per;
  els.tally.textContent = n
    ? `${n} size${n === 1 ? '' : 's'} × ${state.per} = ${total} image${total === 1 ? '' : 's'}`
    : 'nothing selected';
  els.go.disabled = !n || !state.scan;
  save();
}

function applyPreset(p) {
  state.chosen.clear();
  if (p === 'all') for (const [, list] of GROUPS) for (const [w, h, k] of list) state.chosen.add(key(w, h, k));
  if (p === 'common') COMMON.forEach(k => state.chosen.add(k));
  buildPicker(); tally();
}

/* ------------------------------------------------------------- store --- */
function save() {
  try {
    localStorage.setItem('adpress', JSON.stringify({
      site: els.site.value, ref: els.ref.value,
      per: state.per, chosen: [...state.chosen],
    }));
  } catch (e) {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('adpress') || '{}');
    if (s.site) els.site.value = s.site;
    if (s.ref) els.ref.value = s.ref;
    if (s.per) state.per = s.per;
    if (Array.isArray(s.chosen) && s.chosen.length) state.chosen = new Set(s.chosen);
  } catch (e) {}
}

/* -------------------------------------------------------------- scan --- */
function card(k, v, small, extra) {
  const d = document.createElement('div');
  d.className = 'fcard' + (v ? '' : ' miss');
  d.innerHTML = `<div class="k">${k}</div><div class="v${small ? ' sm' : ''}">${v || 'none found'}</div>`;
  if (extra) d.appendChild(extra);
  return d;
}

function showFound(s) {
  els.foundgrid.innerHTML = '';
  els.foundgrid.appendChild(card('Brand', s.brandName));
  els.foundgrid.appendChild(card('What it is about', s.description || s.title, true));

  const thumbs = document.createElement('div');
  thumbs.className = 'thumbs';
  s.photos.slice(0, 8).forEach(p => {
    const c = document.createElement('canvas');
    c.width = 88; c.height = 64;
    c.getContext('2d').drawImage(p.canvas, 0, 0, 88, 64);
    thumbs.appendChild(c);
  });
  els.foundgrid.appendChild(card('Photographs', s.photos.length ? `${s.photos.length} usable` : '', false,
    s.photos.length ? thumbs : null));

  const lg = document.createElement('div');
  if (s.logoCanvas) {
    lg.className = 'thumbs';
    const c = document.createElement('canvas');
    c.width = 44; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#0a090c'; x.fillRect(0, 0, 44, 32);
    x.drawImage(s.logoCanvas, 6, 0, 32, 32);
    lg.appendChild(c);
  }
  els.foundgrid.appendChild(card('Logo', s.logoCanvas ? 'found on the page' : '', true, s.logoCanvas ? lg : null));
  els.foundgrid.appendChild(card('Typefaces',
    [s.fonts.display, s.fonts.ui].filter(Boolean).join(' · ') || 'site fonts unavailable — using defaults', true));
  els.foundgrid.appendChild(card('Wording found',
    `${s.counts.headlines} headlines · ${s.counts.subs} lines · ${s.counts.ctas} buttons`, true));

  const sec = (t, arr) => arr.length
    ? `<h4>${t}</h4><ul>${arr.slice(0, 10).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
  els.copylists.innerHTML =
    sec('Headlines', s.headlinePool) + sec('Supporting lines', s.subPool) + sec('Buttons', s.ctaPool);
  els.found.hidden = false;
  els.setup.hidden = false;
}

const escapeHtml = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function doScan(ev) {
  if (ev) ev.preventDefault();
  const url = els.site.value.trim();
  if (!url) { els.hint.textContent = 'Enter a website address first.'; els.hint.className = 'hint bad'; return; }
  els.scan.disabled = true; els.go.disabled = true; els.dlall.disabled = true;
  els.hint.className = 'hint';
  els.out.innerHTML = ''; state.jobs = [];
  try {
    const s = await scanSite(url, (m) => { els.hint.textContent = m + '…'; say(m); });
    if (!s.headlinePool.length && !s.photos.length) {
      throw new Error('nothing usable on that page — it may render its content with JavaScript');
    }
    // Duotone every photo once, so a stranger's photography lands in this palette.
    s.photos.forEach(p => { p.canvas = duotone(p.img); });
    if (s.logoSvg) {
      try { s.logoCanvas = await svgToImage(s.logoSvg); } catch (e) { s.logoCanvas = null; }
    } else if (s.logoImg) {
      s.logoCanvas = s.logoImg;
    }
    if (s.fonts.display) DISPLAY_FONT = s.fonts.display;
    if (s.fonts.ui) UI_FONT = s.fonts.ui;
    state.scan = s;
    state.pools = buildPools(s, els.ref.value);
    showFound(s);
    els.hint.textContent = `Read ${s.host} — ${s.counts.headlines} headlines, ${s.photos.length} photographs.`;
    say(`Read ${s.host}.`);
    els.setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    els.hint.textContent = 'Could not read that site: ' + e.message;
    els.hint.className = 'hint bad';
    say('Scan failed.');
  }
  els.scan.disabled = false;
  tally();
}

function svgToImage(svg) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('svg'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/* --------------------------------------------------------- generate ---- */
const yieldFrame = () => new Promise(r => requestAnimationFrame(() => r()));

function chosenSpecs() {
  const out = [];
  for (const [, list] of GROUPS) {
    for (const [w, h, kind] of list) {
      const k = key(w, h, kind);
      if (!state.chosen.has(k)) continue;
      if (kind === 'logo') out.push({ logo: true, W: w, H: h, slot: `Logo ${w === h ? '1:1' : '4:1'}`, k });
      else { const s = specFor(w, h); if (s) out.push({ logo: false, spec: s, k }); }
    }
  }
  return out;
}

async function drawInto(cv, job) {
  if (job.logo) {
    renderLogoAsset(cv, job.W, job.H, state.scan.brandName, state.scan.logoCanvas || null, job.theme);
  } else {
    render(cv, job.W, job.H, job.arch, job.copy, job.theme, job.variant);
  }
  return canvasToBlob(cv, `${job.W}x${job.H}`);
}

function makeLogoJob(runSeed, idx, varIdx, W, H, slot, salt) {
  const r = mulberry32((Math.imul(runSeed ^ (idx + 1), 0x9E3779B1) ^ (varIdx + 1) ^ (salt || 0)) >>> 0);
  const names = Object.keys(THEMES);
  return { logo: true, W, H, slot, sizeIdx: idx, varIdx, theme: THEMES[names[Math.floor(r() * names.length)]] };
}

async function generate() {
  const specs = chosenSpecs();
  if (!specs.length || !state.scan) return;
  els.go.disabled = true; els.dlall.disabled = true;
  els.out.innerHTML = ''; state.jobs = [];
  window.__fitMisses = [];
  state.seed = (Math.random() * 4294967296) >>> 0;
  state.pools = buildPools(state.scan, els.ref.value);

  const total = specs.length * state.per;
  let done = 0;
  els.bar.hidden = false; els.barfill.style.width = '0%';

  const group = document.createElement('section');
  group.className = 'rungroup';
  group.innerHTML = `<div class="wrap"><div class="runhead">
      <h2>${escapeHtml(state.scan.brandName)}</h2>
      <span class="meta">${state.scan.host} · ${total} image${total === 1 ? '' : 's'} · seed ${state.seed}</span>
    </div><div class="grid"></div></div>`;
  els.out.appendChild(group);
  const grid = group.querySelector('.grid');

  for (let si = 0; si < specs.length; si++) {
    for (let vi = 0; vi < state.per; vi++) {
      const s = specs[si];
      const job = s.logo
        ? makeLogoJob(state.seed, si, vi, s.W, s.H, s.slot, 0)
        : Object.assign(makeJob(state.scan, state.pools, state.seed, s.spec, si, vi, 0), { logo: false });
      const cv = document.createElement('canvas');
      const out = await drawInto(cv, job);
      const rec = { job, cv, out, si, vi, spec: s, salt: 0 };
      state.jobs.push(rec);
      grid.appendChild(cardFor(rec));
      done++;
      els.barfill.style.width = `${(done / total) * 100}%`;
      if (done % 3 === 0) { say(`Drawing ${done}/${total}`); await yieldFrame(); }
    }
  }

  els.bar.hidden = true;
  const misses = window.__fitMisses.length;
  say(`${total} image${total === 1 ? '' : 's'} ready${misses ? ` · ${misses} needed shrinking` : ''}.`);
  els.go.disabled = false; els.dlall.disabled = false;
}

function fileName(rec) {
  const host = state.scan.host.replace(/\./g, '-');
  const ext = rec.out.name.split('.').pop();
  return `${host}-${rec.job.W}x${rec.job.H}-v${rec.vi + 1}.${ext}`;
}

function cardFor(rec) {
  const c = document.createElement('div');
  c.className = 'card';
  const shell = document.createElement('div');
  shell.className = 'shell';
  rec.cv.style.width = Math.min(rec.job.W, 520) + 'px';
  shell.appendChild(rec.cv);
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="spec"><b>${rec.job.W}&times;${rec.job.H}</b> ${rec.job.slot || ''} · ${Math.round(rec.out.bytes / 1024)} KB</span>`;
  const acts = document.createElement('div');
  acts.className = 'acts';
  const again = document.createElement('button');
  again.type = 'button'; again.textContent = 'Another version';
  const a = document.createElement('a');
  a.className = 'save'; a.textContent = 'Save';
  a.href = URL.createObjectURL(rec.out.blob); a.download = fileName(rec);
  acts.appendChild(again); acts.appendChild(a);
  row.appendChild(acts);
  c.appendChild(shell); c.appendChild(row);

  again.addEventListener('click', async () => {
    again.disabled = true;
    rec.salt = (rec.salt + 1 + ((Math.random() * 1e6) | 0)) >>> 0;
    rec.job = rec.spec.logo
      ? makeLogoJob(state.seed, rec.si, rec.vi, rec.spec.W, rec.spec.H, rec.spec.slot, rec.salt)
      : Object.assign(makeJob(state.scan, state.pools, state.seed, rec.spec.spec, rec.si, rec.vi, rec.salt), { logo: false });
    URL.revokeObjectURL(a.href);
    rec.out = await drawInto(rec.cv, rec.job);
    a.href = URL.createObjectURL(rec.out.blob); a.download = fileName(rec);
    row.querySelector('.spec').innerHTML =
      `<b>${rec.job.W}&times;${rec.job.H}</b> ${rec.job.slot || ''} · ${Math.round(rec.out.bytes / 1024)} KB`;
    again.disabled = false;
  });
  return c;
}

/* -------------------------------------------------------------- zip ---- */
els.dlall.addEventListener('click', async () => {
  if (!state.jobs.length) return;
  els.dlall.disabled = true; say('Packing…');
  const files = [];
  for (const rec of state.jobs) {
    files.push({ name: fileName(rec), data: new Uint8Array(await rec.out.blob.arrayBuffer()) });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files));
  a.download = `${state.scan.host.replace(/\./g, '-')}-display-ads.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  say(`${files.length} images downloaded.`);
  els.dlall.disabled = false;
});

/* --------------------------------------------------------------- go ---- */
els.form.addEventListener('submit', doScan);
els.go.addEventListener('click', generate);
document.querySelectorAll('[data-preset]').forEach(b =>
  b.addEventListener('click', () => applyPreset(b.dataset.preset)));

restore();
buildPicker();
buildStepper();
tally();
els.out.innerHTML = '<div class="wrap"><p class="empty">Read a site to begin.</p></div>';
