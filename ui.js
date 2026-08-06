import { scanSite } from './scan.js';

const $ = (id) => document.getElementById(id);
const E = {
  form: $('form'), site: $('site'), ref: $('ref'), scan: $('scan'), hint: $('scanhint'),
  found: $('found'), fgrid: $('fgrid'), setup: $('setup'), ratios: $('ratios'),
  rationote: $('rationote'), textmodes: $('textmodes'), modenote: $('modenote'),
  pervals: $('pervals'), tally: $('tally'), go: $('go'), dlall: $('dlall'),
  prog: $('prog'), progfill: $('progfill'), verdict: $('verdict'), vgrid: $('vgrid'),
  out: $('out'), rulebody: $('rulebody'),
};

const S = {
  scan: null, pools: null, per: 3, mode: 'brand',
  chosen: new Set(['1x1', '1.91x1', '4x5']), recs: [], seed: 0,
};
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------ controls -- */
function buildRatios() {
  E.ratios.innerHTML = '';
  for (const a of ASPECTS) {
    const box = 46, sc = Math.min(box / a.w, box / a.h);
    const el = document.createElement('label');
    el.className = 'rt';
    el.dataset.on = S.chosen.has(a.key) ? '1' : '0';
    el.title = a.used + (a.note ? ' — ' + a.note : '');
    el.innerHTML =
      `<input type="checkbox" ${S.chosen.has(a.key) ? 'checked' : ''} aria-label="${a.label} ${a.key}">
       ${a.warn ? '<span class="flag" title="not a Google image-asset ratio"></span>' : ''}
       <span class="box"><span class="sh" style="width:${Math.max(7, a.w * sc)}px;height:${Math.max(5, a.h * sc)}px"></span></span>
       <span class="n">${a.key.replace('x', ':')}</span>
       <span class="p">${a.w}&times;${a.h}</span>`;
    const cb = el.querySelector('input');
    cb.addEventListener('change', () => {
      cb.checked ? S.chosen.add(a.key) : S.chosen.delete(a.key);
      el.dataset.on = cb.checked ? '1' : '0';
      tally();
    });
    E.ratios.appendChild(el);
  }
  E.rationote.innerHTML = ASPECT_NOTES
    .map(n => `<b>${esc(n.asked)}</b> — ${esc(n.verdict)} ${esc(n.detail)}`).join('<br><br>');
}

function buildModes() {
  E.textmodes.innerHTML = '';
  for (const [key, m] of Object.entries(TEXT_MODES)) {
    const el = document.createElement('label');
    el.className = 'md';
    el.dataset.on = S.mode === key ? '1' : '0';
    el.innerHTML = `<input type="radio" name="tm" value="${key}" ${S.mode === key ? 'checked' : ''}>
      <span><span class="t">${esc(m.label)}</span><span class="d">${esc(m.detail)}</span></span>`;
    el.querySelector('input').addEventListener('change', () => {
      S.mode = key;
      [...E.textmodes.children].forEach(c =>
        c.dataset.on = c.querySelector('input').checked ? '1' : '0');
      save();
    });
    E.textmodes.appendChild(el);
  }
  E.modenote.textContent = CTA_POLICY.ruling + ' ' + CTA_POLICY.instead;
}

function buildSteps() {
  E.pervals.innerHTML = '';
  for (const n of [1, 2, 3, 4, 5, 6, 8]) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = n;
    b.setAttribute('aria-pressed', String(n === S.per));
    b.addEventListener('click', () => {
      S.per = n;
      [...E.pervals.children].forEach(c => c.setAttribute('aria-pressed', String(c.textContent === String(n))));
      tally();
    });
    E.pervals.appendChild(b);
  }
}

function tally() {
  const n = S.chosen.size, t = n * S.per;
  E.tally.textContent = n ? `${n} ratio${n === 1 ? '' : 's'} × ${S.per} = ${t} image${t === 1 ? '' : 's'}`
                          : 'nothing selected';
  E.go.disabled = !n || !S.scan;
  save();
}

function save() {
  try {
    localStorage.setItem('adpress2', JSON.stringify({
      site: E.site.value, ref: E.ref.value, per: S.per, mode: S.mode, chosen: [...S.chosen] }));
  } catch (e) {}
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('adpress2') || '{}');
    if (s.site) E.site.value = s.site;
    if (s.ref) E.ref.value = s.ref;
    if (s.per) S.per = s.per;
    if (s.mode && TEXT_MODES[s.mode]) S.mode = s.mode;
    if (Array.isArray(s.chosen) && s.chosen.length) S.chosen = new Set(s.chosen);
  } catch (e) {}
}

/* ---------------------------------------------------------------- scan -- */
function fc(k, v, small, extra) {
  const d = document.createElement('div');
  d.className = 'fc' + (v ? '' : ' none');
  d.innerHTML = `<div class="k">${k}</div><div class="v${small ? ' sm' : ''}">${esc(v || 'none')}</div>`;
  if (extra) d.appendChild(extra);
  return d;
}

