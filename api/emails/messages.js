'use strict';

/* ============================================================================
 * The letters themselves.
 *
 * Every one returns { subject, html, text }. Both parts, always — `text` is
 * not a courtesy:
 *
 *   - Some people read in plain text by choice or necessity.
 *   - Spam filters treat an HTML-only message as a mild negative signal.
 *   - A watch, a screen reader, and a preview pane often render the text part.
 *
 * So the text version has to say everything the HTML does, links included.
 * ========================================================================= */

const { shell, button, esc, ACCENT } = require('./layout');

/* ---------------------------------------------------------------------
 * Confirmation
 * ------------------------------------------------------------------ */

function confirmation(options) {
  const link = options.link;
  const name = options.name ? String(options.name).split(/\s+/)[0] : '';
  const hello = name ? 'Dear ' + esc(name) + ',' : 'Hello,';

  const html = shell({
    title: 'Confirm your letters from Ikshaa',
    // Shown in the inbox list beside the subject. It should reduce the work
    // of deciding to open, not repeat the subject back.
    preheader: 'One click and the letters start. Nothing is sent until you do.',
    body: `
      <p style="margin:0 0 18px;">${hello}</p>

      <p style="margin:0 0 18px;">
        Somebody asked for letters from Ikshaa using this address. If that was you,
        one click is all that is left.
      </p>

      ${button(link, 'Yes, send me the letters')}

      <p style="margin:0 0 18px;">
        Then you will hear from me about once a week &mdash; what is flowering, what the
        cook is making, what the weather has been doing to the courtyard. A note when
        the season turns. Nothing else, ever.
      </p>

      <p style="margin:0 0 18px;color:rgba(46,42,36,0.68);font-size:15px;">
        The link works for three days. If it was not you, simply ignore this &mdash;
        nothing is sent to an address that has not been confirmed.
      </p>

      <p style="margin:22px 0 0;">Carman</p>

      <p style="margin:14px 0 0;font-size:13px;color:rgba(46,42,36,0.5);
                word-break:break-all;">
        If the button does nothing, paste this into your browser:<br>
        <a href="${esc(link)}" style="color:${ACCENT};">${esc(link)}</a>
      </p>`,
  });

  const text = [
    hello.replace(/&#39;/g, "'"),
    '',
    'Somebody asked for letters from Ikshaa using this address.',
    'If that was you, confirm here:',
    '',
    link,
    '',
    'Then you will hear from me about once a week - what is flowering, what the',
    'cook is making, what the weather has been doing to the courtyard. A note',
    'when the season turns. Nothing else, ever.',
    '',
    'The link works for three days. If it was not you, ignore this: nothing is',
    'sent to an address that has not been confirmed.',
    '',
    'Carman',
    'Ikshaa, Loutolim, South Goa',
    'nyaragoa@gmail.com',
  ].join('\n');

  return { subject: 'Confirm your letters from Ikshaa', html, text };
}

/* ---------------------------------------------------------------------
 * The nudge
 *
 * Sent once, to somebody who subscribed and never clicked. This is the
 * honest answer to "what if they never confirm" -- ask again, once, rather
 * than mail them anyway. An address that ignores both is an address that
 * did not want this, or was never theirs to give.
 * ------------------------------------------------------------------ */

function reminder(options) {
  const link = options.link;
  const name = options.name ? String(options.name).split(/\s+/)[0] : '';
  const hello = name ? 'Dear ' + esc(name) + ',' : 'Hello again,';

  const html = shell({
    title: 'Your letters from Ikshaa are still waiting',
    preheader: 'The link from a few days ago is still good, for a little longer.',
    body: `
      <p style="margin:0 0 18px;">${hello}</p>

      <p style="margin:0 0 18px;">
        You asked for letters from Ikshaa a few days ago, and the confirmation is
        still sitting unclicked. Inboxes being what they are, it may simply never
        have surfaced.
      </p>

      ${button(link, 'Confirm and start the letters')}

      <p style="margin:0 0 18px;color:rgba(46,42,36,0.68);font-size:15px;">
        This is the only reminder I will send. If the moment has passed, do nothing
        and you will not hear from me again.
      </p>

      <p style="margin:22px 0 0;">Carman</p>`,
  });

  const text = [
    hello.replace(/&#39;/g, "'"),
    '',
    'You asked for letters from Ikshaa a few days ago and the confirmation is',
    'still unclicked. Inboxes being what they are, it may never have surfaced.',
    '',
    'Confirm here:',
    link,
    '',
    'This is the only reminder I will send. If the moment has passed, do nothing',
    'and you will not hear from me again.',
    '',
    'Carman',
    'Ikshaa, Loutolim, South Goa',
  ].join('\n');

  return { subject: 'Your letters from Ikshaa are still waiting', html, text };
}

/* ---------------------------------------------------------------------
 * The weekly letter
 *
 * `body` is the week's writing, as plain paragraphs separated by blank
 * lines. Keeping the composition to prose means whoever writes it needs no
 * HTML, and the shell handles everything else.
 * ------------------------------------------------------------------ */

function letter(options) {
  const paragraphs = String(options.body || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = shell({
    title: options.subject,
    // First sentence of the letter — a real preview beats a slogan.
    preheader: (paragraphs[0] || '').slice(0, 110),
    unsubscribe: options.unsubscribe,
    body: paragraphs
      .map((p) => `<p style="margin:0 0 18px;">${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('\n      ') +
      `\n      <p style="margin:22px 0 0;">Carman</p>` +
      (options.bookingUrl ? button(options.bookingUrl, 'See dates') : ''),
  });

  const text = paragraphs.join('\n\n') +
    '\n\nCarman\nIkshaa, Loutolim, South Goa' +
    (options.bookingUrl ? '\n\nDates: ' + options.bookingUrl : '') +
    (options.unsubscribe ? '\n\nStop receiving these: ' + options.unsubscribe : '');

  return { subject: options.subject, html, text };
}

/* ---------------------------------------------------------------------
 * Welcome
 *
 * Sent once, the moment somebody subscribes.
 *
 * Under double opt-in the confirmation email did this job as a side effect:
 * it proved the address worked AND told the person something had happened.
 * Removing it took the second job away with the first, and left a form that
 * accepted an address in silence. Silence is how a person concludes it did
 * not work, and subscribes again — or writes to ask.
 *
 * It also does something the confirmation could not: it is the first thing
 * that ever arrives from this sending domain, so it establishes what the
 * letters look like and who they are from while the reader is still
 * expecting them. An unsubscribe link is in it from the first message,
 * because consent that cannot be withdrawn easily is not worth much.
 * ------------------------------------------------------------------ */

function welcome(options) {
  const settings = options || {};
  const name = settings.name ? String(settings.name).split(/\s+/)[0] : '';
  const hello = name ? 'Dear ' + esc(name) + ',' : 'Hello,';
  const weekly = settings.weekly !== false;
  const seasonal = settings.seasonal !== false;

  /* Says back exactly what they ticked. A welcome that describes the wrong
     subscription is worse than none — the reader has no way to tell whether
     the form recorded them correctly, and this is the only chance to show it. */
  const expect = weekly && seasonal
    ? 'a letter about once a week, and a note when the season turns'
    : weekly
      ? 'a letter about once a week'
      : seasonal
        ? 'a note when the season turns, a handful of times a year'
        : 'nothing at all, by the look of it &mdash; neither box was ticked';

  const html = shell({
    title: 'Welcome to the letters from Ikshaa',
    preheader: 'You are on the list. Here is what will arrive, and how to stop it.',
    unsubscribe: settings.unsubscribe,
    body: `
      <p style="margin:0 0 18px;">${hello}</p>

      <p style="margin:0 0 18px;">
        You are on the list &mdash; there is nothing further to click. From here you can
        expect ${expect}.
      </p>

      <p style="margin:0 0 18px;">
        They come from the house itself: what is flowering, what the cook is making,
        what the weather has been doing to the courtyard. No offers and no campaigns.
        If one ever reads like marketing, I have got it wrong.
      </p>

      ${settings.bookingUrl ? button(settings.bookingUrl, 'See dates for a stay') : ''}

      <p style="margin:0 0 18px;color:rgba(46,42,36,0.68);font-size:15px;">
        Reply to this if you have a question about the villa &mdash; it reaches a person,
        not an autoresponder.
      </p>

      <p style="margin:22px 0 0;">Carman</p>`,
  });

  const text = [
    hello.replace(/&#39;/g, "'"),
    '',
    'You are on the list - there is nothing further to click.',
    'From here you can expect ' + expect.replace(/&mdash;/g, '-') + '.',
    '',
    'They come from the house itself: what is flowering, what the cook is',
    'making, what the weather has been doing to the courtyard. No offers and',
    'no campaigns. If one ever reads like marketing, I have got it wrong.',
    '',
    'Reply to this if you have a question about the villa - it reaches a',
    'person, not an autoresponder.',
    '',
    'Carman',
    'Ikshaa, Loutolim, South Goa',
    'nyaragoa@gmail.com',
    settings.bookingUrl ? '\nDates: ' + settings.bookingUrl : null,
    settings.unsubscribe ? '\nStop receiving these: ' + settings.unsubscribe : null,
    /* null, not '' — an empty string here IS a paragraph break, and filtering
       on falsiness collapsed the whole letter into one block of text. */
  ].filter((line) => line !== null).join('\n');

  return { subject: 'Welcome to the letters from Ikshaa', html, text };
}

module.exports = { confirmation, reminder, letter, welcome };
