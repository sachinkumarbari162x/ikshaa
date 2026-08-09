'use strict';

/* ============================================================================
 * The newsletter API. Mounted at /api/ by server.js, so the form posts to the
 * same origin it was served from and there is no CORS to configure.
 *
 * Public, because a visitor has to be able to use it:
 *   POST /api/subscribe
 *   GET  /api/confirm?token=…    the double opt-in link from the email
 *   POST /api/understand         routes a stuck conversation to a topic id
 *
 * Everything else is the owner's data and needs the token:
 *   GET  /api/subscribers        ?confirmed=1 for the sendable list only
 *   GET  /api/messages           ?email= to filter to one person
 *   GET  /api/stats
 *   POST /api/unsubscribe
 *   POST /api/export             writes the mailing list to data/exports/
 *
 * The token comes from IKSHAA_API_TOKEN and lives nowhere in this repo.
 * If it is unset, the protected routes refuse everyone rather than letting
 * everyone in — an unconfigured server is a locked one, not an open one.
 * ========================================================================= */

const crypto = require('crypto');

const MAX_BODY = 16 * 1024;      // a note is capped at 4000 chars; this is slack
const RATE = { WINDOW_MS: 60000, MAX: 10 };

/* ---------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------ */

/* Constant-time compare. `a === b` on a secret leaks its length and its
   first differing byte through timing, which is enough to recover a token
   one character at a time. timingSafeEqual throws when the two buffers are
   different lengths, so both sides are hashed first: SHA-256 always gives
   32 bytes, whatever came in. */
function tokenMatches(presented, expected) {
  if (!expected || !presented) {
    return false;
  }
  const a = crypto.createHash('sha256').update(String(presented)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/* ---------------------------------------------------------------------
 * Rate limiting — per address, sliding window, in memory.
 *
 * Enough for one process on localhost. A second process or a real deploy
 * needs shared state; this is not that, and pretending otherwise would be
 * worse than saying so.
 * ------------------------------------------------------------------ */

function createRateLimiter(options = RATE) {
  const hits = new Map();

  return function allow(key) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < options.WINDOW_MS);
    recent.push(now);
    hits.set(key, recent);

    // Cheap sweep so an unbounded map cannot become the vulnerability.
    if (hits.size > 5000) {
      for (const [k, times] of hits) {
        if (!times.some((t) => now - t < options.WINDOW_MS)) {
          hits.delete(k);
        }
      }
    }
    return recent.length <= options.MAX;
  };
}

/* ---------------------------------------------------------------------
 * Plumbing
 * ------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      // Stop reading rather than buffering something enormous and then
      // rejecting it — the point is not to hold it in memory at all.
      if (size > MAX_BODY) {
        // Drain rather than destroy: killing the socket here resets the
        // connection before the 413 can be written, and the caller sees a
        // network error instead of the reason they were refused.
        chunks.length = 0;
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* Accepts JSON and urlencoded, because the same endpoint serves fetch() and
   a plain <form> post — and a form post is what still works with no JS. */
