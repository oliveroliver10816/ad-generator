/* Read a website and work out what it is about.
 *
 * Everything the generator uses — brand name, wording, photographs, logo,
 * typefaces — comes out of here. Nothing is prebuilt.
 */

const API = 'https://ad-generator.fleet-fefsba.workers.dev';
const px = (u) => `${API}/fetch?url=${encodeURIComponent(u)}`;

const STOP_CTA = /^(home|menu|close|skip to content|back|next|previous|toggle|search|share)$/i;
const ACTIONY = /\b(read|see|get|try|start|shop|book|learn|browse|explore|find|discover|view|plan|join|download|compare|choose|build|order|request|call)\b/i;

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
}

/* Split into whole sentences. Ad copy is never a half sentence, so anything
   that cannot be taken whole is discarded rather than truncated. */
function sentences(text) {
  return clean(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/)
    .map(clean)
    .filter(s => s.length > 8 && s.length < 200);
}

function uniq(arr) {
  const seen = new Set(), out = [];
  for (const x of arr) {
    const k = clean(x).toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(clean(x));
  }
  return out;
}

async function getText(url) {
  const r = await fetch(px(url));
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return { text: await r.text(), finalUrl: r.headers.get('X-Final-Url') || url };
}

/* Images are fetched through the proxy and turned into blob: URLs. A canvas
   that has drawn a cross-origin image is tainted and toBlob() throws, which
   would silently break every download — blob: URLs are same-origin, so they
   keep the canvas clean. */
function loadImageVia(url) {
  return new Promise(async (res, rej) => {
    let objUrl;
    try {
      const r = await fetch(px(url));
      if (!r.ok) return rej(new Error('http ' + r.status));
      const b = await r.blob();
      if (!/^image\//.test(b.type)) return rej(new Error('not an image'));
      objUrl = URL.createObjectURL(b);
    } catch (e) { return rej(e); }
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { URL.revokeObjectURL(objUrl); rej(new Error('decode failed')); };
    im.src = objUrl;
  });
}

/* ---------------------------------------------------------------- colour -- */
function parseColours(cssText) {
  const hits = [];
  const hex = cssText.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || [];
  for (let h of hex) {
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    hits.push(h.toLowerCase());
  }
  const rgb = cssText.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/gi) || [];
  for (const r of rgb) {
    const n = r.match(/\d+/g).map(Number);
    hits.push('#' + n.slice(0, 3).map(v => Math.min(255, v).toString(16).padStart(2, '0')).join(''));
  }
  const count = {};
  for (const h of hits) count[h] = (count[h] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ c, n }));
}

