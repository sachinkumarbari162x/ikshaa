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
import { confirmation } from '../../api/emails/messages.js';
import * as campaigns from '../../api/pg/campaigns.js';
import { httpTransport } from '../../api/mailer.js';
import { drainOutbox, sendReminders } from './scheduled.js';
import * as validate from '../../api/validate.js';

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

      /* Subscribing, without a confirmation email.
       *
       * The double opt-in is gone. It proved the mailbox existed, and most
       * people who meant to subscribe never clicked, so the list filled with
       * addresses nobody was permitted to write to.
       *
       * What stands in its place happens here, before the row is stored:
       *
       *   1. Turnstile   a human, not a script
       *   2. policy      not a throwaway, not a test address
       *   3. MX          the domain can actually receive mail
       *
       * Say plainly what this is: weaker proof than a clicked link. None of
       * it shows the MAILBOX exists — only that the domain accepts mail and
       * a person typed it. It removes the categories certain to bounce,
       * which is the part that protects the sending domain, and it accepts
       * that some typo'd addresses will get through where the old flow would
       * have caught them. */
      if (route === '/api/subscribe' && request.method === 'POST') {
        const body = await readJson(request);
        if (body === null) {
          return json(request, env, 400, { error: 'malformed request' });
        }
        // The form's honeypot. A human never fills it in.
        if (body['bot-field']) {
          return json(request, env, 200, { ok: true, next: 'subscribed' });
        }

        const human = await verifyTurnstile(env, body.captcha, request);
        if (!human.ok) {
          return json(request, env, 400, {
            error: 'captcha',
            reason: human.reason,
            message: 'That verification did not go through. Please tick the box and try once more.',
          });
        }

        const verdict = validate.classifyEmail(body.email);
        if (verdict.verdict === 'reject') {
          return json(request, env, 422, {
            error: 'email-rejected', reason: verdict.reason, message: verdict.message,
          });
        }
        if (verdict.verdict === 'unresolved' && !(await domainAcceptsMail(verdict.domain))) {
          return json(request, env, 422, {
            error: 'email-rejected',
            reason: 'no-mx',
            message: 'That domain does not appear to accept email. Please check the spelling.',
          });
        }

        const result = await store.subscribe(pool, body, { verifiedBy: 'captcha+mx' });
        if (!result.ok) {
          return json(request, env, 422, { error: 'invalid', details: result.errors });
        }

        return json(request, env, result.created ? 201 : 200, {
          ok: true,
          created: result.created,
          confirmed: result.confirmed,
          next: result.created ? 'subscribed' : 'already-subscribed',
        });
      }

      /* The link people actually click, from an email client.
       *
       * A browser gets sent back to the site; anything asking for JSON gets
       * JSON. The difference matters: a guest who clicks a confirmation link
       * and is shown {"ok":true} has been handed a debugging artefact, not a
       * confirmation, and has no idea whether it worked. Tests and scripts
       * still want the object, so this negotiates rather than picking one. */
      if (route === '/api/confirm' && request.method === 'GET') {
        const result = await store.confirm(pool, url.searchParams.get('token'));

        const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
        if (wantsJson || !env.PUBLIC_SITE_URL) {
          const status = result.ok ? 200 : (result.reason === 'expired' ? 410 : 400);
          return new Response(JSON.stringify(result), {
            status,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
              ...corsHeaders(request, env),
            },
          });
        }

        const outcome = result.ok
          ? (result.already ? 'already' : 'yes')
          : result.reason;                       // unknown | expired | missing

        return Response.redirect(
          env.PUBLIC_SITE_URL.replace(/\/$/, '') +
            '/subscribe.html?confirmed=' + encodeURIComponent(outcome),
          302
        );
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

  /* ---------------------------------------------------------------------
   * The timer.
   *
   * Sends what is queued and nudges the unconfirmed. It never composes a
   * letter: writing the week is a human act, and a cron that invented
   * content and mailed it would be the worst thing this system could do.
   * ------------------------------------------------------------------ */
  async scheduled(event, env, ctx) {
    if (!env.DATABASE_URL) {
      console.warn('[cron] no database configured');
      return;
    }

    const pool = store.createPool({ pool: new Pool({ connectionString: env.DATABASE_URL }) });
    const log = (...args) => console.log('[cron]', ...args);

    try {
      const transport = httpTransport({
        apiKey: env.MAIL_API_KEY,
        from: env.MAIL_FROM,
        endpoint: env.MAIL_ENDPOINT,
        unsubscribeBase: env.PUBLIC_BASE_URL,
      });

      /* Sequential, not parallel. Both talk to the same provider, and a young
         sending domain should not open two bursts at once. */
      await drainOutbox(pool, campaigns, transport, log);
      await sendReminders(pool, env, log);
    } catch (e) {
      console.error('[cron]', e && e.stack);
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
/* ---------------------------------------------------------------------
 * Turnstile
 *
 * Cloudflare's challenge, verified server-side. The token the browser sends
 * is worthless on its own — anyone can post a made-up string — so it is
 * exchanged with Cloudflare here, which is the only step that means anything.
 *
 * With no secret configured this REFUSES rather than waves everyone through.
 * A misconfigured deploy that silently accepts every signup is how a form
 * ends up unprotected without anybody noticing; a form that stops working is
 * noticed immediately.
 * ------------------------------------------------------------------ */
async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET) {
    return { ok: false, reason: 'not-configured' };
  }
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing' };
  }

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  // Binds the token to the address that solved it, so a solved token cannot
  // be lifted and replayed from somewhere else.
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) { form.append('remoteip', ip); }

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form,
    });
    const outcome = await res.json();
    return outcome && outcome.success
      ? { ok: true }
      : { ok: false, reason: (outcome && outcome['error-codes'] || ['rejected']).join(',') };
  } catch (e) {
    // Cloudflare unreachable from Cloudflare is close to impossible, and if
    // it happens, failing closed is still the right side to fail on.
    return { ok: false, reason: 'verify-failed' };
  }
}

