'use strict';

/* ============================================================================
 * BUILD — produces `dist/`, the only directory that should ever be published.
 *
 * Nothing outside dist/ is touched. Source files in public/ are copied, never
 * moved or deleted, so the working tree is exactly as it was afterwards.
 *
 * It exists because `public/` is not safe to publish as-is:
 *
 *   - public/skeletons&Protos/  131 MB, including its own node_modules and a
 *                               second package.json that can confuse a host's
 *                               build detection
 *   - public/_archive/          superseded scaffolding
 *   - ~96 MB of media that no page references — masters, unused music, reels
 *
 * Rather than maintaining an ignore list, this walks the actual references and
 * copies only what is reachable. A file nobody links to cannot ship by
 * accident, and a file someone links to cannot be forgotten.
 *
 * Zero dependencies, like the server.
 * ========================================================================= */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

/* Directories inside public/ that are never reachable and never shipped.
   Listed for the report; the reference walk would exclude them anyway. */
const NEVER_SHIP = ['skeletons&Protos', '_archive'];

/* Entry points. Everything else is discovered from what these reference. */
const CODE_EXT = new Set(['.html', '.css', '.js']);

const ASSET_ROOTS = [
  'media', 'imagesIkshaa', 'galleryImages',
  'heritagePageImages', 'hamBurgerDropImages', 'gifs',
];

function listCode(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = path.join(base, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (NEVER_SHIP.includes(entry.name) || ASSET_ROOTS.includes(entry.name)) {
        continue;
      }
      out.push(...listCode(dir, rel));
    } else if (CODE_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(rel);
    }
  }
  return out;
}

/* Which assets are actually referenced.
   Two passes, because not every path exists as a literal string: the villa
   tour builds its image URLs as IMG_DIR + filename at runtime, so scanning
   for "media/..." alone would report all 35 photographs as unused and
   silently drop them from the build. */
function findAssets(codeFiles) {
  const used = new Set();
  const literal = new RegExp(
    '["\'(]\\.?/?((?:' + ASSET_ROOTS.join('|') + ')/[^"\')\\s]+)', 'g'
  );

  for (const rel of codeFiles) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    let m;
    while ((m = literal.exec(text)) !== null) {
      // A trailing slash means the match was a DIRECTORY, not a file — the
      // tour declares `IMG_DIR: './media/images/'`, which looks exactly like
      // an asset path to this regex. Copying it would throw EPERM.
      if (!m[1].endsWith('/')) {
        used.add(m[1]);
      }
    }
  }

  /* The tour's assembled paths.

     It has TWO base directories — IMG_DIR for photographs, AUDIO.DIR for
     the two sound files — and both declare their filenames with the same
     `file:` key. Prefixing every match with IMG_DIR put the audio under
     media/images/, so the real tracks were never copied and the tour would
     have shipped silent. Each base only takes the extensions it owns. */
  const tourPath = path.join(SRC, 'exploreIkshaa.js');
  if (fs.existsSync(tourPath)) {
    const tour = fs.readFileSync(tourPath, 'utf8');
    const bases = [
      { dir: /IMG_DIR:\s*'([^']+)'/, ext: /\.(avif|webp|jpe?g|png)$/i },
      { dir: /DIR:\s*'(\.\/media\/music\/)'/, ext: /\.(mp3|m4a|ogg|wav)$/i },
    ];

    for (const base of bases) {
      const found = base.dir.exec(tour);
      if (!found) {
        continue;
      }
      const dir = found[1].replace(/^\.\//, '');
      for (const f of tour.matchAll(/file: '([^']+)'/g)) {
        if (base.ext.test(f[1])) {
          used.add(dir + f[1]);
        }
      }
    }
  }

  /* The AVIF siblings nothing references in writing.
   *
   * `bestFormat()` in script.js swaps `.webp` for `.avif` at runtime once a
   * 2x2 probe confirms the browser can decode it. That URL is assembled in
   * the browser, so it appears in no file for the walk above to find — and
   * the walk is an allow-list, so what it does not find does not ship.
   *
   * The result was invisible photographs on exactly the browsers that
   * support the better format: Chrome and Edge asked for the AVIF, got a
   * 404, and rendered nothing, while Safari 15 kept the WebP and looked
   * fine. Twenty images, including ten of the twelve in the nav dropdown.
   *
   * Pairing them here keeps the rewrite rule and the build in step: ship the
   * AVIF wherever a shipped WebP has one, and the runtime swap can never
   * reach for a file that is not there. */
  for (const rel of [...used]) {
    if (!/\.webp$/i.test(rel)) {
      continue;
    }
    const sibling = rel.replace(/\.webp$/i, '.avif');
    if (fs.existsSync(path.join(SRC, sibling))) {
      used.add(sibling);
    }
  }

  return used;
}

