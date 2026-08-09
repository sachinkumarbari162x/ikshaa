'use strict';

/* ============================================================================
 * Campaigns, the outbox, and the sender.
 *
 * The whole design answers one question: what happens when this crashes
 * halfway through sending to four hundred people?
 *
 *   - Queueing is a set operation against the `mailable` view, inside one
 *     transaction. Either every recipient is queued or none is.
 *   - UNIQUE (campaign_id, subscriber_id) means queueing twice adds nobody
 *     twice. Running the whole thing again is boring rather than embarrassing.
 *   - Claiming uses FOR UPDATE SKIP LOCKED, so two senders can run at once
 *     and will never hand the same row to both.
 *   - Failure moves `visible_at` forward instead of sleeping. A worker that
 *     dies mid-backoff loses nothing; the schedule is in the database.
 *
 * Nothing here knows how to send an email. That is a transport, injected —
 * see api/mailer.js. This module owns *what* to send and *whether it went*.
 * ========================================================================= */

const { LIMITS } = require('../validate');

/* Attempts before a row is given up on. Five with the backoff below spans
   about half an hour, which covers a provider blip without hammering one
   that is genuinely refusing us. */
const MAX_ATTEMPTS = 5;

/* Exponential, in seconds: 30s, 2m, 8m, 32m. A hard address failure will
   exhaust these; a rate limit or a wobble will not. */
function backoffSeconds(attempt) {
  return Math.min(30 * Math.pow(4, Math.max(attempt - 1, 0)), 3600);
}

/* ---------------------------------------------------------------------
 * Writing a letter
 * ------------------------------------------------------------------ */

async function createCampaign(pool, input) {
  const slug = String(input.slug || '').trim();
  const list = input.list === 'seasonal' ? 'seasonal' : 'weekly';
  const subject = String(input.subject || '').trim();
  const body = String(input.body || '');

  if (!slug || !subject || !body.trim()) {
    return { ok: false, errors: ['slug, subject and body are all required'] };
  }

  /* ON CONFLICT DO NOTHING rather than an upsert: editing a letter that has
     already gone out would rewrite history, and the outbox rows point at
     this row as the record of what was actually sent. */
  const r = await pool.query(`
    INSERT INTO campaigns (slug, list, subject, body)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
  `, [slug.slice(0, 200), list, subject.slice(0, 300), body]);

  if (r.rowCount === 0) {
    return { ok: false, errors: ['a campaign with that slug already exists'] };
  }
  return { ok: true, id: Number(r.rows[0].id), slug, list };
}

/* Fill the outbox from the mailable view.
 *
 * INSERT ... SELECT, so the recipient set is decided by the database in one
 * statement. Doing it in JS would mean reading the list, then writing rows,
 * with a window in between where somebody could unsubscribe and still be
 * queued. */
async function queueCampaign(pool, campaignId) {
  const campaign = await pool.query(
    'SELECT id, list, sent_at FROM campaigns WHERE id = $1', [campaignId]
  );
  if (campaign.rowCount === 0) {
    return { ok: false, errors: ['no such campaign'] };
  }
  const list = campaign.rows[0].list;

  const r = await pool.query(`
    INSERT INTO outbox (campaign_id, subscriber_id, email)
    SELECT $1, m.id, m.email
    FROM mailable m
    WHERE m.${list === 'seasonal' ? 'seasonal' : 'weekly'}
    ON CONFLICT (campaign_id, subscriber_id) DO NOTHING
  `, [campaignId]);

  const total = await pool.query(
    'SELECT COUNT(*)::int AS n FROM outbox WHERE campaign_id = $1', [campaignId]
  );

  return { ok: true, queued: r.rowCount, total: total.rows[0].n };
}

/* ---------------------------------------------------------------------
 * Sending
 * ------------------------------------------------------------------ */

/* Take up to `size` rows and mark them 'sending' in the same statement.
 *
 * SKIP LOCKED is what makes a second worker safe: rather than blocking on
 * rows the first has locked, it steps over them and takes the next ones. The
 * CTE keeps claim-and-mark atomic, so there is no moment where a row is
 * selected but not yet claimed. */
