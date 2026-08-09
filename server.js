'use strict';

/* ============================================================================
 * IKSHAA — STATIC SERVER
 *
 * Zero runtime dependencies: Node's own http, fs and zlib. Nothing to
 * install, nothing to keep patched.
 *
 * The delivery behaviours here are the ones that actually matter on a slow
 * or distant link — the same set a streaming service leans on, minus the
 * parts that only make sense for audio catalogues:
 *
 *   1. CONDITIONAL REQUESTS  — strong ETags and 304s, so a repeat visit
 *      transfers headers and nothing else.
 *   2. CACHE TIERS           — immutable, year-long caching for media that
 *      never changes under its own name; short revalidation for HTML.
 *   3. RANGE REQUESTS        — 206 Partial Content for video and audio, so
 *      a browser can seek without pulling the whole file. This is what
 *      makes progressive playback work at all.
 *   4. COMPRESSION           — Brotli, then gzip, chosen from Accept-Encoding
 *      and applied only to text. Never to already-compressed media, where
 *      it burns CPU to make the file slightly bigger.
 *   5. ADAPTIVE DELIVERY     — Save-Data and the Client Hints a browser
 *      sends about its connection are honoured, the way an adaptive
 *      bitrate ladder honours them: a phone on 2G asking for the hero
 *      video is redirected to the poster instead.
 *
 * Exported rather than auto-started so the tests can drive it on an
 * ephemeral port. `node server.js` still runs it directly.
 * ========================================================================= */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = path.join(__dirname, 'public');

/* ---------------------------------------------------------------------------
 * Content types. Anything unlisted is served as a byte stream rather than
 * guessed at — a wrong type is worse than none.
 * ------------------------------------------------------------------------ */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
};

/* Only text compresses usefully. A JPEG or an MP4 is already compressed;
   running deflate over it costs CPU and typically ADDS a few bytes. */
const COMPRESSIBLE = new Set([
  'text/html; charset=utf-8',
  'text/css; charset=utf-8',
  'text/javascript; charset=utf-8',
  'application/json; charset=utf-8',
  'image/svg+xml',
  'text/plain; charset=utf-8',
  'text/markdown; charset=utf-8',
]);

const MEDIA = new Set(['.mp4', '.mov', '.webm', '.mp3']);

/* Cache tiers.
   HTML must revalidate or a deploy never reaches anyone. Everything else is
   content the page references by name; when one changes its name changes
   with it, so it can be held for a year and never asked about again. */
const YEAR = 60 * 60 * 24 * 365;

function cacheControl(ext, contentType) {
  if (contentType.startsWith('text/html')) {
    return 'no-cache'; // revalidate every time; a 304 is nearly free
  }
  if (ext === '.css' || ext === '.js') {
    return 'public, max-age=3600, must-revalidate';
  }
  return 'public, max-age=' + YEAR + ', immutable';
}

/* ---------------------------------------------------------------------------
 * Path resolution
 * ------------------------------------------------------------------------ */

/* Rejects anything that climbs out of ROOT. Decoding first matters: %2e%2e
   is "..", and a check made before decoding would wave it straight through. */
function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch (err) {
    return null; // malformed percent-encoding
  }

  if (decoded.indexOf('\0') !== -1) {
    return null;
  }

  const withIndex = decoded.endsWith('/') ? decoded + 'index.html' : decoded;
  const full = path.join(ROOT, withIndex);
  const rel = path.relative(ROOT, full);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return full;
}

/* Weak-looking but strong ETag: size and mtime identify a static file as
   reliably as hashing it, without reading the bytes on every request. */
function etagFor(stat) {
  const material = stat.size + '-' + Number(stat.mtimeMs).toString(36);
  return '"' + crypto.createHash('sha1').update(material).digest('base64').slice(0, 20) + '"';
}

/* ---------------------------------------------------------------------------
 * Adaptive delivery
 *
 * The browser tells us about its connection if asked. Save-Data is a direct
 * request to send less, and is honoured rather than interpreted.
 * ------------------------------------------------------------------------ */
function connectionIsPoor(headers) {
  if (String(headers['save-data'] || '').toLowerCase() === 'on') {
    return true;
  }
  const ect = String(headers['ect'] || '').toLowerCase();
  return ect === '2g' || ect === 'slow-2g';
}

/* The one substitution worth making: 2.7MB of hero video becomes a 110KB
   still. The page already falls back to the poster if the video never
   plays, so nothing breaks — it simply weighs 25x less. */
const SAVE_DATA_SWAPS = {
  '/media/videos/mainPageVideoWeb.mp4': '/media/videos/mainPageVideoPoster.webp',
};

/* ---------------------------------------------------------------------------
 * Range requests
 *
 * Returns null for an absent or unsatisfiable header, which the caller
 * treats as "send the whole thing".
 * ------------------------------------------------------------------------ */
