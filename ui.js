import { scanSite } from './scan.js';

const $ = (id) => document.getElementById(id);
const E = {
  form: $('form'), site: $('site'), ref: $('ref'), ratios: $('ratios'),
  counts: $('counts'), modes: $('modes'), run: $('run'), tally: $('tally'),
  allsizes: $('allsizes'), steps: $('steps'), steplist: $('steplist'),
  report: $('report'), reportgrid: $('reportgrid'), out: $('out'),
  bar: $('bar'), fill: $('fill'), pct: $('pct'), eta: $('eta'),
  whoami: $('whoami'), rulesbtn: $('rulesbtn'), rules: $('rules'),
};

const S = {
  per: 2, mode: 'brand', chosen: new Set(['1x1', '1.91x1', '4x5']),
  scan: null, pools: null, recs: [], seed: 0,
};
const esc = (t) => String(t).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------- form ---- */
function buildRatios() {
  E.ratios.innerHTML = '';
  for (const a of ASPECTS) {
    const box = 26, sc = Math.min(box / a.w, box / a.h);
    const el = document.createElement('label');
    el.className = 'rt';
    el.dataset.on = S.chosen.has(a.key) ? '1' : '0';
    el.title = a.used + (a.note ? ' — ' + a.note : '');
    el.innerHTML =
      `<input type="checkbox" ${S.chosen.has(a.key) ? 'checked' : ''} aria-label="${a.label}">
       ${a.warn ? '<span class="warn" title="video ratio, not a Google image asset"></span>' : ''}
       <span class="sh" style="width:${Math.max(6, a.w * sc)}px;height:${Math.max(5, a.h * sc)}px"></span>
       <span class="tx"><span class="a">${a.label}</span>
       <span class="b">${a.key.replace('x', ':')} · ${a.w}×${a.h}</span></span>`;
    const cb = el.querySelector('input');
    cb.addEventListener('change', () => {
      cb.checked ? S.chosen.add(a.key) : S.chosen.delete(a.key);
      el.dataset.on = cb.checked ? '1' : '0';
      tally();
    });
    E.ratios.appendChild(el);
  }
}

function buildCounts() {
  E.counts.innerHTML = '';
  for (const n of [1, 2, 3, 4, 6, 8]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = n;
    b.setAttribute('aria-pressed', String(n === S.per));
    b.addEventListener('click', () => {
      S.per = n;
      [...E.counts.children].forEach(c =>
        c.setAttribute('aria-pressed', String(c.textContent === String(n))));
      tally();
    });
    E.counts.appendChild(b);
  }
}

function buildModes() {
  E.modes.innerHTML = '';
  for (const [key, m] of Object.entries(TEXT_MODES)) {
    const el = document.createElement('label');
    el.className = 'md';
    el.dataset.on = S.mode === key ? '1' : '0';
    el.innerHTML = `<input type="radio" name="tm" value="${key}" ${S.mode === key ? 'checked' : ''}>
      <span class="t">${esc(m.label)}</span><span class="d">${esc(m.detail)}</span>`;
    el.querySelector('input').addEventListener('change', () => {
      S.mode = key;
      [...E.modes.children].forEach(c =>
        c.dataset.on = c.querySelector('input').checked ? '1' : '0');
      save();
    });
    E.modes.appendChild(el);
  }
}

function tally() {
  const n = S.chosen.size, t = n * S.per;
  E.tally.textContent = n
    ? `${t} image${t === 1 ? '' : 's'} — ${n} size${n === 1 ? '' : 's'}, ${S.per} each`
    : 'pick at least one size';
  E.run.disabled = !n;
  markFilled(); save();
}

/** Tick a step number once its question has an answer. Quiet feedback. */
function markFilled() {
  const qs = [...document.querySelectorAll('.q')];
  const done = [!!E.site.value.trim(), !!E.ref.value.trim(), S.chosen.size > 0, true, true];
  qs.forEach((q, i) => q.classList.toggle('filled', !!done[i]));
}

