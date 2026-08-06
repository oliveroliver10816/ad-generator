/* Canva, server-side.
 *
 * The site never talks to Canva. This Worker holds the OAuth credential, keeps
 * it alive, and exposes a few plain endpoints.
 *
 * ⚠ Canva ROTATES the refresh token on every refresh — the old one dies
 * immediately. So exactly one holder can own it, and it must be written back
 * atomically or the connection is lost and needs a browser sign-in again.
 * That is why the token lives in KV rather than in an env var.
 */

const TOKEN_URL = 'https://mcp.canva.com/token';
const MCP_URL = 'https://mcp.canva.com/mcp';
const KEY = 'canva_oauth';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function readCred(env) {
  const raw = await env.ADGEN.get(KEY);
  if (!raw) throw new Error('Canva is not connected on the server yet.');
  return JSON.parse(raw);
}

/** Access token, refreshed when it is close to expiry. */
async function accessToken(env) {
  const c = await readCred(env);
  if (c.expiresAt - Date.now() > 5 * 60 * 1000) return c.accessToken;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: c.refreshToken,
    client_id: c.clientId,
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
               'Accept': 'application/json', 'User-Agent': UA },
    body,
  });
  if (!r.ok) {
    throw new Error(`Canva refused to refresh (${r.status}). ` +
                    `The connection needs re-authorising.`);
  }
  const d = await r.json();
  const next = {
    ...c,
    accessToken: d.access_token,
    refreshToken: d.refresh_token || c.refreshToken,   // rotates
    expiresAt: Date.now() + (Number(d.expires_in || 14400) * 1000),
  };
  await env.ADGEN.put(KEY, JSON.stringify(next));
  return next.accessToken;
}

let rpcId = 0;
async function rpc(env, method, params) {
  const tok = await accessToken(env);
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': 'Bearer ' + tok,
      'User-Agent': UA,
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: String(++rpcId), method, params }),
  });
  let text = await r.text();
  // The endpoint answers as SSE even for single results.
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    text = lines.length ? lines[lines.length - 1].slice(6) : text;
  }
  let d;
  try { d = JSON.parse(text); }
  catch (e) { throw new Error(`Canva returned something unparseable (${r.status})`); }
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.result || {};
}

let handshaken = false;
async function call(env, tool, args) {
  if (!handshaken) {
    await rpc(env, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'ad-press', version: '1.0' },
    });
    handshaken = true;
  }
  const res = await rpc(env, 'tools/call', { name: tool, arguments: args });
  const texts = (res.content || []).filter(c => c.type === 'text').map(c => c.text);
  let out = res.structuredContent;
  if (out == null) {
    for (const t of texts) { try { out = JSON.parse(t); break; } catch (e) {} }
  }
  if (res.isError) throw new Error(`${tool}: ${texts.join(' ').slice(0, 400)}`);
  return out != null ? out : { text: texts.join('\n') };
}

/* ------------------------------------------------------------- sizes ---- */
/* generate-design only accepts Canva's own design types — no custom pixels.
   So each ad ratio is generated at the nearest Canva shape, then resized to
   the exact Google size, then exported at exact pixel dimensions. */
export const RATIOS = {
  '1x1':    { w: 1200, h: 1200, canva: 'instagram_post',   label: 'Square 1:1' },
  '1.91x1': { w: 1200, h: 628,  canva: 'facebook_post',    label: 'Landscape 1.91:1' },
  '4x5':    { w: 960,  h: 1200, canva: 'pinterest_pin',    label: 'Portrait 4:5' },
  '9x16':   { w: 1080, h: 1920, canva: 'your_story',       label: 'Vertical 9:16' },
  '16x9':   { w: 1920, h: 1080, canva: 'youtube_thumbnail',label: 'Widescreen 16:9' },
};

/* ---------------------------------------------------------- endpoints --- */
export async function handleCanva(request, env, path, cors) {
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // Anything that spends the account's quota needs the app key.
  const key = request.headers.get('x-app-key') || '';
  const expected = await env.ADGEN.get('app_key');
  if (!expected || key !== expected) return json({ error: 'unauthorised' }, 401);

  try {
    if (path === '/canva/status') {
      const c = await readCred(env);
      return json({ connected: true, expiresInSec: Math.round((c.expiresAt - Date.now()) / 1000) });
    }

    if (path === '/canva/concepts' && request.method === 'POST') {
      const { brief, ratio } = await request.json();
      const R = RATIOS[ratio] || RATIOS['1x1'];
      const out = await call(env, 'generate-design', {
        query: brief,
        design_type: R.canva,
        user_intent: 'Generate advertising concepts for a display campaign',
      });
      const cands = out?.job?.result?.generated_designs || [];
      return json({ job_id: out?.job?.id, status: out?.job?.status,
                    candidates: cands.map(c => ({ id: c.candidate_id, url: c.url,
                                                  thumb: c.thumbnails?.[0]?.url })) });
    }

    if (path === '/canva/render' && request.method === 'POST') {
      const { job_id, candidate_id, ratio } = await request.json();
      const R = RATIOS[ratio] || RATIOS['1x1'];
      const made = await call(env, 'create-design-from-candidate', {
        job_id, candidate_id,
        user_intent: 'Turn the chosen advertising concept into a design',
      });
      const id = made?.design_summary?.id;
      if (!id) return json({ error: 'Canva did not return a design id' }, 502);

      // Reflow to the exact ad shape before exporting.
      let resized = true;
      try {
        await call(env, 'resize-design', {
          design_id: id,
          design_type: { type: 'custom', width: R.w, height: R.h },
          user_intent: 'Match the exact Google Display asset size',
        });
      } catch (e) { resized = false; }

      const exp = await call(env, 'export-design', {
        design_id: id,
        format: { type: 'png', width: R.w, height: R.h,
                  export_quality: 'pro', lossless: true },
        user_intent: 'Export the finished advertisement',
      });
      const urls = exp?.job?.urls || [];
      return json({ design_id: id, resized, urls,
                    edit_url: made?.design_summary?.urls?.edit_url,
                    width: R.w, height: R.h });
    }

    /* The export URLs are signed and short-lived, and the browser cannot read
       them cross-origin, so the Worker streams the bytes back. */
    if (path === '/canva/file') {
      const u = new URL(request.url).searchParams.get('u');
      if (!u || !/^https:\/\/export-download\.canva\.com\//.test(u)) {
        return json({ error: 'only canva export urls' }, 400);
      }
      const r = await fetch(u);
      return new Response(r.body, {
        status: r.status,
        headers: { ...cors, 'Content-Type': r.headers.get('content-type') || 'image/png' },
      });
    }

    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
