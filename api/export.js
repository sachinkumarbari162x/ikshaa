'use strict';

/* ============================================================================
 * The mailing list, written out as files you can actually send from.
 *
 * Two rules, both load-bearing:
 *
 *   1. Confirmed addresses only. An unconfirmed address is one that somebody
 *      typed — not necessarily its owner. Mailing those is how a sending
 *      domain gets blocked, and it is the reason double opt-in exists.
 *
 *   2. Split by what each person asked for. Somebody who ticked seasonal and
 *      not weekly must not appear in the weekly file. The preference is not a
 *      suggestion; it is the basis on which they consented.
 *
 * Output goes to data/exports/, which is gitignored along with the rest of
 * data/. These files are real people's addresses.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');

/* RFC 4180. A name containing a comma or a quote will otherwise shift every
   later column, and "O'Brien, Maria" is not an unusual name. */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/* A stamp rather than an overwrite: an export is a snapshot of who had
   consented at a moment, and keeping the old ones is what lets you answer
   "who was on the list when we sent that" months later. */
function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function writeMailingList(db, store, options = {}) {
  const dir = options.dir || path.join(__dirname, '..', 'data', 'exports');
  const when = options.now || new Date();
  fs.mkdirSync(dir, { recursive: true });

  const columns = ['email', 'name', 'origin', 'confirmed_at'];
  const written = [];

  for (const list of ['weekly', 'seasonal']) {
    const rows = store.mailingList(db, { list: list });
    const base = list + '-' + stamp(when);

    const csv = path.join(dir, base + '.csv');
    fs.writeFileSync(csv, toCsv(rows, columns), 'utf8');

    const json = path.join(dir, base + '.json');
    fs.writeFileSync(json, JSON.stringify({
      list: list,
      exportedAt: when.toISOString(),
      count: rows.length,
      // Stated in the file itself, so nobody downstream has to take it on
      // trust that these addresses opted in.
      basis: 'double opt-in: confirmed_at is set and unsubscribed_at is null',
      subscribers: rows,
    }, null, 2), 'utf8');

    written.push({ list: list, count: rows.length, csv: csv, json: json });
  }

  /* A plain address-per-line file, because most sending tools want exactly
     that and nothing else. Weekly only — the seasonal list is a different
     audience and merging them would send people mail they declined. */
  const plain = path.join(dir, 'weekly-' + stamp(when) + '.txt');
  fs.writeFileSync(
    plain,
    store.mailingList(db, { list: 'weekly' }).map((r) => r.email).join('\n') + '\n',
    'utf8'
  );

  return { dir: dir, files: written, plain: plain };
}

module.exports = { writeMailingList, toCsv, csvCell };
