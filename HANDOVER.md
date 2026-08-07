# Handover

Where the project stands, what to do next, and the traps that have already
caught someone.

`README.md` covers *how the thing is built* — the server, the build step, the
chat assistant. This file covers *where it currently is*. Read that one first
if you have not.

**Last updated:** 7 August 2026.

---

## Current state

| | |
|---|---|
| Live | https://ikshaa.netlify.app |
| Repository | https://github.com/sachinkumarbari162x/ikshaa |
| Hosting | Netlify, connected to GitHub — every push to `main` deploys |
| CI | GitHub Actions: `npm ci` → `npm run build` → `npm test` |
| Tests | 226, all passing |
| Build | 16.74 MB, 131 files, from 146 tracked source files |
| Node | **22.13+ required** — `node:sqlite` is flagged below that. CI runs 24. |

Ten pages, a 35-room scroll-driven villa tour, an offline chat assistant, a
newsletter, and a local database behind a token-protected API. No framework,
no runtime dependencies, one dev dependency (Jest).

### Where the weight is

```
page images   7.92 MB   JPEG    <- the outstanding item
video         2.84 MB
audio         2.54 MB   mono 96kbps
tour images   2.46 MB   AVIF/WebP already
code + chat   0.45 MB
```

---

## Do these next, in this order

### 1. Convert the page JPEGs to AVIF — biggest win, nothing else close

`imagesIkshaa/`, `galleryImages/`, `heritagePageImages/` and
`hamBurgerDropImages/` are all still JPEG: **7.92 MB of a 16.74 MB build.**
Only the tour's `media/images/` was ever converted.

The case, measured on this repo:

```
theCourtyard.avif    1440x956   1.38 MP    76 KB   <- tour
IkshaaSitting2.jpg   1024x680   0.70 MP   145 KB   <- page hero
```

Twice the pixels for half the bytes. Expect 50–60% off that 7.92 MB.

`ffmpeg` here has `libaom-av1` and `libwebp`, so no new tooling is needed.
AV1 encoding is slow — budget real time for ~100 images, and use
`-cpu-used 6`. Nothing in `imagesIkshaa/` exceeds 0.73 MP, so do **not**
upscale on the way through; these are small originals and always were.

### 2. Lazy-load the chat brain — 34 KB off every page

Five scripts load on all eight content pages. Three of them are never needed
until somebody opens the chat:

```
chat/chat.js         4,824 B   keep — draws the launcher and the timed prompts
chat/nlu.js         14,628 B   defer to first open
chat/knowledge.js   12,658 B   defer to first open
chat/bot.js          7,198 B   defer to first open
```

The split is already clean: `chat.js` owns the UI, the other three are the
brain. Load them on first launcher click. Per-page JavaScript goes from
51,354 B across 5 requests to 16,870 B across 2.

### 3. Content-hash the assets — and stop the stale-cache confusion

`script.js` and `style.css` ship as `max-age=3600, must-revalidate`, because
their names do not change when their contents do. Consequences:

- after an hour, every page view spends a conditional round-trip per file
- **a deploy does not reach an open browser for up to an hour**

That second one wasted real time during this session — four separate
"it isn't working" moments were a cached `script.js`. Hash the filenames
(`script.7f3a91.js`), rewrite the references, move them to the `immutable`
tier. `build.js` already walks references, so that is where it belongs.

`_headers` already states the principle for media: *"referenced by name; a new
photo is a new filename."* Code just does not follow it yet.

---

## The newsletter database (localhost)

`api/` — a real relational store behind a token-protected API, mounted into
`server.js` at `/api/`. It runs on localhost only; **nothing about it is
deployed.** The live site still posts to Netlify Forms.

**Why SQLite via `node:sqlite`:** it is built into Node, so the project stays
zero-dependency. Real constraints, real SQL, one file, no server to run and
nothing to install. If it ever needs hosting, the same SQL runs on Turso or
any libSQL host without changing a line.

### The two properties it exists to guarantee

```
subscribers   one row per address, ever    UNIQUE COLLATE NOCASE
messages      many rows per address        FK -> subscribers, ON DELETE CASCADE
```

`COLLATE NOCASE` is the load-bearing part. `Maria@Example.com` and
`maria@example.com` are one person; without it the table stores both happily
and they each get a letter. The address is kept as first seen — later casing
does not rewrite it.

Unsubscribing sets `unsubscribed_at` rather than deleting. The row is the
record that consent was given and later withdrawn; deleting it loses the proof
along with the preference. Subscribing again clears the flag.

### Running it

```bash
npm run token                 # generate a strong token
IKSHAA_API_TOKEN=<token> npm start
```

```
POST /api/subscribe      public   JSON or urlencoded, rate limited 10/min/IP
GET  /api/subscribers    token
GET  /api/messages       token    ?email= filters to one person
GET  /api/stats          token
POST /api/unsubscribe    token
```

The database lands at `data/ikshaa.db`, which is **gitignored** — real
addresses and messages must never reach a public repository. Back it up
separately; nothing else is holding a copy.

### Security decisions worth not undoing

- **An unset `IKSHAA_API_TOKEN` locks the protected routes rather than opening
  them.** An unconfigured server is a locked one.
