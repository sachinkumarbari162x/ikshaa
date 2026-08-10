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
    /* Four pages once shipped with action="#", which silently discards
       whatever is typed into it. The address is now collected on one page,
       and that page has to reach something that stores it.

       This test used to assert `data-netlify="true"`, and that is precisely
       how the bug it was written to catch came back. The attribute is a
       Netlify instruction; the site moved to Cloudflare Pages, where a POST
       to a static file is a 405. The form kept the attribute, the test kept
       passing, and the live page told people to check their inbox while
       throwing the address away.

       So the assertion is now on the thing that actually does the work: the
       script has an API origin to post to. */
    const scripts = fs.readdirSync(DIST).filter((f) => /^script\.[a-z0-9]+\.js$/.test(f));
    expect(scripts).toHaveLength(1);

    const code = fs.readFileSync(path.join(DIST, scripts[0]), 'utf8');
    const api = /NEWSLETTER_API\s*=\s*'([^']*)'/.exec(code);
    expect(api).not.toBeNull();
    expect(api[1]).toMatch(/^https:\/\/\S+$/);   // empty means the form goes nowhere

    // And nothing anywhere still submits into the void.
    const dead = fs.readdirSync(DIST)
      .filter((f) => f.endsWith('.html'))
      .filter((f) => /<form[^>]*action="#"/.test(
        fs.readFileSync(path.join(DIST, f), 'utf8')
      ));
    expect(dead).toEqual([]);
  });

  test('every page carries the footer and the subscribe card', () => {
    /* Four of the eight pages shipped without either. A visitor who landed on
       the gallery or the guest book had no contact details, no links onward
       and no way to subscribe — the page simply stopped.

       Two exemptions, both deliberate:

       subscribe.html IS the form, and a card linking to the page you are
       already on is noise.

       exploreIkshaa.html is the full-screen villa tour. It carries no navbar
       either — its own comment says a full one "would undo the point of a
       full-screen walk" — and it has no <main> to put a footer in. The way
       out is the single back-link in the corner, which is the design. */
    /* 404.html joins them: an error page offering a newsletter signup is
       the wrong thing to put in front of somebody who has just hit a dead
       link, and its whole job is to be short. */
    /* for-carman.html is an unlisted note to the owner, not part of the
       site: no nav, no footer, no signup, noindex, absent from the sitemap. */
    const exempt = new Set(['subscribe.html', 'exploreIkshaa.html', '404.html', 'for-carman.html']);
    const missing = [];

    for (const file of fs.readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
      if (exempt.has(file)) { continue; }
      const page = fs.readFileSync(path.join(DIST, file), 'utf8');
      const gaps = [];
      if (!/<footer class="footer"/.test(page)) { gaps.push('footer'); }
      if (!/id="subscribe"/.test(page)) { gaps.push('subscribe card'); }
      if (gaps.length) { missing.push(file + ' (' + gaps.join(', ') + ')'); }
    }

    expect(missing).toEqual([]);
  });

  test('every shipped webp ships its avif sibling too', () => {
    /* script.js rewrites `.webp` to `.avif` at runtime whenever the browser
       passes a decode probe. That URL is built in the browser, so the build's
       reference walk — an allow-list — could not see it, and shipped the WebP
       alone. Chrome and Edge then requested an AVIF that was not there and
       rendered nothing, while Safari 15 kept the WebP and looked correct.

       Twenty images were affected, ten of them in the nav dropdown, and the
       failure was invisible to anyone testing on the older browser. */
    const orphans = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.webp$/i.test(entry.name)) {
          continue;
        }
        const rel = path.relative(DIST, full);
        // Only where a sibling exists to ship — nothing here converts images.
        if (fs.existsSync(path.join(SRC, rel).replace(/\.webp$/i, '.avif')) &&
            !fs.existsSync(full.replace(/\.webp$/i, '.avif'))) {
          orphans.push(rel.split(path.sep).join('/'));
        }
      }
    };
    walk(DIST);

    expect(orphans).toEqual([]);
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
    /* Written by build.js rather than copied from public/.
     *
     * Named individually on purpose. The invariant this test protects is
     * that the build COPIES — so a file appearing in dist/ with no source
     * must be one we deliberately generate, and anything else is a bug worth
     * failing on. A blanket exemption would have let the next stray file
     * through unnoticed. */
    const GENERATED = new Set([
      '_headers',
      'faq.html',                 // assembled from knowledge.js at build time
      'robots.txt', 'sitemap.xml', 'llms.txt',
    ]);
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

/* ---------------------------------------------------------------------
 * What the site tells search engines and answer engines
 * ------------------------------------------------------------------ */
