'use strict';

/* ============================================================================
 * Tests for the delivery behaviours in server.js.
 *
 * Each block states the behaviour it is protecting and why it matters on a
 * slow link — these are not coverage for its own sake. The server is
 * started on an ephemeral port so the suite never collides with a running
 * dev server or with itself under --watch.
 * ========================================================================= */

const { createServer, resolveSafe, parseRange, cacheControl, connectionIsPoor, pickEncoding } = require('../server');

let server;
let origin;

beforeAll((done) => {
  server = createServer();
  server.listen(0, () => {
    origin = 'http://127.0.0.1:' + server.address().port;
    done();
  });
});

afterAll(async () => {
  /* close() stops NEW connections but waits for existing ones to end, and
     Node's fetch keeps its sockets alive for reuse — so on its own this
     hangs until the keep-alive timeout, and Jest reports a leak.
     closeAllConnections drops those idle sockets first. */
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
});

/* Node's fetch decompresses transparently, which would hide exactly what we
   want to assert. Identity by default; tests opt in explicitly. */
function get(pathname, headers = {}) {
  return fetch(origin + pathname, {
    headers: Object.assign({ 'Accept-Encoding': 'identity' }, headers),
  });
}

/* ---------------------------------------------------------------------- */
describe('path safety', () => {
  test('resolves a normal path inside the root', () => {
    expect(resolveSafe('/index.html')).toContain('index.html');
  });

  test('refuses to climb out of the root', () => {
    expect(resolveSafe('/../server.js')).toBeNull();
    expect(resolveSafe('/../../secrets.txt')).toBeNull();
  });

  test('refuses an ENCODED climb', () => {
    // The check happens after decoding on purpose: %2e%2e is "..", and a
    // check made before decoding lets it straight through.
    expect(resolveSafe('/%2e%2e/server.js')).toBeNull();
  });

  test('refuses a null byte', () => {
    expect(resolveSafe('/index.html\0.png')).toBeNull();
  });

  test('a traversal attempt over HTTP is refused, not served', async () => {
    const res = await get('/../server.js');
    expect([403, 404]).toContain(res.status);
  });
});

