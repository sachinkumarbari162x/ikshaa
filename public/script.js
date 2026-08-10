//===============================================
// Crossfade slideshow: all slides are stacked, one is visible at a time,
// and the order is reshuffled on every pass.

const FADE_MS = 1000; // must match the transition duration in style.css
const HOLD_MS = 2000; // how long a slide stays fully visible after fading in

const slides = Array.from(document.querySelectorAll('.slide'));

// Fisher-Yates: returns a new array, leaves the original alone
function shuffle(items) {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Hands back slides in random order. Reshuffling only once the queue is
// empty means every image is shown once before any of them repeats —
// picking purely at random each time would clump and skip.
function createRandomOrder(items) {
  let queue = [];
  let previous = null;
  let isFirstCall = true;

  function next() {
    // Every reload opens on the same image: it's the only one carrying a
    // real src in the markup and the one preloaded in the <head>, so it can
    // paint without waiting on a decision this function hasn't made yet.
    if (isFirstCall) {
      isFirstCall = false;
      previous = items[0];
      // Its own pass excludes it, so the fixed opener can't come back
      // around immediately after showing.
      queue = shuffle(items.slice(1));
      return previous;
    }

    if (queue.length === 0) {
      queue = shuffle(items);
      // A reshuffle can put last pass's final slide first, which would
      // show the same image twice in a row. Swap it back one place.
      if (queue[0] === previous && queue.length > 1) {
        [queue[0], queue[1]] = [queue[1], queue[0]];
      }
    }
    previous = queue.shift();
    return previous;
  }

  // What the next few calls will hand back, without consuming them. This is
  // what lets a photograph be fetched shortly before it is due on screen
  // rather than long before, which is the whole point of the schedule below.
  next.upcoming = function (count) {
    return isFirstCall ? items.slice(0, count) : queue.slice(0, count);
  };

  return next;
}

// ---------------------------------------------------------------------
// When deferred photographs actually get fetched.
//
// Everything except the opening slide ships as data-src so the first paint
// isn't competing with a dozen full-screen photos for bandwidth. Hydrating
// all of them on window load threw that away: on the homepage it fired 24
// requests and 2.88 MB at once, of which the guest could see exactly one
// image. Over HTTP/2 they all multiplex rather than queue, so they share
// the connection and the one picture that mattered finished as slowly as
// the twenty-three that did not.
//
// 1.65 MB of that was preview imagery inside a *closed* hamburger menu,
// loading on every page of the site.
//
// So each group is fetched when it is nearly needed instead:
//   slides    — a couple ahead of the fade (see HYDRATE_LEAD)
//   previews  — on the first menu open
//   anything else — once the browser is idle
// ---------------------------------------------------------------------

/* ---------------------------------------------------------------------
 * Picking the format, for images JavaScript sets.
 *
 * A <picture> element lets the browser choose, but only for markup. Most of
 * the photographs here are set from script — the hero slides, the menu
 * previews, the rotating figures, the gallery layers — and for those the
 * choice has to be made in code.
 *
 * So: probe once for AVIF, then swap the extension. Every reference in the
 * markup points at the .webp, which is the SAFE one; the swap is an upgrade
 * applied only when the browser has proved it can decode AVIF. Getting the
 * probe wrong therefore costs bytes, never a broken image.
 *
 * The probe is a 2x2 AVIF as a data URI — no network, and decoding is the
 * only honest test. Checking the user agent would be a guess, and canvas
 * .toDataURL('image/avif') tests ENCODE support, which is a different
 * question and answers false in browsers that display AVIF perfectly well.
 * ------------------------------------------------------------------ */

let avifOk = false;

(function probeAvif() {
  const probe = new Image();
  probe.onload = function () { avifOk = probe.width === 2; };
  probe.onerror = function () { avifOk = false; };
  probe.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAUAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAACAAAAAgAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAcbWRhdAoFGAA2wCAyCx/wAABYAAAAAK8w';
})();

/* Until the probe resolves, avifOk is false and WebP is served. That is the
   correct default: an image that loads slightly larger beats one that does
   not load at all. */
function bestFormat(path) {
  return avifOk ? String(path).replace(/\.webp$/i, '.avif') : path;
}

function hydrate(image) {
  if (image && image.dataset.src) {
    image.src = bestFormat(image.dataset.src);
    image.removeAttribute('data-src');
  }
}

function hydrateAll(images) {
  images.forEach(hydrate);
}

// A slide holds for FADE_MS + HOLD_MS = 3s, so two slides of lead is about
// six seconds of warning — ample for a ~100 KB photograph even on a slow
// connection, while still keeping only a couple of requests in flight.
const HYDRATE_LEAD = 2;

// Whatever is left over: no group claims it, but it must not stay blank.
// requestIdleCallback waits for a gap in the main thread; the timeout is
// the ceiling, and the setTimeout is for Safari, which lacks the API.
function hydrateRemainderWhenIdle() {
  const rest = () =>
    hydrateAll(
      Array.from(document.querySelectorAll('img[data-src]:not(.slide):not(.previewImage)'))
    );

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(rest, { timeout: 3000 });
  } else {
    setTimeout(rest, 1200);
  }
}

if (document.readyState === 'complete') {
  hydrateRemainderWhenIdle();
} else {
  window.addEventListener('load', hydrateRemainderWhenIdle, { once: true });
}

//===============================================
// Article figures: each frame drifts to a different photo on its own
// randomised timer, drawing from a shared pool.

// Three of the folder's photos are deliberately absent: IkshaaDoor is the
// fixed hero, and outside/IkshaaFlower are the same shots the static figures
// use. Any of them turning up in a rotating frame would read as a duplicate.
const FIGURE_POOL = [
  './heritagePageImages/Courtyard.webp',
  './heritagePageImages/IkshaaSitting2.webp',
  './heritagePageImages/IkshaaPool.webp',
  './heritagePageImages/IkshaaPool2.webp',
  './heritagePageImages/IkshaaMaster.webp',
  './heritagePageImages/bath1.webp',
  './heritagePageImages/stream.webp',
];

const FIGURE_MIN_MS = 4000;
const FIGURE_MAX_MS = 9000;

