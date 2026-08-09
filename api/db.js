'use strict';

/* ============================================================================
 * Storage for the newsletter.
 *
 * node:sqlite — built into Node, so this stays a zero-dependency project. A
 * real relational database with real constraints, in one file, with no server
 * to run and nothing to install. If it ever needs to be hosted, the same SQL
 * runs on Turso or any libSQL host without changing a line of this file.
 *
 * Two shapes, and they pull in opposite directions:
 *
 *   subscribers — one row per person. An address must never appear twice.
 *   messages    — many rows per person. The same address writing again is
 *                 the normal case, not a duplicate.
 *
 * That is why the uniqueness lives on `subscribers.email` and nowhere near
 * `messages`.
 * ========================================================================= */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
/* The rules live on their own so the Postgres store can use them without
   loading this file — and therefore without loading node:sqlite. */
const { validateSubscription, cleanText, LIMITS } = require('./validate');
const fs = require('fs');
const path = require('path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY,

  /* COLLATE NOCASE is the whole point. Mail providers do not distinguish
     case in the domain, and no real provider distinguishes it in the local
     part either, so Maria@Example.com and maria@example.com are one person.
     Without this the table happily stores both and they each get a letter. */
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,

  name            TEXT,
  origin          TEXT,                              -- "where you are writing from"
  weekly          INTEGER NOT NULL DEFAULT 1,
  seasonal        INTEGER NOT NULL DEFAULT 1,

  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,

  /* Double opt-in. An address is worthless until its owner has proved they
     asked for this: anybody can type someone else's address into a form, and
     a promotion sent to an unconfirmed list is how a sending domain gets
     blocked. Only rows with confirmed_at set are ever exported. */
  confirmed_at    TEXT,
  /* The SHA-256 of the token, never the token. If this file leaks, the
     hashes in it cannot be used to confirm anybody. */
  confirm_hash    TEXT,
  confirm_expires TEXT,
  /* Null means subscribed. Unsubscribing is not a delete: the row is the
     record that consent was given and later withdrawn, and deleting it would
     lose the proof along with the preference. */
  unsubscribed_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY,
  subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  body          TEXT    NOT NULL,
  received_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS messagesBySubscriber
  ON messages (subscriber_id, received_at DESC);
`;

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new DatabaseSync(file);

  // SQLite disables foreign keys by default, per connection. Without this the
  // ON DELETE CASCADE above is decoration and orphan messages are allowed.
  db.exec('PRAGMA foreign_keys = ON');

  if (file !== ':memory:') {
    // Readers do not block the writer. Irrelevant for one process, but this
    // is the setting people forget when a second one appears.
    db.exec('PRAGMA journal_mode = WAL');
  }

  db.exec(SCHEMA);

  /* CREATE TABLE IF NOT EXISTS does nothing to a table that already exists,
     so a database made before opt-in was added would silently lack these
     columns and every insert would throw. Add them if they are missing. */
  const have = new Set(db.prepare('PRAGMA table_info(subscribers)').all().map((c) => c.name));
  for (const [column, type] of [['confirmed_at', 'TEXT'], ['confirm_hash', 'TEXT'],
                                ['confirm_expires', 'TEXT']]) {
    if (!have.has(column)) {
      db.exec('ALTER TABLE subscribers ADD COLUMN ' + column + ' ' + type);
    }
  }

  return db;
}

/* How long somebody has to click the link before it stops working. Long
   enough to survive a weekend and a spam folder; short enough that a token
   found in an old mailbox years later is inert. */
const CONFIRM_TTL_HOURS = 72;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
  // 32 bytes of CSPRNG. base64url so it survives a URL without escaping.
  return crypto.randomBytes(32).toString('base64url');
}

/* ---------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------ */

/* One address, however many times it is submitted — and every message it
   sends, kept. The upsert is what makes re-subscribing safe: it updates the
   preferences rather than failing on the unique constraint, and COALESCE
   means submitting the short form later cannot blank a name given earlier. */
function subscribe(db, input) {
  const { errors, value } = validateSubscription(input);
  if (errors.length) {
    return { ok: false, errors };
  }

  const now = new Date().toISOString();

  const before = db.prepare(
    'SELECT id, confirmed_at FROM subscribers WHERE email = ?'
  ).get(value.email);

  /* Somebody already confirmed does not get sent round the loop again — they
     asked once, and re-confirming an address on every form submission is how
     people end up unsubscribing. */
  const alreadyConfirmed = Boolean(before && before.confirmed_at);
  const token = alreadyConfirmed ? null : newToken();
  const expires = alreadyConfirmed
    ? null
    : new Date(Date.now() + CONFIRM_TTL_HOURS * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO subscribers
      (email, name, origin, weekly, seasonal, created_at, updated_at, confirm_hash, confirm_expires)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name       = COALESCE(excluded.name, subscribers.name),
      origin     = COALESCE(excluded.origin, subscribers.origin),
      weekly     = excluded.weekly,
      seasonal   = excluded.seasonal,
      updated_at = excluded.updated_at,
      -- Subscribing again is how somebody comes back.
      unsubscribed_at = NULL,
      -- A fresh token supersedes any outstanding one, so the newest link in
      -- somebody's inbox is always the one that works. Null here means they
      -- were already confirmed, and COALESCE leaves the old value alone.
      confirm_hash    = COALESCE(excluded.confirm_hash, subscribers.confirm_hash),
      confirm_expires = COALESCE(excluded.confirm_expires, subscribers.confirm_expires)
  `).run(value.email, value.name, value.origin, value.weekly, value.seasonal, now, now,
         token ? hashToken(token) : null, expires);

  const row = db.prepare('SELECT id FROM subscribers WHERE email = ?').get(value.email);

  if (value.note) {
    db.prepare(
      'INSERT INTO messages (subscriber_id, body, received_at) VALUES (?, ?, ?)'
    ).run(row.id, value.note, now);
  }

  return {
    ok: true,
    id: row.id,
    created: !before,
    messageStored: Boolean(value.note),
    confirmed: alreadyConfirmed,
    /* The only time the raw token exists. It is not stored and cannot be
       recovered — whoever calls this has to put it in the email now or issue
       a new one later. */
    confirmToken: token,
    confirmExpires: expires,
  };
}

