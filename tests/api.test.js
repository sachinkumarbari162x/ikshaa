'use strict';

/* ============================================================================
 * The newsletter store and its API.
 *
 * The two properties worth writing down, because they pull against each other
 * and both are easy to get backwards:
 *
 *   an address may appear once     — however many times it is submitted
 *   an address may write endlessly — every message is kept
 *
 * Everything else here is about the token: an unset token must lock the door,
 * not leave it open.
 * ========================================================================= */

const http = require('http');
const store = require('../api/db');
const { createApi, tokenMatches, createRateLimiter, parseBody } = require('../api');
const { createServer } = require('../server');

const TOKEN = 'test-token-do-not-use-in-production';

function request(server, method, path, { body, token, type } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) {
      headers['Content-Type'] = type || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, body: data, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('the store', () => {
  let db;
  beforeEach(() => { db = store.openDatabase(':memory:'); });
  afterEach(() => { db.close(); });

  test('an address is stored once, however many times it subscribes', () => {
    expect(store.subscribe(db, { email: 'maria@example.com' }).created).toBe(true);
    expect(store.subscribe(db, { email: 'maria@example.com' }).created).toBe(false);

    expect(store.stats(db).subscribers).toBe(1);
  });

  test('the same address in different case is the same person', () => {
    // The failure this prevents: two rows, and they each get a letter.
    store.subscribe(db, { email: 'Maria@Example.com' });
    store.subscribe(db, { email: 'maria@example.com' });
    store.subscribe(db, { email: 'MARIA@EXAMPLE.COM' });

    expect(store.stats(db).subscribers).toBe(1);
  });

  test('one address may write as many times as it likes', () => {
    store.subscribe(db, { email: 'maria@example.com', note: 'Is the pool heated?' });
    store.subscribe(db, { email: 'maria@example.com', note: 'And is parking easy?' });
    store.subscribe(db, { email: 'MARIA@example.com', note: 'One more thing —' });

    expect(store.stats(db)).toMatchObject({ subscribers: 1, messages: 3 });

    const mine = store.listMessages(db, { email: 'maria@example.com' });
    expect(mine).toHaveLength(3);
    // Newest first. The tiebreak on id matters: all three land in the same
    // millisecond, so received_at alone leaves the order undefined.
    expect(mine[0].body).toBe('One more thing —');
    // Each carries the sender rather than only an id.
    expect(mine[0].email).toBe('maria@example.com');
  });

  test('the address is kept as first seen, not rewritten by later casing', () => {
    store.subscribe(db, { email: 'Maria@Example.com' });
    store.subscribe(db, { email: 'maria@example.com' });

    // They are one person either way; this is about what gets displayed back.
    expect(store.listSubscribers(db)[0].email).toBe('Maria@Example.com');
  });

  test('subscribing again does not blank details given earlier', () => {
    store.subscribe(db, { email: 'm@example.com', name: 'Maria', origin: 'Lisbon' });
    store.subscribe(db, { email: 'm@example.com' });      // the short form

    const [row] = store.listSubscribers(db);
    expect(row.name).toBe('Maria');
    expect(row.origin).toBe('Lisbon');
  });

  test('preferences are updated, and a message count comes back with each', () => {
    store.subscribe(db, { email: 'm@example.com', weekly: 1, seasonal: 1, note: 'hello' });
    store.subscribe(db, { email: 'm@example.com', weekly: 0, seasonal: 1 });

    const [row] = store.listSubscribers(db);
    expect(row.weekly).toBe(0);
    expect(row.seasonal).toBe(1);
    expect(row.message_count).toBe(1);
  });

  test('unsubscribing keeps the row — it is the record consent was withdrawn', () => {
    store.subscribe(db, { email: 'm@example.com' });
    expect(store.unsubscribe(db, 'm@example.com').changed).toBe(true);

    expect(store.stats(db)).toMatchObject({ subscribers: 1, active: 0 });
    expect(store.listSubscribers(db)[0].unsubscribed_at).not.toBeNull();
  });

  test('subscribing again is how somebody comes back', () => {
    store.subscribe(db, { email: 'm@example.com' });
    store.unsubscribe(db, 'm@example.com');
    store.subscribe(db, { email: 'm@example.com' });

    expect(store.stats(db).active).toBe(1);
  });

  test('a bad address is refused', () => {
    for (const email of ['', '   ', 'nope', 'no@domain', 'a b@c.com', undefined]) {
      expect(store.subscribe(db, { email }).ok).toBe(false);
    }
    expect(store.subscribe(db, { email: 'maria+goa@example.co.uk' }).ok).toBe(true);
  });

  test('oversized fields are cut rather than rejected', () => {
    const long = 'x'.repeat(9000);
    const result = store.subscribe(db, { email: 'm@example.com', name: long, note: long });
    expect(result.ok).toBe(true);
    expect(store.listSubscribers(db)[0].name).toHaveLength(store.LIMITS.name);
    expect(store.listMessages(db)[0].body).toHaveLength(store.LIMITS.note);
  });

  test('deleting a subscriber takes their messages with them', () => {
    // Proves PRAGMA foreign_keys is actually on: it is off by default, and
    // without it ON DELETE CASCADE is decoration.
    const { id } = store.subscribe(db, { email: 'm@example.com', note: 'hi' });
    db.prepare('DELETE FROM subscribers WHERE id = ?').run(id);
    expect(store.stats(db).messages).toBe(0);
  });
});

describe('the token', () => {
  test('matches only the real one', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abd')).toBe(false);
    // Different lengths must not throw — timingSafeEqual does, so both
    // sides are hashed to a fixed width first.
    expect(tokenMatches('short', 'a-much-longer-token')).toBe(false);
  });

  test('an unset token locks the door rather than opening it', () => {
    expect(tokenMatches('anything', undefined)).toBe(false);
    expect(tokenMatches('anything', '')).toBe(false);
    expect(tokenMatches(undefined, undefined)).toBe(false);
  });
});

