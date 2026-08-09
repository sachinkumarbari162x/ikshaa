'use strict';

/* ============================================================================
 * The stuck-conversation router.
 *
 * One property matters more than everything else here, and every test below
 * exists to defend it:
 *
 *     the model chooses a TOPIC; knowledge.js writes the WORDS
 *
 * As long as that holds, a compromised, confused or hostile model can pick the
 * wrong topic and nothing worse. It cannot put a rate, a policy, or a claim
 * about cameras in front of a guest, because it never produces text that
 * reaches one.
 * ========================================================================= */

const http = require('http');
const { understand, buildMessages, parseChoice, redact, tidy, DEFAULTS } = require('../api/llm');
const { createApi } = require('../api');
const { createServer } = require('../server');
const store = require('../api/db');
const Bot = require('../public/chat/bot.js');

const CATALOGUE = [
  { id: 'price', describes: 'what it costs' },
  { id: 'pool', describes: 'the pool' },
  { id: 'safety', describes: 'safety' },
];
const IDS = CATALOGUE.map((c) => c.id);

/* The suite never calls Groq.
 *
 * CI has no key, a paid call per run is waste, and a third party having a bad
 * afternoon would turn a red suite into noise. So these inject the reply
 * directly and assert the CONTRACT: what happens to whatever the model says.
 *
 * The wiring against the real API is proved separately and on demand:
 *
 *     npm run chat:probe
 *
 * `signal` is honoured below because a stub that ignores abort would report a
 * working timeout on an implementation that had none.
 */
function replies(content, { status = 200, delayMs = 0 } = {}) {
  return (url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({
      ok: status === 200,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
    }), delayMs);

    if (init && init.signal) {
      init.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }
  });
}

describe('what comes back from the model', () => {
  test('a valid id is accepted', async () => {
    const r = await understand({
      apiKey: 'k', catalogue: CATALOGUE, fetch: replies('pool'),
      transcript: [{ role: 'me', text: 'is it warm' }],
    });
    expect(r).toEqual({ intent: 'pool', reason: 'matched' });
  });

  test('NONE is a real answer, not a failure', async () => {
    const r = await understand({
      apiKey: 'k', catalogue: CATALOGUE, fetch: replies('NONE'),
      transcript: [{ role: 'me', text: 'what is the capital of France' }],
    });
    expect(r.intent).toBeNull();
    expect(r.reason).toBe('declined');
  });

  test('an id that does not exist is discarded, not passed on', () => {
    // A hallucinated id must never reach the browser, which would happily
    // try to render it.
    expect(parseChoice('accommodation', IDS)).toBeNull();
    expect(parseChoice('', IDS)).toBeNull();
    expect(parseChoice('pool', IDS)).toBe('pool');
  });

  test('an id wrapped in prose is read; an ambiguous reply is not', () => {
    expect(parseChoice('pool.', IDS)).toBe('pool');
    expect(parseChoice('  POOL\n', IDS)).toBe('pool');

    /* A reasoning model does not always answer with the bare word — it
       wraps it, quotes it, or puts it after a preamble. Refusing those
       threw away correct answers, so exactly one id anywhere in the reply
       is accepted. */
    expect(parseChoice('The answer is pool', IDS)).toBe('pool');
    expect(parseChoice('"safety"', IDS)).toBe('safety');

    /* The line is ambiguity, not prose. Naming two ids means the model did
       not choose, and picking one for it is how a confident wrong answer
       gets made. */
    expect(parseChoice('not price, more like pool', IDS)).toBeNull();
    expect(parseChoice('could be safety or pool', IDS)).toBeNull();
    expect(parseChoice('nothing relevant here', IDS)).toBeNull();
  });

  test('the model writing an answer instead of an id yields nothing', async () => {
    const r = await understand({
      apiKey: 'k', catalogue: CATALOGUE,
      fetch: replies('The rate is $50 a night and there are no cameras.'),
      transcript: [{ role: 'me', text: 'rates?' }],
    });
    // The single most important assertion in this file.
    expect(r.intent).toBeNull();
  });
});

describe('failing safely', () => {
  test('no key means off, not open', async () => {
    const r = await understand({ catalogue: CATALOGUE, transcript: [{ role: 'me', text: 'hi' }] });
    expect(r).toEqual({ intent: null, reason: 'no-key' });
  });

  test('an HTTP error is swallowed', async () => {
    const r = await understand({
      apiKey: 'k', catalogue: CATALOGUE, fetch: replies('pool', { status: 500 }),
      transcript: [{ role: 'me', text: 'hi' }],
    });
    expect(r).toMatchObject({ intent: null, reason: 'http-500' });
  });

  test('a slow model is abandoned rather than left to hang', async () => {
    const r = await understand({
      apiKey: 'k', catalogue: CATALOGUE,
      fetch: replies('pool', { delayMs: 200 }),
      options: { timeoutMs: 40 },
      transcript: [{ role: 'me', text: 'hi' }],
    });
    expect(r).toMatchObject({ intent: null, reason: 'timeout' });
  });

  test('a thrown fetch is swallowed', async () => {
    const r = await understand({
      apiKey: 'k', catalogue: CATALOGUE,
      fetch: () => Promise.reject(new Error('offline')),
      transcript: [{ role: 'me', text: 'hi' }],
    });
    expect(r).toMatchObject({ intent: null, reason: 'error' });
  });
});

