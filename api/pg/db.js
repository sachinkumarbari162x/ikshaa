'use strict';

/* ============================================================================
 * The newsletter store, on PostgreSQL.
 *
 * Same surface as api/db.js so the routes do not care which one they are
 * talking to — subscribe / confirm / unsubscribe / listSubscribers /
 * listMessages / mailingList / stats — with one difference that matters:
 * everything here is async, because pg is. The routes await, and awaiting a
 * plain value is harmless, so both stores work through the same code path.
 *
 * Validation is not duplicated, and it does not live in the other store
 * either. Both import api/validate.js, which has no imports of its own — so
 * the rules cannot drift, and neither store depends on the other. That last
 * part is what makes this file loadable on a runtime with no SQLite and no
 * filesystem.
 * ========================================================================= */

const crypto = require('crypto');

/* pg, fs and path are NOT imported here.
 *
 * This file has to load inside a Cloudflare Worker, which has no filesystem
 * and cannot open a raw TCP socket the way node-postgres expects. Requiring
 * them at the top would make the module throw on import, before any of the
 * logic below could be reached — and the logic is identical on both
 * runtimes; only the connection differs.
 *
 * So the driver is injected (createPool takes one) and the filesystem is
 * required lazily, inside the one function that needs it. */

/* Rules from the shared module, NOT from the SQLite store. Importing that
   store to borrow its validation pulled node:sqlite into this file, which
   made the Postgres path unusable anywhere SQLite is absent — a Cloudflare
   Worker being the case that matters. */
const { validateSubscription, LIMITS } = require('../validate');

/* Local, because these need crypto and the Workers build will want WebCrypto
   instead. Keeping them here means swapping the runtime does not touch the
   shared rules. */
const CONFIRM_TTL_HOURS = 72;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/* Hand in a Pool and it is used as-is. That is how the Worker supplies
   @neondatabase/serverless, whose Pool is API-compatible with node-postgres
   but speaks HTTP instead of TCP.

   With nothing handed in, node-postgres is required lazily — so a Worker
   that always injects never touches it. */
function createPool(options = {}) {
  if (options.pool) {
    return options.pool;
  }

  const connectionString = options.connectionString ||
    (typeof process !== 'undefined' && process.env && process.env.DATABASE_URL);

  const PoolClass = options.Pool || require('pg').Pool;
  const pool = new PoolClass(connectionString ? { connectionString } : options);

  /* An idle client erroring takes a Node process down by default, and a
     database restarting under a long-lived pool is ordinary operations
     rather than a crash. Serverless pools have no such event. */
  if (typeof pool.on === 'function') {
    pool.on('error', (e) => {
      var write = (typeof process !== 'undefined' && process.stderr)
        ? (m) => process.stderr.write(m) : (m) => console.warn(m);
      write('[pg] idle client error: ' + (e && e.message) + '\n');
    });
  }
  return pool;
}

/* Node and CLI only: there is no filesystem in a Worker, and a request
   handler is the wrong place to alter a schema in any case. Production
   migrations are a deliberate step (`npm run db:migrate`), not a side effect
   of the first request after a deploy. */
async function migrate(pool) {
  // Required here, not at the top: a Worker has no filesystem, and importing
  // fs at module load would break the file for a caller that never migrates.
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  return pool;
}

/* ---------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------ */

/* One address however many times it is submitted, and every message kept.
   ON CONFLICT is the Postgres spelling of the SQLite upsert; COALESCE still
   means a later short form cannot blank a name given earlier. */
/**
 * Store a subscription.
 *
 * options.verifiedBy — when set, the address is treated as already verified
 * and becomes mailable at once. The caller passes what did the verifying
 * ('captcha+mx'), and that string is recorded on the row.
 *
 * Left unset, the old double opt-in applies: a token is minted and the row
 * stays unmailable until somebody clicks the link. Both paths are kept
 * because the store should not be the thing deciding how consent is proven —
 * that is policy, and policy lives at the edge where the request arrives.
 */