function initRandomFigures() {
  const figures = Array.from(document.querySelectorAll('.randomFigure'));
  if (figures.length === 0) {
    return;
  }

  // Rotating photographs is decoration, so honour a reduced-motion
  // preference by simply leaving the authored frames in place.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // Warm the cache once. Without this the first swap of each photo would
  // fade in an empty layer while the file downloaded.
  FIGURE_POOL.forEach((source) => {
    const preload = new Image();
    // Warm the same URL the swap will actually request, or the first change
    // of each frame downloads a second copy.
    preload.src = bestFormat(source);
  });

  // What each frame is showing right now, so a photo can't appear in two
  // frames at once.
  const showing = new Map();
  figures.forEach((figure) => {
    const visible = figure.querySelector('.figureLayer.isVisible');
    showing.set(figure, visible ? visible.getAttribute('src') : null);
  });

  function pickUnusedImage() {
    const onScreen = new Set(showing.values());
    const available = FIGURE_POOL.filter((source) => !onScreen.has(source));
    // If the pool ever gets smaller than the number of frames, fall back to
    // the full list rather than stalling with nothing to choose.
    const options = available.length > 0 ? available : FIGURE_POOL;
    return options[Math.floor(Math.random() * options.length)];
  }

  function swapFigure(figure) {
    const layers = figure.querySelectorAll('.figureLayer');
    const visible = figure.querySelector('.figureLayer.isVisible');
    const hidden = visible === layers[0] ? layers[1] : layers[0];
    const nextSource = pickUnusedImage();

    // Claim it up front: the reveal is async, and without this two frames
    // resolving at once could both pick the same photo.
    showing.set(figure, nextSource);
    hidden.src = bestFormat(nextSource);

    const reveal = () => {
      hidden.classList.add('isVisible');
      visible.classList.remove('isVisible');
    };

    // Cached images are already complete and never fire load again.
    if (hidden.complete) {
      reveal();
    } else {
      hidden.addEventListener('load', reveal, { once: true });
    }
  }

  // Each frame runs its own timer with a fresh random delay every cycle,
  // so they never settle into a visible rhythm together.
  function scheduleFigure(figure) {
    const delay = FIGURE_MIN_MS + Math.random() * (FIGURE_MAX_MS - FIGURE_MIN_MS);
    setTimeout(() => {
      swapFigure(figure);
      scheduleFigure(figure);
    }, delay);
  }

  figures.forEach(scheduleFigure);
}

if (document.readyState === 'complete') {
  initRandomFigures();
} else {
  window.addEventListener('load', initRandomFigures, { once: true });
}

//===============================================
// Gallery: each tile stacks one group's photos and crossfades between them
// in random order, but only while the tile is actually on screen.

const GALLERY_MIN_MS = 3000;
const GALLERY_MAX_MS = 6500;

function initGalleryStacks() {
  const stacks = Array.from(document.querySelectorAll('.galleryStack'));
  if (stacks.length === 0) {
    return;
  }

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  stacks.forEach((stack) => {
    const layers = Array.from(stack.querySelectorAll('.galleryLayer'));
    // A single-image group has nothing to rotate between.
    if (layers.length < 2) {
      return;
    }

    const nextLayer = createRandomOrder(layers);
    // Burn the fixed opener: the markup already shows layers[0], so without
    // this the first tick would "change" to the image already displayed.
    nextLayer();

    let current = layers[0];
    let timer = null;

    function advance() {
      // Hold position while the viewer is open: it reads the tile's visible
      // layer to decide where to open, and closing onto a tile that had
      // silently moved on would be jarring.
      if (!document.body.classList.contains('lightboxOpen')) {
        const upcoming = nextLayer();
        current.classList.remove('isVisible');
        upcoming.classList.add('isVisible');
        current = upcoming;
      }
      schedule();
    }

    // A fresh random delay each cycle, so tiles never fall into step with
    // one another the way a shared interval would.
    function schedule() {
      const delay = GALLERY_MIN_MS + Math.random() * (GALLERY_MAX_MS - GALLERY_MIN_MS);
      timer = setTimeout(advance, delay);
    }

    function start() {
      if (timer === null && !prefersReducedMotion) {
        schedule();
      }
    }

    function stop() {
      clearTimeout(timer);
      timer = null;
    }

    // Off-screen tiles stop entirely rather than churning through images
    // nobody is looking at. threshold 0.3 so it starts once the tile is
    // meaningfully in view, not on the first pixel.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            start();
          } else {
            stop();
          }
        });
      },
      { threshold: 0.3 }
    );

    observer.observe(stack);
  });
}

if (document.readyState === 'complete') {
  initGalleryStacks();
} else {
  window.addEventListener('load', initGalleryStacks, { once: true });
}

//===============================================
// Enlarged viewer: clicking a tile opens its group full-size, with arrows
// to step through it by hand.

function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const closeButton = document.getElementById('lightboxClose');
  const prevButton = document.getElementById('lightboxPrev');
  const nextButton = document.getElementById('lightboxNext');

  // Only the gallery page has one.
  if (!lightbox || !lightboxImage) {
    return;
  }

  let sources = [];
  let groupTitle = '';
  let index = 0;
  let lastFocused = null;

  function render() {
    lightboxImage.src = sources[index];
    lightboxImage.alt = `${groupTitle} — photo ${index + 1} of ${sources.length}`;
    lightboxCaption.textContent = `${groupTitle} · ${index + 1} / ${sources.length}`;

    // A single-photo group has nothing to step through.
    const isNavigable = sources.length > 1;
    prevButton.hidden = !isNavigable;
    nextButton.hidden = !isNavigable;
  }

  // Wraps at both ends, so the arrows never dead-end.
  function step(offset) {
    index = (index + offset + sources.length) % sources.length;
    render();
  }

  function open(tile) {
    const layers = Array.from(tile.querySelectorAll('.galleryLayer'));
    if (layers.length === 0) {
      return;
    }

    sources = layers.map((layer) => layer.getAttribute('src'));
    const titleNode = tile.querySelector('.galleryTileTitle');
    groupTitle = titleNode ? titleNode.textContent.trim() : '';

    // Open on whatever the tile was showing, so the enlargement feels like
    // it grew out of the tile rather than jumping to an unrelated photo.
    const visible = tile.querySelector('.galleryLayer.isVisible');
    index = Math.max(0, layers.indexOf(visible));

    render();
    lastFocused = document.activeElement;
    lightbox.classList.add('isOpen');
    document.body.classList.add('lightboxOpen');
    closeButton.focus();
  }

  function close() {
    lightbox.classList.remove('isOpen');
    document.body.classList.remove('lightboxOpen');
    // Send focus back where it came from, or the page loses its place.
    if (lastFocused) {
      lastFocused.focus();
    }
  }

  document.querySelectorAll('.galleryTrigger').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const tile = trigger.closest('.galleryTile');
      if (tile) {
        open(tile);
      }
    });
  });

  prevButton.addEventListener('click', () => step(-1));
  nextButton.addEventListener('click', () => step(1));
  closeButton.addEventListener('click', close);

  // Clicking the backdrop closes; clicking the photo or a button does not.
  // The stage counts as backdrop: when the photo is smaller than the frame
  // that bare plate is what surrounds it, and clicking there means "out".
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox || event.target.classList.contains('lightboxStage')) {
      close();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!lightbox.classList.contains('isOpen')) {
      return;
    }
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'ArrowLeft') {
      step(-1);
    } else if (event.key === 'ArrowRight') {
      step(1);
    }
  });
}

