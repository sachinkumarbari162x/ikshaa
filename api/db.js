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
  return db;
}

/* ---------------------------------------------------------------------
 * Validation. Kept here rather than in the route so the rules hold no
 * matter who calls in — a CLI import has to obey them too.
 * ------------------------------------------------------------------ */

const LIMITS = { email: 254, name: 120, origin: 120, note: 4000 };

// Deliberately loose. Anything stricter rejects addresses that genuinely
// work; the real proof an address exists is that mail to it arrives.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function cleanText(value, max) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function validateSubscription(input) {
  const errors = [];
  const email = cleanText(input.email, LIMITS.email);

  if (!email) {
    errors.push('email is required');
  } else if (!EMAIL.test(email)) {
    errors.push('email is not a valid address');
  }

  // Long text is cut, not refused. Someone who writes past the limit has
  // still said something worth keeping, and losing all of it to protect a
  // column width would be the wrong trade.
  const note = cleanText(input.note, LIMITS.note);

  return {
    errors,
    value: {
      email,
      name: cleanText(input.name, LIMITS.name),
      origin: cleanText(input.origin, LIMITS.origin),
      // Absent means yes: the form ships both boxes ticked, and an unchecked
      // box is simply not submitted.
      weekly: input.weekly === undefined ? 1 : (input.weekly ? 1 : 0),
      seasonal: input.seasonal === undefined ? 1 : (input.seasonal ? 1 : 0),
      note,
    },
  };
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

  const before = db.prepare('SELECT id FROM subscribers WHERE email = ?').get(value.email);

  db.prepare(`
    INSERT INTO subscribers (email, name, origin, weekly, seasonal, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name       = COALESCE(excluded.name, subscribers.name),
      origin     = COALESCE(excluded.origin, subscribers.origin),
      weekly     = excluded.weekly,
      seasonal   = excluded.seasonal,
      updated_at = excluded.updated_at,
      -- Subscribing again is how somebody comes back.
      unsubscribed_at = NULL
  `).run(value.email, value.name, value.origin, value.weekly, value.seasonal, now, now);

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
  };
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
  return db.prepare(`
    SELECT s.id, s.email, s.name, s.origin, s.weekly, s.seasonal,
           s.created_at, s.updated_at, s.unsubscribed_at,
           COUNT(m.id) AS message_count
    FROM subscribers s
    LEFT JOIN messages m ON m.subscriber_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
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
      (SELECT COUNT(*) FROM messages)                                  AS messages
  `).get();
  return row;
}

module.exports = {
  openDatabase,
  subscribe,
  unsubscribe,
  listSubscribers,
  listMessages,
  stats,
  validateSubscription,
  SCHEMA,
  LIMITS,
};