describeIfBuilt('discoverability', () => {
  const pages = () => fs.readdirSync(DIST).filter((f) => f.endsWith('.html'));
  const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');

  it('gives every page a canonical, a description and Open Graph tags', () => {
    const gaps = [];
    for (const file of pages()) {
      // 404.html is noindex on purpose — a canonical would invite the
      // indexing the page exists to prevent.
      if (file === '404.html' || file === 'for-carman.html') { continue; }
      const html = read(file);
      const missing = [];
      if (!/rel="canonical"/.test(html)) { missing.push('canonical'); }
      if (!/<meta name="description"/.test(html)) { missing.push('description'); }
      if (!/property="og:title"/.test(html)) { missing.push('og:title'); }
      if (!/property="og:image"/.test(html)) { missing.push('og:image'); }
      if (missing.length) { gaps.push(file + ': ' + missing.join(', ')); }
    }
    expect(gaps).toEqual([]);
  });

  it('never repeats a description across two pages', () => {
    /* Duplicate descriptions are the commonest own goal here: Google picks
       its own snippet instead, and an answer engine gets the same sentence
       about ten different pages. */
    const seen = new Map();
    for (const file of pages()) {
      const found = /<meta name="description" content="([^"]+)"/.exec(read(file));
      if (!found) { continue; }
      const dupe = seen.get(found[1]);
      expect(dupe ? dupe + ' and ' + file : null).toBeNull();
      seen.set(found[1], file);
    }
  });

  it('declares canonicals that the sitemap actually lists', () => {
    /* The invariant that matters. A canonical pointing at a URL the sitemap
       does not contain is a site arguing with itself, and it is exactly what
       happens when the two are maintained by hand. */
    const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
    const listed = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

    const orphans = [];
    for (const file of pages()) {
      const found = /rel="canonical" href="([^"]+)"/.exec(read(file));
      if (found && !listed.has(found[1])) { orphans.push(file + ' -> ' + found[1]); }
    }
    expect(orphans).toEqual([]);
  });

  it('points canonicals at the URL the host redirects to', () => {
    /* Both hosts strip .html and 308 to the extensionless URL. A canonical
       ending in .html therefore names a URL that immediately redirects,
       which wastes the crawl and splits the signal between two addresses. */
    const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
    expect(sitemap).not.toMatch(/\.html<\/loc>/);

    for (const file of pages()) {
      const found = /rel="canonical" href="([^"]+)"/.exec(read(file));
      if (found) { expect(found[1]).not.toMatch(/\.html$/); }
    }
  });

  it('ships structured data that parses', () => {
    /* Malformed JSON-LD is worse than none: the crawler drops it silently,
       so the page looks fine and simply carries no structured data. */
    let blocks = 0;
    for (const file of pages()) {
      for (const m of read(file).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const parsed = JSON.parse(m[1]);          // throws on malformed
        expect(parsed['@context']).toBe('https://schema.org');
        expect(typeof parsed['@type']).toBe('string');
        blocks++;
      }
    }
    expect(blocks).toBeGreaterThanOrEqual(2);     // LodgingBusiness + FAQPage
  });

  it('never puts a null fact into structured data', () => {
    /* 24 facts are null on purpose so the bot defers rather than inventing.
       Structured data states things with more authority than prose does, so
       a guess here would be the worst place to make one. */
    const home = read('index.html');
    const schema = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)[1]);
    const flat = JSON.stringify(schema);

    expect(flat).not.toMatch(/null/);
    expect(schema).not.toHaveProperty('priceRange');
    expect(schema).not.toHaveProperty('petsAllowed');

    /* checkinTime USED to be here, asserting its absence while the fact was
       null. The owner has since verified the listing, so it is known and
       stating it is now the correct behaviour — the rule was never "omit
       these fields", it was "omit what we cannot stand behind". */
    expect(schema.checkinTime).toBe('14:00');
    expect(schema.checkoutTime).toBe('11:00');
  });

  it('welcomes the AI crawlers by name and refuses the harvesters', () => {
    const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');

    for (const agent of ['GPTBot', 'ClaudeBot', 'OAI-SearchBot', 'PerplexityBot',
      'Googlebot', 'Bingbot', 'Google-Extended']) {
      expect(robots).toMatch(new RegExp('User-agent: ' + agent + '\s*\nAllow: /'));
    }
    for (const agent of ['AhrefsBot', 'SemrushBot', 'Bytespider']) {
      expect(robots).toMatch(new RegExp('User-agent: ' + agent));
    }
    expect(robots).toMatch(/Disallow: \/api\//);
    expect(robots).toMatch(/Sitemap: https:\/\/\S+\/sitemap\.xml/);
  });

  it('tells an assistant which facts it must not invent', () => {
    /* The point of llms.txt here is not the links. It is this list: an
       assistant that guesses a nightly rate, or answers the camera question,
       does real harm to somebody planning around it. */
    const llms = fs.readFileSync(path.join(DIST, 'llms.txt'), 'utf8');
    expect(llms).toMatch(/do not state these as fact/i);
    for (const topic of ['rates', 'Check-in', 'cancellation', 'cameras', 'Accessibility']) {
      expect(llms).toMatch(new RegExp(topic, 'i'));
    }
  });

  it('answers the FAQ instead of deferring on it', () => {
    /* "Ask the owner" is a true answer in a chat window and a wasted slot in
       a search result. Every published Q&A has to actually answer. */
    const faq = read('faq.html');
    const schema = JSON.parse(
      [...faq.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map((m) => m[1]).find((s) => s.includes('FAQPage'))
    );

    expect(schema.mainEntity.length).toBeGreaterThanOrEqual(12);
    for (const entry of schema.mainEntity) {
      expect(entry.acceptedAnswer.text).not.toMatch(/owner can confirm|rather not guess/);
      // The chat's first person does not belong on a page.
      expect(entry.acceptedAnswer.text).not.toMatch(/\bI (do not|am not|cannot)\b/);
    }
  });
});