- **Tokens are compared with `timingSafeEqual` over SHA-256 digests**, not
  `===`. A plain compare leaks the token's length and first differing byte
  through timing, which is enough to recover it one character at a time.
  Hashing first is what makes the lengths always match, since
  `timingSafeEqual` throws when they differ.
- **401 says nothing about why.** Which of "no token", "wrong token" and
  "server has no token set" applies is not the caller's business.
- **Oversized bodies are drained, not destroyed.** Killing the socket resets
  the connection before the 413 can be written, and the caller sees a network
  error instead of the reason.
- The rate limiter is in-memory and per-process. Fine for localhost; a real
  deployment needs shared state.

### Wiring the live form to it

Currently `subscribe.html` posts to Netlify Forms. To use this instead, change
the form's `action` to `/api/subscribe` and drop `data-netlify`. Do not do
that until the API is actually hosted somewhere — the endpoint does not exist
in production today, and the change would silently break a working form.

---

## Testing recipes

### The newsletter modal

Do not clear `localStorage` by hand. Two URLs:

```
?newsletter=now      shows it in 400ms, stores nothing — repeatable
?newsletter=reset    forgets stored state, then behaves as a real first visit
```

Real behaviour: 3s after load or 30% scroll, whichever first. Dismissing
stores a 30-day quiet period under `ikshaa.newsletter`; subscribing silences
it permanently. It never shows on `subscribe.html`.

### Reproducing CI locally — do this before every push

**Passing locally proves nothing.** Two tests once asserted files that are
gitignored, so they passed here and could never pass on CI. Build a tree from
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

Locally `public/` is ~244 MB; in a fresh clone it is ~16.6 MB. Any test that
reasons about that difference is testing a hard drive.

---

## Traps

- **Stale cache.** Hard-refresh (Ctrl+Shift+R) after every deploy, or you are
  looking at up to an hour-old `script.js`. Fixed permanently by item 3.
- **`public/skeletons&Protos/`** (131 MB) and **`public/_archive/`** are
  gitignored but still on disk. Nothing may delete them.
- **The build is by reference-walking, not an ignore list.** A file nothing
  links to cannot ship; a file something links to cannot be forgotten. This
  already caught a tour shipping silent — photographs and audio use the same
  `file:` key under two different base directories.
- **`knowledge.js` nulls are load-bearing.** 21 facts are `null` on purpose;
  the bot defers to a human rather than inventing a number, and a test asserts
  it emits no figure while rates are unset. Set a value and the answer turns
  on by itself. Do not "fill them in" with guesses.
- **Do not add JPEGs.** New imagery comes from `media/images/` or gets
  converted first.
- **`data/` is real people's data.** Gitignored, never committed, backed up by
  nobody but you.
- **Node 22.13+.** Below that `node:sqlite` needs `--experimental-sqlite` and
  the API will not start.

---

## Open, needing information nobody has yet

- **Netlify Forms** — the form is wired (`data-netlify`), but nobody has
  confirmed a submission lands. Check Site configuration → Forms, submit once,
  set a notification email.
- **The API is localhost-only.** Hosting it means choosing somewhere that can
  run Node and keep a file — Fly.io, Railway, or a small VPS — or moving the
  store to Turso (same SQL) and putting the routes in Netlify Functions. Until
  then the live form stays on Netlify Forms.
- **Nothing sends the letters.** The page promises one a week; Netlify only
  collects addresses. Needs a sender (Buttondown, Beehiiv). That is the first
  point where an API key exists, and therefore the first honest reason to add
  `netlify/functions/`.
- `knowledge.js` has 21 null facts awaiting real values.
- Instagram, Facebook, Privacy and Terms are placeholder links.
- `findingUs.html` has no journey time for Mopa airport; the map pin marks the
  village, not the gate.
- `subscribe.html` is reached from the four newsletter sections and the modal,
  but is not in the nav.

---

## What changed most recently

```
(this session)  Newsletter database: node:sqlite store, token-protected API
eb2e02b  Add HANDOVER.md
acd7f2c  Stop the newsletter preview from writing to what it previews
cdbd779  Show the newsletter modal after 3s
582b444  Make the newsletter modal testable, and lower its thresholds
d2a1a75  Make the newsletter prompt a centred modal, half photograph
2e36136  Move the newsletter to its own page, and prompt people toward it
8afa70f  Fix two build tests that asserted the developer's disk, not the build
ea06d2e  Run the hero crossfade only while it can be seen
506ca16  Fetch photographs when they are due, and re-encode the audio
```

Two performance problems were diagnosed and fixed. Deferred images were all
hydrated at once on window load — 24 requests and 2.88 MB on the home page, of
which one image was visible, and 1.65 MB of it was menu previews behind a shut
panel. Site-wide first-load image cost went from 14.46 MB to 0.20 MB. Audio
was 224/256 kbps stereo for ambience played at volume 0.24; mono 96 kbps saved
3.89 MB, and the pool track's fade was longer than the pause it accompanied.

The hero crossfade also ran forever, including off-screen and in background
tabs, with a fixed `backdrop-filter` element over it — a backdrop-filter above
animating content re-blurs every frame. That was the Windows-slower-than-iPad
report: cheap on Apple's compositor, expensive elsewhere.
