'use strict';

/* ============================================================================
 * Transports — the only part that knows how a letter physically leaves.
 *
 * Injected into sendBatch rather than imported by it, for two reasons. Tests
 * need a transport that fails on demand and never touches a network; and the
 * choice of provider should not be a rewrite. A transport is one method:
 *
 *     send({ to, subject, body, campaign }) -> resolves, or throws
 *
 * Throwing is how a failure is reported. campaigns.js turns that into a
 * retry with backoff, so a transport does not need to know about attempts,
 * schedules, or the outbox at all.
 * ========================================================================= */

/* fs and path are required lazily, inside fileTransport alone.
 *
 * httpTransport is nothing but fetch, so it runs unchanged in a Cloudflare
 * Worker — but only if importing this module does not drag the filesystem in
 * with it. A Worker has no fs, and the import would throw before any
 * transport could be chosen. */

/* ---------------------------------------------------------------------
 * Development
 * ------------------------------------------------------------------ */

/* Writes each letter to data/outbox-preview/ instead of sending it.
 *
 * The default on purpose. Nothing about the queue, the retries or the
 * confirmations needs a real provider to develop against, and an accidental
 * send to a real list is not something you can take back. */
function fileTransport(options = {}) {
  const fs = require('fs');
  const path = require('path');
  const dir = options.dir || path.join(__dirname, '..', 'data', 'outbox-preview');
  fs.mkdirSync(dir, { recursive: true });

  return {
    name: 'file',
    async send(letter) {
      const safe = String(letter.to).replace(/[^a-z0-9._@-]/gi, '_');
      const path = require('path');
      const file = path.join(dir, Date.now() + '-' + safe + '.txt');
      require('fs').writeFileSync(file,
        'To: ' + letter.to + '\n' +
        'Subject: ' + letter.subject + '\n' +
        'Campaign: ' + letter.campaign + '\n' +
        '\n' + letter.body + '\n', 'utf8');
      return { id: file.split(/[\\/]/).pop() };
    },
  };
}

/* ---------------------------------------------------------------------
 * Production
 * ------------------------------------------------------------------ */

/* Resend, chosen because it is one HTTPS call with no SDK — which keeps this
   working unchanged on Node and on a Worker, where an SMTP library would
   not. Any provider with a JSON endpoint fits the same shape.
 *
 * MAIL_FROM must be a domain you have verified with the provider. Sending as
 * an address you do not control is the fastest route to being filtered
 * everywhere, and no amount of double opt-in compensates for it. */
function httpTransport(options = {}) {
  const apiKey = options.apiKey || process.env.MAIL_API_KEY;
  const from = options.from || process.env.MAIL_FROM;
  const endpoint = options.endpoint || process.env.MAIL_ENDPOINT || 'https://api.resend.com/emails';
  const fetchImpl = options.fetch || globalThis.fetch;
  const unsubscribeBase = options.unsubscribeBase || process.env.PUBLIC_BASE_URL;

  if (!apiKey || !from) {
    throw new Error('httpTransport needs MAIL_API_KEY and MAIL_FROM');
  }

  return {
    name: 'http',
    async send(letter) {
      /* List-Unsubscribe is not decoration. Without it, the only way out of
         a list is the spam button, and enough of those poison the sending
         domain for everybody. */
      const headers = unsubscribeBase ? {
        'List-Unsubscribe': '<' + unsubscribeBase + '/unsubscribe?email=' +
          encodeURIComponent(letter.to) + '>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      } : undefined;

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          from: from,
          to: [letter.to],
          reply_to: options.replyTo || process.env.MAIL_REPLY_TO || undefined,
          subject: letter.subject,
          /* Both parts when the caller composed both. Text alone would throw
             away the design; HTML alone is a mild spam signal and unreadable
             on anything that does not render it. */
          text: letter.body,
          html: letter.html || undefined,
          headers: headers,
        }),
      });

      if (!res.ok) {
        /* Include the status: campaigns.js keeps last_error, and "429" versus
           "422" is the difference between "try later" and "this address will
           never work". */
        const detail = await res.text().catch(() => '');
        throw new Error('mail provider ' + res.status + ': ' + detail.slice(0, 200));
      }
      return res.json().catch(() => ({}));
    },
  };
}

/* ---------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------ */

/* Records what it was asked to send, and fails whenever `failOn` says so.
   Retries and backoff cannot be tested against a transport that always
   works. */
function memoryTransport(options = {}) {
  const sent = [];
  const failOn = options.failOn || (() => false);
  return {
    name: 'memory',
    sent,
    async send(letter) {
      const verdict = failOn(letter, sent.length);
      if (verdict) {
        throw new Error(typeof verdict === 'string' ? verdict : 'transport refused');
      }
      sent.push(letter);
      return { id: 'mem-' + sent.length };
    },
  };
}

/* Pick from the environment, defaulting to the one that cannot embarrass
   anybody. Sending for real has to be asked for. */
function transportFromEnv(options = {}) {
  const wanted = options.kind || process.env.MAIL_TRANSPORT || 'file';
  if (wanted === 'http') { return httpTransport(options); }
  if (wanted === 'memory') { return memoryTransport(options); }
  return fileTransport(options);
}

module.exports = { fileTransport, httpTransport, memoryTransport, transportFromEnv };