async function subscribe(pool, input, options) {
  const settings = options || {};
  const { errors, value } = validateSubscription(input);
  if (errors.length) {
    return { ok: false, errors };
  }
  const verifiedBy = typeof settings.verifiedBy === 'string' ? settings.verifiedBy : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      'SELECT id, confirmed_at FROM subscribers WHERE email = $1', [value.email]
    );
    const already = Boolean(before.rows[0] && before.rows[0].confirmed_at);

    // No link to send means no token to mint.
    const token = (already || verifiedBy) ? null : crypto.randomBytes(32).toString('base64url');
    const expires = token
      ? new Date(Date.now() + CONFIRM_TTL_HOURS * 3600 * 1000)
      : null;

    const upserted = await client.query(`
      INSERT INTO subscribers
        (email, name, origin, weekly, seasonal, confirm_hash, confirm_expires,
         confirmed_at, verified_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7,
              CASE WHEN $8::text IS NULL THEN NULL ELSE now() END, $8)
      ON CONFLICT (email) DO UPDATE SET
        name            = COALESCE(EXCLUDED.name,   subscribers.name),
        origin          = COALESCE(EXCLUDED.origin, subscribers.origin),
        weekly          = EXCLUDED.weekly,
        seasonal        = EXCLUDED.seasonal,
        updated_at      = now(),
        -- Subscribing again is how somebody comes back.
        unsubscribed_at = NULL,
        -- Null here means they were already confirmed; leave the old value.
        confirm_hash    = COALESCE(EXCLUDED.confirm_hash,    subscribers.confirm_hash),
        confirm_expires = COALESCE(EXCLUDED.confirm_expires, subscribers.confirm_expires),
        -- COALESCE keeps the ORIGINAL confirmation date and provenance. A
        -- returning subscriber has not consented afresh, and overwriting the
        -- date would quietly erase when they actually did.
        confirmed_at    = COALESCE(subscribers.confirmed_at, EXCLUDED.confirmed_at),
        verified_by     = COALESCE(subscribers.verified_by,  EXCLUDED.verified_by)
      RETURNING id, confirmed_at
    `, [value.email, value.name, value.origin, Boolean(value.weekly), Boolean(value.seasonal),
        token ? hashToken(token) : null, expires, verifiedBy]);

    const id = upserted.rows[0].id;

    if (value.note) {
      await client.query(
        'INSERT INTO messages (subscriber_id, body) VALUES ($1, $2)', [id, value.note]
      );
    }

    await client.query('COMMIT');
    return {
      ok: true,
      id: Number(id),
      created: before.rowCount === 0,
      messageStored: Boolean(value.note),
      // Mailable now — either they already were, or this signup verified them.
      confirmed: already || Boolean(upserted.rows[0].confirmed_at),
      verifiedBy: verifiedBy,
      confirmToken: token,
      confirmExpires: expires ? expires.toISOString() : null,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function confirm(pool, token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'missing' };
  }

  const found = await pool.query(
    'SELECT id, email, confirmed_at, confirm_expires FROM subscribers WHERE confirm_hash = $1',
    [hashToken(token)]
  );
  const row = found.rows[0];
  if (!row) {
    return { ok: false, reason: 'unknown' };
  }
  /* Clicking twice is normal — people double-click and mail clients prefetch.
     The hash is deliberately not cleared on success so this branch can answer
     "already confirmed" instead of "unknown link". */
  if (row.confirmed_at) {
    return { ok: true, email: row.email, already: true };
  }
  if (row.confirm_expires && row.confirm_expires.getTime() < Date.now()) {
    return { ok: false, reason: 'expired', email: row.email };
  }

  await pool.query(
    'UPDATE subscribers SET confirmed_at = now(), updated_at = now(), confirm_expires = NULL WHERE id = $1',
    [row.id]
  );
  return { ok: true, email: row.email, already: false };
}

async function unsubscribe(pool, email) {
  const address = typeof email === 'string' ? email.trim().slice(0, LIMITS.email) : '';
  if (!address) {
    return { ok: false, errors: ['email is required'] };
  }
  const r = await pool.query(
    'UPDATE subscribers SET unsubscribed_at = now(), updated_at = now() WHERE email = $1',
    [address]
  );
  return { ok: true, changed: r.rowCount > 0 };
}

/* ---------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------ */

function page(options) {
  return {
    limit: Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500),
    offset: Math.max(parseInt(options.offset, 10) || 0, 0),
  };
}

async function listSubscribers(pool, options = {}) {
  const { limit, offset } = page(options);
  const where = options.confirmedOnly
    ? 'WHERE s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL'
    : '';
  const r = await pool.query(`
    SELECT s.id, s.email::text, s.name, s.origin, s.weekly, s.seasonal,
           s.created_at, s.updated_at, s.unsubscribed_at, s.confirmed_at,
           COUNT(m.id)::int AS message_count
    FROM subscribers s
    LEFT JOIN messages m ON m.subscriber_id = s.id
    ${where}
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return r.rows;
}

async function listMessages(pool, options = {}) {
  const { limit, offset } = page(options);
  if (options.email) {
    const r = await pool.query(`
      SELECT m.id, m.body, m.received_at, s.email::text, s.name
      FROM messages m JOIN subscribers s ON s.id = m.subscriber_id
      WHERE s.email = $1
      ORDER BY m.received_at DESC, m.id DESC
      LIMIT $2 OFFSET $3
    `, [options.email, limit, offset]);
    return r.rows;
  }
  const r = await pool.query(`
    SELECT m.id, m.body, m.received_at, s.email::text, s.name
    FROM messages m JOIN subscribers s ON s.id = m.subscriber_id
    ORDER BY m.received_at DESC, m.id DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return r.rows;
}

/* Reads the view, not the table. The filter lives in one place — see the
   comment on `mailable` in schema.sql for why this is not a second list. */
async function mailingList(pool, options = {}) {
  const wanted = options.list === 'seasonal' ? 'seasonal' : 'weekly';
  const r = await pool.query(
    'SELECT id, email::text, name, origin, confirmed_at FROM mailable WHERE ' +
    wanted + ' ORDER BY confirmed_at ASC, id ASC'
  );
  return r.rows;
}

async function stats(pool) {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM subscribers)::int                                   AS subscribers,
      (SELECT COUNT(*) FROM subscribers WHERE unsubscribed_at IS NULL)::int     AS active,
      (SELECT COUNT(*) FROM mailable)::int                                      AS confirmed,
      (SELECT COUNT(*) FROM subscribers
        WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL)::int            AS awaiting,
      (SELECT COUNT(*) FROM messages)::int                                      AS messages
  `);
  return r.rows[0];
}

module.exports = {
  createPool,
  migrate,
  subscribe,
  confirm,
  unsubscribe,
  listSubscribers,
  listMessages,
  mailingList,
  stats,
  // Re-exported so callers get the same rules whichever store they hold.
  validateSubscription,
  hashToken,
  LIMITS,
  CONFIRM_TTL_HOURS,
};