if (document.readyState === 'complete') {
  initLightbox();
} else {
  window.addEventListener('load', initLightbox, { once: true });
}

const nextSlide = createRandomOrder(slides);

// Paired to the slides by position: caption 3 belongs to slide 3. Matching
// by index rather than a lookup keeps the markup free of ids, but it does
// mean the two lists have to stay in the same order.
const heroCaptions = Array.from(document.querySelectorAll('.heroCaption'));

let current = null;
let currentCaption = null;

function showNext() {
  const upcoming = nextSlide();

  // Fetch the slides that are about to be due. Called after the pick so the
  // lead is measured from the slide now going up, not the one leaving.
  hydrateAll(nextSlide.upcoming(HYDRATE_LEAD));
  // Safety net for the wrap between shuffles, where the lead can come up
  // short. A no-op once a slide has been hydrated, so it costs nothing.
  hydrate(upcoming);

  // Dropping the class on one while adding it to the other makes both
  // transitions run together, so there is no black gap between slides.
  if (current) {
    current.classList.remove('isVisible');
  }
  upcoming.classList.add('isVisible');
  current = upcoming;

  // The caption crossfades on the same 1000ms, so words and picture arrive
  // together. Guarded because the sub-pages have slides but no captions.
  const caption = heroCaptions[slides.indexOf(upcoming)];
  if (caption && caption !== currentCaption) {
    if (currentCaption) {
      currentCaption.classList.remove('isVisible');
    }
    caption.classList.add('isVisible');
    currentCaption = caption;
  }

  scheduleNext();
}

/* ---------------------------------------------------------------------
 * The crossfade only runs while it can actually be seen.
 *
 * It used to run forever — while the guest read the footer, while another
 * tab was in front. A permanent full-viewport opacity animation between
 * two full-screen photographs is close to free on Apple's compositor and
 * costly on a Windows laptop with integrated graphics, or on any browser
 * where GPU rasterisation is partly blocklisted. That is precisely the gap
 * between an iPad and a desktop browser showing the same page.
 *
 * It compounds: .navBook is fixed with backdrop-filter directly over the
 * hero. A backdrop-filter above STATIC content is cached; above ANIMATING
 * content it re-samples and re-blurs its backdrop every frame. The hero
 * never stopping meant that blur never stopped either.
 * ------------------------------------------------------------------ */
let heroOnScreen = true;
let heroTimer = null;

function scheduleNext() {
  clearTimeout(heroTimer);
  if (heroOnScreen && document.visibilityState === 'visible') {
    heroTimer = setTimeout(showNext, FADE_MS + HOLD_MS);
  }
}

if (slides.length > 0) {
  const heroRoot = slides[0].parentElement;

  if (heroRoot && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      (entries) => {
        heroOnScreen = entries[0].isIntersecting;
        // Resuming restarts the cycle; pausing lets the pending timer go.
        // A fade already in flight is left to finish on its own — cutting
        // it short would leave a slide stranded at partial opacity.
        if (heroOnScreen) {
          scheduleNext();
        } else {
          clearTimeout(heroTimer);
        }
      },
      { threshold: 0 }
    ).observe(heroRoot);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleNext();
    } else {
      clearTimeout(heroTimer);
    }
  });

  // Two frames so the browser commits the starting opacity: 0 before the
  // class lands. Without it the first slide pops in instead of fading.
  requestAnimationFrame(() => requestAnimationFrame(showNext));
}

//===============================================
// Navigation: the hamburger opens a full-screen overlay of the links.

const menuToggle = document.getElementById('menuToggle');
const navPanel = document.getElementById('navPanel');
const navLinks = document.getElementById('navLinks');
const previewImages = Array.from(document.querySelectorAll('.previewImage'));

// Whichever link is first decides what the panel shows before anything
// is hovered, so the preview is never blank on open.
const defaultPreview = navLinks
  ? navLinks.querySelector('a[data-preview]')?.dataset.preview
  : undefined;

// Matches on the data-preview key rather than list position, so adding or
// reordering a link can't silently pair it with the wrong photo.
function showPreview(key) {
  previewImages.forEach((image) => {
    image.classList.toggle('isVisible', image.dataset.preview === key);
  });
}

// Single place that writes the open/closed state, so the button, the
// overlay, the body scroll lock and the ARIA flag can never disagree.
function setMenu(isOpen) {
  navPanel.classList.toggle('active', isOpen);
  menuToggle.classList.toggle('active', isOpen);
  document.body.classList.toggle('menuOpen', isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));

  // Reopening should start from the top link again, not from whatever
  // happened to be hovered when it was last closed.
  if (isOpen) {
    // First open is when these are worth fetching. They are 1.65 MB of
    // photographs behind a panel that is shut on arrival, and most guests
    // never open it — paying for them during first paint on every page was
    // the single largest avoidable cost on the site.
    hydrateAll(Array.from(navPanel.querySelectorAll('img[data-src]')));
    showPreview(defaultPreview);
  }
}

if (menuToggle && navPanel && navLinks) {
  menuToggle.addEventListener('click', () => {
    setMenu(!navPanel.classList.contains('active'));
  });

  // One listener on the list instead of six: mouseover bubbles, unlike
  // mouseenter, so closest() can identify which link was entered.
  navLinks.addEventListener('mouseover', (event) => {
    const link = event.target.closest('a[data-preview]');
    if (link) {
      showPreview(link.dataset.preview);
    }
  });

  // Keyboard users tab rather than hover, so mirror it on focus
  navLinks.addEventListener('focusin', (event) => {
    const link = event.target.closest('a[data-preview]');
    if (link) {
      showPreview(link.dataset.preview);
    }
  });

  // Tapping a link should dismiss the overlay, otherwise it covers the
  // page after navigating. closest() so an icon inside a link still works.
  navLinks.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      setMenu(false);
    }
  });

  // Escape is the expected way out of anything covering the whole screen
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navPanel.classList.contains('active')) {
      setMenu(false);
    }
  });
}

