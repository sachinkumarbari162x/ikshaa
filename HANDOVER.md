# Handover

Where the project stands, what to do next, and the traps that have already
caught someone.

`README.md` covers *how the thing is built* — the server, the build step, the
chat assistant. This file covers *where it currently is*. Read that one first
if you have not.

**Last updated:** 9 August 2026. Everything below is deployed and verified,
not planned.

---

## Current state

| | |
|---|---|
| Site | https://ikshaa.pages.dev — Cloudflare Pages |
| API | https://ikshaa-api.sachinkumarbari162x.workers.dev — Cloudflare Worker |
| Database | Neon Postgres, `ap-southeast-1` (Singapore) |
| Email | Resend, sending as `Carman at Ikshaa <carman@brownodin.com>` |
| Timer | Cloudflare cron, `*/15 * * * *` |
| Repository | https://github.com/sachinkumarbari162x/ikshaa |
| Tests | 276, all passing |
| Build | 14.35 MB, 174 files |
| Node | **22.13+** — `node:sqlite` is flagged below that. CI runs 24. |

Ten pages, a 35-room villa tour, an offline chat assistant, and a newsletter
with double opt-in that actually delivers mail.

**Netlify still holds an old deployment at `ikshaa.netlify.app`.** Nothing was
deleted there; it is simply no longer the target. See the hosting comparison
below for why the move happened, and why it was closer than expected.

---

## Done, and verified end to end

**The newsletter works.** A stranger subscribes on the site, Neon stores them
unconfirmed, Resend sends a designed confirmation from a DKIM-signed domain,
clicking it flips `confirmed_at`, and the cron delivers the weekly letter.
Every step of that has been run against production, not mocked.

| | |
|---|---|
| Double opt-in | single-use token, only its SHA-256 is stored, 72h expiry |
| Case-insensitive addresses | `citext` — `Maria@` and `maria@` are one person |
| Idempotent confirm | a second click says "already", never "invalid" |
| Outbox | `UNIQUE (campaign_id, subscriber_id)` — re-running sends nobody twice |
| Concurrency | `FOR UPDATE SKIP LOCKED` — two senders never collide |
| Retries | backoff moves `visible_at`; a crash mid-backoff loses nothing |
| One reminder | `reminded_at`, so a 15-minute cron cannot nudge 96×/day |
| Unsubscribe | per-recipient link, plus `List-Unsubscribe` headers |

**Images are AVIF with a WebP fallback.** 8.96 MB of JPEG became 3.39 MB of
AVIF, or 5.19 MB of WebP for Safari 15 and older. Zero JPEGs ship. Two
mechanisms, because counting showed 76 static `<img>` against 122 whose `src`
JavaScript sets: `<picture>` for the first, a decoded 2×2 AVIF probe for the
second.

**Code is fingerprinted and immutable.** `script.7f3a91c4.js`, cached for a
year. Unchanged files cost no request at all; changed ones arrive immediately.

**First paint carries 65% less JavaScript.** The chat's language engine (34 KB
across three files) now loads on idle or first interaction rather than on
every page.

**Chat routes 100% of the eval corpus**, with 0.0% false confidence. A Groq
model (`qwen/qwen3.6-27b`) resolves conversations that miss twice — it returns
only a topic id, never words, so an injection can reach the wrong topic and
nothing worse.

---

## Do these next

### 1. A CLI for writing the week's letter

Right now composing one means calling `createCampaign` and `queueCampaign`
from a Node one-liner. That is fine for me and wrong for anybody else.
`npm run letter` should prompt for subject and body, show the recipient count,
and ask before queueing. Nothing else about the system is hard to use; this is.

### 2. Ikshaa needs its own sending domain

Mail currently goes out as `@brownodin.com` — a test domain. A guest who
subscribed at *Ikshaa* and receives mail from *brownodin.com* has no reason to
trust it, and Gmail agrees: unfamiliar sender domain is a strong spam signal.