/* ---------------------------------------------------------------------
 * Fingerprinting: script.js becomes script.7f3a91c4.js
 *
 * The problem this solves is that code changed without its name changing, so
 * the only safe policy was "revalidate hourly". That cost a conditional
 * round-trip per file on every page view once the hour lapsed, and — worse —
 * meant a deploy did not reach an already-open browser for up to an hour.
 *
 * With the content in the name, the two failure modes disappear together:
 * a file that has not changed keeps its URL and is served from disk cache
 * with no request at all, and a file that HAS changed has a new URL, so it
 * is fetched immediately however old the cache is. Both properties are what
 * `_headers` already claims for media: "referenced by name; a new photo is a
 * new filename". This makes it true of code as well.
 *
 * Order is the only subtlety. chat.js names nlu.js, knowledge.js and bot.js
 * in a list of strings, so those have to be renamed before chat.js is
 * hashed, or chat.js would be hashed over stale references and the browser
 * would cache a file pointing at URLs that no longer exist. The loop below
 * takes leaves first and works inward, which handles that without anyone
 * having to declare the graph by hand.
 * ------------------------------------------------------------------ */

const HASH_EXT = new Set(['.css', '.js']);

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}

// Only rewrite a path that appears as a reference — quoted, or inside url().
// A bare substring match would happily corrupt prose that mentions a filename.
function rewriteRefs(text, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp('(["\'(])(\\./)?' + escaped + '(["\')])', 'g'),
    (m, open, dot, close) => open + (dot || '') + to + close);
}

function fingerprint(codeFiles) {
  const pending = new Set(codeFiles.filter((f) => HASH_EXT.has(path.extname(f))));
  const all = () => codeFiles.map((f) => path.join(OUT, f));
  const renamed = new Map();

  while (pending.size > 0) {
    // A leaf is a file that no longer names any file still waiting to be
    // renamed. There is always at least one unless the graph has a cycle.
    const leaf = [...pending].find((rel) => {
      const text = fs.readFileSync(path.join(OUT, rel), 'utf8');
      return ![...pending].some((other) => other !== rel && text.includes(other));
    });

    if (!leaf) {
      // A cycle between two stylesheets or scripts. Bail loudly rather than
      // ship half-rewritten references.
      throw new Error('circular references among: ' + [...pending].join(', '));
    }
    pending.delete(leaf);

    const full = path.join(OUT, leaf);
    const ext = path.extname(leaf);
    const hashed = leaf.slice(0, -ext.length) + '.' + digest(fs.readFileSync(full)) + ext;

    fs.renameSync(full, path.join(OUT, hashed));
    renamed.set(leaf, hashed);

    // Point every other file at the new name. Basename too, because HTML
    // refers to chat/chat.js as "chat/chat.js" but chat.js refers to its
    // siblings the same way — the paths are already root-relative, so one
    // pass over the full rel covers both.
    for (const file of all()) {
      const here = renamed.get(path.relative(OUT, file).replace(/\\/g, '/'));
      const onDisk = here ? path.join(OUT, here) : file;
      if (!fs.existsSync(onDisk)) continue;
      if (!CODE_EXT.has(path.extname(onDisk))) continue;

      const before = fs.readFileSync(onDisk, 'utf8');
      let after = rewriteRefs(before, leaf, hashed);

      /* The same file gets referred to two ways. chat.js names its siblings
         root-relatively ("chat/nlu.js") because the page is at the root; but
         bot.js, sitting beside them, uses require('./nlu.js'). Only the first
         form matches `leaf`, so the second is rewritten here — otherwise dist
         ends up with a require pointing at a name that no longer exists.
         Harmless in a browser, which never takes that branch, but it is the
         kind of loose end that reads as a bug later. */
      if (path.dirname(leaf) === path.dirname(path.relative(OUT, onDisk).replace(/\\/g, '/'))) {
        after = rewriteRefs(after, path.basename(leaf), path.basename(hashed));
      }

      if (after !== before) fs.writeFileSync(onDisk, after);
    }
  }

  return renamed;
}