/* ---------------------------------------------------------------------
 * The hero paints without waiting for JavaScript
 * ------------------------------------------------------------------ */
describeIfBuilt('first paint', () => {
  it('ships the opening slide already visible', () => {
    /* Every .slide is opacity:0 with a 1000ms fade, and only JS adds
       .isVisible. With the first slide left to that, the hero stayed blank
       until script.js had downloaded, parsed and run — and then took a
       further second to fade in. That is a second of LCP handed away on
       every single visit, and it looked like a broken page.

       showNext() adds the class the first slide already has, so this costs
       the slideshow nothing. */
    const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const slides = [...home.matchAll(/class="(slide[^"]*)"/g)].map((m) => m[1]);

    expect(slides.length).toBeGreaterThan(1);
    expect(slides[0]).toContain('isVisible');
    // Exactly one, or two would crossfade against each other on load.
    expect(slides.filter((c) => c.includes('isVisible'))).toHaveLength(1);
  });

  it('preloads the format the page will actually render', () => {
    /* Eight pages preloaded the .webp while <picture> rendered the .avif:
       the browser fetched one at high priority, discarded it, then fetched
       the other with none. */
    const mismatched = [];
    for (const file of fs.readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(DIST, file), 'utf8');
      const preload = /rel="preload" as="image"[^>]*href="([^"]+)"/.exec(html);
      const picks = /<picture><source srcset="([^"]+\.avif)"/.exec(html);
      if (preload && picks && preload[1] !== picks[1]) {
        mismatched.push(file + ': preloads ' + preload[1] + ' but renders ' + picks[1]);
      }
      // A preload naming an AVIF must carry type=, or a browser that cannot
      // decode it downloads a file it can never show.
      if (preload && /\.avif$/.test(preload[1])) {
        expect(html).toMatch(/rel="preload" as="image" type="image\/avif"/);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('loads no third-party stylesheet before first paint', () => {
    // Google Fonts cost ~320ms of render-blocking time and then chained to a
    // second origin for the files themselves.
    for (const file of fs.readdirSync(DIST).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(DIST, file), 'utf8');
      expect(html).not.toMatch(/<link[^>]*fonts\.googleapis\.com/);
      expect(html).not.toMatch(/<link[^>]*rel="preconnect"[^>]*gstatic/);
    }
  });
});

describeIfBuilt('the hero can actually be observed', () => {
  it('keeps every slide inside the container the observer watches', () => {
    /* The slideshow pauses itself when the hero scrolls away, via an
       IntersectionObserver. It used to observe slides[0].parentElement, which
       WAS the container until the photographs were wrapped in <picture> for
       the AVIF fallback — and `picture { display: contents }` means that
       wrapper generates no box, so the observer measured 0x0, reported
       isIntersecting false, and froze the slideshow on its first slide.

       script.js now walks up with closest('.baseContainer, .pageHero'). This
       asserts the markup that makes that work: every slide has one of those
       above it, and it is not the <picture>. */
    const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

    const container = /<div class="baseContainer"[^>]*>([\s\S]*?)<\/div>/.exec(home);
    expect(container).not.toBeNull();

    // Every slide on the page sits inside it — none stranded outside.
    const inside = (container[1].match(/class="slide[^"]*"/g) || []).length;
    const total = (home.match(/class="slide[^"]*"/g) || []).length;
    expect(total).toBeGreaterThan(1);
    expect(inside).toBe(total);
  });

  it('gives every slide a caption to pair with', () => {
    // showNext() pairs them BY POSITION, so a short list silently leaves the
    // previous caption up under a new photograph.
    const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
    const slides = (home.match(/class="slide[^"]*"/g) || []).length;
    /* The optional-space group matters: `heroCaptions` is the CONTAINER, and
       a looser pattern counts it as a fourteenth caption. querySelectorAll
       matches class tokens exactly, so the browser never made that mistake —
       only this test did. */
    const captions = (home.match(/class="heroCaption(?: [^"]*)?"/g) || []).length;
    expect(captions).toBe(slides);
  });
});
