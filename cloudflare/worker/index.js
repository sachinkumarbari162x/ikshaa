/* ============================================================================
 * The newsletter API, on Cloudflare Workers.
 *
 * This is a THIN ADAPTER. Every rule it enforces — what a valid address is,
 * how the upsert behaves, when a confirmation token expires, which addresses
 * are mailable — lives in api/validate.js and api/pg/db.js and is shared,
 * unchanged, with the Node server. Duplicating any of it here would mean two
 * definitions of "confirmed", and the one nobody is reading would be wrong.
 *
 * What is genuinely different on a Worker:
 *
 *   - No TCP. node-postgres cannot open a socket, so the Neon driver is
 *     injected instead; its Pool is API-compatible and speaks HTTP.
 *   - No filesystem. Migrations do not run here — they are a deliberate CLI
 *     step, never a side effect of the first request after a deploy.
 *   - Cross-origin. The site is served from a different hostname to this,
 *     so CORS has to be explicit rather than absent.
 * ========================================================================= */

import { Pool } from '@neondatabase/serverless';
import * as store from '../../api/pg/db.js';

/* Only these origins may call the API from a browser.
 *
 * Not '*'. A wildcard here would let any page on the internet post
 * subscriptions in your visitors' names, and read nothing useful in return —
 * which is precisely the shape of an abuse nobody notices until the list is
 * full of addresses that never opted in. */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  if (!origin || allowed.indexOf(origin) === -1) {
    return {};                       // not an allowed origin: send no CORS grant
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(request, env),
    },
  });
}

/* Constant-time compare over SHA-256 digests, same as the Node API.
   WebCrypto rather than node:crypto, and async because subtle.digest is. */
async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

async function tokenMatches(presented, expected) {
  if (!expected || !presented) {
    return false;
  }
  const [a, b] = await Promise.all([sha256(presented), sha256(expected)]);
  /* Fixed width, so the comparison cannot leak length; XOR-accumulate so it
     cannot leak the position of the first difference either. */
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

async function readJson(request) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  const text = await request.text();
  if (text.length > 16 * 1024) {
    return null;
  }
  if (type === 'application/json') {
    try {
      const parsed = JSON.parse(text || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return null;
    }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    out[k] = v;
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!env.DATABASE_URL) {
      // Unconfigured is off, not open — the same posture as a missing token.
      return json(request, env, 503, { error: 'database not configured' });
    }

    /* A pool per request. That is correct here rather than wasteful: an
       isolate may be discarded at any moment, and Neon's driver pools over
       HTTP, so there is no socket to keep warm. */
    const pool = store.createPool({ pool: new Pool({ connectionString: env.DATABASE_URL }) });

    try {
      /* ---- public ---- */

      if (route === '/api/subscribe' && request.method === 'POST') {
        const body = await readJson(request);
        if (body === null) {
          return json(request, env, 400, { error: 'malformed request' });
        }
        // The form's honeypot. A human never fills it in.
        if (body['bot-field']) {
          return json(request, env, 200, { ok: true, next: 'check-your-email' });
        }

        const result = await store.subscribe(pool, body);
        if (!result.ok) {
          return json(request, env, 422, { error: 'invalid', details: result.errors });
        }

        /* The raw token goes to the queue that will email it, never back to
           the browser. Returning it would let whoever typed an address
           confirm it themselves, which is the whole thing opt-in prevents. */
        if (result.confirmToken) {
          ctx.waitUntil(sendConfirmation(env, body.email, result.confirmToken));
        }

        return json(request, env, result.created ? 201 : 200, {
          ok: true,
          created: result.created,
          confirmed: result.confirmed,
          next: result.confirmed ? 'already-subscribed' : 'check-your-email',
        });
      }

      if (route === '/api/confirm' && request.method === 'GET') {
        const result = await store.confirm(pool, url.searchParams.get('token'));
        if (!result.ok) {
          const status = result.reason === 'expired' ? 410 : 400;
          return json(request, env, status, { ok: false, reason: result.reason });
        }
        return json(request, env, 200, { ok: true, already: result.already });
      }

      /* ---- owner only ---- */

      const authorised = await tokenMatches(bearer(request), env.IKSHAA_API_TOKEN);
      if (!authorised) {
        return json(request, env, 401, { error: 'unauthorised' });
      }

      if (route === '/api/subscribers' && request.method === 'GET') {
        return json(request, env, 200, {
          subscribers: await store.listSubscribers(pool, {
            limit: url.searchParams.get('limit'),
            offset: url.searchParams.get('offset'),
            confirmedOnly: url.searchParams.get('confirmed') === '1',
          }),
        });
      }

      if (route === '/api/messages' && request.method === 'GET') {
        return json(request, env, 200, {
          messages: await store.listMessages(pool, {
            limit: url.searchParams.get('limit'),
            email: url.searchParams.get('email'),
          }),
        });
      }

      if (route === '/api/stats' && request.method === 'GET') {
        return json(request, env, 200, await store.stats(pool));
      }

      if (route === '/api/unsubscribe' && request.method === 'POST') {
        const body = await readJson(request) || {};
        const result = await store.unsubscribe(pool, body.email);
        return json(request, env, result.ok ? 200 : 422, result);
      }

      return json(request, env, 404, { error: 'no such endpoint' });
    } catch (error) {
      // Never echo the thrown message: it can carry a query or a connection
      // string. The detail goes to the log, not to the caller.
      console.error('[api]', error && error.stack);
      return json(request, env, 500, { error: 'server error' });
    }
  },
};

/* ---------------------------------------------------------------------
 * The confirmation email
 *
 * Sent with ctx.waitUntil so the visitor is not kept waiting on a mail
 * provider — the response goes back as soon as the row is written.
 *
 * With no MAIL_API_KEY the subscription is still recorded; it simply stays
 * unconfirmed, and therefore unmailable, which is the safe end of the
 * failure. Nothing here silently promotes an unconfirmed address.
 * ------------------------------------------------------------------ */
async function sendConfirmation(env, email, token) {
  if (!env.MAIL_API_KEY || !env.MAIL_FROM || !env.PUBLIC_BASE_URL) {
    console.warn('[mail] not configured — %s stays unconfirmed', email);
    return;
  }

  const link = env.PUBLIC_BASE_URL.replace(/\/$/, '') +
    '/api/confirm?token=' + encodeURIComponent(token);

  const res = await fetch(env.MAIL_ENDPOINT || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.MAIL_API_KEY,
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: 'Confirm your letters from Ikshaa',
      text:
        'Someone asked for letters from Ikshaa using this address.\n\n' +
        'If that was you, confirm here:\n' + link + '\n\n' +
        'The link works for three days. If it was not you, ignore this — ' +
        'nothing is sent until somebody clicks it.\n\n' +
        'Carman\nIkshaa, Loutolim\n',
    }),
  });

  if (!res.ok) {
    console.error('[mail] provider %s: %s', res.status, (await res.text()).slice(0, 200));
  }
}