async function claimBatch(pool, size = 25) {
  const r = await pool.query(`
    WITH due AS (
      SELECT o.id
      FROM outbox o
      WHERE o.status = 'queued'
        AND o.visible_at <= now()
      ORDER BY o.queued_at ASC, o.id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox o
       SET status = 'sending', attempts = o.attempts + 1
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.campaign_id, o.subscriber_id, o.email::text, o.attempts
  `, [size]);
  return r.rows;
}

async function markSent(pool, id) {
  await pool.query(
    "UPDATE outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1",
    [id]
  );
}

/* Back to 'queued' with a later visible_at, unless it has run out of tries.
   The error is kept either way — a row that failed five times should be able
   to tell you why without anyone reading a log file. */
async function markFailed(pool, id, attempts, error) {
  const message = String(error && error.message ? error.message : error || 'unknown')
    .slice(0, 500);

  if (attempts >= MAX_ATTEMPTS) {
    await pool.query(
      "UPDATE outbox SET status = 'failed', last_error = $2 WHERE id = $1", [id, message]
    );
    return { retrying: false };
  }

  await pool.query(
    "UPDATE outbox SET status = 'queued', last_error = $2, " +
    "visible_at = now() + ($3 || ' seconds')::interval WHERE id = $1",
    [id, message, String(backoffSeconds(attempts))]
  );
  return { retrying: true, inSeconds: backoffSeconds(attempts) };
}

/* One pass of the sender.
 *
 * Deliberately not a loop-until-empty: a caller decides how long to run,
 * whether that is a cron tick, a CLI command, or a worker. That also makes
 * it testable without waiting on real time. */
async function sendBatch(pool, transport, options = {}) {
  const size = options.size || 25;
  const rows = await claimBatch(pool, size);
  if (rows.length === 0) {
    return { claimed: 0, sent: 0, failed: 0, retrying: 0 };
  }

  // One query for the letters, rather than one per recipient.
  const ids = [...new Set(rows.map((r) => r.campaign_id))];
  const letters = await pool.query(
    'SELECT id, subject, body, slug FROM campaigns WHERE id = ANY($1::bigint[])', [ids]
  );
  const byId = new Map(letters.rows.map((c) => [String(c.id), c]));

  let sent = 0;
  let failed = 0;
  let retrying = 0;

  for (const row of rows) {
    const letter = byId.get(String(row.campaign_id));
    try {
      if (!letter) {
        throw new Error('campaign disappeared between claim and send');
      }
      await transport.send({
        to: row.email,
        subject: letter.subject,
        body: letter.body,
        campaign: letter.slug,
      });
      await markSent(pool, row.id);
      sent++;
    } catch (e) {
      const outcome = await markFailed(pool, row.id, row.attempts, e);
      if (outcome.retrying) { retrying++; } else { failed++; }
    }
  }

  return { claimed: rows.length, sent, failed, retrying };
}

/* Mark the campaign done once nothing is left to try. Separate from
   sendBatch because "this batch finished" and "this campaign finished" are
   different things, and only the second belongs on the campaign row. */
async function settle(pool, campaignId) {
  const r = await pool.query(`
    UPDATE campaigns SET sent_at = now()
     WHERE id = $1
       AND sent_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM outbox
          WHERE campaign_id = $1 AND status IN ('queued', 'sending')
       )
    RETURNING sent_at
  `, [campaignId]);
  return { settled: r.rowCount > 0 };
}

async function progress(pool, campaignId) {
  const r = await pool.query(`
    SELECT
      COUNT(*)::int                                        AS total,
      COUNT(*) FILTER (WHERE status = 'sent')::int         AS sent,
      COUNT(*) FILTER (WHERE status = 'queued')::int       AS queued,
      COUNT(*) FILTER (WHERE status = 'sending')::int      AS sending,
      COUNT(*) FILTER (WHERE status = 'failed')::int       AS failed
    FROM outbox WHERE campaign_id = $1
  `, [campaignId]);
  return r.rows[0];
}

module.exports = {
  createCampaign,
  queueCampaign,
  claimBatch,
  markSent,
  markFailed,
  sendBatch,
  settle,
  progress,
  backoffSeconds,
  MAX_ATTEMPTS,
};
