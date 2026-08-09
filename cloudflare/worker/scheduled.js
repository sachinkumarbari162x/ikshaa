/* ============================================================================
 * What runs on a timer.
 *
 * Two jobs, deliberately separate, because they fail differently:
 *
 *   drainOutbox   sends whatever a campaign has queued, a batch at a time
 *   sendReminders nudges people who subscribed and never confirmed, ONCE
 *
 * Neither composes a campaign. Writing the week's letter is a human act; a
 * cron that invented content and mailed it would be the single worst thing
 * this system could do. The schedule only sends what somebody has already
 * written and queued.
 *
 * Everything is bounded. A scheduled Worker has a wall-clock limit, and a
 * job that tries to drain an unbounded queue in one tick will be killed
 * partway — which is survivable here only because the outbox is durable and
 * the next tick resumes exactly where this one stopped.
 * ========================================================================= */

import { reminder } from '../../api/emails/messages.js';

/* One batch per tick, sized so a slow provider cannot run the tick out of
   time. Anything left waits for the next one; nothing is lost, because
   claimBatch marks rows 'sending' inside the same statement that selects
   them. */
const BATCH = 20;

/* How long somebody gets before the single nudge. Long enough that the first
   email has had a fair chance to be seen and acted on, short enough that the
   context has not gone cold. */
const REMIND_AFTER_HOURS = 48;

/* A cap per tick. Sending hundreds of reminders in one burst from a young
   domain looks exactly like a compromised account to a receiving provider. */
const REMIND_MAX = 25;

/* ---------------------------------------------------------------------
 * Sending what is queued
 * ------------------------------------------------------------------ */

export async function drainOutbox(pool, campaigns, transport, log) {
  const result = await campaigns.sendBatch(pool, transport, { size: BATCH });

  if (result.claimed > 0) {
    log('outbox: claimed %d, sent %d, retrying %d, failed %d',
      result.claimed, result.sent, result.retrying, result.failed);
  }

  /* Mark any campaign done whose queue has emptied. Cheap, and it is what
     makes "has the October letter finished going out" answerable. */
  const open = await pool.query(
    'SELECT id FROM campaigns WHERE sent_at IS NULL'
  );
  for (const row of open.rows) {
    await campaigns.settle(pool, row.id);
  }

  return result;
}

/* ---------------------------------------------------------------------
 * The single reminder
 *
 * reminded_at is what keeps this honest. Without it a nightly job would
 * nudge the same person every night — which is precisely the behaviour
 * somebody who has not confirmed did not agree to, and the fastest way to
 * turn a hesitant subscriber into a spam complaint.
 * ------------------------------------------------------------------ */

export async function sendReminders(pool, env, log) {
  if (!env.MAIL_API_KEY || !env.MAIL_FROM || !env.PUBLIC_BASE_URL) {
    return { sent: 0, reason: 'mail not configured' };
  }

  /* Claim and stamp in one statement. Two ticks overlapping — which a cron
     can do if one runs long — would otherwise both read the same rows and
     both send. */
  const due = await pool.query(`
    UPDATE subscribers
       SET reminded_at = now()
     WHERE id IN (
       SELECT id FROM subscribers
        WHERE confirmed_at IS NULL
          AND reminded_at IS NULL
          AND unsubscribed_at IS NULL
          AND confirm_hash IS NOT NULL
          AND created_at < now() - ($1 || ' hours')::interval
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, email::text, name
  `, [String(REMIND_AFTER_HOURS), REMIND_MAX]);

  if (due.rowCount === 0) {
    return { sent: 0 };
  }

  /* The stored token is a hash and cannot be reversed, so a reminder cannot
     re-send the original link. A fresh token is issued and supersedes it —
     the newest link in somebody's inbox is always the one that works. */
  let sent = 0;
  for (const row of due.rows) {
    try {
      const token = crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, '');
      const hashed = await sha256Hex(token);

      await pool.query(
        "UPDATE subscribers SET confirm_hash = $2, " +
        "confirm_expires = now() + interval '72 hours' WHERE id = $1",
        [row.id, hashed]
      );

      const link = env.PUBLIC_BASE_URL.replace(/\/$/, '') +
        '/api/confirm?token=' + encodeURIComponent(token);
      const letter = reminder({ link: link, name: row.name });

      const res = await fetch(env.MAIL_ENDPOINT || 'https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + env.MAIL_API_KEY,
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [row.email],
          reply_to: env.MAIL_REPLY_TO || undefined,
          subject: letter.subject,
          html: letter.html,
          text: letter.text,
        }),
      });

      if (res.ok) {
        sent++;
      } else {
        log('reminder to %s failed: %s', row.email, res.status);
      }
    } catch (e) {
      /* reminded_at is already set, so a thrown error costs this person their
         reminder rather than earning them a second one. That is the right way
         round: a missed nudge is a small loss, a repeated one is a complaint. */
      log('reminder to %s threw: %s', row.email, e && e.message);
    }
  }

  log('reminders: %d of %d due', sent, due.rowCount);
  return { sent, due: due.rowCount };
}

/* Hash matching api/pg/db.js — hex SHA-256, so a token issued here can be
   confirmed by the same lookup the subscribe path uses. */
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