/* Does this domain accept mail at all?
 *
 * DNS over HTTPS, because a Worker has no UDP and therefore no ordinary DNS.
 * 1.1.1.1 is on the same network, so this costs a few milliseconds.
 *
 * An MX record is the closest thing to proof available without sending: a
 * domain with none cannot receive email, which makes every address at it a
 * guaranteed bounce. A domain WITH one may still have no such mailbox — this
 * catches the typo'd domain, not the typo'd name.
 *
 * A lookup that fails is treated as acceptable. DNS is not always reachable,
 * and turning somebody away because a resolver hiccuped is worse than
 * accepting one address that might bounce. */
async function domainAcceptsMail(domain) {
  try {
    const res = await fetch(
      'https://cloudflare-dns.com/dns-query?type=MX&name=' + encodeURIComponent(domain),
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) { return true; }

    const dns = await res.json();
    // NXDOMAIN — the domain does not exist at all.
    if (dns.Status === 3) { return false; }
    if (dns.Status !== 0) { return true; }

    const mx = (dns.Answer || []).filter((a) => a.type === 15);
    if (mx.length) {
      // "." as the exchange is a null MX (RFC 7505): explicitly no mail here.
      return !mx.every((a) => String(a.data).trim().endsWith(' .'));
    }

    /* No MX is not quite the end of it: a domain with an A record and no MX
       still receives mail at that address under the fallback rule, and small
       self-hosted domains do rely on it. */
    const a = await fetch(
      'https://cloudflare-dns.com/dns-query?type=A&name=' + encodeURIComponent(domain),
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!a.ok) { return true; }
    const arec = await a.json();
    return Boolean(arec.Answer && arec.Answer.length);
  } catch (e) {
    return true;
  }
}

/* UNUSED as of the move to captcha + MX. Nothing calls this: signing up no
   longer mints a token, so there is no link to send.
 *
 * Kept, not deleted, for the same reason the Groq router was kept — the
 * decision to drop double opt-in is a judgement about deliverability, and if
 * bounce rates argue the other way it should be one call to restore, not a
 * rewrite. `/api/confirm` is still live too, because links already sitting in
 * inboxes must keep working.
 *
 * `sendReminders` in scheduled.js is a separate thing and IS still running:
 * it nudges people who subscribed under the old flow and never confirmed. */
async function sendConfirmation(env, email, token, name) {
  if (!env.MAIL_API_KEY || !env.MAIL_FROM || !env.PUBLIC_BASE_URL) {
    console.warn('[mail] not configured — %s stays unconfirmed', email);
    return;
  }

  const link = env.PUBLIC_BASE_URL.replace(/\/$/, '') +
    '/api/confirm?token=' + encodeURIComponent(token);

  /* Composed in api/emails/, shared with the Node sender. One definition of
     what a letter from Ikshaa looks like, rather than one here and a
     different one wherever the weekly send runs. */
  const letter = confirmation({ link: link, name: name });

  const res = await fetch(env.MAIL_ENDPOINT || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.MAIL_API_KEY,
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      /* The From address sends but cannot receive — no inbound MX, on
         purpose. The subscribe form promises "this goes to a person, not an
         autoresponder", so replies have to land somewhere real, or that is a
         lie the guest discovers by being bounced. */
      reply_to: env.MAIL_REPLY_TO || undefined,
      subject: letter.subject,
      /* Both parts, always. Plain text is not a courtesy: some people read
         that way, a watch or preview pane often renders it, and an
         HTML-only message is a mild negative signal to spam filters. */
      html: letter.html,
      text: letter.text,
    }),
  });

  if (!res.ok) {
    console.error('[mail] provider %s: %s', res.status, (await res.text()).slice(0, 200));
  }
}