function save() {
  try {
    localStorage.setItem('adstudio', JSON.stringify({
      site: E.site.value, ref: E.ref.value, per: S.per,
      mode: S.mode, chosen: [...S.chosen] }));
  } catch (e) {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('adstudio') || '{}');
    if (s.site) E.site.value = s.site;
    if (s.ref) E.ref.value = s.ref;
    if (s.per) S.per = s.per;
    if (s.mode && TEXT_MODES[s.mode]) S.mode = s.mode;
    if (Array.isArray(s.chosen) && s.chosen.length) S.chosen = new Set(s.chosen);
  } catch (e) {}
}

/* ------------------------------------------------------------ steps ---- */
const STEPS = [
  ['read', 'Reading the website'],
  ['think', 'Working out the concept'],
  ['draw', 'Drawing the ads'],
  ['check', 'Checking every image'],
];
function showSteps() {
  E.steplist.innerHTML = STEPS.map(([k, t]) =>
    `<li data-k="${k}" data-s="wait"><span class="ic"></span><span>${t}</span>
     <span class="note"></span></li>`).join('');
  E.steps.hidden = false;
}
function step(k, state, note) {
  const li = E.steplist.querySelector(`[data-k="${k}"]`);
  if (!li) return;
  if (state) li.dataset.s = state;
  if (note != null) li.querySelector('.note').textContent = note;
}

/* -------------------------------------------------------- progress ---- */
/* Weighted, because reading the site is a fixed unknown cost and drawing is
   per-image. The estimate comes from images actually finished in this run —
   a fixed guess would be wrong on the first slow website. */
const P = { started: 0, drawn: 0, total: 0, drawStart: 0, readDone: 0 };
const READ_SHARE = 0.22;                    // reading is roughly a fifth of the wait

function progressReset(total) {
  Object.assign(P, { started: performance.now(), drawn: 0, total, drawStart: 0, readDone: 0 });
  E.bar.hidden = false;
  E.fill.classList.add('idle');
  E.fill.style.width = '4%';
  E.pct.textContent = '0%';
  E.eta.textContent = 'reading the site…';
}
function human(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `about ${s}s left`;
  const m = Math.floor(s / 60);
  return `about ${m}m ${s % 60}s left`;
}
function progressRead() {
  P.readDone = performance.now();
  P.drawStart = P.readDone;
  E.fill.classList.remove('idle');
  setProgress(READ_SHARE, null);
}
function progressDrew(n) {
  P.drawn = n;
  const frac = READ_SHARE + (1 - READ_SHARE) * (n / P.total);
  const per = (performance.now() - P.drawStart) / Math.max(1, n);
  setProgress(frac, n < P.total ? per * (P.total - n) : 0);
}
function setProgress(frac, msLeft) {
  const pc = Math.max(0, Math.min(100, Math.round(frac * 100)));
  E.fill.style.width = pc + '%';
  E.pct.textContent = pc + '%';
  if (msLeft === 0) E.eta.textContent = 'finishing…';
  else if (msLeft != null) E.eta.textContent = human(msLeft);
}
function progressDone() {
  E.fill.classList.remove('idle');
  setProgress(1, 0);
  E.pct.textContent = '100%';
  E.eta.textContent = `done in ${Math.round((performance.now() - P.started) / 1000)}s`;
}

/* ------------------------------------------------------------- run ----- */
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const chosenAspects = () => ASPECTS.filter(a => S.chosen.has(a.key));

function fileName(rec) {
  const host = S.scan.host.replace(/\./g, '-');
  return `${host}-${rec.job.W}x${rec.job.H}-v${rec.vi + 1}.${rec.out.ext}`;
}

async function buildOne(aspect, ai, vi, salt, avoid) {
  let best = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const useSalt = (salt + attempt * 0x9E37) >>> 0;
    const job = makeJob(S.scan, S.pools, S.seed, aspect, ai, vi, useSalt, avoid);
    const cv = document.createElement('canvas');
    const report = renderAd(cv, job, S.mode);
    const out = await canvasToBlob(cv, `${job.W}x${job.H}`);
    const check = checkImage(cv, job, report, out.bytes);
    const rec = { job, report, out, check, ai, vi, aspect, salt: useSalt, cv };
    if (!best || check.issues.length < best.check.issues.length) best = rec;
    if (!check.issues.length) break;
  }
  if (avoid) avoid.add(best.job.headline);
  return best;
}