/* ---------------------------------------------------------------------- */
describe('serving', () => {
  test('/ serves the homepage', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('<!DOCTYPE html>');
  });

  test('a missing file is 404, not a crash', async () => {
    const res = await get('/nope.html');
    expect(res.status).toBe(404);
  });

  test('declares a content type it does not have to guess', async () => {
    const res = await get('/style.css');
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  test('sends nosniff, so a mistyped response cannot be reinterpreted', async () => {
    const res = await get('/index.html');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('rejects methods other than GET and HEAD', async () => {
    const res = await fetch(origin + '/index.html', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });
});

/* ---------------------------------------------------------------------- */
describe('conditional requests', () => {
  // The single biggest win for a repeat visitor on a distant link: the
  // round trip still happens, but nothing is transferred.
  test('a matching ETag returns 304 with no body', async () => {
    const first = await get('/index.html');
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await get('/index.html', { 'If-None-Match': etag });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  test('a stale ETag returns the file', async () => {
    const res = await get('/index.html', { 'If-None-Match': '"not-the-one"' });
    expect(res.status).toBe(200);
  });

  test('the ETag is stable across requests for unchanged bytes', async () => {
    const a = await get('/style.css');
    const b = await get('/style.css');
    expect(a.headers.get('etag')).toBe(b.headers.get('etag'));
  });
});

/* ---------------------------------------------------------------------- */
describe('cache tiers', () => {
  test('HTML revalidates, so a deploy actually reaches people', () => {
    expect(cacheControl('.html', 'text/html; charset=utf-8')).toBe('no-cache');
  });

  test('media is immutable for a year', () => {
    expect(cacheControl('.jpg', 'image/jpeg')).toMatch(/immutable/);
    expect(cacheControl('.jpg', 'image/jpeg')).toMatch(/31536000/);
  });

  test('CSS and JS revalidate hourly rather than being pinned', () => {
    expect(cacheControl('.css', 'text/css; charset=utf-8')).toMatch(/must-revalidate/);
  });

  test('Vary names every header the response depends on', async () => {
    // Without this a shared cache serves one visitor's variant to another.
    const res = await get('/index.html');
    const vary = res.headers.get('vary');
    expect(vary).toMatch(/Accept-Encoding/);
    expect(vary).toMatch(/Save-Data/);
  });
});

/* ---------------------------------------------------------------------- */
describe('range requests', () => {
  // Without these a browser cannot seek, and cannot begin playback until
  // the whole file has arrived.
  test('media advertises range support', async () => {
    const res = await get('/media/videos/mainPageVideoWeb.mp4');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
  });

  test('a range returns 206 and only those bytes', async () => {
    const res = await get('/media/videos/mainPageVideoWeb.mp4', { Range: 'bytes=0-99' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('content-range')).toMatch(/^bytes 0-99\/\d+$/);
  });

  test('an open-ended range runs to the end of the file', () => {
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
  });

  test('a suffix range means the LAST n bytes', () => {
    // bytes=-500 is the final 500 bytes, not the first 500. Getting this
    // backwards silently serves the wrong part of a video.
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 });
  });

  test('a range past the end of the file is unsatisfiable', () => {
    expect(parseRange('bytes=5000-6000', 1000)).toEqual({ unsatisfiable: true });
  });

  test('an unsatisfiable range returns 416 with the real size', async () => {
    const res = await get('/media/videos/mainPageVideoWeb.mp4', { Range: 'bytes=999999999-' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
  });

  test('no range header means the whole file', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('rubbish', 100)).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
describe('compression', () => {
  test('prefers brotli over gzip when both are offered', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
  });

  test('compresses HTML when asked', async () => {
    const res = await get('/index.html', { 'Accept-Encoding': 'gzip' });
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  test('does NOT compress a JPEG', async () => {
    // Already-compressed bytes gain nothing and usually grow slightly,
    // while costing CPU on both ends.
    const res = await get('/imagesIkshaa/IkshaaDoor.jpg', { 'Accept-Encoding': 'gzip, br' });
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  test('serves plain bytes when no encoding is accepted', async () => {
    const res = await get('/style.css');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
  });

  test('omits Content-Length when compressing, rather than lying about it', async () => {
    // The uncompressed size would truncate the response.
    const res = await get('/style.css', { 'Accept-Encoding': 'gzip' });
    expect(res.headers.get('content-length')).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
describe('adaptive delivery', () => {
  test('reads Save-Data and the connection hint', () => {
    expect(connectionIsPoor({ 'save-data': 'on' })).toBe(true);
    expect(connectionIsPoor({ ect: '2g' })).toBe(true);
    expect(connectionIsPoor({ ect: 'slow-2g' })).toBe(true);
    expect(connectionIsPoor({ ect: '4g' })).toBe(false);
    expect(connectionIsPoor({})).toBe(false);
  });

  test('Save-Data swaps the hero video for its poster', async () => {
    const full = await get('/media/videos/mainPageVideoWeb.mp4');
    const lite = await get('/media/videos/mainPageVideoWeb.mp4', { 'Save-Data': 'on' });

    expect(lite.status).toBe(200);
    expect(lite.headers.get('content-type')).toBe('image/jpeg');
    expect(lite.headers.get('x-adaptive-substitute')).toBe('save-data');

    // The point of the exercise: far fewer bytes.
    expect(Number(lite.headers.get('content-length')))
      .toBeLessThan(Number(full.headers.get('content-length')));
  });

  test('a normal connection still gets the video', async () => {
    const res = await get('/media/videos/mainPageVideoWeb.mp4');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('x-adaptive-substitute')).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
describe('the site itself', () => {
  // Cheap guards against the kind of breakage a refactor causes.
  const pages = [
    '/index.html',
    '/ourHeritage.html',
    '/gallery.html',
    '/guestBook.html',
    '/exploreGoa.html',
    '/goanCuisine.html',
    '/findingUs.html',
    '/stayWithUs.html',
    '/exploreIkshaa.html',
  ];

  test.each(pages)('%s is served', async (page) => {
    const res = await get(page);
    expect(res.status).toBe(200);
  });

  test('every page loads the one stylesheet and the one script', async () => {
    for (const page of pages) {
      if (page === '/exploreIkshaa.html') {
        continue; // the tour is deliberately self-contained
      }
      const html = await (await get(page)).text();
      expect(html).toContain('href="style.css"');
      expect(html).toContain('src="script.js"');
      expect(html).not.toContain('trial.css');
      expect(html).not.toContain('trial.js');
    }
  });

  test('no page still points at a trial filename', async () => {
    for (const page of pages) {
      const html = await (await get(page)).text();
      expect(html).not.toContain('trialIndex.html');
      expect(html).not.toContain('trialOurHeritage.html');
    }
  });
});
