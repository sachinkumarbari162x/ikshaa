'use strict';

/* ============================================================================
 * Ask the chat assistant 100 questions and write down what it says.
 *
 *     node chatAudit/run.js              against public/chat (what is committed)
 *     node chatAudit/run.js --live       against ikshaa.pages.dev (what guests get)
 *
 * Why both: the committed files are what you are editing, and the deployed
 * ones are what a guest actually receives. They have been out of step before
 * — a build that never shipped an AVIF looked perfect locally — so the audit
 * that matters is the one against production.
 *
 * Each question gets a FRESH bot. That is deliberate: a shared instance
 * carries a topic and an unknown-streak between questions, so answer 40 would
 * depend on answer 39 and the file would stop being a straight answer sheet.
 * The compound and conversational questions at the end are single turns for
 * the same reason.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HERE = __dirname;
const LIVE = 'https://ikshaa.pages.dev';

/* Reads the question file into turns.
 *
 * A plain line is its own conversation. A line starting with ">" continues
 * the one above it, which is how repetition and memory get tested at all —
 * both only exist across turns, and a file of one-liners can never see them.
 */
function turns() {
  const lines = fs.readFileSync(path.join(HERE, 'questions.txt'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const out = [];
  let convo = 0;
  for (const line of lines) {
    const isFollowUp = line.startsWith('>');
    if (!isFollowUp) { convo++; }
    out.push({
      text: isFollowUp ? line.replace(/^>\s*/, '') : line,
      convo: convo,
      followUp: isFollowUp,
    });
  }
  return out;
}

/* Pull the three hashed chat files off production into a temp directory,
   keeping their hashed names — the build rewrites each require() to the
   hashed sibling, so renaming them breaks the imports. */
async function fetchLive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ikshaa-live-'));

  /* The chain is page -> chat/chat.<hash>.js -> the three language files.
     Not script.js: the widget loads its own engine on idle, which is what
     keeps 34 KB of tokeniser off first paint. */
  const page = await (await fetch(LIVE + '/?cb=' + Date.now())).text();
  const widget = /chat\/chat\.[a-z0-9]+\.js/.exec(page);
  if (!widget) { throw new Error('no chat widget referenced on ' + LIVE); }

  const code = await (await fetch(LIVE + '/' + widget[0] + '?cb=' + Date.now())).text();
  const names = {};
  for (const m of code.matchAll(/((?:nlu|knowledge|bot)\.[a-z0-9]+\.js)/g)) {
    names[m[1].split('.')[0]] = m[1];
  }
  for (const which of ['nlu', 'knowledge', 'bot']) {
    if (!names[which]) { throw new Error('live script does not reference ' + which); }
    const res = await fetch(LIVE + '/chat/' + names[which] + '?cb=' + Date.now());
    if (!res.ok) { throw new Error(names[which] + ' -> HTTP ' + res.status); }
    fs.writeFileSync(path.join(dir, names[which]), await res.text(), 'utf8');
  }
  return { dir: dir, bot: path.join(dir, names.bot), label: LIVE, files: names };
}

function localSource() {
  return {
    dir: path.join(HERE, '..', 'public', 'chat'),
    bot: path.join(HERE, '..', 'public', 'chat', 'bot.js'),
    label: 'public/chat (working tree)',
    files: null,
  };
}

/* First line carries the label, continuations are indented to match under it.
   Repeating "A:" down the left margin made the answers unreadable. */
function wrap(text, width, label) {
  const pad = ' '.repeat(label.length);
  const out = [];
  let first = true;

  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && (line + ' ' + word).length + label.length > width) {
        out.push((first ? label : pad) + line);
        first = false;
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    out.push((first ? label : pad) + line);
    first = false;
  }
  return out.join('\n');
}

