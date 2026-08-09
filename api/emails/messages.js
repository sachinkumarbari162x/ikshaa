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

module.exports = { confirmation, reminder, letter };