/* Turning a click into a confirmed subscriber.
   Constant-time is not needed here: the token is 256 bits of CSPRNG, so
   there is nothing to guess a byte at a time. What matters is that it is
   single-use and expires. */
function confirm(db, token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing' };
  }

  const row = db.prepare(
    'SELECT id, email, confirmed_at, confirm_expires FROM subscribers WHERE confirm_hash = ?'
  ).get(hashToken(token));

  if (!row) {
    return { ok: false, reason: 'unknown' };
  }
  if (row.confirmed_at) {
    // Clicking twice is not an error. Say so plainly rather than failing.
    return { ok: true, email: row.email, already: true };
  }
  if (row.confirm_expires && row.confirm_expires < new Date().toISOString()) {
    return { ok: false, reason: 'expired', email: row.email };
  }

  const now = new Date().toISOString();
  /* confirm_hash is deliberately NOT cleared. Clearing it made a second click
     report "unknown link" to somebody who had just successfully confirmed —
     and second clicks are normal: people double-click, and mail clients
     prefetch URLs. Keeping the hash lets the branch above answer "already
     confirmed" instead. Re-using the token cannot do anything except set a
     flag that is already set. The expiry is cleared, since it no longer
     governs anything. */
  db.prepare(
    'UPDATE subscribers SET confirmed_at = ?, updated_at = ?, confirm_expires = NULL WHERE id = ?'
  ).run(now, now, row.id);

  return { ok: true, email: row.email, already: false };
}

function unsubscribe(db, email) {
  const address = cleanText(email, LIMITS.email);
  if (!address) {
    return { ok: false, errors: ['email is required'] };
  }
  const result = db.prepare(
    'UPDATE subscribers SET unsubscribed_at = ?, updated_at = ? WHERE email = ?'
  ).run(new Date().toISOString(), new Date().toISOString(), address);

  return { ok: true, changed: result.changes > 0 };
}

/* ---------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------ */

function page(options) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(options.offset, 10) || 0, 0);
  return { limit, offset };
}

function listSubscribers(db, options = {}) {
  const { limit, offset } = page(options);
  const where = options.confirmedOnly
    ? 'WHERE s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL'
    : '';
  return db.prepare(`
    SELECT s.id, s.email, s.name, s.origin, s.weekly, s.seasonal,
           s.created_at, s.updated_at, s.unsubscribed_at, s.confirmed_at,
           COUNT(m.id) AS message_count
    FROM subscribers s
    LEFT JOIN messages m ON m.subscriber_id = s.id
    ${where}
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/* The mailing list, as something you can actually send to.
   Confirmed, not unsubscribed, and split by what each person asked for — a
   seasonal-only subscriber must not receive the weekly letter. */
function mailingList(db, options = {}) {
  const wanted = options.list === 'seasonal' ? 'seasonal' : 'weekly';
  return db.prepare(`
    SELECT email, name, origin, confirmed_at
    FROM subscribers
    WHERE confirmed_at IS NOT NULL
      AND unsubscribed_at IS NULL
      AND ${wanted} = 1
    ORDER BY confirmed_at ASC
  `).all();
}

/* Messages carry their sender's address rather than only an id, because the
   thing anybody actually wants to know is who wrote in. */
function listMessages(db, options = {}) {
  const { limit, offset } = page(options);

  if (options.email) {
    return db.prepare(`
      SELECT m.id, m.body, m.received_at, s.email, s.name
      FROM messages m JOIN subscribers s ON s.id = m.subscriber_id
      WHERE s.email = ?
      ORDER BY m.received_at DESC, m.id DESC
      LIMIT ? OFFSET ?
    `).all(cleanText(options.email, LIMITS.email), limit, offset);
  }

  return db.prepare(`
    SELECT m.id, m.body, m.received_at, s.email, s.name
    FROM messages m JOIN subscribers s ON s.id = m.subscriber_id
    ORDER BY m.received_at DESC, m.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function stats(db) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM subscribers)                              AS subscribers,
      (SELECT COUNT(*) FROM subscribers WHERE unsubscribed_at IS NULL) AS active,
      (SELECT COUNT(*) FROM subscribers
        WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL)     AS confirmed,
      (SELECT COUNT(*) FROM subscribers
        WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL)         AS awaiting,
      (SELECT COUNT(*) FROM messages)                                  AS messages
  `).get();
  return row;
}

module.exports = {
  openDatabase,
  subscribe,
  confirm,
  mailingList,
  unsubscribe,
  listSubscribers,
  listMessages,
  stats,
  validateSubscription,
  hashToken,
  SCHEMA,
  LIMITS,
  CONFIRM_TTL_HOURS,
};