describe('the API over HTTP', () => {
  let db;
  let server;

  beforeEach((done) => {
    db = store.openDatabase(':memory:');
    server = createServer({ api: createApi({ db, store, token: TOKEN }) });
    server.listen(0, done);
  });

  afterEach((done) => {
    // Without this the suite hangs: close() waits on keep-alive sockets.
    server.closeAllConnections();
    server.close(() => { db.close(); done(); });
  });

  test('anybody may subscribe', async () => {
    const res = await request(server, 'POST', '/api/subscribe', {
      body: JSON.stringify({ email: 'maria@example.com', note: 'Is the pool heated?' }),
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ ok: true, created: true, messageStored: true });
  });

  test('a plain form post works, so the page functions without JavaScript', async () => {
    const res = await request(server, 'POST', '/api/subscribe', {
      body: 'email=maria%40example.com&name=Maria&note=hello',
      type: 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(201);
    expect(store.stats(db)).toMatchObject({ subscribers: 1, messages: 1 });
  });

  test('a second subscription is 200, not 201, and not a duplicate', async () => {
    await request(server, 'POST', '/api/subscribe', { body: JSON.stringify({ email: 'm@example.com' }) });
    const res = await request(server, 'POST', '/api/subscribe', { body: JSON.stringify({ email: 'M@Example.com' }) });

    expect(res.status).toBe(200);
    expect(res.json.created).toBe(false);
    expect(store.stats(db).subscribers).toBe(1);
  });

  test('a bad address is 422 with reasons', async () => {
    const res = await request(server, 'POST', '/api/subscribe', { body: JSON.stringify({ email: 'nope' }) });
    expect(res.status).toBe(422);
    expect(res.json.details.join(' ')).toMatch(/valid address/);
  });

  test('malformed JSON is 400, not a crash', async () => {
    const res = await request(server, 'POST', '/api/subscribe', { body: '{"email":' });
    expect(res.status).toBe(400);
  });

  test('the honeypot looks exactly like success and stores nothing', async () => {
    const res = await request(server, 'POST', '/api/subscribe', {
      body: JSON.stringify({ email: 'bot@example.com', 'bot-field': 'gotcha' }),
    });
    expect(res.status).toBe(200);
    expect(store.stats(db).subscribers).toBe(0);
  });

  test('reading the list needs the token', async () => {
    await request(server, 'POST', '/api/subscribe', { body: JSON.stringify({ email: 'm@example.com' }) });

    for (const token of [undefined, 'wrong', TOKEN + 'x', '']) {
      const res = await request(server, 'GET', '/api/subscribers', { token });
      expect(res.status).toBe(401);
      // The refusal must not hint at which part was wrong.
      expect(res.body).not.toContain(TOKEN);
    }

    const ok = await request(server, 'GET', '/api/subscribers', { token: TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.json.subscribers).toHaveLength(1);
  });

  test('every protected route is actually protected', async () => {
    const routes = [
      ['GET', '/api/subscribers'],
      ['GET', '/api/messages'],
      ['GET', '/api/stats'],
      ['POST', '/api/unsubscribe'],
    ];
    for (const [method, path] of routes) {
      const res = await request(server, method, path, { body: '{}' });
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });

  test('answers are never cached', async () => {
    const res = await request(server, 'GET', '/api/stats', { token: TOKEN });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('an oversized body is refused rather than buffered', async () => {
    const res = await request(server, 'POST', '/api/subscribe', {
      body: JSON.stringify({ email: 'm@example.com', note: 'x'.repeat(64 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  test('an unknown endpoint is 404 JSON, not the static 404 page', async () => {
    const res = await request(server, 'GET', '/api/nope', { token: TOKEN });
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ error: 'no such endpoint' });
  });

  test('the static site still works alongside it', async () => {
    const res = await request(server, 'GET', '/index.html');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<!DOCTYPE html>');
  });
});

describe('rate limiting', () => {
  test('lets a burst through and then stops it', () => {
    const allow = createRateLimiter({ WINDOW_MS: 60000, MAX: 3 });
    expect([1, 2, 3].map(() => allow('ip'))).toEqual([true, true, true]);
    expect(allow('ip')).toBe(false);
    // One caller being noisy must not lock anybody else out.
    expect(allow('other')).toBe(true);
  });
});

describe('body parsing', () => {
  test('malformed JSON is distinguishable from empty', () => {
    expect(parseBody('{"a":1}', 'application/json')).toEqual({ a: 1 });
    expect(parseBody('', 'application/json')).toEqual({});
    expect(parseBody('{oops', 'application/json')).toBeNull();
  });

  test('a JSON array is not accepted as an object', () => {
    expect(parseBody('[1,2]', 'application/json')).toEqual({});
  });
});