Reputation does **not** transfer between domains. Whatever is built on
`brownodin.com` starts again on the real one.

### 3. The `.html` redirect on every internal link

Both hosts strip `.html` and 301/308 to the extensionless URL. Every internal
link on the site is `.html` — 22 on the home page alone — so every internal
navigation costs a redirect round-trip, and always has. Rewrite the links
extensionless at build time.

---

## Hosting: why Cloudflare, and the honest caveat

Measured with Lighthouse, three runs each, identical preset:

```
host        LCP     FCP     TTFB    CLS     score
Cloudflare  6.9 s   1.7 s   44 ms   0.005   70
Netlify     3.3 s   1.9 s   69 ms   0.005   84

spread  Cloudflare  LCP 3.2–9.2 s   TTFB 30–56 ms
        Netlify     LCP 3.2–6.8 s   TTFB 67–74 ms
```

**Cloudflare wins TTFB decisively and consistently.** On LCP the two are
indistinguishable — both bimodal at ~3.2 s or ~6.9 s, and *both hosts hit both
values*, so that variance is the measuring network, not the host.

CLS was 0.005 on every run of both. That was the control: identical HTML must
produce identical CLS, and it did, so the numbers are trustworthy.

The honest reading: **Cloudflare answers faster; neither renders faster.** The
move was justified by TTFB, the free tier, and having Workers/D1/Hyperdrive
beside the site — not by a rendering win, which did not materialise.

---

## The newsletter, operationally

### Composing and sending

```js
createCampaign(pool, { slug: 'weekly-2026-08-16', list: 'weekly',
                       subject: '…', body: 'paragraphs\n\nseparated by blank lines' })
queueCampaign(pool, id)
// the cron drains it within 15 minutes
```

`body` is prose. `api/emails/messages.js` wraps it in the house layout.

### Why the emails look twenty years out of date

They have to. Tables rather than flex, because Outlook renders through Word's
engine. Inline styles, because Gmail strips `<style>` on forward. Georgia
rather than Cormorant, which no client will load. Nothing depends on an image,
because most clients block them until asked. 600px, because it still survives
everything.

Every letter ships `html` **and** `text`. Not a courtesy: some people read in
plain text, watches and preview panes render it, and HTML-only is a mild spam
signal.

### The cron never writes anything

It drains the outbox and sends reminders. Composing a letter is a human act,
and a cron that invented content and mailed it would be the worst thing this
system could do.

Fifteen minutes rather than weekly *because* it only drains — a weekly cron
would leave a letter queued on Tuesday sitting until Sunday.

### Secrets

Set with `wrangler secret put`, never in `wrangler.toml`:

```
DATABASE_URL       Neon
IKSHAA_API_TOKEN   npm run token
MAIL_API_KEY       Resend (send-only key)
```

`.env` mirrors them for local work and is gitignored. **`essentials.txt` in the
repo root holds live credentials and is gitignored** — it was once picked up by
`git add -A` and caught before the commit. Never `git add -f` it.

---

## Testing recipes

### The newsletter modal

Do not clear `localStorage` by hand:

```
?newsletter=now      shows it in 400ms, stores nothing — repeatable
?newsletter=reset    forgets stored state, then behaves as a real first visit
```

### The confirmation page

```
/subscribe.html?confirmed=yes | already | expired | unknown
```

### Chat routing

```
npm run eval          the 121-question corpus, offline and free
npm run chat:probe    one real Groq call per awkward question
npm run chat:bench    compares candidate models; costs tokens
```

### Reproducing CI locally — do this before every push

**Passing locally proves nothing.** Two tests once asserted files that are
gitignored, so they passed here and could never pass in CI. Build a tree from
tracked files only:

```bash
python -c "
import subprocess,os,shutil,sys
sim=sys.argv[1]
for f in subprocess.run(['git','ls-files'],capture_output=True,text=True).stdout.splitlines():
    if os.path.exists(f):
        d=os.path.join(sim,f); os.makedirs(os.path.dirname(d),exist_ok=True); shutil.copy2(f,d)
" /path/to/sim
cp -r node_modules /path/to/sim/
cd /path/to/sim && node build.js && ./node_modules/.bin/jest
```

---

## Traps

- **Cloudflare caches at the edge even with `no-store`.** A 400 from `/api/confirm`
  was served from cache after the bug behind it was fixed. Add a cache-buster
  when testing an API response you have just changed, or you will debug a
  problem that no longer exists.
- **Neon sleeps.** Free tier scales to zero after ~5 minutes. The first request
  can take ~2 s and may surface as Cloudflare error `1042`. Not a fault.
- **Never send to made-up addresses.** `maria@example.com` is a hard bounce, and
  a young sending domain has no reputation to absorb it. Use
  `delivered@resend.dev` and `bounced@resend.dev`.
- **`knowledge.js` nulls are load-bearing.** 21 facts are `null` on purpose. The
  bot defers rather than inventing a number, and a test asserts it emits no
  figure while rates are unset. `cameras` and `perimeter` matter most: a guest
  asking whether they are recorded deserves the truth or a human, never a
  reassuring guess.
- **Do not add JPEGs.** AVIF plus a WebP fallback, and measure dimensions before
  using an image as a hero — everything in `imagesIkshaa/` is ≤0.73 MP.
- **`public/skeletons&Protos/`** (131 MB) and **`public/_archive/`** are gitignored
  but still on disk. Nothing may delete them.
- **The build walks references, it is not an ignore list.** A file nothing links
  to cannot ship; a file something links to cannot be forgotten.
- **Adding a duplicate key to an intent silently does nothing.** A second
  `patterns:` in the same object literal is dead code — the later key wins. That
  cost nine accuracy points before it was spotted.

---

## Open

- **Ikshaa has no domain of its own.** Everything runs on `brownodin.com` and
  `*.pages.dev`.
- **`carman@brownodin.com` cannot receive.** `Reply-To` points at
  `nyaragoa@gmail.com`. Cloudflare Email Routing would fix it free.
- `knowledge.js` has 21 null facts awaiting real values.
- Instagram, Facebook, Privacy and Terms are placeholder links.
- `findingUs.html` has no journey time for Mopa airport; the map pin marks the
  village, not the gate.
- The four JPEG folders still hold the originals. They no longer ship — nothing
  references them — but they were never moved to an archive.
- `subscribe.html` is reached from the newsletter sections and the modal, but is
  not in the nav.

---

## What changed most recently

```
6ba81ad  Designed emails, the weekly sender, and the cron that drains it
4258449  Prepare the newsletter for Cloudflare + Neon
cfabe86  Add campaigns, the outbox and the sender; add a Cloudflare test deploy
f24a1f4  Port the newsletter store to Postgres, and decouple the shared rules
46dc157  Convert the photographs to AVIF with a WebP fallback
44b31b9  Fix the chat misroutes: 86.8% -> 100% on the eval corpus
bf6175f  Add a Groq router for stuck conversations, and .env for the keys
7912419  Fingerprint code so caches update on deploy, not an hour later
```

Two decisions in that run are worth remembering, because both were about
refusing to share infrastructure.

The API was nearly put on the existing Lightsail box to save $5/month. That box
is 1 GB running a **live client system** with consent and DSAR modules —
personal data under a compliance obligation. The OOM killer does not check
whose process matters more.

The same trap appeared again in Resend: the only verified domain on that
account was the client's. Sending this newsletter from it would have put a
portfolio project's mail on their sending reputation.

Both were avoided. Isolation cost nothing in the end — Cloudflare, Neon and
Resend all sit inside free tiers, and current database usage is 8 MB against a
500 MB allowance.