//===============================================
// Flip the navbar to ink once the cream panel has risen behind it,
// otherwise the white name and bars disappear against it.

const NAVBAR_HEIGHT = 90;

function syncNavContrast() {
  const panelReachedNavbar = window.scrollY > window.innerHeight - NAVBAR_HEIGHT;
  document.body.classList.toggle('scrolled', panelReachedNavbar);

  // Separate, much smaller threshold: the cue should go at the first hint
  // of scrolling, not wait until the panel reaches the navbar.
  document.body.classList.toggle('hasScrolled', window.scrollY > 20);
}

// passive: the handler never calls preventDefault, and saying so lets the
// browser scroll without waiting on it.
window.addEventListener('scroll', syncNavContrast, { passive: true });
window.addEventListener('resize', syncNavContrast);

// Run once up front: a reload can restore a mid-page scroll position.
syncNavContrast();

//===============================================
// SITE BEHAVIOUR — folded in from the former trial.js.
// Everything above handles the navbar, the hero slideshow and captions,
// the scroll state and deferred images. Below: navbar tone, the welcome
// video, the cuisine carousel, the explore strip, and the moving
// pictures. Every block guards on its own elements, so a page without
// them simply skips it.

/* ---------- Navbar tone ----------
   script.js flips the whole bar on body.scrolled, which only asks "am I
   past the hero". That is far too coarse here: this is a white page with
   photographs scattered through it — the explore strip, the cuisine
   carousel, the split bands, the experience cards — so the bar crosses
   dark imagery long after the hero is gone, and ink-on-photo disappears.

   Marking whole sections could not fix that either, because those strips
   are images sitting INSIDE otherwise-white sections. So each control is
   sampled individually against whatever is directly beneath it, and the
   three of them can disagree — the hamburger can be over a photo while
   the book button is over white. */
(function () {
  const navbar = document.querySelector('.navbar');
  if (!navbar) {
    return;
  }

  const controls = [
    document.querySelector('.menu-toggle'),
    document.querySelector('.villaName'),
    document.querySelector('.navBook'),
  ].filter(Boolean);

  let ticking = false;

  function isOverDark(control) {
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Paint order, topmost first. Elements with pointer-events:none are
    // skipped by the browser, which happens to be what we want: the hero
    // overlay and villa name are transparent to this probe.
    const stack = document.elementsFromPoint(x, y);

    for (const node of stack) {
      if (navbar.contains(node)) {
        continue; // the bar and its own children are not the backdrop
      }
      // First thing under the bar decides. An <img> or <video> is imagery,
      // and a marked region covers the hero and the full-bleed bands.
      return node.tagName === 'IMG' ||
        node.tagName === 'VIDEO' ||
        Boolean(node.closest('[data-nav-dark]'));
    }
    return false; // nothing underneath: the bare white page
  }

  function update() {
    ticking = false;
    controls.forEach((control) => {
      control.classList.toggle('isOnDark', isOverDark(control));
    });
  }

  function requestUpdate() {
    if (ticking) {
      return;
    }
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  // The carousel and the explore strip move images under the bar without
  // any scrolling, so re-probe after those settle too.
  document.addEventListener('click', () => setTimeout(requestUpdate, 750));
  update();
})();

/* ---------- Welcome video ----------
   Plays by itself when the card comes into view — but MUTED, because that
   is the only kind of autoplay a browser permits. Sound then needs one
   user gesture, which is what the unmute button is for. There is no way
   around this: a video that starts unmuted on its own is refused outright,
   and the whole thing would sit on the poster instead.

   2.7MB, preload="none", so nothing is fetched until the card is close. */
(function () {
  const video = document.getElementById('welcomeVideo');
  const playBtn = document.getElementById('welcomePlay');
  const muteBtn = document.getElementById('welcomeMute');
  if (!video || !playBtn || !muteBtn) {
    return;
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const expensive = Boolean(
    connection && (connection.saveData || /^(slow-)?2g$/.test(connection.effectiveType || ''))
  );
  const stillness = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Both of these suppress the AUTOMATIC start only. Pressing play still
  // works either way — an explicit request outranks a guess about intent.
  const mayAutoPlay = !expensive && !stillness;

  let loaded = false;
  let wanted = false;
  /* Whether the visitor has DELIBERATELY silenced it. The video is also
     muted while autoplaying, but that is the browser's requirement rather
     than their choice — the two must not be confused, or pressing play
     would override a decision they actually made. */
  let userMuted = false;

  function setPlayState(playing) {
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.setAttribute('aria-label', playing ? 'Pause the film' : 'Play the film');
  }

  function setMuteState(muted) {
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? 'Unmute the film' : 'Mute the film');
  }

  /* Try with sound first, and only fall back to silence if the browser
     refuses. Autoplay policies are not a flat no: Chrome permits unmuted
     autoplay once a visitor has built up engagement with the site, and any
     earlier interaction on the page counts too. So on many visits this
     simply works — and where it does not, the fallback below covers it. */
  function start() {
    if (!loaded) {
      loaded = true;
      video.load();
    }

    if (!userMuted) {
      video.muted = false;
    }

    const playing = video.play();
    if (playing && typeof playing.catch === 'function') {
      playing.catch(function () {
        // Refused because of the sound. Retry silently — muted autoplay is
        // always allowed — and arm the first-gesture unmute below.
        if (!video.muted && !userMuted) {
          video.muted = true;
          armUnmuteOnGesture();
          const silent = video.play();
          if (silent && typeof silent.catch === 'function') {
            silent.catch(function () {
              wanted = false;
              setPlayState(false);
            });
          }
          return;
        }
        wanted = false;
        setPlayState(false);
      });
    }
  }

  /* The browser would not start it aloud, so the next best thing is the
     visitor's very next action — a tap, a click, a key, a scroll-ending
     touch. Any of those is a user gesture, and one gesture is all the
     autoplay policy ever wanted. Fires once, then removes itself. */
  let armed = false;
  function armUnmuteOnGesture() {
    if (armed) {
      return;
    }
    armed = true;

    const events = ['pointerdown', 'keydown', 'touchend'];

    function unmuteOnce() {
      events.forEach(function (evt) {
        window.removeEventListener(evt, unmuteOnce);
      });
      // Only if they have not since chosen silence, and it is still running
      if (!userMuted && !video.paused) {
        video.muted = false;
      }
    }

    events.forEach(function (evt) {
      window.addEventListener(evt, unmuteOnce, { once: true, passive: true });
    });
  }

  playBtn.addEventListener('click', function () {
    wanted = video.paused;
    if (wanted) {
      /* This click is a user gesture, which is the one thing that permits
         audio. Autoplay had to be silent; a deliberate press did not, and
         pressing play on a film plainly means wanting the film. Honoured
         unless they have muted it themselves. */
      if (!userMuted) {
        video.muted = false;
      }
      start();
    } else {
      video.pause();
    }
  });

  muteBtn.addEventListener('click', function () {
    // A click is a user gesture, which is precisely what unmuting requires
    video.muted = !video.muted;
    userMuted = video.muted; // remember it, so play() will not undo it
    setMuteState(video.muted);
  });

  /* Driven by the element's own events, not by the click: a video can pause
     itself — stalling, a tab switch, a refused play() — and the icons have
     to show what is true rather than what was last asked for. */
  video.addEventListener('play', function () {
    setPlayState(true);
  });
  video.addEventListener('pause', function () {
    setPlayState(false);
  });
  video.addEventListener('volumechange', function () {
    setMuteState(video.muted);
  });

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          if (mayAutoPlay || wanted) {
            start();
          }
        } else if (!video.paused) {
          // Off screen it decodes frames nobody is watching — and would
          // keep playing audio out of an empty card.
          video.pause();
        }
      });
    },
    { rootMargin: '100px 0px' }
  );
  observer.observe(video);

  setPlayState(false);
  setMuteState(video.muted);
})();

