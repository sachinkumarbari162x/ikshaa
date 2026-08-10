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

/* ============================================================================
 * Which addresses we are willing to write to
 *
 * The confirmation email used to be the proof an address was real: send a
 * link, and only mail people who click it. Without it, nothing downstream
 * checks whether an address exists, and the first thing that notices is the
 * bounce rate on a young sending domain — which is the one number that
 * decides whether Gmail puts the letter in the inbox or the spam folder.
 *
 * So the proof has to move to the moment of signup. Three layers here, and a
 * fourth (an MX lookup) in the Worker, where DNS is reachable:
 *
 *   1. TEST AND DEVELOPMENT addresses are refused outright. These never
 *      belong to a guest and every one of them is a guaranteed bounce.
 *   2. DISPOSABLE providers are refused. A ten-minute mailbox cannot receive
 *      a weekly letter, so accepting one is a bounce with extra steps.
 *   3. KNOWN PROVIDERS are accepted immediately — no DNS round trip on the
 *      path of somebody waiting for a form to submit.
 *   4. Anything else is UNRESOLVED and the caller must check that the domain
 *      can actually receive mail before storing it.
 *
 * None of this proves the mailbox exists. Nothing except sending to it can,
 * and we have chosen not to. It does remove the categories that are certain
 * to fail, which is the part that protects the sending domain.
 * ========================================================================= */

/* The mailbox providers a guest of a Goan villa plausibly uses. Anything here
   skips the DNS check, so it is a latency optimisation as much as a policy —
   these domains are not going to stop having MX records.

   Indian providers are included deliberately: most enquiries come from within
   India, and rediffmail is not obscure here even if it looks it elsewhere. */
const KNOWN_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'hotmail.co.uk',
  'outlook.in', 'live.co.uk', 'hotmail.fr', 'outlook.fr', 'hotmail.it',
  'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'yahoo.in', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'aol.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com',
  'zoho.com', 'zohomail.in', 'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io',
  'rediffmail.com', 'sify.com', 'indiatimes.com',
  'qq.com', '163.com', '126.com', 'naver.com', 'daum.net',
  'yandex.com', 'yandex.ru', 'mail.ru',
  'orange.fr', 'free.fr', 'laposte.net', 'wanadoo.fr',
  'btinternet.com', 'sky.com', 'virginmedia.com', 'talktalk.net',
  'bigpond.com', 'optusnet.com.au', 'xtra.co.nz',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net',
]);

/* Throwaway mailboxes. Not a complete list — one cannot exist, new ones
   appear weekly — but it covers the services people actually reach for.
   Anything missed falls through to the MX check, which these all pass, so
   this list is the only thing standing between us and them. */
const DISPOSABLE_PROVIDERS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'throwawaymail.com', 'yopmail.com', 'yopmail.fr', 'trashmail.com', 'trashmail.de',
  'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mintemail.com',
  'fakeinbox.com', 'spamgourmet.com', 'mailnesia.com', 'mytemp.email',
  'moakt.com', 'tempr.email', 'discard.email', 'mailcatch.com',
  'inboxbear.com', 'emailondeck.com', 'burnermail.io', 'anonaddy.me',
  'spam4.me', 'grr.la', 'pokemail.net', 'harakirimail.com',
  'mohmal.com', 'tempmailo.com', 'linshiyouxiang.net', 'boximail.com',
  'vomoto.com', 'tmpmail.org', 'tmpeml.com', 'byom.de',
]);

/* Domains reserved by standards or by mail services for testing. RFC 2606
   sets aside example.* and .test/.invalid/.localhost precisely so nobody
   routes real mail to them. resend.dev is our own provider's sandbox. */
const TEST_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'example.edu',
  'test.com', 'test.net', 'testing.com', 'domain.com', 'email.com',
  'localhost', 'localhost.localdomain', 'resend.dev', 'mailtrap.io',
  'sink.sendgrid.net', 'simulator.amazonses.com',
]);
const TEST_TLDS = ['.test', '.invalid', '.localhost', '.example', '.local'];

/* Local parts nobody signs up with. `delivered` and `bounced` are Resend's
   sandbox mailboxes and were used to test this very endpoint — which is why
   they are here: the addresses that make good test data make terrible
   subscribers, and the form should not accept either. */
const TEST_LOCALPARTS = new Set([
  'test', 'tester', 'testing', 'test1', 'test123', 'demo', 'dev', 'developer',
  'sample', 'example', 'dummy', 'fake', 'asdf', 'qwerty', 'foo', 'bar', 'baz',
  'delivered', 'bounced', 'complained', 'noreply', 'no-reply', 'donotreply',
  'nobody', 'null', 'void', 'temp', 'trash', 'spam', 'abc', 'xyz', 'aaa',
]);

function domainOf(email) {
  const at = String(email).lastIndexOf('@');
  return at === -1 ? '' : String(email).slice(at + 1).toLowerCase();
}

function localPartOf(email) {
  const at = String(email).lastIndexOf('@');
  // Plus-addressing is legitimate, but the tag is not part of the identity:
  // test+anything@ is still test@.
  return at === -1 ? '' : String(email).slice(0, at).toLowerCase().split('+')[0];
}

/**
 * Decide what to do with an address.
 *
 * Returns one of:
 *   { verdict: 'accept'     }  a known provider, store it
 *   { verdict: 'unresolved' }  plausible, but check the domain has MX first
 *   { verdict: 'reject', reason, message }
 *
 * `message` is written for the person who typed it, not for a log. Being told
 * "email is not valid" when the real problem is a throwaway domain teaches
 * nobody anything, and they will simply retype the same address.
 */
function classifyEmail(email, options) {
  const settings = options || {};
  const address = String(email || '').trim().toLowerCase();
  const domain = domainOf(address);
  const local = localPartOf(address);

  if (!domain) {
    return { verdict: 'reject', reason: 'malformed', message: 'That does not look like an email address.' };
  }

  /* Owner-side scripts still need to reach the sandbox mailboxes — that is
     how the sender is tested without mailing a stranger. The form never sets
     this; only a token-authenticated caller can. */
  if (!settings.allowTestAddresses) {
    const reservedTld = TEST_TLDS.some((tld) => domain.endsWith(tld));
    if (TEST_DOMAINS.has(domain) || reservedTld || !domain.includes('.')) {
      return {
        verdict: 'reject',
        reason: 'test-domain',
        message: 'That is a test domain, so no letter could ever reach it. Please use the address you actually read.',
      };
    }
    if (TEST_LOCALPARTS.has(local)) {
      return {
        verdict: 'reject',
        reason: 'test-address',
        message: 'That looks like a placeholder address. Please use the one you actually read.',
      };
    }
  }

  if (DISPOSABLE_PROVIDERS.has(domain)) {
    return {
      verdict: 'reject',
      reason: 'disposable',
      message: 'That is a temporary mailbox, and a weekly letter would outlive it. Please use a permanent address.',
    };
  }

  if (KNOWN_PROVIDERS.has(domain)) {
    return { verdict: 'accept', reason: 'known-provider', domain };
  }

  // A real company or personal domain, most likely. The caller checks DNS.
  return { verdict: 'unresolved', reason: 'needs-mx', domain };
}

module.exports = {
  validateSubscription, cleanText, LIMITS, EMAIL,
  classifyEmail, domainOf, localPartOf,
  KNOWN_PROVIDERS, DISPOSABLE_PROVIDERS, TEST_DOMAINS,
};