function parseRange(header, size) {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }

  const [, rawStart, rawEnd] = match;
  let start;
  let end;

  if (rawStart === '') {
    // "bytes=-500" means the LAST 500 bytes, not the first 500
    const suffix = parseInt(rawEnd, 10);
    if (Number.isNaN(suffix) || suffix === 0) {
      return null;
    }
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10);
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return { unsatisfiable: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

function pickEncoding(accept) {
  const header = String(accept || '');
  if (/\bbr\b/.test(header)) {
    return 'br';
  }
  if (/\bgzip\b/.test(header)) {
    return 'gzip';
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * The handler
 * ------------------------------------------------------------------------ */
async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') {
    urlPath = '/index.html';
  }

  // Adaptive substitution happens before resolution, so the swap target
  // goes through exactly the same safety and caching path.
  let swapped = false;
  if (connectionIsPoor(req.headers) && SAVE_DATA_SWAPS[urlPath]) {
    urlPath = SAVE_DATA_SWAPS[urlPath];
    swapped = true;
  }

  const filePath = resolveSafe(urlPath);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      stat = await fsp.stat(path.join(filePath, 'index.html'));
    }
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = etagFor(stat);
  const lastModified = stat.mtime.toUTCString();

  const headers = {
    'Content-Type': type,
    'Cache-Control': cacheControl(ext, type),
    ETag: etag,
    'Last-Modified': lastModified,
    // Any response that depends on a request header must say so, or a
    // shared cache will serve one visitor's variant to another.
    Vary: 'Accept-Encoding, Save-Data, ECT',
    'X-Content-Type-Options': 'nosniff',
  };

  if (swapped) {
    headers['X-Adaptive-Substitute'] = 'save-data';
  }

  // Conditional request: the visitor already holds this exact bytes.
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some((tag) => tag.trim() === etag)) {
    res.writeHead(304, headers);
    return res.end();
  }

  // Media is served by range so a player can seek and start early.
  if (MEDIA.has(ext)) {
    headers['Accept-Ranges'] = 'bytes';
    const range = parseRange(req.headers.range, stat.size);

    if (range && range.unsatisfiable) {
      headers['Content-Range'] = 'bytes */' + stat.size;
      res.writeHead(416, headers);
      return res.end();
    }

    if (range) {
      const length = range.end - range.start + 1;
      headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + stat.size;
      headers['Content-Length'] = length;
      res.writeHead(206, headers);
      if (req.method === 'HEAD') {
        return res.end();
      }
      return fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    }

    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      return res.end();
    }
    return fs.createReadStream(filePath).pipe(res);
  }

  // Text: compress if the client asked and the type benefits.
  const encoding = COMPRESSIBLE.has(type) ? pickEncoding(req.headers['accept-encoding']) : null;

  if (!encoding) {
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      return res.end();
    }
    return fs.createReadStream(filePath).pipe(res);
  }

  headers['Content-Encoding'] = encoding;
  // Length is unknown until compression finishes, and declaring the
  // uncompressed size here would truncate the response.
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    return res.end();
  }

  const compressor = encoding === 'br' ? zlib.createBrotliCompress() : zlib.createGzip();
  return fs.createReadStream(filePath).pipe(compressor).pipe(res);
}

/* `api` is opt-in rather than always-on. Mounting it by default would mean
   every createServer() in a test opened a database file as a side effect,
   and a test suite that writes to the real store is not a test suite. */
function createServer(options = {}) {
  const api = options.api || null;

  return http.createServer((req, res) => {
    (async () => {
      // The API answers first and reports whether the request was its own.
      // It has to come before handle(), which rejects anything but GET/HEAD.
      if (api && (await api(req, res))) {
        return;
      }
      await handle(req, res);
    })().catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Server error');
    });
  });
}

/* Started only when run directly, so requiring this from a test does not
   bind a port. */
if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;

  const store = require('./api/db');
  const { createApi } = require('./api');
  const db = store.openDatabase(path.join(__dirname, 'data', 'ikshaa.db'));

  /* The topic catalogue the router is allowed to choose from, built from the
     bot's own intents so the two can never drift apart. Social turns are left
     out: the local matcher never misses "hello", and every id in the prompt
     is a chance for the model to pick the wrong one. */
  const SOCIAL = ['greeting', 'goodbye', 'thanks', 'compliment'];
  const KNOWLEDGE = require('./public/chat/knowledge.js');
  const Bot = require('./public/chat/bot.js');
  const describer = new Bot();
  const catalogue = (KNOWLEDGE.INTENTS || [])
    .filter((i) => SOCIAL.indexOf(i.id) === -1)
    .map((i) => ({ id: i.id, describes: describer.describe(i.id) }));

  createServer({ api: createApi({ db, store, catalogue }) }).listen(port, () => {
    process.stdout.write('Ikshaa running at http://localhost:' + port + '\n');
    process.stdout.write(
      process.env.IKSHAA_API_TOKEN
        ? '  API at /api — read routes need the bearer token\n'
        : '  API at /api — IKSHAA_API_TOKEN is unset, so read routes refuse everyone\n'
    );
    process.stdout.write(
      process.env.GROQ_API_KEY
        ? '  chat router on — Groq resolves a conversation stuck twice\n'
        : '  chat router off — set GROQ_API_KEY to enable it\n'
    );
  });
}

module.exports = { createServer, resolveSafe, parseRange, cacheControl, connectionIsPoor, pickEncoding, ROOT };