/* ---------- Cuisine carousel ----------
   A true loop, not a modulo. The previous version jumped the index from
   the last slide back to 0, which translated the track from -700% to 0 —
   so "next" at the end visibly rewound backwards through every slide.

   The fix is the standard one: a clone of the last slide sits before the
   first, and a clone of the first sits after the last. Stepping past
   either end animates onto a clone — which looks exactly like continuing —
   and then the track is repositioned onto the real slide with the
   transition switched off, so the correction is invisible. */
(function () {
  const track = document.getElementById('cuisineTrack');
  const dots = document.getElementById('cuisineDots');
  const prev = document.getElementById('cuisinePrev');
  const next = document.getElementById('cuisineNext');
  if (!track || !dots || !prev || !next) {
    return;
  }

  const slides = Array.from(track.children);
  const count = slides.length;
  if (count < 2) {
    return;
  }

  // Clones are decoration; screen readers already have the originals.
  const head = slides[0].cloneNode(true);
  const tail = slides[count - 1].cloneNode(true);
  head.setAttribute('aria-hidden', 'true');
  tail.setAttribute('aria-hidden', 'true');
  track.appendChild(head);
  track.insertBefore(tail, slides[0]);

  // Position in the padded track: 0 is the tail clone, 1..count the real
  // slides, count+1 the head clone.
  let position = 1;
  let animating = false;
  let safety = null;

  function place(animate) {
    track.style.transition = animate ? '' : 'none';
    track.style.transform = 'translateX(-' + position * 100 + '%)';
    if (!animate) {
      // Read a layout property to force the change to apply before the
      // transition is restored, or the browser coalesces both and the
      // correction animates after all.
      void track.offsetWidth;
      track.style.transition = '';
    }
  }

  function realIndex() {
    return (position - 1 + count) % count;
  }

  function paintDots() {
    const active = realIndex();
    buttons.forEach(function (dot, i) {
      dot.setAttribute('aria-current', String(i === active));
    });
  }

  // Built from the slide count, so adding a photo needs no matching dot.
  const buttons = slides.map(function (slide, i) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', 'Photo ' + (i + 1) + ' of ' + count);
    dot.addEventListener('click', function () {
      // Always lands on a real slide, so no clone correction is pending
      position = i + 1;
      animating = false;
      clearTimeout(safety);
      place(true);
      paintDots();
    });
    dots.appendChild(dot);
    return dot;
  });

  /* Guarded because the padding is only ONE slide deep at each end. Two
     quick clicks at the last slide would put position at count+2, where
     there is no clone and nothing to show. */
  function step(delta) {
    if (animating) {
      return;
    }
    animating = true;
    position += delta;
    place(true);
    paintDots();

    // transitionend is not guaranteed — an interrupted or zero-length
    // transition never fires it, and the carousel would lock forever.
    clearTimeout(safety);
    safety = setTimeout(release, 900);
  }

  function release() {
    animating = false;
  }

  /* Once the move onto a clone has finished, hop to the identical real
     slide with no animation. Nothing appears to happen. */
  track.addEventListener('transitionend', function (event) {
    if (event.propertyName !== 'transform') {
      return;
    }
    if (position === count + 1) {
      position = 1;
      place(false);
    } else if (position === 0) {
      position = count;
      place(false);
    }
    clearTimeout(safety);
    release();
  });

  prev.addEventListener('click', function () {
    step(-1);
  });
  next.addEventListener('click', function () {
    step(1);
  });

  place(false);
  paintDots();
})();

/* ---------- Explore strip ---------- */
(function () {
  const strip = document.getElementById('exploreStrip');
  const left = document.getElementById('exploreLeft');
  const right = document.getElementById('exploreRight');
  if (!strip || !left || !right) {
    return;
  }

  // Measured live rather than hardcoded: the card width is a clamp(), so
  // it differs at every viewport. +6 accounts for the flex gap.
  const step = () => strip.querySelector('figure').offsetWidth + 6;

  left.addEventListener('click', () => strip.scrollBy({ left: -step(), behavior: 'smooth' }));
  right.addEventListener('click', () => strip.scrollBy({ left: step(), behavior: 'smooth' }));
})();

/* ---------- Pictures moving inside fixed frames ----------
   The frames stay put; each PICTURE slides vertically inside its own
   frame as the section crosses the viewport — one up, one down. Only
   `transform` is touched, so the work happens on the compositor and the
   overlay text never moves. */