function parseBody(raw, contentType) {
  const type = (contentType || '').split(';')[0].trim();

  if (type === 'application/json') {
    try {
      const parsed = JSON.parse(raw || '{}');
      // typeof [] is 'object', and an array reaching the store would read
      // its fields as undefined and quietly store an empty subscriber.
      const usable = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
      return usable ? parsed : {};
    } catch (e) {
      return null; // malformed, distinct from empty
    }
  }

  const params = new URLSearchParams(raw || '');
  const out = {};
  for (const [k, v] of params) {
    out[k] = v;
  }
  return out;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',           // never let a CDN keep this
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/* ---------------------------------------------------------------------
 * The handler
 * ------------------------------------------------------------------ */

function createApi(options) {
  const db = options.db;
  const store = options.store;               // db.js, injectable for tests
  const token = options.token !== undefined ? options.token : process.env.IKSHAA_API_TOKEN;
  const allow = options.rateLimiter || createRateLimiter();
  // Injected so a test can export to a temp directory instead of data/.
  const exporter = options.exporter !== undefined
    ? options.exporter
    : require('./export').writeMailingList;

  /* The router. Injected so tests can drive it without a network, and so a
     deployment can leave it off entirely by not setting a key. */
  const router = options.router !== undefined ? options.router : require('./llm').understand;
  const groqKey = options.groqKey !== undefined ? options.groqKey : process.env.GROQ_API_KEY;
  const catalogue = options.catalogue || null;

  /* Two limits, because they stop different things.

     Per-address, per-minute stops one caller hammering it. It does nothing
     about a thousand callers doing it once each, which is what actually
     empties a prepaid balance overnight — so there is a hard ceiling on the
     whole day as well. Both are in memory and per-process, which is honest
     for a single server and would need shared state behind more than one. */
  const allowThink = options.thinkLimiter || createRateLimiter({ WINDOW_MS: 60000, MAX: 4 });
  const dailyCap = options.dailyCap !== undefined ? options.dailyCap : Number(process.env.GROQ_DAILY_CAP || 300);
  let spentToday = 0;
  let spendingSince = new Date().toDateString();

  function withinBudget() {
    const today = new Date().toDateString();
    if (today !== spendingSince) {
      spendingSince = today;
      spentToday = 0;
    }
    if (spentToday >= dailyCap) {
      return false;
    }
    spentToday++;
    return true;
  }

  function authorised(req, res) {
    if (!tokenMatches(presentedToken(req), token)) {
      // 401 with no detail: which of "no token", "wrong token" and "server
      // has no token set" applies is not the caller's business.
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendJson(res, 401, { error: 'unauthorised' });
      return false;
    }
    return true;
  }

  return async function handleApi(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      return false;                          // not ours; let the static server have it
    }

    const route = url.pathname.replace(/\/+$/, '');
    const method = req.method;

    try {
      /* ---- public ---- */
      if (route === '/api/subscribe' && method === 'POST') {
        const key = req.socket.remoteAddress || 'unknown';
        if (!allow(key)) {
          sendJson(res, 429, { error: 'too many requests' });
          return true;
        }

        const raw = await readBody(req);
        const body = parseBody(raw, req.headers['content-type']);
        if (body === null) {
          sendJson(res, 400, { error: 'malformed JSON' });
          return true;
        }

        // The form's honeypot. A human never fills it in.
        if (body['bot-field']) {
          sendJson(res, 200, { ok: true });   // look identical to success
          return true;
        }

        const result = store.subscribe(db, body);
        if (!result.ok) {
          sendJson(res, 422, { error: 'invalid', details: result.errors });
          return true;
        }

        /* The raw confirmation token is returned ONLY when the caller proved
           it is the owner. A public caller gets told an email is coming and
           nothing else — handing the token back to whoever posted the form
           would defeat double opt-in entirely, since the person typing an
           address would be able to confirm it themselves. */
        const trusted = tokenMatches(presentedToken(req), token);

        sendJson(res, result.created ? 201 : 200, Object.assign({
          ok: true,
          created: result.created,
          confirmed: result.confirmed,
          messageStored: result.messageStored,
          // What the page should tell the visitor.
          next: result.confirmed
            ? 'already-subscribed'
            : 'check-your-email',
        }, trusted && result.confirmToken ? {
          confirmToken: result.confirmToken,
          confirmExpires: result.confirmExpires,
        } : {}));
        return true;
      }

      /* The link in the confirmation email. Public by necessity — the token
         IS the authentication, and it is 256 bits of CSPRNG. Rate limited
         all the same, so it cannot be used to probe. */
      if (route === '/api/confirm' && method === 'GET') {
        if (!allow(req.socket.remoteAddress || 'unknown')) {
          sendJson(res, 429, { error: 'too many requests' });
          return true;
        }
        const result = store.confirm(db, url.searchParams.get('token'));
        if (!result.ok) {
          // 410 for an expired link: it was valid once, and that is a
          // different thing for the reader than "this was never real".
          sendJson(res, result.reason === 'expired' ? 410 : 400, {
            ok: false,
            reason: result.reason,
          });
          return true;
        }
        sendJson(res, 200, { ok: true, already: result.already });
        return true;
      }

      /* Called by the widget when the local matcher has missed twice running.
         Returns a topic id and nothing else — never prose. The words the
         guest reads are still rendered from knowledge.js by the browser. */
      if (route === '/api/understand' && method === 'POST') {
        if (!allowThink(req.socket.remoteAddress || 'unknown')) {
          sendJson(res, 429, { intent: null, reason: 'rate-limited' });
          return true;
        }
        if (!catalogue) {
          sendJson(res, 200, { intent: null, reason: 'not-configured' });
          return true;
        }
        if (!withinBudget()) {
          // 200, not an error: the widget's job is to fall through to the
          // human handoff, and it does that on any null intent.
          sendJson(res, 200, { intent: null, reason: 'daily-cap' });
          return true;
        }

        const raw = await readBody(req);
        const body = parseBody(raw, req.headers['content-type']);
        if (body === null) {
          sendJson(res, 400, { intent: null, reason: 'malformed' });
          return true;
        }

        const result = await router({
          apiKey: groqKey,
          catalogue: catalogue,
          transcript: Array.isArray(body.transcript) ? body.transcript : [],
          shortlist: Array.isArray(body.shortlist) ? body.shortlist.slice(0, 3) : [],
        });

        /* Belt and braces. llm.js already checks membership, but this is the
           boundary where an id crosses into the browser, and the browser will
           render whatever intent it is handed. */
        const ids = catalogue.map((c) => c.id);
        const safe = result && ids.indexOf(result.intent) >= 0 ? result.intent : null;

        sendJson(res, 200, { intent: safe, reason: result ? result.reason : 'no-result' });
        return true;
      }

      /* ---- protected ---- */
      if (route === '/api/subscribers' && method === 'GET') {
        if (!authorised(req, res)) return true;
        sendJson(res, 200, {
          subscribers: store.listSubscribers(db, {
            limit: url.searchParams.get('limit'),
            offset: url.searchParams.get('offset'),
            confirmedOnly: url.searchParams.get('confirmed') === '1',
          }),
        });
        return true;
      }

      if (route === '/api/messages' && method === 'GET') {
        if (!authorised(req, res)) return true;
        sendJson(res, 200, {
          messages: store.listMessages(db, {
            limit: url.searchParams.get('limit'),
            offset: url.searchParams.get('offset'),
            email: url.searchParams.get('email'),
          }),
        });
        return true;
      }

      if (route === '/api/stats' && method === 'GET') {
        if (!authorised(req, res)) return true;
        sendJson(res, 200, store.stats(db));
        return true;
      }

      /* Token-protected, not public. A public unsubscribe endpoint lets
         anyone remove anyone by guessing addresses; the real answer for
         visitors is a signed link in the letter itself, which is a job for
         whatever ends up sending them. */
      if (route === '/api/unsubscribe' && method === 'POST') {
        if (!authorised(req, res)) return true;
        const raw = await readBody(req);
        const body = parseBody(raw, req.headers['content-type']) || {};
        const result = store.unsubscribe(db, body.email);
        if (!result.ok) {
          sendJson(res, 422, { error: 'invalid', details: result.errors });
          return true;
        }
        sendJson(res, 200, { ok: true, changed: result.changed });
        return true;
      }

      if (route === '/api/export' && method === 'POST') {
        if (!authorised(req, res)) return true;
        if (!exporter) {
          sendJson(res, 501, { error: 'export not configured' });
          return true;
        }
        const written = exporter(db, store);
        sendJson(res, 200, {
          ok: true,
          dir: written.dir,
          lists: written.files.map((f) => ({ list: f.list, count: f.count })),
        });
        return true;
      }

      sendJson(res, 404, { error: 'no such endpoint' });
      return true;
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      // Never echo the thrown message: it can carry a file path or a query.
      sendJson(res, status, { error: status === 413 ? 'body too large' : 'server error' });
      return true;
    }
  };
}

module.exports = { createApi, createRateLimiter, tokenMatches, parseBody, MAX_BODY, RATE };