/* ----------------------------------------------------------------- fonts -- */
function findFonts(doc, cssText) {
  const fams = [];
  doc.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(l => {
    const m = l.getAttribute('href').match(/family=([^&]+)/g) || [];
    for (const g of m) {
      for (const part of g.replace('family=', '').split('&family=')) {
        const name = decodeURIComponent(part.split(':')[0]).replace(/\+/g, ' ');
        if (name) fams.push(name);
      }
    }
  });
  const decl = cssText.match(/font-family\s*:\s*([^;}]+)/gi) || [];
  for (const d of decl) {
    const first = d.split(':')[1].split(',')[0].replace(/['"]/g, '').trim();
    if (first && !/^(inherit|initial|unset|var\()/i.test(first) && first.length < 40) fams.push(first);
  }
  return uniq(fams);
}

/** Load a family from Google Fonts and confirm it really arrived.
 *
 *  Two traps here. Fetching the CSS is CORS-blocked by Google, so the
 *  stylesheet has to be injected as a <link> instead. And document.fonts.check()
 *  answers "can this be rendered", which is true even for a family that does
 *  not exist because fallback covers it — so the only honest test is to measure
 *  a probe string against a family that definitely does not exist and see
 *  whether the widths differ. */
const SYSTEMISH = /^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|segoe ui|helvetica|helvetica ?neue|arial|georgia|times|times new roman|courier|courier new|verdana|tahoma|roboto|noto sans|liberation|dejavu|emoji|icons?)$/i;

function measureIn(fam, text) {
  const c = measureIn._c || (measureIn._c = document.createElement('canvas').getContext('2d'));
  c.font = `700 72px "${fam}", __probe_missing__`;
  return c.measureText(text).width;
}

async function tryLoadGoogleFont(family) {
  const f = clean(family);
  if (!f || f.length > 34) return false;
  if (SYSTEMISH.test(f)) return false;
  if (/[0-9]{3,}|[-_][0-9a-f]{6,}/i.test(f)) return false;   // build-hashed local face
  const probe = 'Handgloves 123 WMwm';
  const baseline = measureIn('__definitely_not_a_font__', probe);

  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;700&display=swap`;
  await new Promise((res) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = res; l.onerror = res;
    document.head.appendChild(l);
    setTimeout(res, 4000);
  });
  try {
    await document.fonts.load(`700 40px "${f}"`);
    await document.fonts.load(`400 40px "${f}"`);
  } catch (e) { return false; }
  return Math.abs(measureIn(f, probe) - baseline) > 0.5;
}

/* ------------------------------------------------------------------ scan -- */
export async function scanSite(rawUrl, onStep) {
  const step = onStep || (() => {});
  let start = clean(rawUrl);
  if (!/^https?:\/\//i.test(start)) start = 'https://' + start;

  step('Fetching the page');
  const { text: html, finalUrl } = await getText(start);
  const base = new URL(finalUrl);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const abs = (u) => { try { return new URL(u, base).href; } catch (e) { return null; } };

  const meta = (sel, attr = 'content') => {
    const el = doc.querySelector(sel);
    return el ? clean(el.getAttribute(attr)) : '';
  };

  /* ----- stylesheets (for colours and fonts) ----- */
  step('Reading the stylesheets');
  let cssText = '';
  doc.querySelectorAll('style').forEach(s => { cssText += '\n' + s.textContent; });
  const sheets = [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]
    .map(l => abs(l.getAttribute('href'))).filter(Boolean)
    .filter(u => !/fonts\.googleapis\.com/.test(u)).slice(0, 4);
  for (const s of sheets) {
    try { cssText += '\n' + (await getText(s)).text; } catch (e) { /* skip */ }
  }

  /* ----- identity ----- */
  const host = base.hostname.replace(/^www\./, '');
  const rawTitle = clean(doc.querySelector('title')?.textContent || '');
  // Titles are sentences far more often than they are brand names
  // ("Welcome to GOV.UK"). Strip the sentence part, then refuse anything that
  // still reads like prose and fall back to the domain.
  const deSentence = (t) => clean(String(t)
    .replace(/^(welcome to|home\s*[-–—|:]|the official|official)\s+/i, '')
    .replace(/\s*[-–—|:]\s*(home|official site|official website).*$/i, ''));
  const usable = (t) => t && t.length <= 24 && t.split(/\s+/).length <= 3;
  const nameCands = [
    meta('meta[property="og:site_name"]'),
    meta('meta[name="application-name"]'),
    rawTitle.split(/[|—–·:]|\s+-\s+/)[0],
    rawTitle,
  ].map(deSentence).filter(Boolean);
  const brandName = nameCands.find(usable) || host.replace(/\.(com|co\.uk|org|net|io|shop|store)$/i, '');

  /* ----- wording, all taken whole from the page ----- */
  step('Reading the copy');
  const h1 = clean(doc.querySelector('h1')?.textContent);
  const h2s = uniq([...doc.querySelectorAll('h2')].map(e => clean(e.textContent)));
  const h3s = uniq([...doc.querySelectorAll('h3')].map(e => clean(e.textContent)));
  const questions = uniq([...doc.querySelectorAll('summary, .faq summary, details > summary')]
    .map(e => clean(e.textContent)));
  const desc = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const paras = [...doc.querySelectorAll('main p, article p, section p, p')]
    .map(e => clean(e.textContent)).filter(t => t.length > 40).slice(0, 40);
  const paraSentences = uniq(paras.flatMap(sentences));

  const ctaTexts = uniq([...doc.querySelectorAll(
      'a.btn, a.button, a.cta, .btn, .button, button, a[class*="cta"], a[class*="btn"], .more, a.more')]
    .map(e => clean(e.textContent))
    .filter(t => t.length > 2 && t.length <= 26 && !STOP_CTA.test(t)));
  const linkActions = uniq([...doc.querySelectorAll('a')]
    .map(e => clean(e.textContent).replace(/\s*[→›»]\s*$/, ''))
    .filter(t => t.length > 4 && t.length <= 26 && ACTIONY.test(t) && !STOP_CTA.test(t)));
  const navItems = uniq([...doc.querySelectorAll('nav a, header nav a')]
    .map(e => clean(e.textContent)).filter(t => t.length > 1 && t.length <= 22 && !STOP_CTA.test(t)));

  const headlinePool = uniq([h1, ...h2s, ...questions, ...h3s].filter(t => t.length >= 8 && t.length <= 68));
  const subPool = uniq([...sentences(desc), ...paraSentences].filter(t => t.length >= 30 && t.length <= 145));
  const ctaPool = uniq([...ctaTexts, ...linkActions]);

  /* ----- logo first, so it can be kept out of the photograph pool ----- */
  step('Looking for a logo');
  let logoSvg = null, logoImg = null, logoUrl = null;
  const headerSvg = doc.querySelector('header svg, .brand svg, a.brand svg, [class*="logo"] svg');
  if (headerSvg) {
    if (!headerSvg.getAttribute('xmlns')) headerSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    logoSvg = headerSvg.outerHTML;
  }
  {
    const cand = doc.querySelector('header img[src*="logo"], img[class*="logo"], img[alt*="logo" i]') ||
                 doc.querySelector('link[rel="apple-touch-icon"]');
    const src = cand && (cand.getAttribute('src') || cand.getAttribute('href'));
    if (src) {
      logoUrl = abs(src);
      if (!logoSvg) { try { logoImg = await loadImageVia(logoUrl); } catch (e) {} }
    }
  }

  /* ----- pictures ----- */
  step('Collecting the pictures');
  const cands = [];
  doc.querySelectorAll('img').forEach(im => {
    const w = Number(im.getAttribute('width') || 0), h = Number(im.getAttribute('height') || 0);
    if ((w && w < 200) || (h && h < 150)) return;                    // icons, avatars
    const src = im.getAttribute('src') || im.getAttribute('data-src');
    if (!src || /^data:/.test(src)) return;
    if (/logo|icon|sprite|avatar|badge/i.test(src)) return;
    cands.push(abs(src));
  });
  doc.querySelectorAll('source[srcset]').forEach(s => {
    const first = (s.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0];
    if (first && !/^data:/.test(first)) cands.push(abs(first));
  });
  // og:image is frequently just a branded share card, so it goes last and only
  // gets used when the page offered nothing better.
  const ogImg = meta('meta[property="og:image"]');
  if (ogImg) cands.push(abs(ogImg));

  const photos = [];
  const seenSrc = new Set();
  for (const u of uniq(cands.filter(Boolean)).slice(0, 14)) {
    if (seenSrc.has(u) || (logoUrl && u === logoUrl)) continue;
    seenSrc.add(u);
    try {
      const im = await loadImageVia(u);
      if (im.naturalWidth < 320 || im.naturalHeight < 220) continue;  // too small to crop
      photos.push({ img: im, src: u, w: im.naturalWidth, h: im.naturalHeight });
      step(`Collecting the pictures — ${photos.length} usable`);
      if (photos.length >= 8) break;
    } catch (e) { /* skip unreachable image */ }
  }

  /* ----- typefaces ----- */
  step('Matching the typefaces');
  const famNames = findFonts(doc, cssText);
  const loaded = [];
  for (const f of famNames.slice(0, 6)) {
    if (await tryLoadGoogleFont(f)) loaded.push(f);
    if (loaded.length >= 2) break;
  }

  const colours = parseColours(cssText).slice(0, 12);

  return {
    url: finalUrl, host, brandName,
    title: rawTitle, description: desc,
    headlinePool, subPool, ctaPool, navItems, questions,
    photos, logoSvg, logoImg,
    fonts: { display: loaded[0] || null, ui: loaded[1] || loaded[0] || null, seen: famNames },
    colours,
    counts: {
      headlines: headlinePool.length, subs: subPool.length,
      ctas: ctaPool.length, photos: photos.length,
    },
  };
}
