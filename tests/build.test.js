'use strict';

/* ============================================================================
 * Tests for the production build.
 *
 * These exist because of a bug this suite would have caught: the tour
 * declares its photographs and its audio with the same `file:` key under two
 * different base directories, and the first version prefixed both with the
 * image directory. dist/ built cleanly, reported no errors, and shipped a
 * villa tour with no sound.
 *
 * "It built" is not the same as "it works". The check that matters is that
 * every path the site asks for exists in the output.
 * ========================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'public');

const built = fs.existsSync(DIST);

/* Code is fingerprinted in dist — script.js is emitted as script.7f3a91c4.js.
   Tests refer to files by the name they have in public/, so they need a way
   to find the built one. */
function builtName(rel) {
  const dir = path.dirname(rel);
  const ext = path.extname(rel);
  const stem = path.basename(rel, ext);
  const here = path.join(DIST, dir);
  if (!fs.existsSync(here)) return null;
  const hit = fs.readdirSync(here).find(
    (f) => f === stem + ext || new RegExp('^' + stem + '\\.[0-9a-f]{8}' + ext.replace('.', '\\.') + '$').test(f)
  );
  return hit ? path.join(dir, hit).replace(/\\/g, '/') : null;
}

/* The build is not run here — it is slow, and CI runs it before the tests.
   Skipping loudly beats failing confusingly on a fresh clone. */
const describeIfBuilt = built ? describe : describe.skip;