function showFound(s) {
  E.fgrid.innerHTML = '';
  E.fgrid.appendChild(fc('Brand', s.brandName));
  E.fgrid.appendChild(fc('About', s.description || s.title, true));
  const tb = document.createElement('div');
  tb.className = 'tb';
  s.photos.slice(0, 8).forEach(p => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 60;
    c.getContext('2d').drawImage(p.treated, 0, 0, 80, 60);
    tb.appendChild(c);
  });
  E.fgrid.appendChild(fc('Photographs', s.photos.length ? String(s.photos.length) : '', false,
    s.photos.length ? tb : null));
  E.fgrid.appendChild(fc('Lines available', `${s.counts.headlines} headlines`, true));
  E.found.hidden = false; E.setup.hidden = false;
}

async function doScan(ev) {
  if (ev) ev.preventDefault();
  const url = E.site.value.trim();
  if (!url) { E.hint.textContent = 'Enter an address first.'; E.hint.className = 'hint bad'; return; }
  E.scan.disabled = true; E.go.disabled = true; E.dlall.disabled = true;
  E.hint.className = 'hint'; E.out.innerHTML = ''; E.verdict.hidden = true; S.recs = [];
  try {
    const s = await scanSite(url, (m) => { E.hint.textContent = m + '…'; });
    if (!s.headlinePool.length && !s.photos.length) {
      throw new Error('nothing usable — the page may build its content with JavaScript');
    }
    s.photos.forEach(p => { p.treated = treatPhoto(p.img); });
    S.scan = s;
    S.pools = buildPools(s, E.ref.value);
    showFound(s);
    E.hint.textContent = `${s.host} · ${s.photos.length} photographs · ${s.counts.headlines} lines`;
    E.setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    E.hint.textContent = 'Could not read that site: ' + e.message;
    E.hint.className = 'hint bad';
  }
  E.scan.disabled = false; tally();
}

/* ----------------------------------------------------------- generate -- */
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const chosenAspects = () => ASPECTS.filter(a => S.chosen.has(a.key));

function fileName(rec) {
  const host = S.scan.host.replace(/\./g, '-');
  return `${host}-${rec.job.W}x${rec.job.H}-${rec.job.aspect.key}-v${rec.vi + 1}.${rec.out.ext}`;
}

/* Build one image. If it comes back flagged — almost always because the
   photograph that slot drew has very little light in it — try a different
   photograph rather than shipping the flagged frame. */
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
  (window.__lits = window.__lits || []).push([best.report.litPhoto || 0, best.report.litFinal || 0]);
  return best;
}

function cardFor(rec) {
  const c = document.createElement('div');
  c.className = 'card';
  const shown = Math.min(rec.job.W, rec.job.W / rec.job.H > 1.6 ? 460 : 300);
  const img = document.createElement('img');
  img.width = shown; img.height = Math.round(shown * rec.job.H / rec.job.W);
  img.alt = `${rec.job.aspect.label} ad`;
  img.src = URL.createObjectURL(rec.out.blob);
  const row = document.createElement('div');
  row.className = 'r';
  const spec = document.createElement('span');
  spec.className = 's';
  const setSpec = () => {
    const bad = rec.check.issues.length;
    spec.innerHTML = `<b>${rec.job.W}&times;${rec.job.H}</b> · ${Math.round(rec.out.bytes / 1024)} KB · ` +
      `text ${(rec.check.coverage * 100).toFixed(1)}%` +
      (bad ? ` · <span class="bad">${bad} issue${bad === 1 ? '' : 's'}</span>` : '');
    spec.title = bad ? rec.check.issues.join('\n') : 'passes every mechanical check';
  };
  setSpec();
  const acts = document.createElement('div');
  acts.className = 'acts';
  const again = document.createElement('button');
  again.type = 'button'; again.textContent = 'Again';
  const a = document.createElement('a');
  a.className = 'save'; a.textContent = 'Save';
  a.href = img.src; a.download = fileName(rec);
  acts.append(again, a);
  row.append(spec, acts);
  c.append(img, row);

  again.addEventListener('click', async () => {
    again.disabled = true;
    URL.revokeObjectURL(img.src);
    const next = await buildOne(rec.aspect, rec.ai, rec.vi, (rec.salt + 1 + ((Math.random() * 1e6) | 0)) >>> 0, new Set(S.recs.map(x => x.job.headline)));
    Object.assign(rec, next);
    img.src = URL.createObjectURL(rec.out.blob);
    a.href = img.src; a.download = fileName(rec);
    setSpec(); showVerdict();
    again.disabled = false;
  });
  return c;
}

