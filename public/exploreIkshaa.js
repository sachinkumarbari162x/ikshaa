/* ============================================================================
 * IKSHAA — VILLA TOUR
 *
 * No dependencies. The previous build pulled jQuery from a CDN, which on a
 * slow or distant connection cost a DNS lookup, a TCP handshake, a TLS
 * negotiation and ~30KB before a single line of this file could run. Every
 * DOM call below is plain platform API; nothing is loaded from a third party.
 *
 * Loading strategy, in short:
 *   - only rooms near the current position are fetched, never all 35
 *   - how far ahead we look is decided from the actual connection speed
 *   - the first room is preloaded from the markup so it paints immediately
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
   * Config
   * ------------------------------------------------------------------ */
  var CONFIG = {
    IMG_DIR: './media/images/',

    SEGMENT: 820,        // px of scroll per room
    SPAN_RATIO: 1.5,     // a room lives for 1.5 segments, so neighbours overlap
    FADE: 0.22,          // fraction of a span spent fading in / out

    SMOOTHING: 0.085,    // scroll easing per frame
    SETTLE: 0.4,         // px — closer than this and we just land

    PARALLAX_PX: 22,     // pointer-driven drift of the photo
    PARALLAX_EASE: 0.06,

    AUTO_MS: 2600,       // base dwell per room in auto tour, before its pause

    // Blur is capped low on purpose: a full-screen blur() is one of the
    // most expensive things a compositor can be asked for, and these only
    // ever run during a crossfade.
    BLUR_MAX: 5
  };


  /* ---------------------------------------------------------------------
   * Camera roles
   *
   * What a photograph is OF decides how the camera treats it. An approach
   * pushes forward; a reveal steps back and takes the space in; a detail
   * leans in slowly; a calm frame barely moves at all.
   *
   * zoom  — frame scale at the start and end of the room's window. The
   *         range is deliberately tiny: at 1200x800 these are already
   *         upscaled to fill the screen, and every extra 1% of zoom is
   *         another 1% of softness.
   * blur  — px of blur at the edges of the window, resolving to 0 in the
   *         middle. The frame arrives out of focus and settles, which makes
   *         the settled state read as sharper than it is.
   * hold  — fraction of the window spent fully opaque. Higher means the
   *         image sits still for longer before it starts to leave, which is
   *         the pause you feel when scrolling by hand.
   * pause — extra ms the auto tour dwells here, on top of AUTO_MS.
   * ------------------------------------------------------------------ */
  var ROLE = {
    // walking toward something
    APPROACH: { zoom: [1.000, 1.055], blur: 2.4, hold: 0.52, pause: 220 },
    // the space opens up and you stop
    REVEAL:   { zoom: [1.050, 1.000], blur: 3.4, hold: 0.62, pause: 500 },
    // an object, close, quiet
    DETAIL:   { zoom: [1.020, 1.060], blur: 4.2, hold: 0.56, pause: 320 },
    // a room you are standing in
    INTERIOR: { zoom: [1.000, 1.045], blur: 2.8, hold: 0.58, pause: 300 },
    // nothing is happening, and that is the point
    CALM:     { zoom: [1.040, 1.010], blur: 3.0, hold: 0.68, pause: 500 },
    /* The poolside. `swing` makes the zoom travel out and back within a
       single room instead of drifting one way — a slow breath in and out,
       so the frame is still moving while the water is playing. The long
       hold and the pause are there to keep the visitor still long enough
       to actually hear it. */
    POOL:     { zoom: [1.000, 1.075], blur: 2.0, hold: 0.72, pause: 300, swing: true }
  };

  /* ---------------------------------------------------------------------
   * The tour. One entry per room, in walking order: gate, drive, door,
   * courtyard, living, bedrooms, kitchen, table, water, garden, night.
   * Adding a photo means adding a line here and nothing else.
   * ------------------------------------------------------------------ */
  var TOUR = [
    { ch: 'Arrival', r: 'APPROACH', file: 'mainGateOfIkshaa.avif', title: 'The gate', note: 'A wall, a name, and a lane that gives no clue what is behind it.' },
    { ch: 'Arrival', r: 'APPROACH', file: 'driveWayFrommainGateToIkshaaVillaEntrance.avif', title: 'The drive', note: 'Long enough that the village noise is gone before the house appears.' },
    { ch: 'Arrival', r: 'APPROACH', file: 'entranceviewfromstepOne.webp', title: 'From the first step', note: 'The house does not announce itself. It waits until you are inside.' },
    { ch: 'Arrival', r: 'DETAIL', file: 'entranceGatewithRails.avif', title: 'At the rails', note: 'The first look through — courtyard light, already visible from the road.' },
    { ch: 'Arrival', r: 'DETAIL', file: 'mainDoor.avif', title: 'The door', note: 'Generous thresholds — a familiar Goan form, carried forward.' },
    { ch: 'Arrival', r: 'REVEAL', file: 'EntranceOfIkshaaInsideToOutside.webp', title: 'Looking back out', note: 'Every doorway here frames something. This one frames the way you came.' },

    { ch: 'Courtyard', r: 'REVEAL', file: 'CourtYard.avif', title: 'The courtyard', note: 'A courtyard brings the sky into the centre of domestic life.' },
    { ch: 'Courtyard', r: 'CALM', file: 'theCourtyard.avif', title: 'Open to the weather', note: 'Open above, sheltered all round — the oldest idea in the house.' },
    { ch: 'Courtyard', r: 'DETAIL', file: 'centreCourtyardDecoration.avif', title: 'At the centre', note: 'The point everything else is arranged around.' },
    { ch: 'Courtyard', r: 'CALM', file: 'machilaChairInCourtyard.avif', title: 'The machila chair', note: 'Made to be sat in slowly, in the part of the day nobody has planned.' },

    { ch: 'Living', r: 'REVEAL', file: 'Relax_Chill_Unwind_in_this_living_room!.avif', title: 'The living room', note: 'Air-conditioned, open to the courtyard, and where the house gathers.' },
    { ch: 'Living', r: 'DETAIL', file: 'livingroomsittingareacloseup.avif', title: 'Room to settle', note: 'Where the life of the house quietly collects at the end of a day.' },

    { ch: 'Bedrooms', r: 'INTERIOR', file: 'bedRoomOne.avif', title: 'Bedroom one', note: 'Deep shade, and light that moves slowly across the floor.' },
    { ch: 'Bedrooms', r: 'INTERIOR', file: 'bedroomOne_secondImg.avif', title: 'Morning side', note: 'Older proportions, made for the way we live now.' },
    { ch: 'Bedrooms', r: 'DETAIL', file: 'bedroomOne_secondImg_bedcloseUp.avif', title: 'Close to', note: 'A house is remembered through touch as much as sight.' },
    { ch: 'Bedrooms', r: 'INTERIOR', file: 'BathRoomOne.webp', title: 'The first bath', note: 'Cool stone underfoot, and Goa’s biggest rainshower heads.' },
    { ch: 'Bedrooms', r: 'DETAIL', file: 'bathroomOneLamps.avif', title: 'Lamplight', note: 'Recesses in the wall, where the old paraffin ponttios once stood.' },
    { ch: 'Bedrooms', r: 'INTERIOR', file: 'bedroomTwo.avif', title: 'Bedroom two', note: 'The quieter side of the house, away from the courtyard.' },
    { ch: 'Bedrooms', r: 'DETAIL', file: 'bedroomTwo_bedCloseUp.avif', title: 'Made up', note: 'Linen, timber, and the unevenness that proves a hand was here.' },
    { ch: 'Bedrooms', r: 'INTERIOR', file: 'bathroomTwo.avif', title: 'The second bath', note: 'Every bedroom has its own. Nobody queues.' },
    { ch: 'Bedrooms', r: 'INTERIOR', file: 'bedroomthree.webp', title: 'Bedroom three', note: 'Three bedrooms in all, sleeping six — the whole house is yours.' },

    { ch: 'Kitchen', r: 'REVEAL', file: 'makeyourselfagourmetmealinthislargefullyequippedkitch!.avif', title: 'The kitchen', note: 'Large, and fully equipped — cook, or let us send someone who will.' },
    { ch: 'Kitchen', r: 'DETAIL', file: 'makeyourselfagourmetmealinthislargefullyequippedkitch!_2ndImg.avif', title: 'Everything to hand', note: 'Breakfast comes with the house. Dinner comes if you ask.' },
    { ch: 'Kitchen', r: 'INTERIOR', file: 'DiningRoom.avif', title: 'The dining room', note: 'A meal is rarely only a meal. It is an invitation to stay longer.' },
    { ch: 'Kitchen', r: 'INTERIOR', file: 'dinningArea.avif', title: 'The table', note: 'Long enough for six, and for the evening to go on.' },
    { ch: 'Kitchen', r: 'DETAIL', file: 'complimentartyDrinks.avif', title: 'Poured for you', note: 'Unlimited tea, coffee and juices, all day, with our compliments.' },

    { ch: 'Water', r: 'POOL', a: 'pool', file: 'privateSwimmingPoolForYourExclusiveUse.avif', title: 'The pool', note: 'Private, for the use of your party alone.' },
    { ch: 'Water', r: 'POOL', a: 'pool', file: 'privateswimingPoolcloseUp.avif', title: 'At the edge', note: 'Nobody else books into this house while you are in it.' },
    { ch: 'Water', r: 'INTERIOR', file: 'gazebowithbarbequeFacility.avif', title: 'The gazebo', note: 'A barbeque, for the evenings you would rather cook outside.' },
    { ch: 'Water', r: 'CALM', file: 'lyingInAHammcock.avif', title: 'The hammock', note: 'An unhurried hour, and nowhere else to be.' },

    { ch: 'Garden', r: 'CALM', file: 'surroundedbyfreshairbautifulgreeneryand soundsofnature.avif', title: 'Green all round', note: 'Fresh air, greenery, and the sound of nothing in particular.' },
    { ch: 'Garden', r: 'DETAIL', file: 'flowerCloseUpfromGarden.avif', title: 'From the garden', note: 'Cut this morning, and on the table by the time you are up.' },
    { ch: 'Garden', r: 'POOL', a: 'pool', file: 'aSpringClosetoIkshaa.avif', title: 'A spring nearby', note: 'Water close by, and no particular hurry to reach it.' },

    { ch: 'Night', r: 'POOL', a: 'pool', file: 'poolSideNightView.avif', title: 'Poolside, after dark', note: 'The house changes entirely once the light goes.' },
    { ch: 'Night', r: 'REVEAL', file: 'ikshaawideViewAtNight.avif', title: 'The whole house', note: 'Candlelight, and the sky still at the centre of it.' }
  ];


  /* ---------------------------------------------------------------------
   * Network-aware loading
   *
   * navigator.connection is the only honest signal a page gets about the
   * link it arrived over. On a slow or metered connection we look a shorter
   * distance ahead, so a visitor on 3G in a distant region fetches three
   * photos rather than eleven.
   * ------------------------------------------------------------------ */
  function lookAhead() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) {
      return 3; // no signal: a middle-of-the-road guess
    }
    if (c.saveData) {
      return 1; // the visitor has explicitly asked for less
    }
    switch (c.effectiveType) {
      case 'slow-2g':
      case '2g':
        return 1;
      case '3g':
        return 2;
      default:
        return 4;
    }
  }

  var LOOK = lookAhead();

  /* Filenames here contain a space and exclamation marks, so they cannot go
     into a URL raw. encodeURIComponent leaves the safe characters alone. */
  function srcFor(file) {
    return CONFIG.IMG_DIR + encodeURIComponent(file);
  }

  /* ---------------------------------------------------------------------
   * Small maths helpers
   * ------------------------------------------------------------------ */
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function norm(v, a, b) {
    return b === a ? 0 : (v - a) / (b - a);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Smoothstep: the fades start and finish gently instead of clipping on
  // and off at the window edges.
  function ease(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /* ---------------------------------------------------------------------
   * Elements
   * ------------------------------------------------------------------ */
  var stage = document.getElementById('stage');
  var caption = document.getElementById('caption');
  var rail = document.getElementById('rail');
  var ticks = document.getElementById('ticks');
  var counter = document.getElementById('counter');
  var fill = document.getElementById('fill');
  var autoBtn = document.getElementById('autoBtn');
  var soundBtn = document.getElementById('soundBtn');
  var dotsWrap = document.getElementById('dots');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var intro = document.getElementById('intro');
  var outro = document.getElementById('outro');
  var enterBtn = document.getElementById('enterBtn');

  if (!stage) {
    return;
  }

  /* ---------------------------------------------------------------------
   * Rooms
   * ------------------------------------------------------------------ */
  function Room(data, index) {
    this.data = data;
    this.index = index;
    this.start = index * CONFIG.SEGMENT;
    this.span = CONFIG.SEGMENT * CONFIG.SPAN_RATIO;
    this.role = ROLE[data.r] || ROLE.INTERIOR;
    // Half the window that is NOT the hold, at each end. A room with a long
    // hold therefore fades faster and sits still for longer.
    this.fadeSpan = (1 - this.role.hold) / 2;
    this.loaded = false;
    this.visible = false;

    var el = document.createElement('div');
    el.className = 'room';

    var img = document.createElement('img');
    img.className = 'room__img';
    img.alt = '';
    img.decoding = 'async';
    // The first room is preloaded from the markup; give it priority and let
    // the rest queue behind it.
    img.fetchPriority = index === 0 ? 'high' : 'low';

    el.appendChild(img);
    stage.appendChild(el);

    this.el = el;
    this.img = img;
  }

  Room.prototype.load = function () {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.img.src = srcFor(this.data.file);
  };

  Room.prototype.centre = function () {
    return this.index * CONFIG.SEGMENT + CONFIG.SEGMENT * 0.5;
  };

  // Returns this room's opacity, which the caller uses to pick the live room.
  Room.prototype.render = function (scroll, px, py) {
    var p = norm(scroll, this.start, this.start + this.span);

    if (p < 0 || p > 1) {
      if (this.visible) {
        this.visible = false;
        this.el.style.visibility = 'hidden';
        this.el.style.opacity = '0';
      }
      return 0;
    }

    if (!this.visible) {
      this.visible = true;
      this.el.style.visibility = 'visible';
    }

    /* Opacity: fade in, then a flat plateau, then fade out. The plateau is
       the room's `hold` — that is the pause you feel scrolling past a REVEAL
       compared with an APPROACH. */
    var o;
    if (p < this.fadeSpan) {
      o = ease(p / this.fadeSpan);
    } else if (p > 1 - this.fadeSpan) {
      o = ease((1 - p) / this.fadeSpan);
    } else {
      o = 1;
    }

    /* Blur tracks the inverse of opacity, so the frame arrives out of focus,
       settles completely at the plateau, and softens again as it leaves.
       Resolving TO sharp is what makes the settled frame read as sharper
       than it actually is — these are only 1200px wide. */
    var blur = this.role.blur * (1 - o);

    /* A swing role goes out and back across its own window. sin(p * PI)
       peaks at the midpoint and returns to 0 at both ends, so the frame
       arrives at rest, opens up, and settles again. */
    var t = this.role.swing ? Math.sin(p * Math.PI) : p;

    var scale;
    var driftX = px;
    var driftY = py;

    if (fitContain) {
      /* The whole frame is on screen, so anything above 1 would crop it
         again — which is the thing this mode exists to prevent. The move
         is kept by running BELOW 1 instead: the frame arrives a little
         small and settles to full size. Same gesture, nothing lost. */
      scale = lerp(0.94, 1.0, t);
      // The letterbox gives the drift somewhere to go; at full size it
      // would not, so keep it small.
      driftX = px * 0.35;
      driftY = py * 0.35;
    } else {
      scale = lerp(this.role.zoom[0], this.role.zoom[1], t);
    }

    this.el.style.opacity = o.toFixed(3);
    this.el.style.transform =
      'translate3d(' + driftX.toFixed(1) + 'px,' + driftY.toFixed(1) + 'px,0) scale(' + scale.toFixed(4) + ')';
    // Skipped entirely at the plateau: a full-screen blur() filter is
    // expensive, and 'none' is far cheaper than blur(0px).
    this.el.style.filter = blur > 0.05 ? 'blur(' + Math.min(blur, CONFIG.BLUR_MAX).toFixed(2) + 'px)' : 'none';

    return o;
  };

  var rooms = TOUR.map(function (data, i) {
    return new Room(data, i);
  });

  /* ---------------------------------------------------------------------
   * Chapters — the ticks down the left
   * ------------------------------------------------------------------ */
  var chapters = [];
  TOUR.forEach(function (data, i) {
    if (!chapters.length || chapters[chapters.length - 1].name !== data.ch) {
      chapters.push({ name: data.ch, index: i });
    }
  });

  /* ---------------------------------------------------------------------
   * Chrome: rail dots and chapter ticks, both built from the data
   * ------------------------------------------------------------------ */
  var dots = rooms.map(function (room, i) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rail__dot';
    b.setAttribute('aria-label', room.data.title);
    b.addEventListener('click', function () {
      goTo(i);
    });
    (dotsWrap || rail).appendChild(b);
    return b;
  });

  var tickEls = chapters.map(function (chapter) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tick';
    b.textContent = chapter.name;
    b.addEventListener('click', function () {
      goTo(chapter.index);
    });
    ticks.appendChild(b);
    return b;
  });

  /* ---------------------------------------------------------------------
   * Page height. The document is only as tall as the tour needs.
   * ------------------------------------------------------------------ */
  function pageHeight() {
    return rooms.length * CONFIG.SEGMENT + window.innerHeight;
  }

  function setHeight() {
    document.body.style.height = pageHeight() + 'px';
  }

  /* ---------------------------------------------------------------------
   * Loop state
   * ------------------------------------------------------------------ */
  var target = 0;    // where the page actually is
  var eased = 0;     // where the camera is, chasing target
  var pointer = { x: 0, y: 0, cx: 0, cy: 0 };
  var live = -1;     // index of the room currently in front

  /* Portrait phones and narrow windows show the whole frame instead of
     filling the screen with a crop of it. */
  var containQuery = window.matchMedia('(max-width: 640px), (orientation: portrait) and (max-width: 900px)');
  var fitContain = containQuery.matches;

  function syncFit() {
    fitContain = containQuery.matches;
    document.body.classList.toggle('isContain', fitContain);
  }
  var running = false;
  var auto = false;
  var autoTimer = null;

  function maxScroll() {
    return Math.max(pageHeight() - window.innerHeight, 1);
  }

  /* Fetch the live room and its neighbours, and nothing else. */
  function loadAround(index) {
    for (var i = index - 1; i <= index + LOOK; i++) {
      if (i >= 0 && i < rooms.length) {
        rooms[i].load();
      }
    }
  }

  function setCaption(room) {
    caption.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'cap__in';

    var k = document.createElement('p');
    k.className = 'cap__kicker';
    k.textContent = room.data.ch;

    var t = document.createElement('h2');
    t.className = 'cap__title';
    t.textContent = room.data.title;

    var n = document.createElement('p');
    n.className = 'cap__note';
    n.textContent = room.data.note;

    wrap.appendChild(k);
    wrap.appendChild(t);
    wrap.appendChild(n);
    caption.appendChild(wrap);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function setLive(index) {
    if (index === live) {
      return;
    }
    live = index;

    setCaption(rooms[index]);
    loadAround(index);

    counter.textContent = pad(index + 1) + ' / ' + pad(rooms.length);

    dots.forEach(function (d, i) {
      d.setAttribute('aria-current', String(i === index));
    });

    // The active chapter is the last one that began at or before this room.
    var activeChapter = 0;
    for (var c = 0; c < chapters.length; c++) {
      if (chapters[c].index <= index) {
        activeChapter = c;
      }
    }
    tickEls.forEach(function (t, i) {
      t.setAttribute('aria-current', String(i === activeChapter));
    });

    if (prevBtn) {
      prevBtn.disabled = index === 0;
    }
    if (nextBtn) {
      nextBtn.disabled = index === rooms.length - 1;
    }

    setTrack(rooms[index].data.a || 'bed');
    warmPool(index);
    syncIconTone(rooms[index]);

    // The outro belongs to the last room only.
    if (outro) {
      outro.classList.toggle('card--on', index === rooms.length - 1);
    }
  }

  /* ---------------------------------------------------------------------
   * The frame
   * ------------------------------------------------------------------ */
  function frame() {
    var delta = target - eased;

    // Below SETTLE the easing would crawl toward the target forever, so we
    // just land on it and stop asking for frames.
    if (Math.abs(delta) < CONFIG.SETTLE) {
      eased = target;
    } else {
      eased += delta * CONFIG.SMOOTHING;
    }

    pointer.cx += (pointer.x - pointer.cx) * CONFIG.PARALLAX_EASE;
    pointer.cy += (pointer.y - pointer.cy) * CONFIG.PARALLAX_EASE;

    var best = 0;
    var bestOpacity = -1;

    for (var i = 0; i < rooms.length; i++) {
      var o = rooms[i].render(eased, pointer.cx, pointer.cy);
      if (o > bestOpacity) {
        bestOpacity = o;
        best = i;
      }
    }

    setLive(best);
    fill.style.width = (clamp(eased / maxScroll(), 0, 1) * 100).toFixed(2) + '%';

    // Keep going only while there is still motion to resolve.
    if (eased !== target || Math.abs(pointer.x - pointer.cx) > 0.1) {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function kick() {
    if (!running) {
      running = true;
      requestAnimationFrame(frame);
    }
  }

  function onScroll() {
    target = window.scrollY;
    kick();
  }

  function goTo(index) {
    window.scrollTo({ top: rooms[index].centre(), behavior: 'auto' });
    target = rooms[index].centre();
    kick();
  }


  /* ---------------------------------------------------------------------
   * Sound
   *
   * Two tracks, not eight. `relaxedMusic` is a bed that runs the whole tour;
   * at the poolside it hands over completely to `soundForPool`, so the water
   * is the only thing playing there rather than competing with a pad.
   *
   * Both are held deliberately low. The photographs lead; the sound is
   * meant to be noticed only if you stop and listen for it.
   *
   * Three browser rules shape this:
   *   1. audio cannot start without a user gesture — nothing plays until
   *      "Enter the villa" or "Auto tour" is pressed
   *   2. play() returns a promise that rejects when blocked; unhandled, that
   *      throws on every load
   *   3. preload="none", or the audio competes with the photographs
   *      the visitor is actually looking at
   * ------------------------------------------------------------------ */
  var AUDIO = {
    DIR: './media/music/',
    FADE_MS: 1800,   // default: long, so a handover is never abrupt
    STEP_MS: 50,
    TRACKS: {
      // The bed keeps the long fade — it is background, and nobody should
      // notice it arrive.
      bed:  { file: 'relaxedMusic.mp3', volume: 0.24 },

      // The pool does not. Water is the thing the guest was brought here to
      // hear, and 1800ms of ramp meant it was still nearly inaudible a full
      // second after the pool was on screen — the pause is only 300ms, so
      // the effect was over before the sound arrived. 700ms still reads as
      // a fade rather than a cut.
      pool: { file: 'soundForPool.mp3', volume: 0.38, fadeMs: 700 }
    }
  };

  var sound = {
    on: false,
    key: null,        // which track is meant to be playing
    players: {},      // key -> Audio, created once and reused
    fades: {}         // key -> interval id, so a new fade cancels the old
  };

  // No audio at all on a metered or very slow link: 6.4MB nobody asked for.
  var AUDIO_OK = LOOK > 1;

  function player(key) {
    if (!sound.players[key]) {
      var spec = AUDIO.TRACKS[key];
      var a = new Audio();
      a.src = AUDIO.DIR + encodeURIComponent(spec.file);
      a.loop = true;
      a.preload = 'none';
      a.volume = 0;
      sound.players[key] = a;
    }
    return sound.players[key];
  }

  function fade(key, to, done) {
    var a = sound.players[key];
    if (!a) {
      return;
    }
    // Cancel any fade already running on this track, or two of them fight
    // over the same volume property and it jitters.
    clearInterval(sound.fades[key]);

    var from = a.volume;
    var ms = (AUDIO.TRACKS[key] && AUDIO.TRACKS[key].fadeMs) || AUDIO.FADE_MS;
    var steps = Math.max(Math.round(ms / AUDIO.STEP_MS), 1);
    var i = 0;

    sound.fades[key] = setInterval(function () {
      i++;
      // Anything outside 0..1 throws.
      a.volume = Math.min(Math.max(from + (to - from) * (i / steps), 0), 1);
      if (i >= steps) {
        clearInterval(sound.fades[key]);
        if (done) {
          done();
        }
      }
    }, AUDIO.STEP_MS);
  }

  function setTrack(key) {
    if (!AUDIO_OK || !sound.on || key === sound.key) {
      return;
    }
    var previous = sound.key;
    sound.key = key;

    var a = player(key);
    var started = a.play();
    if (started && typeof started.catch === 'function') {
      started.catch(function () { /* blocked or missing: stay silent */ });
    }
    fade(key, AUDIO.TRACKS[key].volume);

    if (previous) {
      fade(previous, 0, function () {
        // Paused, not discarded — coming back out of the pool should not
        // re-download the bed track.
        sound.players[previous].pause();
      });
    }
  }

  /* The pool file is 1.0MB. Fetching it on load would compete with the
     photographs, so it is warmed only once the pool is a few rooms away —
     early enough to be ready, late enough not to be in the way. */
  var poolWarmed = false;
  var firstPool = -1;
  for (var pi = 0; pi < TOUR.length; pi++) {
    if (TOUR[pi].a === 'pool') {
      firstPool = pi;
      break;
    }
  }

  function warmPool(index) {
    if (poolWarmed || !AUDIO_OK || !sound.on || firstPool < 0) {
      return;
    }
    // Six rooms, not three. In an auto tour a room is ~2.6s, so three rooms
    // gave roughly 8 seconds of lead for a file that takes longer than that
    // to arrive on a slow connection — the track was still buffering when
    // the pool appeared. Six rooms is ~15s, and costs nothing extra: the
    // file is fetched once either way, just sooner.
    if (index >= firstPool - 6) {
      poolWarmed = true;
      player('pool').load();
    }
  }

  function soundOn() {
    if (!AUDIO_OK) {
      return;
    }
    sound.on = true;
    soundBtn.setAttribute('aria-pressed', 'true');
    soundBtn.setAttribute('aria-label', 'Turn sound off');

    var want = live >= 0 ? (rooms[live].data.a || 'bed') : 'bed';
    sound.key = null; // force setTrack to act
    setTrack(want);
  }

  function soundOff() {
    sound.on = false;
    soundBtn.setAttribute('aria-pressed', 'false');
    soundBtn.setAttribute('aria-label', 'Turn sound on');

    Object.keys(sound.players).forEach(function (key) {
      clearInterval(sound.fades[key]);
      sound.players[key].pause();
      sound.players[key].volume = 0;
    });
    sound.key = null;
  }

  if (soundBtn) {
    if (!AUDIO_OK) {
      soundBtn.hidden = true;
    }
    soundBtn.addEventListener('click', function () {
      if (sound.on) {
        soundOff();
      } else {
        soundOn();
      }
    });
  }

  /* ---------------------------------------------------------------------
   * Adaptive icon colour
   *
   * The button sits over whatever photograph is live, so white is not
   * always safe. This samples the part of the frame directly behind it and
   * flips the glyph to ink when that patch is pale.
   *
   * Two things make the measurement honest rather than decorative:
   *   - the sample is taken from the region the button actually covers,
   *     not the whole image
   *   - the scrim over the photo is factored in, because that is what the
   *     eye sees. Skipping it would report a bright frame as bright when
   *     the scrim has already darkened it to near black.
   *
   * getImageData throws a SecurityError on file:// — the canvas is tainted
   * by a local image. Caught, and the button keeps its white-plus-shadow
   * default, which is legible anyway. Served over HTTP it works.
   * ------------------------------------------------------------------ */
  /* 0.183 is not a taste value. White text meets 4.5:1 against a backdrop
     of luminance 0.183 and fails above it, so that is exactly where the
     glyph has to stop being white. */
  var LIGHT_CUTOFF = 0.183;

  /* How much the overlays darken the photograph at each control. Both the
     scrim and the vignette are stacked over the image, and BOTH have to be
     counted: measuring the raw pixels alone reports a bright sky as bright
     when the overlays have already taken it to near black.

       bar  = scrim 0.72 (foot of the vertical gradient) over vignette 0.42
       rail = scrim 0.11 (the gradient is at its lightest mid-height)
              over vignette 0.42 at the right edge

     The consequence is worth knowing: at 0.838 the bar can never exceed the
     cutoff, so the sound button never flips — the scrim already guarantees
     white works down there. The rail at 0.486 genuinely can, which is why
     it needed this. */
  var TONE = [];

  var probe = null;

  function toLinear(v) {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /* Average luminance of a normalised region, as it appears AFTER the
     overlays. Returns null when the pixels cannot be read. */
  function regionLuminance(img, area, darkening) {
    if (!img || !img.complete || !img.naturalWidth) {
      return null;
    }
    try {
      if (!probe) {
        probe = document.createElement('canvas');
        probe.width = 8;
        probe.height = 8;
      }
      var ctx = probe.getContext('2d', { willReadFrequently: true });

      var sx = img.naturalWidth * area[0];
      var sy = img.naturalHeight * area[1];
      var sw = img.naturalWidth * area[2];
      var sh = img.naturalHeight * area[3];
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 8, 8);

      var d = ctx.getImageData(0, 0, 8, 8).data;
      var keep = 1 - darkening;
      var sum = 0;

      for (var i = 0; i < d.length; i += 4) {
        // Composite black over the pixel FIRST, in sRGB, because that is
        // where the browser does it — then convert to linear light, which
        // is the space contrast is defined in.
        sum += 0.2126 * toLinear(d[i] * keep) +
               0.7152 * toLinear(d[i + 1] * keep) +
               0.0722 * toLinear(d[i + 2] * keep);
      }
      return sum / (d.length / 4);
    } catch (e) {
      // Tainted canvas — a local image on file://. Callers keep their
      // white-plus-shadow default, which is legible anyway.
      return null;
    }
  }

  function syncIconTone(room) {
    for (var t = 0; t < TONE.length; t++) {
      var target = TONE[t];
      var lum = regionLuminance(room.img, target.area, target.darkening);
      if (lum === null) {
        continue;
      }
      var light = lum > LIGHT_CUTOFF;
      for (var e = 0; e < target.els.length; e++) {
        target.els[e].classList.toggle('onLight', light);
      }
    }
  }

  /* area = [x, y, w, h] as fractions of the image, matching where each
     control actually sits on screen. */
  if (soundBtn) {
    TONE.push({ els: [soundBtn], area: [0.82, 0.82, 0.18, 0.18], darkening: 0.838 });
  }
  if (prevBtn || nextBtn) {
    TONE.push({
      els: [prevBtn, nextBtn].filter(Boolean),
      area: [0.86, 0.40, 0.14, 0.20],
      darkening: 0.486
    });
  }

  /* ---------------------------------------------------------------------
   * Fullscreen
   *
   * Only ever called from the Auto tour click. The Fullscreen API refuses
   * outside a user gesture, so it cannot be triggered from the timer or on
   * load. Both calls are written defensively: Safari's prefixed versions
   * return undefined rather than a promise, and a rejection here (an iframe
   * without allowfullscreen, a locked-down browser) must not stop the tour.
   * ------------------------------------------------------------------ */
  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function enterFullscreen() {
    var el = document.documentElement;
    var request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!request) {
      return; // unsupported: the tour simply runs windowed
    }
    var result = request.call(el);
    if (result && typeof result.catch === 'function') {
      result.catch(function () { /* refused — carry on windowed */ });
    }
  }

  function exitFullscreen() {
    if (!isFullscreen()) {
      return; // already out, e.g. the visitor pressed Escape
    }
    var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (!exit) {
      return;
    }
    var result = exit.call(document);
    if (result && typeof result.catch === 'function') {
      result.catch(function () {});
    }
  }

  /* Escape and F11 leave fullscreen without going through our button, which
     would otherwise leave the tour advancing behind a restored window. */
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      if (!isFullscreen() && auto) {
        stopAuto();
      }
    });
  });

  /* ---------------------------------------------------------------------
   * Auto tour
   * ------------------------------------------------------------------ */
  function stopAuto() {
    // auto is cleared FIRST: exitFullscreen fires a fullscreenchange, whose
    // handler calls back into here, and this flag is what stops that
    // bouncing between the two.
    auto = false;
    document.body.classList.remove('isAuto');
    autoBtn.setAttribute('aria-pressed', 'false');
    autoBtn.textContent = 'Auto tour';
    clearTimeout(autoTimer);
    autoTimer = null;
    exitFullscreen();
  }

  function startAuto() {
    auto = true;
    document.body.classList.add('isAuto');
    enterFullscreen();
    // A click is a user gesture, which is the only moment audio may begin.
    if (AUDIO_OK && !sound.on) {
      soundOn();
    }
    autoBtn.setAttribute('aria-pressed', 'true');
    autoBtn.textContent = 'Stop';
    // setTimeout rather than setInterval: each room dwells for its own
    // role's pause on top of the base, so a REVEAL is held half a second
    // longer than an APPROACH. An interval can only do one fixed beat.
    (function step() {
      autoTimer = setTimeout(function () {
        if (!auto) {
          return;
        }
        var next = live + 1;
        if (next >= rooms.length) {
          stopAuto();
          return;
        }
        goTo(next);
        step();
      }, CONFIG.AUTO_MS + rooms[Math.max(live, 0)].role.pause);
    })();
  }

  autoBtn.addEventListener('click', function () {
    if (auto) {
      stopAuto();
    } else {
      startAuto();
    }
  });

  /* Escape is the ONLY key that ends the tour. Scrolling and touching
     deliberately do not: the visitor can move the camera around with the
     pointer while it plays, and an accidental trackpad nudge should not
     drop them out of fullscreen halfway through the house. */
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && auto) {
      stopAuto();
    }
  });

  /* Touch drives the camera during the tour, same as the mouse does. */
  window.addEventListener('touchmove', function (e) {
    var t = e.touches && e.touches[0];
    if (!t) {
      return;
    }
    pointer.x = -(t.clientX / window.innerWidth - 0.5) * CONFIG.PARALLAX_PX;
    pointer.y = -(t.clientY / window.innerHeight - 0.5) * CONFIG.PARALLAX_PX;
    kick();
  }, { passive: true });

  /* ---------------------------------------------------------------------
   * Input
   * ------------------------------------------------------------------ */
  window.addEventListener('scroll', onScroll, { passive: true });

  window.addEventListener('resize', function () {
    setHeight();
    syncFit();
    kick();
  }, { passive: true });

  /* Rotating a phone changes the answer, and fires no resize on some
     browsers — listen to the query itself. */
  if (containQuery.addEventListener) {
    containQuery.addEventListener('change', function () {
      syncFit();
      kick();
    });
  }

  window.addEventListener('pointermove', function (e) {
    var nx = e.clientX / window.innerWidth - 0.5;
    var ny = e.clientY / window.innerHeight - 0.5;
    pointer.x = -nx * CONFIG.PARALLAX_PX;
    pointer.y = -ny * CONFIG.PARALLAX_PX;
    kick();
  }, { passive: true });

  window.addEventListener('keydown', function (e) {
    if (auto) {
      return; // the tour is driving; arrows would fight it
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      goTo(Math.min(live + 1, rooms.length - 1));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goTo(Math.max(live - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(rooms.length - 1);
    }
  });

  if (enterBtn) {
    enterBtn.addEventListener('click', function () {
      intro.classList.add('card--gone');
      // Reveals the way back, which is hidden behind the intro card
      document.body.classList.add('tourStarted');
      if (AUDIO_OK) {
        soundOn();
      }
      goTo(0);
    });
  }

  /* Manual stepping. Both clamp rather than wrap: at the gate there is no
     previous room, and the disabled state says so instead of silently
     doing nothing. */
  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      goTo(Math.max(live - 1, 0));
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      goTo(Math.min(live + 1, rooms.length - 1));
    });
  }

  var againBtn = document.getElementById('againBtn');
  if (againBtn) {
    againBtn.addEventListener('click', function () {
      goTo(0);
    });
  }

  /* ---------------------------------------------------------------------
   * Go
   * ------------------------------------------------------------------ */
  setHeight();
  syncFit();

  /* Browsers restore the previous scroll position on reload. Landing back
     at the bottom made setLive() light up the final room, which switched
     the outro card on behind the intro — that was the 'Stay a while' text
     showing through 'Enter the villa'. Start every visit at the gate. */
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);

  target = 0;
  eased = 0;
  rooms[0].load();
  loadAround(0);
  kick();
})();
