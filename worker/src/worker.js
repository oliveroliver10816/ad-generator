/* Fetch endpoint for the ad generator.
 *
 * A browser cannot read another website (same-origin policy), so the scanner
 * cannot run entirely in the page. This Worker does the fetching and returns
 * the bytes with CORS headers — including for images, which matters because a
 * canvas that has drawn a cross-origin image without CORS is tainted and
 * toBlob() throws, so the downloads would break.
 */

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
    /* Drop-box for the render machine. It generates on the GPU and POSTs the
       finished PNGs here, because the rig is inbound-closed and this Worker is
       the only channel that reaches both sides. Write needs the token; read is
       open so the images can simply be linked. */
    if (url.pathname.startsWith('/rig/')) {
      const name = url.pathname.slice(5);
      if (request.method === 'PUT' || request.method === 'POST') {
        const tok = request.headers.get('x-rig-token') || '';
        const want = await env.ADGEN.get('rig_token');
        if (!want || tok !== want) {
          return new Response(JSON.stringify({ error: 'unauthorised' }),
            { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        const buf = await request.arrayBuffer();
        if (buf.byteLength > 24 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'too large' }),
            { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        await env.ADGEN.put('rig:' + name, buf, { expirationTtl: 60 * 60 * 24 * 7 });
        const idx = JSON.parse((await env.ADGEN.get('rig_index')) || '[]');
        if (!idx.includes(name)) idx.unshift(name);
        await env.ADGEN.put('rig_index', JSON.stringify(idx.slice(0, 200)));
        return new Response(JSON.stringify({ ok: true, name, bytes: buf.byteLength }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      if (!name || name === 'index') {
        const idx = JSON.parse((await env.ADGEN.get('rig_index')) || '[]');
        return new Response(JSON.stringify({ files: idx }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } });
      }
      const v = await env.ADGEN.get('rig:' + name, 'arrayBuffer');
      if (!v) return new Response('not found', { status: 404, headers: CORS });
      return new Response(v, { headers: { ...CORS,
        'Content-Type': name.endsWith('.json') ? 'application/json' : 'image/png' } });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
    return env.ASSETS.fetch(request);
  },
};