async function main() {
  const live = process.argv.includes('--live');
  const source = live ? await fetchLive() : localSource();
  const Bot = require(source.bot);
  const asked = turns();

  /* One bot per conversation. A follow-up shares the instance with the line
     above it, so the topic, the remembered dates and the repeat counter all
     survive; a plain line gets a clean one. */
  let current = null;
  let currentConvo = -1;

  const rows = asked.map((turn) => {
    if (turn.convo !== currentConvo) {
      current = new Bot();
      currentConvo = turn.convo;
    }
    const bot = current;
    const reply = bot.respond(turn.text);
    return {
      question: turn.text,
      convo: turn.convo,
      followUp: turn.followUp,
      // Did the repeat ladder fire on this turn?
      repeated: /You have asked about|saying it a third time/.test(reply.text),
      intent: reply.intent,
      confidence: reply.confidence || 0,
      text: reply.text,
      chips: reply.chips || [],
      /* Three shapes of not-knowing, and they are not the same thing:
         a named decline, a hedge, and a deferral to the owner. */
      declined: /nothing on file/.test(reply.text),
      hedged: /I am not certain|did not catch|got past me|keep missing/.test(reply.text),
      deferred: /owner can confirm|will know for certain|reaches a person|gets you a person|rather not guess|do not want to guess|cannot confirm|I do not have/.test(reply.text),
    };
  });

  const understood = rows.filter((r) => !r.declined && !r.hedged);
  const deferred = understood.filter((r) => r.deferred);
  // Answered FROM FACTS means understood and not handed onward. The deferrals
  // sit inside `understood`, so counting both as "answered" double-counts and
  // flatters the result.
  const fromFacts = understood.filter((r) => !r.deferred);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const head = [
    '=============================================================================',
    ' Ikshaa chat assistant — every question, and the answer it gave',
    '=============================================================================',
    '',
    ' Source     : ' + source.label,
    ' Run at     : ' + stamp + ' UTC',
    ' Turns      : ' + rows.length + ' guest messages, none of them from eval/corpus.js',
    '              ' + rows.filter((r) => !r.followUp).length + ' opening questions, ' +
      rows.filter((r) => r.followUp).length + ' follow-ups (marked with an arrow)',
    '',
    ' A plain question was asked to a FRESH assistant, so nothing carries over.',
    ' A follow-up shares its assistant with the line above it — that is the only',
    ' way memory and repetition can be tested at all.',
    '',
    ' ---- how it went -------------------------------------------------------',
    '',
    '   answered from the facts   ' + String(fromFacts.length).padStart(3) +
      '   a real answer, drawn from what the villa has told us',
    '   deferred to the owner     ' + String(deferred.length).padStart(3) +
      '   understood, but the fact is null — says so, gives the email',
    '   declined by name          ' + String(rows.filter((r) => r.declined).length).padStart(3) +
      '   "nothing on file about X" — the villa has no such thing',
    '   repeat handled            ' + String(rows.filter((r) => r.repeated).length).padStart(3) +
      '   same topic raised again — restated formally with a next step',
    '   did not understand        ' + String(rows.filter((r) => r.hedged).length).padStart(3) +
      '   asked the guest to rephrase, or handed over',
    '                             ---',
    '                             ' + String(rows.length).padStart(3),
    '',
    ' A deferral is a correct answer, not a miss. Rates, check-in times and the',
    ' security questions are deliberately null in knowledge.js so the bot hands',
    ' them to a person instead of inventing them.',
    '',
    '=============================================================================',
    '',
  ];

  const body = rows.map((r, i) => {
    const n = String(i + 1).padStart(3, ' ');
    const tag = r.declined ? 'declined' : r.hedged ? 'not understood' : (r.intent || '—');
    // An arrow marks a turn that shares its conversation with the line above.
    return [
      n + '. ' + (r.followUp ? '↳ ' : '') + 'Q: ' + r.question,
      '',
      wrap(r.text, 78, '     A: ').replace(/^ {8}/, '     A: '),
      '',
      '     [topic: ' + tag + (r.chips.length ? '  |  offered: ' + r.chips.join(' / ') : '') + ']',
      '',
      '-----------------------------------------------------------------------------',
      '',
    ].join('\n');
  });

  const out = path.join(HERE, live ? 'answers-live.txt' : 'answers.txt');
  fs.writeFileSync(out, head.concat(body).join('\n'), 'utf8');

  console.log('  source     ' + source.label);
  if (source.files) {
    Object.keys(source.files).forEach((k) => console.log('               ' + source.files[k]));
  }
  console.log('  questions  ' + rows.length);
  console.log('  answered   ' + fromFacts.length +
    '   deferred ' + deferred.length +
    '   declined ' + rows.filter((r) => r.declined).length +
    '   not understood ' + rows.filter((r) => r.hedged).length);
  console.log('  written    ' + path.relative(path.join(HERE, '..'), out).split(path.sep).join('/'));
}

main().catch((e) => {
  console.error('\n  failed:', e && e.message, '\n');
  process.exit(1);
});
