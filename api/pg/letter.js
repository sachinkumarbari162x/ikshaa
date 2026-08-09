'use strict';

/* ============================================================================
 * Writing the week's letter.
 *
 *     npm run letter                      write it in your editor
 *     npm run letter -- --file draft.md   use a file you already wrote
 *     npm run letter -- --preview         render it and stop, send nothing
 *     npm run letter -- --send-now        do not wait for the cron
 *
 * The whole point of this file is that composing a letter should not mean
 * opening a file of JavaScript. Everything it does could be done with two
 * function calls; what it adds is the part that matters when a person who
 * did not build this is the one sending mail to real people:
 *
 *   - it shows WHO will receive it, and how many, before anything is queued
 *   - it renders the letter and makes you look at it
 *   - it will not proceed without an explicit yes
 *   - it queues rather than sends, so the outbox and its retries still apply
 *
 * A campaign slug is derived from the date and is UNIQUE, so running this
 * twice on the same day refuses rather than sending the week's letter again.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const store = require('./db');
const campaigns = require('./campaigns');
const { letter: compose } = require('../emails/messages');
const { httpTransport, fileTransport } = require('../mailer');

const BOOKING = 'https://www.airbnb.co.in/rooms/17852391';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) { return null; }
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

/* Open $EDITOR on a scratch file. Writing four paragraphs at a terminal
   prompt is miserable, and the letter is prose — it deserves an editor. */
function writeInEditor() {
  const file = path.join(os.tmpdir(), 'ikshaa-letter-' + Date.now() + '.md');
  fs.writeFileSync(file,
    '# Subject line goes on this first line, after the hash\n' +
    '\n' +
    'Then the letter itself, in ordinary paragraphs.\n' +
    '\n' +
    'Leave a blank line between them. No HTML, no markdown beyond this —\n' +
    'the house layout handles all of that.\n' +
    '\n' +
    '(Delete these instructions before saving. An empty letter is refused.)\n', 'utf8');

  const editor = process.env.EDITOR || process.env.VISUAL ||
    (process.platform === 'win32' ? 'notepad' : 'nano');
  const r = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
  if (r.error) {
    throw new Error('could not open ' + editor + ' — use --file instead');
  }
  return file;
}

/* First `# heading` is the subject, everything after it is the body. One
   file, so a draft can be kept in version control or emailed to somebody
   for review before it goes out. */
function parseDraft(text) {
  const lines = String(text).split(/\r?\n/);
  const headingAt = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (headingAt === -1) {
    return { errors: ['the first line must be "# Your subject line"'] };
  }
  const subject = lines[headingAt].replace(/^#\s+/, '').trim();
  const body = lines.slice(headingAt + 1).join('\n').trim();

  const errors = [];
  if (!subject) { errors.push('the subject is empty'); }
  if (!body) { errors.push('the letter is empty'); }
  if (/Delete these instructions/.test(body)) {
    errors.push('the template instructions are still in the letter');
  }
  return { subject, body, errors };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('\n  DATABASE_URL is not set. See .env.example.\n');
    process.exit(1);
  }

  const list = arg('list') === 'seasonal' ? 'seasonal' : 'weekly';
  const pool = store.createPool();

  try {
    /* ---- who would receive it -------------------------------------- */
    const recipients = await store.mailingList(pool, { list: list });
    console.log('\n  %s list: %d confirmed %s',
      list, recipients.length, recipients.length === 1 ? 'subscriber' : 'subscribers');

    if (recipients.length === 0) {
      console.log('  Nobody to send to. Nothing was created.\n');
      return;
    }
    // Named, not just counted. A number is easy to misread; addresses are not.
    recipients.slice(0, 8).forEach((r) => console.log('    %s', r.email));
    if (recipients.length > 8) {
      console.log('    …and %d more', recipients.length - 8);
    }

    /* ---- the words -------------------------------------------------- */
    const fromFile = arg('file');
    const draftPath = typeof fromFile === 'string' ? fromFile : writeInEditor();
    const parsed = parseDraft(fs.readFileSync(draftPath, 'utf8'));

    if (parsed.errors && parsed.errors.length) {
      console.error('\n  Not sending:');
      parsed.errors.forEach((e) => console.error('    - %s', e));
      console.error('');
      process.exit(1);
    }

    /* ---- look at it before anybody else does ------------------------ */
    const rendered = compose({
      subject: parsed.subject,
      body: parsed.body,
      unsubscribe: (process.env.PUBLIC_BASE_URL || '') + '/unsubscribe?email=you%40example.com',
      bookingUrl: BOOKING,
    });

    console.log('\n  ' + '─'.repeat(66));
    console.log('  Subject: %s', rendered.subject);
    console.log('  ' + '─'.repeat(66));
    rendered.text.split('\n').forEach((l) => console.log('  ' + l));
    console.log('  ' + '─'.repeat(66));

    const previewFile = path.join(os.tmpdir(), 'ikshaa-letter-preview.html');
    fs.writeFileSync(previewFile, rendered.html, 'utf8');
    console.log('  HTML preview: %s', previewFile);

    if (arg('preview')) {
      console.log('\n  --preview: nothing was created.\n');
      return;
    }

    /* ---- the gate --------------------------------------------------- */
    const slug = (arg('slug') || (list + '-' + new Date().toISOString().slice(0, 10)));
    console.log('\n  This will queue "%s" to %d %s.', slug, recipients.length, list);

    const answer = await ask('  Type the number of recipients to confirm: ');
    if (answer !== String(recipients.length)) {
      console.log('  Not confirmed. Nothing was created.\n');
      return;
    }

    /* ---- create, then queue ----------------------------------------- */
    const created = await campaigns.createCampaign(pool, {
      slug: slug, list: list, subject: parsed.subject, body: parsed.body,
    });
    if (!created.ok) {
      console.error('\n  %s', created.errors.join('; '));
      console.error('  (slugs are unique — pass --slug to send a second letter today)\n');
      process.exit(1);
    }

    const queued = await campaigns.queueCampaign(pool, created.id);
    console.log('\n  Campaign #%d queued to %d.', created.id, queued.queued);

    if (!arg('send-now')) {
      console.log('  The cron will send it within fifteen minutes.\n');
      return;
    }

    /* ---- or send it here -------------------------------------------- */
    const transport = process.env.MAIL_API_KEY
      ? httpTransport({
          apiKey: process.env.MAIL_API_KEY,
          from: process.env.MAIL_FROM,
          replyTo: process.env.MAIL_REPLY_TO,
          unsubscribeBase: process.env.PUBLIC_BASE_URL,
        })
      : fileTransport();

    console.log('  Sending now via %s…', transport.name);
    let guard = 0;
    for (;;) {
      const batch = await campaigns.sendBatch(pool, transport, {
        unsubscribeBase: process.env.PUBLIC_BASE_URL, bookingUrl: BOOKING,
      });
      if (batch.claimed === 0) { break; }
      console.log('    sent %d, retrying %d, failed %d', batch.sent, batch.retrying, batch.failed);
      // Retries are scheduled into the future; looping on them here would spin.
      if (++guard > 40) { break; }
    }
    await campaigns.settle(pool, created.id);
    console.log('  %j\n', await campaigns.progress(pool, created.id));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('\n  failed:', e && e.message, '\n');
  process.exit(1);
});