function cardFor(rec, idx) {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.animationDelay = `${Math.min(idx, 12) * 45}ms`;
  const wide = rec.job.W / rec.job.H > 1.5;
  const shown = wide ? 420 : 250;
  const img = document.createElement('img');
  img.width = shown; img.height = Math.round(shown * rec.job.H / rec.job.W);
  img.alt = `${rec.job.aspect.label} advertisement`;
  img.src = URL.createObjectURL(rec.out.blob);
  const row = document.createElement('div'); row.className = 'r';
  const spec = document.createElement('span'); spec.className = 's';
  const setSpec = () => {
    const bad = rec.check.issues.length;
    spec.innerHTML = `<b>${rec.job.W}×${rec.job.H}</b> · ${Math.round(rec.out.bytes / 1024)} KB` +
      (bad ? ` · <span class="bad">${bad} issue${bad === 1 ? '' : 's'}</span>` : '');
    spec.title = bad ? rec.check.issues.join('\n') : 'passes every check';
  };
  setSpec();
  const acts = document.createElement('div'); acts.className = 'acts';
  const again = document.createElement('button');
  again.type = 'button'; again.textContent = 'Another';
  const a = document.createElement('a');
  a.className = 'save'; a.textContent = 'Save'; a.href = img.src; a.download = fileName(rec);
  acts.append(again, a);
  row.append(spec, acts);
  c.append(img, row);

  again.addEventListener('click', async () => {
    again.disabled = true;
    URL.revokeObjectURL(img.src);
    const next = await buildOne(rec.aspect, rec.ai, rec.vi,
      (rec.salt + 1 + ((Math.random() * 1e6) | 0)) >>> 0,
      new Set(S.recs.map(x => x.job.headline)));
    Object.assign(rec, next);
    img.src = URL.createObjectURL(rec.out.blob);
    a.href = img.src; a.download = fileName(rec);
    setSpec(); showReport();
    again.disabled = false;
  });
  return c;
}

