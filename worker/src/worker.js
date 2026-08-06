/* Fetch endpoint for the ad generator.
 *
 * A browser cannot read another website (same-origin policy), so the scanner
 * cannot run entirely in the page. This Worker does the fetching and returns
 * the bytes with CORS headers — including for images, which matters because a
 * canvas that has drawn a cross-origin image without CORS is tainted and
 * toBlob() throws, so the downloads would break.
 */

import { handleCanva } from './canva.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-app-key',
  'Access-Control-Max-Age': '86400',
};

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12000;

/* Refuse anything that is not a public web URL. Without this the Worker is an
   open relay into private address space. */
function checkTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'not a URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'only http and https';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return 'blocked host';
  if (/^\[?(::1|fc00|fd[0-9a-f]{2}|fe80)/i.test(h)) return 'blocked host';
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || a === 169 ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'blocked host';
  }
  return null;
}

async function proxy(target) {
  const bad = checkTarget(target);
  if (bad) return new Response(JSON.stringify({ error: bad }), {
    status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(target, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
                      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    return new Response(JSON.stringify({ error: 'fetch failed: ' + (e.message || e.name) }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  clearTimeout(timer);

  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return new Response(JSON.stringify({ error: 'too large' }), {
    status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const body = await r.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response(JSON.stringify({ error: 'too large' }), {
    status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });

  return new Response(body, {
    status: r.status,
    headers: {
      ...CORS,
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'X-Final-Url': r.url,
      'Cache-Control': 'public, max-age=600',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/fetch') {
      const target = url.searchParams.get('url');
      if (!target) return new Response(JSON.stringify({ error: 'missing url' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
      return proxy(target);
    }
    if (url.pathname.startsWith('/canva/')) {
      return handleCanva(request, env, url.pathname, CORS);
    }
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    return env.ASSETS.fetch(request);
  },
};