function showVerdict() {
  const recs = S.recs;
  if (!recs.length) { E.verdict.hidden = true; return; }
  const issues = recs.reduce((n, r) => n + r.check.issues.length, 0);
  const cover = Math.max(...recs.map(r => r.check.coverage));
  const contrasts = recs.flatMap(r => r.report.contrasts.map(c => c.ratio));
  const minC = contrasts.length ? Math.min(...contrasts) : null;
  const clashes = checkRunUniqueness(recs, 6);
  const maxKB = Math.max(...recs.map(r => r.out.bytes)) / 1024;

  const cell = (k, n, ok) =>
    `<div class="v ${ok ? 'pass' : 'fail'}"><span class="k">${k}</span><span class="n">${n}</span></div>`;
  E.vgrid.innerHTML =
    cell('Checks failed', String(issues), issues === 0) +
    cell('Most text on one image', `${(cover * 100).toFixed(1)}% / 20%`, cover <= TEXT_LIMITS.maxCoverage) +
    (minC == null ? cell('Text contrast', 'no text', true)
                  : cell('Lowest text contrast', `${minC.toFixed(1)}:1`, minC >= 4.5)) +
    cell('Near-duplicates', String(clashes.length), clashes.length === 0) +
    cell('Largest file', `${maxKB.toFixed(0)} KB / 5120`, maxKB * 1024 <= FILE_RULES.maxBytes) +
    cell('Buttons drawn', recs.some(r => r.report.drewButton) ? 'yes' : 'none',
         !recs.some(r => r.report.drewButton));
  E.verdict.hidden = false;
}

async function generate() {
  const aspects = chosenAspects();
  if (!aspects.length || !S.scan) return;
  E.go.disabled = true; E.dlall.disabled = true;
  E.out.innerHTML = ''; S.recs = []; E.verdict.hidden = true; window.__lits = [];
  S.seed = (Math.random() * 4294967296) >>> 0;
  S.pools = buildPools(S.scan, E.ref.value);

  const total = aspects.length * S.per;
  const used = new Set();
  let done = 0;
  E.prog.hidden = false; E.progfill.style.width = '0%';

  const run = document.createElement('section');
  run.className = 'run';
  run.innerHTML = `<div class="wrap"><div class="rh">
      <h2>${esc(S.scan.brandName)}</h2>
      <span class="m">${esc(S.scan.host)} · ${total} image${total === 1 ? '' : 's'} · ${esc(TEXT_MODES[S.mode].label.toLowerCase())} · seed ${S.seed}</span>
    </div><div class="grid"></div></div>`;
  E.out.appendChild(run);
  const grid = run.querySelector('.grid');

  for (let ai = 0; ai < aspects.length; ai++) {
    for (let vi = 0; vi < S.per; vi++) {
      /* Reject a build that is a visual near-duplicate of one already made at
         this ratio and try again. Matters most with no text, where two crops of
         the same photograph can otherwise land almost on top of each other. */
      let rec = await buildOne(aspects[ai], ai, vi, 0, used);
      for (let t = 1; t <= 4; t++) {
        const clash = checkRunUniqueness([...S.recs, rec], 6)
          .some(c => c.b === S.recs.length);
        if (!clash) break;
        rec = await buildOne(aspects[ai], ai, vi, (t * 0x51ED) >>> 0, used);
      }
      S.recs.push(rec);
      grid.appendChild(cardFor(rec));
      done++;
      E.progfill.style.width = `${(done / total) * 100}%`;
      if (done % 2 === 0) await frame();
    }
  }
  E.prog.hidden = true;
  showVerdict();
  E.go.disabled = false; E.dlall.disabled = false;
}

E.dlall.addEventListener('click', async () => {
  if (!S.recs.length) return;
  E.dlall.disabled = true;
  const files = [];
  for (const r of S.recs) files.push({ name: fileName(r), data: new Uint8Array(await r.out.blob.arrayBuffer()) });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files));
  a.download = `${S.scan.host.replace(/\./g, '-')}-ads.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  E.dlall.disabled = false;
});

/* --------------------------------------------------------------- rules -- */
E.rulebody.innerHTML =
  `<h4>${esc(CTA_POLICY.ruling)}</h4><ul>` +
  CTA_POLICY.why.map(w => `<li><q>${esc(w)}</q></li>`).join('') +
  `<li>${esc(CTA_POLICY.instead)}</li></ul>` +
  `<h4>Not built</h4><ul>` +
  UNKNOWNS.map(u => `<li>${esc(u)}</li>`).join('') + `</ul>` +
  `<h4>File</h4><ul><li>${esc(FILE_RULES.note)}</li></ul>`;

E.form.addEventListener('submit', doScan);
E.go.addEventListener('click', generate);
restore(); buildRatios(); buildModes(); buildSteps(); tally();
E.out.innerHTML = '<div class="wrap"><p class="empty">Read a site to begin.</p></div>';