function showReport() {
  const recs = S.recs;
  if (!recs.length) { E.report.hidden = true; return; }
  const issues = recs.reduce((n, r) => n + r.check.issues.length, 0);
  const cover = Math.max(...recs.map(r => r.check.coverage));
  const cs = recs.flatMap(r => r.report.contrasts.map(c => c.ratio));
  const minC = cs.length ? Math.min(...cs) : null;
  const clashes = checkRunUniqueness(recs, 6);
  const maxKB = Math.max(...recs.map(r => r.out.bytes)) / 1024;
  const cell = (k, v, ok) =>
    `<div class="c ${ok ? 'ok' : 'bad'}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  E.reportgrid.innerHTML =
    cell('Problems', String(issues), issues === 0) +
    cell('Most text', `${(cover * 100).toFixed(1)}% of 20%`, cover <= TEXT_LIMITS.maxCoverage) +
    (minC == null ? cell('Contrast', 'no text', true)
                  : cell('Lowest contrast', `${minC.toFixed(1)}:1`, minC >= 4.5)) +
    cell('Look-alikes', String(clashes.length), clashes.length === 0) +
    cell('Biggest file', `${maxKB.toFixed(0)} KB`, maxKB * 1024 <= FILE_RULES.maxBytes) +
    cell('Fake buttons', recs.some(r => r.report.drewButton) ? 'yes' : 'none',
         !recs.some(r => r.report.drewButton));
  E.report.hidden = false;
}

async function run(ev) {
  if (ev) ev.preventDefault();
  const url = E.site.value.trim();
  if (!url) { E.site.focus(); return; }
  const aspects = chosenAspects();
  if (!aspects.length) return;

  E.run.disabled = true;
  E.out.innerHTML = ''; E.report.hidden = true; S.recs = [];
  showSteps();
  progressReset(aspects.length * S.per);
  E.steps.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  step('read', 'now');
  let s;
  try {
    s = await scanSite(url, (m) => step('read', 'now', m.toLowerCase()));
    if (!s.headlinePool.length && !s.photos.length) {
      throw new Error('nothing usable on that page');
    }
    s.photos.forEach(p => { p.treated = treatPhoto(p.img); });
    S.scan = s;
    step('read', 'done', `${s.host} · ${s.photos.length} photos · ${s.counts.headlines} lines`);
    progressRead();
  } catch (e) {
    step('read', 'fail', String(e.message || e));
    E.bar.hidden = true;
    E.run.disabled = false;
    return;
  }

  step('think', 'now');
  await frame();
  S.pools = buildPools(s, E.ref.value);
  S.seed = (Math.random() * 4294967296) >>> 0;
  step('think', 'done', `${s.brandName} · ${TEXT_MODES[S.mode].label.toLowerCase()}`);

  step('draw', 'now');
  const total = aspects.length * S.per;
  const used = new Set();
  let done = 0;

  const sec = document.createElement('div');
  sec.className = 'wrap';
  sec.innerHTML = `<div class="head"><h2>${esc(s.brandName)}</h2>
    <span class="m">${esc(s.host)} · ${total} image${total === 1 ? '' : 's'}</span></div>
    <div class="grid"></div>`;
  E.out.appendChild(sec);
  const grid = sec.querySelector('.grid');

  for (let ai = 0; ai < aspects.length; ai++) {
    for (let vi = 0; vi < S.per; vi++) {
      let rec = await buildOne(aspects[ai], ai, vi, 0, used);
      for (let t = 1; t <= 4; t++) {
        const clash = checkRunUniqueness([...S.recs, rec], 6).some(c => c.b === S.recs.length);
        if (!clash) break;
        rec = await buildOne(aspects[ai], ai, vi, (t * 0x51ED) >>> 0, used);
      }
      S.recs.push(rec);
      grid.appendChild(cardFor(rec, done));
      done++;
      step('draw', 'now', `${done} of ${total}`);
      progressDrew(done);
      await frame();
    }
  }
  step('draw', 'done', `${total} drawn`);

  step('check', 'now');
  await frame();
  showReport();
  const bad = S.recs.reduce((n, r) => n + r.check.issues.length, 0);
  step('check', bad ? 'fail' : 'done', bad ? `${bad} to look at` : 'all clear');
  progressDone();

  const dl = document.createElement('div');
  dl.className = 'go';
  dl.innerHTML = `<button type="button" class="btn quiet" id="dlall">Download all ${total}</button>`;
  sec.appendChild(dl);
  $('dlall').addEventListener('click', downloadAll);

  E.run.disabled = false;
}

async function downloadAll() {
  const b = $('dlall');
  b.disabled = true; b.textContent = 'Packing…';
  const files = [];
  for (const r of S.recs) {
    files.push({ name: fileName(r), data: new Uint8Array(await r.out.blob.arrayBuffer()) });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files));
  a.download = `${S.scan.host.replace(/\./g, '-')}-ads.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  b.disabled = false; b.textContent = `Download all ${S.recs.length}`;
}

/* ------------------------------------------------------------ rules ---- */
E.rulesbtn.addEventListener('click', () => {
  if (!E.rules.innerHTML) {
    E.rules.innerHTML =
      `<h4>${esc(CTA_POLICY.ruling)}</h4><ul>` +
      CTA_POLICY.why.map(w => `<li><q>${esc(w)}</q></li>`).join('') +
      `<li>${esc(CTA_POLICY.instead)}</li></ul><h4>Not built</h4><ul>` +
      UNKNOWNS.map(u => `<li>${esc(u)}</li>`).join('') + `</ul>`;
  }
  E.rules.hidden = !E.rules.hidden;
  E.rulesbtn.textContent = E.rules.hidden
    ? "What this follows, and what it won't do" : 'Hide';
});

E.allsizes.addEventListener('click', () => {
  const all = S.chosen.size < ASPECTS.length;
  S.chosen = new Set(all ? ASPECTS.map(a => a.key) : ['1x1', '1.91x1', '4x5']);
  buildRatios(); tally();
});
E.form.addEventListener('submit', run);
E.site.addEventListener('input', markFilled);
E.ref.addEventListener('input', markFilled);

restore(); buildRatios(); buildCounts(); buildModes(); tally();
E.whoami.textContent = 'exact Google sizes · no fake buttons';