describeIfBuilt('production build', () => {
  test('dist/ exists and holds the pages', () => {
    const pages = [
      'index.html', 'ourHeritage.html', 'gallery.html', 'guestBook.html',
      'exploreGoa.html', 'goanCuisine.html', 'findingUs.html',
      'stayWithUs.html', 'exploreIkshaa.html', 'subscribe.html',
    ];
    pages.forEach((p) => {
      expect(fs.existsSync(path.join(DIST, p))).toBe(true);
    });
  });

  test('every asset the pages reference is present', () => {
    // The real guard. Walks the built output the way a browser would and
    // asserts nothing 404s.
    const roots = 'media|imagesIkshaa|galleryImages|heritagePageImages|hamBurgerDropImages|gifs';
    const pattern = new RegExp('["\'(]\\.?/?((?:' + roots + ')/[^"\')\\s]+)', 'g');
    const missing = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(html|css|js)$/i.test(entry.name)) {
          continue;
        }
        const text = fs.readFileSync(full, 'utf8');
        let m;
        while ((m = pattern.exec(text)) !== null) {
          if (m[1].endsWith('/')) {
            continue; // a base directory, not a file
          }
          if (!fs.existsSync(path.join(DIST, m[1]))) {
            missing.push(path.relative(DIST, full) + ' -> ' + m[1]);
          }
        }
      }
    };
    walk(DIST);

    expect(missing).toEqual([]);
  });

  test('the villa tour ships its photographs AND its audio', () => {
    // The specific regression. Both come from `file:` keys under different
    // base directories, and one silently went missing.
    const tour = fs.readFileSync(path.join(DIST, builtName('exploreIkshaa.js')), 'utf8');

    const photos = [...tour.matchAll(/file: '([^']+\.(?:avif|webp))'/g)].map((m) => m[1]);
    expect(photos.length).toBeGreaterThan(30);
    photos.forEach((f) => {
      expect(fs.existsSync(path.join(DIST, 'media/images', f))).toBe(true);
    });

    const tracks = [...tour.matchAll(/file: '([^']+\.mp3)'/g)].map((m) => m[1]);
    expect(tracks.length).toBeGreaterThan(0);
    tracks.forEach((f) => {
      expect(fs.existsSync(path.join(DIST, 'media/music', f))).toBe(true);
    });
  });

  test('nothing that must never ship is in the output', () => {
    // 131MB of source project, a nested node_modules and a second
    // package.json — any of which can confuse a host's build detection.
    expect(fs.existsSync(path.join(DIST, 'skeletons&Protos'))).toBe(false);
    expect(fs.existsSync(path.join(DIST, '_archive'))).toBe(false);
    expect(fs.existsSync(path.join(DIST, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(DIST, 'package.json'))).toBe(false);
  });

  test('the chat brain ships, even though no page links to it', () => {
    /* nlu.js, knowledge.js and bot.js used to be <script> tags on every page.
       They are now fetched by chat.js at idle, so the only reference to them
       in the whole site is a list of strings inside that file.

       That is precisely the shape of the bug this suite was written for: the
       villa tour once shipped silent because its audio was referenced by a
       key the build did not walk. If a rename ever puts these outside the
       build's reach, the launcher would appear and then do nothing. */
    const chat = fs.readFileSync(path.join(DIST, builtName('chat/chat.js')), 'utf8');
    const referenced = [...chat.matchAll(/'(chat\/[A-Za-z0-9_.-]+\.js)'/g)].map((m) => m[1]);

    expect(referenced.length).toBeGreaterThanOrEqual(3);
    referenced.forEach((rel) => {
      expect(fs.existsSync(path.join(DIST, rel))).toBe(true);
    });
  });

  test('code is fingerprinted, and served immutable', () => {
    /* The point of the hash: a URL can never change meaning, so it is safe to
       cache for a year. Before this, code was max-age=3600 — every page view
       spent a conditional round-trip per file once the hour lapsed, and a
       deploy did not reach an open browser for up to an hour. */
    const code = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (/\.(js|css)$/.test(e.name)) code.push(e.name);
      }
    };
    walk(DIST);

    expect(code.length).toBeGreaterThan(0);
    code.forEach((name) => {
      expect(name).toMatch(/\.[0-9a-f]{8}\.(js|css)$/);
    });

    const headers = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
    expect(headers).toMatch(/\/\*\.js[\s\S]*?max-age=31536000, immutable/);
    expect(headers).toMatch(/\/\*\.css[\s\S]*?max-age=31536000, immutable/);
    // HTML must still revalidate, or a new deploy is never discovered at all.
    expect(headers).toMatch(/\/\*\.html[\s\S]*?no-cache/);
  });

  test('every reference in the built output resolves', () => {
    /* Fingerprinting rewrites references across files, and chat.js names its
       brain in a list of strings while bot.js requires its siblings
       relatively. Either form left unrewritten points at a file that no
       longer exists. */
    const broken = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(html|css|js)$/.test(e.name)) continue;

        const text = fs.readFileSync(full, 'utf8');
        const re = /["'(](?:\.\/)?((?:chat\/)?[A-Za-z0-9_.-]+\.(?:js|css))["')]/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const fromRoot = path.join(DIST, m[1]);
          const fromHere = path.join(path.dirname(full), m[1]);
          if (!fs.existsSync(fromRoot) && !fs.existsSync(fromHere)) {
            broken.push(path.relative(DIST, full) + ' -> ' + m[1]);
          }
        }
      }
    };
    walk(DIST);

    expect(broken).toEqual([]);
  });

  test('the newsletter posts somewhere real', () => {
    /* Four pages shipped with action="#", which silently discards whatever
       is typed into it. The address is now collected on one page, and that
       page has to be wired to the host's form handling for it to land. */
    const page = fs.readFileSync(path.join(DIST, 'subscribe.html'), 'utf8');
    expect(page).toMatch(/data-netlify="true"/);
    // Without the hidden form-name the host cannot tell which form posted.
    expect(page).toMatch(/name="form-name"/);

    // And nothing anywhere still submits into the void.
    const dead = fs.readdirSync(DIST)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => /<form[^>]*action="#"/.test(
        fs.readFileSync(path.join(DIST, f), 'utf8')
      ));
    expect(dead).toEqual([]);
  });

  test('the build carries cache headers for the host', () => {
    const headers = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
    // Same policy the dev server implements, so local and production agree.
    expect(headers).toMatch(/\/\*\.html[\s\S]*?Cache-Control: no-cache/);
    expect(headers).toMatch(/immutable/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
  });

  test('the build is a copy — everything in dist is still in public', () => {
    /* The invariant is that build.js copies rather than moves.
     *
     * This used to assert that public/skeletons&Protos existed, which tested
     * the machine rather than the build: that directory is gitignored on
     * purpose, so it is absent from a fresh clone and CI failed on a file the
     * project deliberately excludes. Walking dist/ back to public/ tests the
     * real property, and it holds wherever the checkout came from.
     */
    const GENERATED = new Set(['_headers']); // written by build.js, never copied
    const orphaned = [];

    /* Code is emitted under a content-hashed name, so dist/script.7f3a91c4.js
       has no counterpart in public/. Strip the hash back off before looking:
       the invariant being tested is that build.js COPIES rather than moves,
       and renaming the copy does not change that. */
    const unhash = (rel) => rel.replace(/\.[0-9a-f]{8}(\.(?:js|css))$/, '$1');

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        const rel = path.relative(DIST, full);
        if (GENERATED.has(rel)) {
          continue;
        }
        if (!fs.existsSync(path.join(SRC, unhash(rel)))) {
          orphaned.push(rel);
        }
      }
    };
    walk(DIST);

    expect(orphaned).toEqual([]);
  });

  test('the site stays inside its size budget', () => {
    /* Replaces a ratio against public/, which was unpassable on CI: locally
     * public/ is ~244MB of masters and prototypes, but almost all of that is
     * gitignored, so in a fresh clone public/ is ~16.6MB and dist/ is ~16.7MB
     * — dist is fractionally LARGER, because of the generated _headers. The
     * old assertion demanded dist be under a quarter of public/.
     *
     * A fixed budget states the thing that was actually meant: if something
     * unreferenced gets pulled in, or the media grows without anyone looking,
     * this fails. It is a ceiling, not a target — at the time of writing the
     * build is ~16.7MB, so there is headroom for a few more photographs but
     * not for an un-transcoded video or a folder copied in wholesale.
     */
    const BUDGET_MB = 22;

    const size = (dir) => {
      let total = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        total += e.isDirectory() ? size(full) : fs.statSync(full).size;
      }
      return total;
    };

    const mb = size(DIST) / 1048576;
    expect(mb).toBeLessThan(BUDGET_MB);
  });
});
