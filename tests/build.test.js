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

/* The build is not run here — it is slow, and CI runs it before the tests.
   Skipping loudly beats failing confusingly on a fresh clone. */
const describeIfBuilt = built ? describe : describe.skip;

describeIfBuilt('production build', () => {
  test('dist/ exists and holds the pages', () => {
    const pages = [
      'index.html', 'ourHeritage.html', 'gallery.html', 'guestBook.html',
      'exploreGoa.html', 'goanCuisine.html', 'findingUs.html',
      'stayWithUs.html', 'exploreIkshaa.html',
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
    const tour = fs.readFileSync(path.join(DIST, 'exploreIkshaa.js'), 'utf8');

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

  test('the build carries cache headers for the host', () => {
    const headers = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
    // Same policy the dev server implements, so local and production agree.
    expect(headers).toMatch(/\/\*\.html[\s\S]*?Cache-Control: no-cache/);
    expect(headers).toMatch(/immutable/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
  });

  test('the build is a copy — public/ is left intact', () => {
    // Nothing is moved or deleted out of the source tree.
    expect(fs.existsSync(path.join(SRC, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(SRC, 'skeletons&Protos'))).toBe(true);
  });

  test('dist is a small fraction of public', () => {
    const size = (dir) => {
      let total = 0;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        total += e.isDirectory() ? size(full) : fs.statSync(full).size;
      }
      return total;
    };
    // public/ is ~244MB; the site is ~20MB. If this ever inverts, something
    // unreferenced has been pulled in.
    expect(size(DIST)).toBeLessThan(size(SRC) / 4);
  });
});
