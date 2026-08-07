# Ikshaa

Marketing site for a heritage villa in Loutolim, South Goa. Ten pages, a
35-room scroll-driven villa tour, and an offline chat assistant.

No framework, no build tooling, no runtime dependencies. The only dev
dependency is Jest.

```bash
npm ci
npm start     # dev server on :3000
npm test      # 198 tests
npm run build # produces dist/
```

---

## Layout

```text
public/          source — everything the site is made of
dist/            build output; the ONLY directory that gets published
server.js        development server (see "Why a server" below)
build.js         produces dist/ by walking actual references
tests/           198 tests across delivery, the build, and the chat NLU
eval/            corpus the chat assistant is scored against
```

`public/` also holds `skeletons&Protos/` and `_archive/` — a separate project
and superseded scaffolding. Both are gitignored and neither ever ships.

---

## Why a server for a static site

`server.js` is not deployed. A static host replaces it and implements the same
behaviours in its own CDN. It exists because:

- **`file://` breaks real features.** The navbar's adaptive colour samples the
  photograph beneath it with `getImageData`, which throws `SecurityError` on a
  canvas tainted by a local image. Video seeking needs range requests. Neither
  works without HTTP.
- **The tests are a specification.** They describe what correct delivery looks
  like — HTML revalidates, media is immutable, `bytes=-500` means the *last*
  500 bytes, JPEGs are never compressed. `dist/_headers` expresses the same
  policy to the host, so local and production agree.

What it implements: conditional requests (ETag → 304), cache tiers, range
requests (206 / 416), Brotli and gzip for text only, and `Save-Data` adaptation
that swaps the 2.7 MB hero video for its 118 KB poster.

---

## Why a build step

`public/` is 244 MB. The site is 16.7 MB.

`build.js` walks what the code actually references and copies only that. It is
not an ignore list — a file nothing links to cannot ship by accident, and a
file something links to cannot be forgotten.

That distinction earned itself immediately. The villa tour declares its
photographs and its audio with the same `file:` key under two different base
directories; the first version prefixed both with the image path, built
cleanly, reported no errors, and produced a tour with no sound. `npm test` now
catches it.

---

## The chat assistant

`public/chat/` — TF-IDF and cosine matching over intent examples, with spell
correction, stemming and entity extraction. Deterministic, offline, no network
call, no API key.

**Every unverified fact in `knowledge.js` is `null` on purpose.** Rates,
check-in times, cancellation terms and the pet policy were placeholders in the
original and several contradicted the site. Null is load-bearing: the bot
defers to a human rather than inventing a number, and a test asserts it emits
no figure at all while rates are unset.

Set a value and the answer turns on by itself.

---

## Deploying

Publish `dist/`, never `public/`.

`netlify.toml` pins `publish = "dist"` and an explicit build command — without
it a host can fall back to `npm start`, launch the dev server, and hang the
deploy until it times out.

---

## Known gaps

- Instagram, Facebook, Privacy and Terms are placeholder links
- `findingUs.html` has no journey time for Mopa airport — the source predates it
- The map pin marks the village, not the gate; swap `q=` for coordinates
- `knowledge.js` has 21 null facts awaiting real values
