/* Wiring: load the kit once, then render a fresh pack on every Generate. */
const KIT = 'kits/ribboncera';
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), outEl = $('out'), goBtn = $('go'), allBtn = $('dlall');

let brand, prompts, images = {}, logoCache = {}, lastFiles = [];

function say(msg) { statusEl.textContent = msg; }

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('image failed: ' + src));
    im.src = src;
  });
}

function logoFor(wick) {
  if (logoCache[wick]) return logoCache[wick];
  const svg = brand.logo.replace('{WICK}', wick);
  const p = loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  logoCache[wick] = p;
  return p;
}

async function boot() {
  try {
    [brand, prompts] = await Promise.all([
      fetch(`${KIT}/brand.json`).then(r => r.json()),
      fetch(`${KIT}/prompts.json`).then(r => r.json()),
    ]);
    UI_FONT = brand.fonts.ui; DISPLAY_FONT = brand.fonts.display;

    // Canvas text measures wrong until the real faces are in memory.
    await Promise.all([
      document.fonts.load(`700 40px "${DISPLAY_FONT}"`),
      document.fonts.load(`400 40px "${DISPLAY_FONT}"`),
      document.fonts.load(`500 40px "${UI_FONT}"`),
      document.fonts.load(`600 40px "${UI_FONT}"`),
      document.fonts.load(`700 40px "${UI_FONT}"`),
    ]);
    await document.fonts.ready;

    await Promise.all(brand.photos.map(async p => { images[p.file] = await loadImage(`${KIT}/img/${p.file}`); }));
    await Promise.all(Object.values(brand.themes).map(t => logoFor(t.wick)));
    await logoFor('#5b3a4a');

    say('Ready — hit Generate.');
    goBtn.disabled = false;
  } catch (e) {
    say('Could not load the brand kit: ' + e.message);
  }
}

function siteLabel(raw) {
  let s = String(raw || '').trim();
  try { return new URL(s.match(/^https?:\/\//) ? s : 'https://' + s).hostname.replace(/^www\./, ''); }
  catch (e) { return s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || brand.site; }
}

const yieldFrame = () => new Promise(r => requestAnimationFrame(() => r()));

async function generate(ev) {
  if (ev) ev.preventDefault();
  goBtn.disabled = true; allBtn.disabled = true;
  outEl.innerHTML = ''; lastFiles = [];

  const seed = (Math.random() * 4294967296) >>> 0;
  const site = siteLabel($('site').value);
  const plan = buildPlan(seed, brand, prompts, $('ref').value, site);
  const total = plan.length * SIZES.length + LOGO_SIZES.length;
  let done = 0;

  for (const c of plan) {
    const theme = brand.themes[c.themeName];
    const v = Object.assign({}, c.variant, {
      img: images[c.photo.file],
      logo: await logoFor(theme.wick),
      brandName: brand.name,
      site,
    });

    const sec = document.createElement('section');
    sec.className = 'concept';
    sec.innerHTML = `<div class="chead"><h2>${c.label}</h2><span class="tag">${c.themeName}</span></div>
      <p class="cline">“${c.head}” — ${c.sub}</p><div class="grid"></div>`;
    outEl.appendChild(sec);
    const grid = sec.querySelector('.grid');

    for (const [W, H, arch, slot] of SIZES) {
      const cv = document.createElement('canvas');
      render(cv, W, H, arch, c, theme, v);
      const out = await canvasToBlob(cv, `${c.id}/${W}x${H}`);
      lastFiles.push({ name: out.name, blobObj: out.blob });

      const card = document.createElement('div');
      card.className = 'card';
      const shell = document.createElement('div'); shell.className = 'shell';
      cv.style.width = Math.min(W, 520) + 'px';
      shell.appendChild(cv);
      const meta = document.createElement('div'); meta.className = 'meta';
      const a = document.createElement('a');
      a.className = 'dl'; a.textContent = 'Download';
      a.href = URL.createObjectURL(out.blob);
      a.download = `${site.replace(/\./g, '-')}-${c.id}-${W}x${H}.${out.name.split('.').pop()}`;
      meta.innerHTML = `<span><b>${W}&times;${H}</b> ${slot} · ${Math.round(out.bytes / 1024)} KB</span>`;
      meta.appendChild(a);
      card.appendChild(shell); card.appendChild(meta);
      grid.appendChild(card);

      done++;
      if (done % 4 === 0) { say(`Drawing… ${done}/${total}`); await yieldFrame(); }
    }
  }

  // shared logo assets
  const sec = document.createElement('section');
  sec.className = 'concept';
  sec.innerHTML = `<div class="chead"><h2>Logo assets</h2><span class="tag">shared</span></div>
    <p class="cline">Responsive display ads ask for a 1:1 and a 4:1 logo. These two stay the same every run.</p>
    <div class="grid"></div>`;
  outEl.appendChild(sec);
  const grid = sec.querySelector('.grid');
  const plainLogo = await logoFor('#5b3a4a');
  for (const [W, H, slot] of LOGO_SIZES) {
    const cv = document.createElement('canvas');
    renderLogoAsset(cv, W, H, brand, plainLogo);
    const out = await canvasToBlob(cv, `_logo/logo-${W}x${H}`);
    lastFiles.push({ name: out.name, blobObj: out.blob });
    const card = document.createElement('div'); card.className = 'card';
    const shell = document.createElement('div'); shell.className = 'shell';
    cv.style.width = Math.min(W, 420) + 'px'; shell.appendChild(cv);
    const meta = document.createElement('div'); meta.className = 'meta';
    const a = document.createElement('a');
    a.className = 'dl'; a.textContent = 'Download';
    a.href = URL.createObjectURL(out.blob);
    a.download = `${site.replace(/\./g, '-')}-logo-${W}x${H}.${out.name.split('.').pop()}`;
    meta.innerHTML = `<span><b>${W}&times;${H}</b> ${slot} · ${Math.round(out.bytes / 1024)} KB</span>`;
    meta.appendChild(a);
    card.appendChild(shell); card.appendChild(meta); grid.appendChild(card);
    done++;
  }

  say(`${lastFiles.length} files · seed ${seed}`);
  goBtn.disabled = false; allBtn.disabled = false;
}

allBtn.addEventListener('click', async () => {
  allBtn.disabled = true; say('Zipping…');
  const files = [];
  for (const f of lastFiles) files.push({ name: f.name, data: new Uint8Array(await f.blobObj.arrayBuffer()) });
  const blob = makeZip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${siteLabel($('site').value).replace(/\./g, '-')}-display-ads.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  say(`${lastFiles.length} files · ZIP downloaded`);
  allBtn.disabled = false;
});

$('form').addEventListener('submit', generate);
goBtn.disabled = true;
boot();