(function () {
  const section = document.querySelector('.twoImagesContainer');
  if (!section) {
    return;
  }

  const pictures = section.querySelectorAll('[data-parallax]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let ticking = false;
  let onScreen = false;

  // Travel distance lives in CSS so the media queries can retune it.
  function shiftDistance() {
    const parsed = parseFloat(getComputedStyle(section).getPropertyValue('--parallax-shift'));
    return Number.isNaN(parsed) ? 48 : parsed;
  }

  function measure() {
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    const rect = section.getBoundingClientRect();
    const topDoc = rect.top + scrollY;
    const maxScroll = Math.max(document.documentElement.scrollHeight - viewportHeight, 0);

    // Ideal window: from "about to enter the bottom of the viewport" to
    // "has fully cleared the top"…
    let start = topDoc - viewportHeight;
    let end = topDoc + rect.height;

    // …clamped to the scroll this page can actually perform, so a section
    // near either end of the document still plays its full range rather
    // than a frozen-looking sliver.
    start = Math.max(start, 0);
    end = Math.min(end, maxScroll);

    const span = end - start;
    // span <= 0 means the page cannot scroll; park everything level.
    const progress = span > 0 ? Math.min(Math.max((scrollY - start) / span, 0), 1) : 0.5;

    return { progress, span, scrollY, maxScroll };
  }

  function update() {
    ticking = false;

    const shift = reduceMotion.matches ? 0 : shiftDistance();
    const { progress } = measure();

    // Remap 0..1 to -1..1 so the pictures sit centred at the midpoint and
    // reach the edge of their surplus at either end.
    const offset = (progress - 0.5) * 2 * shift;

    pictures.forEach((picture) => {
      const direction = picture.dataset.parallax === 'up' ? -1 : 1;
      picture.style.transform = `translate3d(0, ${offset * direction}px, 0)`;
    });
  }

  function requestUpdate() {
    if (ticking || !onScreen) {
      return;
    }
    ticking = true;
    // One update per frame, however many scroll events fire between them
    requestAnimationFrame(update);
  }

  // Don't run the maths while the section is off screen
  new IntersectionObserver(
    (entries) => {
      onScreen = entries[0].isIntersecting;
      requestUpdate();
    },
    { rootMargin: '150px 0px' }
  ).observe(section);

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  reduceMotion.addEventListener('change', () => {
    onScreen = true;
    requestUpdate();
  });

  update();
})();

//===============================================
// Newsletter: the confirmation on subscribe.html, and the prompt that
// leads people there from everywhere else.
//
// The prompt builds its own DOM rather than being marked up on all eight
// pages. One definition, and adding a page cannot forget it.

const NEWSLETTER = {
  KEY: 'ikshaa.newsletter',
  QUIET_DAYS: 30,     // how long a dismissal is respected
  DELAY_MS: 3000,     // or a scroll past SCROLL_AT, whichever lands first
  SCROLL_AT: 0.3,
};

/* localStorage throws outright in some private-browsing modes, so every
   touch of it is guarded. Failing to remember a dismissal is a small
   annoyance; throwing here would take the rest of this file down with it. */
function newsletterState() {
  try {
    return JSON.parse(localStorage.getItem(NEWSLETTER.KEY)) || {};
  } catch (e) {
    return {};
  }
}

function rememberNewsletter(patch) {
  try {
    const next = Object.assign(newsletterState(), patch);
    localStorage.setItem(NEWSLETTER.KEY, JSON.stringify(next));
  } catch (e) {
    /* nothing to do — the prompt simply reappears next visit */
  }
}

/* What the page says after somebody clicks the link in their email.
 *
 * The Worker redirects here with ?confirmed=… rather than showing its own
 * JSON. Each outcome gets a different sentence, because "your link expired"
 * and "you are already on the list" need different things from the reader —
 * one is an action, the other is reassurance. */
/* What the landing card says, per state.
 *
 * Five moments, and they need different things from the reader. "Check your
 * inbox" is an instruction and needs the hints; "you are on the list" is
 * reassurance and does not. "Your link expired" is a problem and must leave
 * the form reachable, because telling somebody to try again while hiding the
 * way to do it is a dead end.
 *
 * The Airbnb link is on every one of them. Somebody who has just handed over
 * their address is the most interested they will ever be, and a page that
 * only says thank you wastes that moment. Offered, never forced.
 */
const LANDING = {
  /* Signing up now finishes at signup. There is no link to wait for, so
     there is nothing to instruct the reader to do — this is the same
     reassurance as `yes`, arrived at a different way. The old "check your
     inbox" wording is gone with the email that justified it. */
  pending: {
    eyebrow: 'Done',
    title: 'You are on the list',
    text: 'That is everything — no link to click and nothing else to do. The first letter ' +
      'will reach you within the week: short, from the house, and never more than one a ' +
      'week. Every letter has an unsubscribe link at the foot of it.',
    hints: false,
    formStaysUp: false,
  },
  yes: {
    eyebrow: 'Confirmed',
    title: 'You are on the list',
    text: 'That is you. The first letter will reach you within the week — short, from the ' +
      'house, and never more than one a week. While you are here, the dates are on Airbnb.',
    hints: false,
    formStaysUp: false,
  },
  already: {
    eyebrow: 'Confirmed',
    title: 'You were already on the list',
    text: 'You confirmed this address before, and you still are. Nothing changed, and ' +
      'nothing has been sent twice.',
    hints: false,
    formStaysUp: false,
  },
  expired: {
    eyebrow: 'That link has expired',
    title: 'Links last three days',
    text: 'Yours has run out — nothing went wrong, it simply stopped working. Put your ' +
      'address in again below and a fresh link will arrive in a moment.',
    hints: false,
    formStaysUp: true,
  },
  unknown: {
    eyebrow: 'That link did not work',
    title: 'Something got lost on the way',
    text: 'Email clients sometimes cut long links in half, and a newer link replaces any ' +
      'older one. Subscribing again below will send a fresh one.',
    hints: false,
    formStaysUp: true,
  },
};

function showLanding(state) {
  const card = document.getElementById('subscribeCard');
  const thanks = document.getElementById('subscribeThanks');
  const said = LANDING[state] || LANDING.unknown;
  if (!thanks) {
    return;
  }

  const set = (id, text) => {
    const node = document.getElementById(id);
    if (node) { node.textContent = text; }
  };
  set('thanksEyebrow', said.eyebrow);
  set('thanksTitle', said.title);
  set('thanksText', said.text);

  const hints = document.getElementById('thanksHints');
  if (hints) { hints.hidden = !said.hints; }

  thanks.hidden = false;
  if (card) { card.hidden = !said.formStaysUp; }
  if (state === 'yes' || state === 'already') { rememberNewsletter({ subscribed: true }); }

  thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function initSubscribeConfirmation() {
  const card = document.getElementById('subscribeCard');
  const thanks = document.getElementById('subscribeThanks');
  if (!card || !thanks) {
    return;
  }

  const params = new URLSearchParams(window.location.search);

  // Back from the link in the email.
  const confirmed = params.get('confirmed');
  if (confirmed) {
    showLanding(confirmed);
    return;
  }

  /* Back from a native form post. There is no confirmation step any more, so
     landing here means the address was taken and the reader is done. */
  if (params.get('subscribed') === '1') {
    showLanding('pending');
  }
}

function initNewsletterPrompt() {
  // Not on the subscribe page itself — they are already where it points.
  if (document.getElementById('subscribeCard')) {
    return;
  }

  /* ?newsletter=now shows it immediately and ignores what has been stored.
     Without this there is no way to look at the thing once you have
     dismissed it: the same key silences it for thirty days across every
     page, so "it never appears" and "it appeared and I closed it last
     Tuesday" are indistinguishable from the outside. */
  const mode = new URLSearchParams(window.location.search).get('newsletter');
  const forced = mode === 'now';

  // ?newsletter=reset forgets the stored state and then behaves exactly like
  // a first visit — real delay, real scroll trigger, no devtools.
  if (mode === 'reset') {
    try {
      localStorage.removeItem(NEWSLETTER.KEY);
    } catch (e) {
      /* nothing stored to clear */
    }
  }

  /* Previewing must not write to the thing being previewed. With
     ?newsletter=now a dismissal still persisted, so looking at the modal
     twice meant clearing localStorage by hand in between — which defeats
     the point of having a preview at all. */
  const remember = (patch) => {
    if (!forced) {
      rememberNewsletter(patch);
    }
  };

  if (!forced) {
    const state = newsletterState();
    if (state.subscribed) {
      return;
    }
    if (state.dismissedAt) {
      const days = (Date.now() - state.dismissedAt) / 86400000;
      if (days < NEWSLETTER.QUIET_DAYS) {
        return;
      }
    }
  }

  const pop = document.createElement('div');
  pop.className = 'newsletterPop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-labelledby', 'newsletterPopTitle');
  pop.hidden = true;

  /* The photograph carries data-src, not src, for the same reason the hero
     slides do: this is built at page load but not shown for at least 20
     seconds, and it must not compete with the page for bandwidth in the
     meantime. It is the one portrait image in the set, which is what a
     half-modal panel wants — and 17 KB of it. */
  pop.innerHTML =
    '<div class="newsletterPopCard">' +
    '<button class="newsletterPopClose" type="button" aria-label="Close">&times;</button>' +
    '<div class="newsletterPopFigure">' +
    '<img data-src="./media/images/machilaChairInCourtyard.avif" alt="" ' +
    'width="1200" height="1804" decoding="async">' +
    '</div>' +
    '<div class="newsletterPopBody">' +
    '<p class="eyebrow">Letters from Ikshaa</p>' +
    '<h2 class="newsletterPopTitle" id="newsletterPopTitle">The house writes, now and then</h2>' +
    '<p class="newsletterPopText">Not a mailing list. A letter from Loutolim about what is ' +
    'flowering, what the cook is making, and what the weather has been doing to the courtyard.</p>' +
    '<ul class="newsletterPopList">' +
    '<li>One letter a week</li>' +
    '<li>A note when the season turns</li>' +
    '<li>No offers, no campaigns</li>' +
    '</ul>' +
    '<div class="newsletterPopActions">' +
    '<a class="ctaButton" href="subscribe.html">Subscribe</a>' +
    '<button class="newsletterPopLater" type="button">Not now</button>' +
    '</div>' +
    '</div>' +
    '</div>';

  document.body.appendChild(pop);

  const closeButton = pop.querySelector('.newsletterPopClose');
  let shown = false;
  let returnFocusTo = null;

  function show() {
    if (shown) {
      return;
    }
    shown = true;
    clearTimeout(timer);
    window.removeEventListener('scroll', onScroll);

    hydrate(pop.querySelector('img[data-src]'));

    returnFocusTo = document.activeElement;
    pop.hidden = false;
    document.body.classList.add('newsletterOpen');

    // Two frames, same reason as the hero: the browser has to commit the
    // starting opacity before the class lands, or it appears without the
    // transition running.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pop.classList.add('isVisible');
      closeButton.focus();
    }));
  }

  function dismiss() {
    pop.classList.remove('isVisible');
    document.body.classList.remove('newsletterOpen');
    remember({ dismissedAt: Date.now() });

    // Focus must not be left on an element that is about to be hidden, or
    // a keyboard user is stranded with nothing selected.
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
      returnFocusTo.focus();
    }
    setTimeout(() => { pop.hidden = true; }, 500); // after the fade
  }

  function onScroll() {
    const seen = window.scrollY / Math.max(document.body.scrollHeight - window.innerHeight, 1);
    if (seen > NEWSLETTER.SCROLL_AT) {
      show();
    }
  }

  const timer = setTimeout(show, forced ? 400 : NEWSLETTER.DELAY_MS);
  window.addEventListener('scroll', onScroll, { passive: true });

  closeButton.addEventListener('click', dismiss);
  pop.querySelector('.newsletterPopLater').addEventListener('click', dismiss);

  // Clicking the darkened surround closes it; clicking the card must not.
  pop.addEventListener('click', (event) => {
    if (event.target === pop) {
      dismiss();
    }
  });

  // Following the link is not a dismissal, but it should not reappear on
  // the way there either.
  pop.querySelector('.ctaButton').addEventListener('click', () => {
    remember({ dismissedAt: Date.now() });
    document.body.classList.remove('newsletterOpen');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pop.hidden) {
      dismiss();
    }
  });
}

