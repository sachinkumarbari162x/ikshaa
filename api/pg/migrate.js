'use strict';

/* ============================================================================
 * Apply schema.sql to whatever DATABASE_URL points at.
 *
 *     npm run db:migrate
 *
 * A deliberate command, never a side effect of the first request after a
 * deploy. Schema changes should happen when somebody decides they should,
 * not when traffic happens to arrive.
 *
 * Safe to run twice: every statement in schema.sql is IF NOT EXISTS or
 * CREATE OR REPLACE, so re-running it converges rather than failing.
 * ========================================================================= */

const store = require('./db');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('\n  DATABASE_URL is not set. Put it in .env (see .env.example).\n');
    process.exit(1);
  }

  // Never print the password — a connection string is a credential.
  const where = url.replace(/\/\/[^@]*@/, '//<credentials>@');
  console.log('\n  target: %s', where);

  const pool = store.createPool();
  try {
    await store.migrate(pool);

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'public' ORDER BY 1"
    );
    console.log('  tables: %s', tables.rows.map((r) => r.table_name).join(', '));

    /* The one constraint worth confirming after every migration. On SQLite it
       is COLLATE NOCASE; here it is citext, and if the extension failed to
       install the column silently becomes case-SENSITIVE — at which point
       Maria@ and maria@ are two subscribers who each get every letter. */
    const email = await pool.query(
      "SELECT udt_name FROM information_schema.columns " +
      "WHERE table_name = 'subscribers' AND column_name = 'email'"
    );
    const type = email.rows[0] && email.rows[0].udt_name;
    console.log('  subscribers.email is %s %s', type,
      type === 'citext' ? '(case-insensitive, correct)' : '<-- WRONG, expected citext');

    const stats = await store.stats(pool);
    console.log('  rows:   %d subscribers, %d confirmed, %d messages\n',
      stats.subscribers, stats.confirmed, stats.messages);

    if (type !== 'citext') {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('  migration failed:', e && e.message);
  process.exit(1);
});