function copy(rel) {
  const from = path.join(SRC, rel);
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(from).size;
}

/* Cache tiers, in the format both Netlify and Cloudflare Pages read.
   Same policy the dev server implements, so local and production agree:
   HTML revalidates or a deploy never reaches anyone; media is content that
   only changes by changing its name, so it is held for a year. */
const HEADERS = `# Generated by build.js — edit there, not here.

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN

# HTML must revalidate, or a deploy never reaches anyone
/*.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

# Code carries its content hash in its name (script.7f3a91c4.js), so a given
# URL can never change meaning. Unchanged files cost no request at all, and a
# changed file arrives immediately however stale the cache is — which is the
# whole reason the hash exists. This used to be max-age=3600, which meant a
# deploy took up to an hour to reach an open browser.
/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable

# Media is referenced by name; a new photo is a new filename
/media/*
  Cache-Control: public, max-age=31536000, immutable

/imagesIkshaa/*
  Cache-Control: public, max-age=31536000, immutable

/galleryImages/*
  Cache-Control: public, max-age=31536000, immutable

/heritagePageImages/*
  Cache-Control: public, max-age=31536000, immutable

/hamBurgerDropImages/*
  Cache-Control: public, max-age=31536000, immutable

/gifs/*
  Cache-Control: public, max-age=31536000, immutable
`;

const NETLIFY = `# Generated by build.js — edit there, not here.

[build]
  publish = "dist"
  # Explicit, so the host cannot fall back to \`npm start\` and launch the
  # dev server, which would hang the deploy until it timed out.
  command = "npm run build"

[build.environment]
  NODE_VERSION = "20"
`;

/* What actually ended up in dist/, rather than what the copy loop believes it
   put there. The two disagree the moment anything is generated. */
function walkOut(dir, each) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkOut(full, each); } else { each(full); }
  }
}

function countFiles(dir) {
  let n = 0;
  walkOut(dir, () => { n++; });
  return n;
}

function dirBytes(dir) {
  let bytes = 0;
  walkOut(dir, (f) => { bytes += fs.statSync(f).size; });
  return bytes;
}