if (document.readyState === 'complete') {
  initSubscribeConfirmation();
  initNewsletterPrompt();
} else {
  window.addEventListener('load', () => {
    initSubscribeConfirmation();
    initNewsletterPrompt();
  }, { once: true });
}

//===============================================
// Catching a mistyped address before it is submitted.
//
// A typo here is silent and total: the form succeeds, the confirmation email
// goes to nobody, and the person waits for a letter that can never arrive.
// Nothing downstream can detect it — an address is only proved real by mail
// reaching it, which is exactly what a typo prevents.
//
// So this warns, and never blocks. It cannot know an address is wrong, only
// that it looks like a common slip, and a real address that trips one of
// these rules must still go through.

const EMAIL_TYPOS = {
  // The domains people actually mistype, and what they meant.
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outloo.com': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com',
  'rediffmial.com': 'rediffmail.com',
};

// .com is the ending people fumble, because m and n are neighbours.
const TLD_TYPOS = { con: 'com', cim: 'com', clm: 'com', comm: 'com', cmo: 'com', ocm: 'com' };

function emailConcern(raw) {
  const value = String(raw || '').trim();
  if (!value || value.indexOf('@') === -1) {
    return null;                       // type="email" already covers this
  }

  const at = value.lastIndexOf('@');
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();

  if (!local) {
    return { message: 'There is nothing before the @.' };
  }
  if (value.split('@').length > 2) {
    return { message: 'That address has more than one @.' };
  }
  if (domain.indexOf('.') === -1) {
    return { message: 'That domain has no ending — did you mean ' + domain + '.com?',
             suggestion: local + '@' + domain + '.com' };
  }
  if (/\.\.|^\.|\.$/.test(domain)) {
    return { message: 'There is a stray dot in the domain.' };
  }
  if (/[,;]/.test(value)) {
    return { message: 'That looks like it has a comma where a dot should be.',
             suggestion: value.replace(/[,;]/g, '.') };
  }

  if (EMAIL_TYPOS[domain]) {
    return { message: 'Did you mean ' + EMAIL_TYPOS[domain] + '?',
             suggestion: local + '@' + EMAIL_TYPOS[domain] };
  }

  const bits = domain.split('.');
  const tld = bits[bits.length - 1];
  if (TLD_TYPOS[tld]) {
    const fixed = bits.slice(0, -1).concat(TLD_TYPOS[tld]).join('.');
    return { message: 'Did you mean .' + TLD_TYPOS[tld] + '?', suggestion: local + '@' + fixed };
  }

  return null;
}

