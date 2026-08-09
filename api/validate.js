'use strict';

/* ============================================================================
 * The rules about what a subscription may contain.
 *
 * ZERO imports, deliberately. Not tidiness — portability.
 *
 * These rules were originally inside api/db.js, so api/pg/db.js imported the
 * SQLite store to borrow them. That meant the Postgres store loaded
 * `node:sqlite` at require time and could not run anywhere SQLite was absent
 * — including a Cloudflare Worker, which has no `node:sqlite` and no
 * filesystem. A whole storage engine was being dragged in for an email regex.
 *
 * With this file standing alone, every store depends on the rules and no
 * store depends on another. It also means the rules cannot drift: there is
 * one definition of a valid address, one set of length caps, and one answer
 * to what an absent checkbox means.
 * ========================================================================= */

const LIMITS = { email: 254, name: 120, origin: 120, note: 4000 };

/* Deliberately loose. Anything stricter rejects addresses that genuinely
   work — plus-addressing, new TLDs, single-label local parts — and the real
   proof an address exists is that mail sent to it arrives. That is what the
   double opt-in is for; this only catches what is obviously not an address. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function cleanText(value, max) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function validateSubscription(input) {
  const given = input || {};
  const errors = [];
  const email = cleanText(given.email, LIMITS.email);

  if (!email) {
    errors.push('email is required');
  } else if (!EMAIL.test(email)) {
    errors.push('email is not a valid address');
  }

  /* Long text is cut, not refused. Someone who wrote past the limit has still
     said something worth keeping, and throwing all of it away to protect a
     column width would be the wrong trade. */
  const note = cleanText(given.note, LIMITS.note);

  return {
    errors,
    value: {
      email,
      name: cleanText(given.name, LIMITS.name),
      origin: cleanText(given.origin, LIMITS.origin),
      /* Absent means yes: the form ships both boxes ticked, and an unchecked
         box is simply not submitted by the browser. Reading absence as "no"
         would silently unsubscribe everyone who used the short form. */
      weekly: given.weekly === undefined ? 1 : (given.weekly ? 1 : 0),
      seasonal: given.seasonal === undefined ? 1 : (given.seasonal ? 1 : 0),
      note,
    },
  };
}

module.exports = { validateSubscription, cleanText, LIMITS, EMAIL };