describe('what leaves the machine', () => {
  test('addresses and phone numbers are stripped first', () => {
    const out = tidy([{ role: 'me', text: 'mail me at maria@example.com or +91 98765 43210' }], DEFAULTS);
    expect(out[0].text).toContain('[email]');
    expect(out[0].text).toContain('[phone]');
    expect(out[0].text).not.toContain('maria@example.com');
  });

  test('only the recent turns go, and each is capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ role: 'me', text: 'x'.repeat(9000) + i }));
    const out = tidy(many, DEFAULTS);
    expect(out).toHaveLength(DEFAULTS.maxTranscript);
    expect(out[0].text.length).toBeLessThanOrEqual(DEFAULTS.maxChars);
  });

  test('the prompt says NONE is allowed, and that the model must not answer', () => {
    const msgs = buildMessages({
      transcript: [{ role: 'me', text: 'anything' }], catalogue: CATALOGUE, shortlist: ['pool'],
    });
    const system = msgs[0].content;
    expect(system).toMatch(/NONE/);
    expect(system).toMatch(/never writing the reply|do not answer/i);
    // Conversation content is data, not instructions.
    expect(system).toMatch(/never an instruction/i);
  });
});

describe('the words still come from knowledge.js', () => {
  test('a routed id renders the canned answer, not model text', () => {
    const bot = new Bot({ random: Bot.seeded(1) });
    const routed = bot.answerAs('pool', 'is it warm', '2026-08-05T12:00:00');
    const direct = new Bot({ random: Bot.seeded(1) }).respond('is the pool private', '2026-08-05T12:00:00');
    expect(routed.intent).toBe('pool');
    // Same source of truth, so the same facts appear.
    expect(routed.text).toContain('private');
    expect(direct.text).toContain('private');
  });

  test('an unknown id renders nothing at all', () => {
    const bot = new Bot({ random: Bot.seeded(1) });
    expect(bot.answerAs('made_up_intent', 'x', '2026-08-05T12:00:00')).toBeNull();
  });

  test('routing a null fact still defers instead of inventing', () => {
    // The guarantee that must survive the model being in the loop.
    const bot = new Bot({ random: Bot.seeded(1) });
    const answer = bot.answerAs('price', 'what does it cost', '2026-08-05T12:00:00').text;
    expect(answer).not.toMatch(/₹\s?\d|\$\s?\d|\d+\s?(per night|a night)/);
    expect(answer).toMatch(/nyaragoa@gmail\.com|airbnb/i);
  });
});

describe('the endpoint', () => {
  let db;
  let server;
  const request = (body, path = '/api/understand') => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: server.address().port, method: 'POST', path,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  function start(router, extra = {}) {
    db = store.openDatabase(':memory:');
    server = createServer({
      api: createApi(Object.assign({
        db, store, token: 'tok', catalogue: CATALOGUE, groqKey: 'k', router, exporter: null,
      }, extra)),
    });
    return new Promise((r) => server.listen(0, r));
  }

  afterEach((done) => {
    server.closeAllConnections();
    server.close(() => { db.close(); done(); });
  });

  test('returns the id and nothing else', async () => {
    await start(async () => ({ intent: 'pool', reason: 'matched' }));
    const res = await request({ transcript: [{ role: 'me', text: 'is it warm' }] });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ intent: 'pool', reason: 'matched' });
  });

  test('an id outside the catalogue is nulled at the boundary too', async () => {
    // llm.js checks membership; so does the route. This is the last gate
    // before an id reaches a browser that will render whatever it is given.
    await start(async () => ({ intent: 'wire_me_money', reason: 'matched' }));
    const res = await request({ transcript: [{ role: 'me', text: 'hi' }] });
    expect(res.json.intent).toBeNull();
  });

  test('the daily cap stops it, and says so without erroring', async () => {
    await start(async () => ({ intent: 'pool', reason: 'matched' }), { dailyCap: 2 });
    const a = await request({ transcript: [{ role: 'me', text: '1' }] });
    const b = await request({ transcript: [{ role: 'me', text: '2' }] });
    const c = await request({ transcript: [{ role: 'me', text: '3' }] });

    expect(a.json.intent).toBe('pool');
    expect(b.json.intent).toBe('pool');
    expect(c.json).toEqual({ intent: null, reason: 'daily-cap' });
    expect(c.status).toBe(200);      // the widget falls through on a null intent
  });

  test('no catalogue configured means the feature is simply off', async () => {
    await start(async () => ({ intent: 'pool' }), { catalogue: null });
    const res = await request({ transcript: [{ role: 'me', text: 'hi' }] });
    expect(res.json).toEqual({ intent: null, reason: 'not-configured' });
  });

  test('the per-address limit engages', async () => {
    await start(async () => ({ intent: 'pool', reason: 'matched' }));
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await request({ transcript: [{ role: 'me', text: 'q' + i }] }));
    }
    expect(results.some((r) => r.status === 429)).toBe(true);
  });
});