function initEmailWarning() {
  const field = document.getElementById('subEmail');
  if (!field) {
    return;
  }

  const note = document.createElement('p');
  note.className = 'fieldWarn';
  note.hidden = true;
  // polite, not assertive: this is a suggestion, and it must not interrupt
  // somebody midway through typing their own address.
  note.setAttribute('aria-live', 'polite');
  field.insertAdjacentElement('afterend', note);

  function check() {
    const concern = emailConcern(field.value);
    if (!concern) {
      note.hidden = true;
      note.textContent = '';
      return;
    }

    note.hidden = false;
    note.textContent = concern.message + ' ';

    if (concern.suggestion) {
      const fix = document.createElement('button');
      fix.type = 'button';               // never submits the form
      fix.className = 'fieldWarnFix';
      fix.textContent = 'Use ' + concern.suggestion;
      fix.addEventListener('click', () => {
        field.value = concern.suggestion;
        note.hidden = true;
        field.focus();
      });
      note.appendChild(fix);
    }
  }

  // On blur, not on every keystroke: warning somebody their address is wrong
  // while they are still halfway through typing it is just noise.
  field.addEventListener('blur', check);
  field.addEventListener('input', () => {
    if (!note.hidden) {
      check();                            // once shown, keep it honest live
    }
  });
}

if (document.readyState === 'complete') {
  initEmailWarning();
} else {
  window.addEventListener('load', initEmailWarning, { once: true });
}

//===============================================
// Posting the subscription to the API, when there is one.
//
// The form still carries data-netlify and a real action, so with JavaScript
// off — or before the API exists — it submits the ordinary way and Netlify
// captures it. Nothing here is required for the page to work.
//
// When the API IS configured, this intercepts instead, because only the API
// does double opt-in: Netlify Forms records an address, it does not prove
// anybody asked for it.

/* The Worker that actually stores subscriptions.
 *
 * This was empty while the site lived on Netlify, where `data-netlify` on the
 * form meant the host captured submissions itself. On Cloudflare Pages that
 * attribute means nothing and a POST to a static file is a 405 — so for a
 * while the live form accepted an address, showed "check your inbox", and
 * threw it away. Worse than an error, because it lied. */
const NEWSLETTER_API = 'https://ikshaa-api.sachinkumarbari162x.workers.dev';

function initSubscribeApi() {
  const form = document.querySelector('.subscribeFormFull');
  if (!form || !NEWSLETTER_API) {
    return;                       // no form here, or no API yet
  }

  const status = document.createElement('p');
  status.className = 'formStatus';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  form.appendChild(status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const button = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());

    // Checkboxes are absent when unticked; the API reads absent as yes, so
    // send an explicit 0 rather than letting a deliberate opt-out vanish.
    data.weekly = form.querySelector('[name="weekly"]').checked ? 1 : 0;
    data.seasonal = form.querySelector('[name="seasonal"]').checked ? 1 : 0;

    /* Turnstile writes its token into a hidden input it injects itself, so
       FormData has already picked it up under Cloudflare's name. Renamed
       here so the API contract does not carry the vendor in its field
       names — swapping the challenge later should not change the endpoint. */
    data.captcha = data['cf-turnstile-response'] || '';
    delete data['cf-turnstile-response'];

    if (!data.captcha) {
      status.hidden = false;
      status.textContent = 'Please complete the "are you a person" check just above the button.';
      return;
    }

    button.disabled = true;
    status.hidden = false;
    status.textContent = 'Sending…';

    try {
      const res = await fetch(NEWSLETTER_API.replace(/\/$/, '') + '/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.ok) {
        showLanding(body.next === 'already-subscribed' ? 'already' : 'pending');
        return;
      }

      /* The API explains WHY when it turns an address away — a throwaway
         domain, a placeholder, a domain that cannot receive mail. Those
         sentences are written for the reader and are the whole point of
         checking: "invalid email" teaches nobody anything, and they retype
         the same address. */
      status.textContent = body.message || (body.details && body.details[0]) ||
        'That did not go through. Try again, or write to nyaragoa@gmail.com.';
      // A failed challenge is single-use; the widget must issue a fresh one.
      if (window.turnstile && typeof window.turnstile.reset === 'function') {
        try { window.turnstile.reset(); } catch (e) { /* not rendered yet */ }
      }
      button.disabled = false;
    } catch (e) {
      /* Offline, blocked, or the API is down.
         There is no host-side form handler to fall back to any more, so
         submitting natively would 405 and lose the address. Say so instead
         and leave the form filled in, so nothing typed is thrown away. */
      status.textContent = 'That did not reach us — check your connection and try again, ' +
        'or write to nyaragoa@gmail.com.';
      button.disabled = false;
    }
  });
}

if (document.readyState === 'complete') {
  initSubscribeApi();
} else {
  window.addEventListener('load', initSubscribeApi, { once: true });
}