function main() {
  // dist/ is this script's own output. Nothing in public/ is ever removed.
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  const code = listCode(SRC);
  const wanted = findAssets(code);

  let codeBytes = 0;
  for (const rel of code) {
    codeBytes += copy(rel);
  }

  let assetBytes = 0;
  const missing = [];
  for (const rel of wanted) {
    const from = path.join(SRC, rel);
    if (!fs.existsSync(from)) {
      missing.push(rel);
      continue;
    }
    // Belt and braces: a directory reaching here would throw, not warn.
    if (fs.statSync(from).isDirectory()) {
      continue;
    }
    assetBytes += copy(rel);
  }

  /* After copying, before writing headers: the header file describes what
     the fingerprinted output looks like. */
  const fingerprinted = fingerprint(code);

  fs.writeFileSync(path.join(OUT, '_headers'), HEADERS);
  fs.writeFileSync(path.join(ROOT, 'netlify.toml'), NETLIFY);

  /* ---- what search engines and answer engines are told ----------------
   *
   * Generated here, after fingerprinting, from one table in seo.js. The
   * canonical URL, the sitemap entry and the og:url are the same fact three
   * times; produced together they cannot contradict each other, and
   * contradicting each other is the usual way this goes wrong. */
  const seo = require('./seo.js');
  const Bot = require('./public/chat/bot.js');

  const faq = seo.faqEntries(new Bot());
  const pages = fs.readdirSync(OUT).filter((f) => f.endsWith('.html'));

  /* The FAQ page is built from a real one so it inherits the navbar, footer
     and chat widget exactly. findingUs is the shell because it is the
     simplest page with the full chrome. */
  const shell = fs.readFileSync(path.join(OUT, 'findingUs.html'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'faq.html'), seo.faqPage(shell, faq));
  pages.push('faq.html');

  let tagged = 0;
  for (const file of pages) {
    const at = path.join(OUT, file);
    const before = fs.readFileSync(at, 'utf8');
    const extra = file === 'faq.html' ? seo.faqSchema(faq) : null;
    const after = seo.linkFaq(seo.injectHead(before, file, extra));
    if (after !== before) {
      fs.writeFileSync(at, after);
      tagged++;
    }
  }

  /* ---- the captcha, only if it has been set up -----------------------
   *
   * The site key is public, but it is per-account, so it cannot live in the
   * repository as a working value. With TURNSTILE_SITE_KEY set the widget
   * ships; without it, the widget and its script are STRIPPED rather than
   * shipped pointing at a placeholder.
   *
   * That matters: a Turnstile widget with an invalid key renders an error and
   * issues no token, so the form would refuse every genuine subscriber. A
   * form that quietly works without a captcha is a smaller problem than a
   * form nobody can use, and the warning below makes sure it is not
   * mistaken for a working one. */
  const subscribeAt = path.join(OUT, 'subscribe.html');
  if (fs.existsSync(subscribeAt)) {
    let page = fs.readFileSync(subscribeAt, 'utf8');
    const siteKey = process.env.TURNSTILE_SITE_KEY;

    if (siteKey) {
      page = page.replace(/TURNSTILE_SITE_KEY/g, siteKey);
    } else {
      page = page
        .replace(/\n\s*<script src="https:\/\/challenges\.cloudflare\.com[^>]*><\/script>/, '')
        .replace(/\n\s*<div class="field fieldCaptcha">[\s\S]*?<\/div>\n\s*<\/div>/, '');
      process.stdout.write(
        '\n    ! TURNSTILE_SITE_KEY is unset — the subscribe form ships WITHOUT a captcha.\n' +
        '      Set it and rebuild to turn the challenge on.\n'
      );
    }
    fs.writeFileSync(subscribeAt, page);
  }

  fs.writeFileSync(path.join(OUT, 'robots.txt'), seo.robotsTxt());
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), seo.sitemapXml(pages));
  fs.writeFileSync(path.join(OUT, 'llms.txt'), seo.llmsTxt(faq));

  // What was left behind, so the exclusion is visible rather than implied
  let skipped = 0;
  let skippedBytes = 0;
  for (const root of ASSET_ROOTS.concat(NEVER_SHIP)) {
    const dir = path.join(SRC, root);
    if (!fs.existsSync(dir)) {
      continue;
    }
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          const rel = path.relative(SRC, full).replace(/\\/g, '/');
          if (!wanted.has(rel)) {
            skipped++;
            skippedBytes += fs.statSync(full).size;
          }
        }
      }
    };
    walk(dir);
  }

  const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
  process.stdout.write(
    '\n  built dist/\n' +
    '    code       ' + String(code.length).padStart(4) + ' files  ' + mb(codeBytes) + '\n' +
    '    media      ' + String(wanted.size - missing.length).padStart(4) + ' files  ' + mb(assetBytes) + '\n' +
    '    ----------------------------------\n' +
    /* Counted off disk, not summed from the copy loop. Six files are WRITTEN
       rather than copied — _headers, robots.txt, sitemap.xml, llms.txt,
       faq.html — so a total built from the loop counters silently understated
       the build by everything generated after it. */
    '    published  ' + String(countFiles(OUT)).padStart(4) + ' files  ' + mb(dirBytes(OUT)) + '\n\n' +
    '    left in public/, not published: ' + skipped + ' files, ' + mb(skippedBytes) + '\n'
  );

  if (missing.length) {
    process.stdout.write('\n  REFERENCED BUT MISSING (these will 404):\n');
    missing.forEach((m) => process.stdout.write('    ' + m + '\n'));
    process.exitCode = 1;
  }
  process.stdout.write('\n');
}

if (require.main === module) {
  main();
}

module.exports = { listCode, findAssets, fingerprint, rewriteRefs, SRC, OUT };
