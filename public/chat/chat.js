/* =====================================================================
 * chat.js — the widget. Builds its own DOM, owns no business logic:
 * every reply comes from Bot (bot.js), which is independently testable.
 * ===================================================================== */
(function () {
    'use strict';

    var STORE_KEY = 'ikshaa.chat.transcript';
    var STATE_KEY = 'ikshaa.chat.state';
    var MAX_STORED = 40;

    /* An unbounded message is the cheapest way to make this widget misbehave:
       the matcher is TF-IDF over the input, so a pasted megabyte is a
       megabyte of tokenising and cosine scoring on the main thread, and it
       then goes into sessionStorage until the quota throws. Nobody asks a
       villa a 2000-character question — this is generous for a real one and
       flatly refuses the other kind. */
    var MAX_INPUT = 600;
    var ROLES = { me: true, bot: true };

    /* THE STUCK-CONVERSATION ROUTER IS OFF. This empty string is the switch.
     *
     * A hosted model would bill per call for as long as the site is up, on a
     * portfolio project whose owner has not yet said what kind of assistant
     * they want. That is a recurring cost against an undecided requirement,
     * which is the wrong order to spend money in. The decision is deferred,
     * not reversed.
     *
     * Nothing was removed. `api/llm.js`, the Groq route in `api/index.js`,
     * the model bench and the tests are all still here and still pass. To
     * switch it back on: deploy the route to the Worker, put GROQ_API_KEY in
     * with `wrangler secret put`, and set this to
     *
     *     https://ikshaa-api.<subdomain>.workers.dev/api/understand
     *
     * Everything below already handles both states, so that one line is the
     * whole change. Empty means the ladder ends at a person instead — which
     * is what it did before the model existed, and it is honest.
     *
     * ROUTER_MAX_PER_SESSION stays because it belongs to the router: the
     * server had its own per-address limit and daily cap, and this stopped a
     * single tab leaning on a chip from spending them. */
    var ROUTER_URL = '';
    var ROUTER_MAX_PER_SESSION = 6;
    var ASSISTANT_CHIP = 'Let the assistant read this';
    /* Must match the wording bot.js already uses in its fallback chips, or
       the stuck rung below will add a second one beside it. */
    var HUMAN_CHIP = 'Talk to a human';

    var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.4A8.4 8.4 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4z"/></svg>';
    var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';


    /* What the bubble offers, and what it actually asks.
     *
     * Two separate strings, deliberately. The old list showed the guest a
     * question they had not asked — "How many bedrooms are there?" — which
     * reads as a quiz rather than an offer of help, and made the widget feel
     * like a form waiting to be filled in.
     *
     * `say` is Carman offering something, in her voice. `ask` is the question
     * put to the bot when it is clicked, phrased the way the matcher expects.
     * Every `ask` here routes to a real intent and avoids anything sitting
     * behind an unverified fact — a prompt the bot then fumbles is worse than
     * no prompt at all.
     *
     * `where` scopes a prompt to a page, and `near` to a section on it, so
     * what Carman offers is about whatever the guest is actually looking at.
     * A prompt with neither is general and can appear anywhere.
     */
    var PROMPTS = [
        // --- the house ---------------------------------------------------
        { where: 'index',      near: 'outdoor',
          say: 'That is our pool — yours alone. Want the details?',
          ask: 'is the pool private' },
        { where: 'index',      near: 'local-eateries',
          say: 'I can point you at the places we actually eat at.',
          ask: 'are there restaurants nearby' },
        { where: 'index',      near: 'subscribe',
          say: 'I write a letter from the house each week, if you would like it.',
          ask: 'what can i ask you' },

        // --- per page ----------------------------------------------------
        { where: 'gallery',
          say: 'Carman here — happy to say which room any of these is.',
          ask: 'how many bedrooms are there' },
        { where: 'ourHeritage',
          say: 'The house has a long story. Ask me anything about staying in it.',
          ask: 'what can i ask you' },
        { where: 'findingUs',
          say: 'Getting here catches people out. Shall I talk you through it?',
          ask: 'how do i get there from the airport' },
        { where: 'goanCuisine',
          say: 'I can arrange a cook for your stay, if you would like one.',
          ask: 'can someone cook for us' },
        { where: 'exploreGoa',
          say: 'I live here — ask me what is genuinely worth the trip.',
          ask: 'what is there to do nearby' },
        { where: 'stayWithUs',
          say: 'Thinking about dates? I can tell you how booking works.',
          ask: 'how do i book' },
        { where: 'guestBook',
          say: 'Anything you would like to ask before you decide?',
          ask: 'how do i book' },
        { where: 'subscribe',
          say: 'Any questions before you hand over your address?',
          ask: 'what can i ask you' },

        // --- anywhere ------------------------------------------------------
        { say: 'I am Carman, I look after Ikshaa. Ask me anything.',
          ask: 'what can i ask you' },
        { say: 'Wondering about breakfast? It is included, and I can explain.',
          ask: 'is breakfast included' },
        { say: 'Ask me when the weather is at its best here.',
          ask: 'when is the best time to come' },
        { say: 'Not sure it sleeps your group? Ask me.',
          ask: 'how many people does it sleep' }
    ];

    /* Which page this is, from the filename, so a prompt can be scoped to it.
       "/" and "/index.html" are the same page. */
    function pageName() {
        var last = location.pathname.split('/').pop() || 'index';
        return last.replace(/\.html$/, '') || 'index';
    }

    /* Prompts for here: the ones scoped to this page or to a section of it,
       plus the general ones. A section-scoped prompt only counts once its
       element has actually been on screen — offering to talk about the pool
       before the guest has reached it is the same guesswork as before. */
    function promptsFor(seenSections) {
        var page = pageName();
        return PROMPTS.filter(function (p) {
            if (p.where && p.where !== page) { return false; }
            if (p.near) { return seenSections.indexOf(p.near) >= 0; }
            return true;
        });
    }

    var NUDGE_KEY = 'ikshaa.chat.nudged';

    function el(tag, className, html) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }

    function build() {
        var root = el('div', 'chat');

        var launcher = el('button', 'chat__launcher');
        launcher.type = 'button';
        // The gif carries no meaning to a screen reader, so the button needs its
        // own name — the visible label used to supply that.
        launcher.title = 'Ask about the villa';
        launcher.setAttribute('aria-label', 'Ask about the villa');
        launcher.setAttribute('aria-expanded', 'false');
        launcher.setAttribute('aria-controls', 'chatPanel');

        var launcherGif = el('img');
        // Animated WebP, not the 1.3MB GIF it shipped with: same animation
        // at 104KB. This sits on every page of the site, so the difference
        // is paid on every single visit.
        launcherGif.src = 'gifs/chat-icon.webp';
        launcherGif.width = 84;
        launcherGif.height = 84;
        launcherGif.decoding = 'async';
        launcherGif.alt = '';                       // decorative; button is labelled
        launcherGif.addEventListener('error', function () {
            launcher.innerHTML = ICON_CHAT;         // fall back to the line icon
        });
        launcher.appendChild(launcherGif);

        // Wrapper so the prompt can sit outside the launcher's clipping circle.
        var beacon = el('div', 'chat__beacon');

        /* A question rather than a ring: it says what the thing is FOR,
           which an animated outline never did.

           A container with TWO buttons inside, not one button — the close
           control has to be separately clickable, and a <button> inside a
           <button> is invalid and unreliable in practice. */
        var nudge = el('div', 'chat__nudge');
        nudge.hidden = true;

        var nudgeAsk = el('button', 'chat__nudge-ask');
        nudgeAsk.type = 'button';

        var nudgeClose = el('button', 'chat__nudge-close', '&times;');
        nudgeClose.type = 'button';
        // Names what it dismisses, so it cannot be mistaken for closing chat
        nudgeClose.setAttribute('aria-label', 'Dismiss these suggestions');
        nudgeClose.title = 'Dismiss suggestions';

        nudge.appendChild(nudgeAsk);
        nudge.appendChild(nudgeClose);
        beacon.appendChild(nudge);
        beacon.appendChild(launcher);

        var scrim = el('div', 'chat__scrim');
        scrim.setAttribute('aria-hidden', 'true');

        var panel = el('div', 'chat__panel');
        panel.id = 'chatPanel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Villa enquiries');
        panel.setAttribute('aria-hidden', 'true');

        var header = el('div', 'chat__header');
        var titleWrap = el('div');
        titleWrap.appendChild(el('h2', 'chat__title', 'Ikshaa Villa'));
        titleWrap.appendChild(el('span', 'chat__status',
            '<span class="chat__dot"></span>Ask anything — rates, dates, the pool'));
        var close = el('button', 'chat__close', '&times;');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close chat');
        header.appendChild(titleWrap);
        header.appendChild(el('div', 'chat__spacer'));
        header.appendChild(close);

        var log = el('div', 'chat__log');
        log.setAttribute('role', 'log');
        log.setAttribute('aria-live', 'polite');
        log.setAttribute('aria-label', 'Conversation');

        var chips = el('div', 'chat__chips');

        var form = el('form', 'chat__form');
        var input = el('textarea', 'chat__input');
        input.rows = 1;
        input.maxLength = MAX_INPUT;
        input.placeholder = 'Type your question…';
        input.setAttribute('aria-label', 'Your message');
        var send = el('button', 'chat__send', ICON_SEND);
        send.type = 'submit';
        send.setAttribute('aria-label', 'Send');
        send.disabled = true;
        form.appendChild(input);
        form.appendChild(send);

        panel.appendChild(header);
        panel.appendChild(log);
        panel.appendChild(chips);
        panel.appendChild(form);
        root.appendChild(beacon);
        root.appendChild(scrim);
        root.appendChild(panel);

        return {
            root: root, beacon: beacon, nudge: nudge, nudgeAsk: nudgeAsk, nudgeClose: nudgeClose, launcher: launcher, scrim: scrim, panel: panel,
            close: close, log: log, chips: chips, form: form, input: input, send: send
        };
    }

    function init() {
        if (!window.Bot) { console.warn('[chat] bot.js not loaded'); return; }

        var KNOWLEDGE = window.KNOWLEDGE || { BOOKING: {} };
        var ui = build();
        document.body.appendChild(ui.root);

        var bot = new window.Bot();
        var busy = false;

        /* ---------------- rendering ---------------- */

        function scroll() { ui.log.scrollTop = ui.log.scrollHeight; }

        // textContent per paragraph — never innerHTML with message text.
        function bubble(role, text) {
            var node = el('div', 'chat__msg chat__msg--' + role);
            String(text).split(/\n{2,}/).forEach(function (para) {
                var p = document.createElement('p');
                p.textContent = para.replace(/\n/g, ' ');
                node.appendChild(p);
            });
            ui.log.appendChild(node);
            scroll();
            return node;
        }

        function renderChips(list) {
            ui.chips.textContent = '';
            (list || []).forEach(function (label) {
                var chip = el('button', 'chat__chip');
                chip.type = 'button';
                chip.textContent = label;
                chip.addEventListener('click', function () {
                    /* Most chips are just a question typed for you. This one
                       is an action: sending its label as a message would ask
                       the bot "let the assistant read this", which is exactly
                       the kind of thing it cannot answer. */
                    if (label === ASSISTANT_CHIP) {
                        renderChips([]);
                        var dots = typing();
                        busy = true;
                        askAssistant(lastGuestText, []).then(function (routed) {
                            dots.remove();
                            busy = false;
                            saveState();
                            say(routed ? routed.text : handoffText(), routed ? [] : ['Start over']);
                        });
                        return;
                    }
                    submit(label);
                });
                ui.chips.appendChild(chip);
            });
        }

        function typing() {
            var node = el('div', 'chat__typing', '<span></span><span></span><span></span>');
            node.setAttribute('aria-label', 'Typing');
            ui.log.appendChild(node);
            scroll();
            return node;
        }

        /* ---------------- the assistant ----------------
         *
         * When the local matcher has missed twice, or the guest asks for it,
         * the recent conversation goes to the server, which asks a model to
         * name ONE topic id from a closed list.
         *
         * What comes back is an id, never prose. The reply the guest reads is
         * rendered from knowledge.js by bot.answerAs(), exactly as if the
         * local matcher had chosen it. So the worst a compromised or confused
         * model can do is pick the wrong topic — it cannot invent a rate, a
         * policy, or an answer about cameras. The 21 null facts stay
         * load-bearing because they are enforced in the answer functions,
         * which none of this touches.
         */
        var routerCalls = 0;
        var lastGuestText = '';

        function routerTranscript() {
            var out = [];
            var nodes = ui.log.querySelectorAll('.chat__msg');
            for (var i = Math.max(0, nodes.length - 6); i < nodes.length; i++) {
                out.push({
                    role: nodes[i].className.indexOf('chat__msg--me') >= 0 ? 'me' : 'bot',
                    text: nodes[i].textContent
                });
            }
            return out;
        }

        function askAssistant(lastText, shortlist) {
            // Not configured. Null is the same answer this gives when the
            // call fails, so every caller already knows what to do with it.
            if (!ROUTER_URL) {
                return Promise.resolve(null);
            }
            if (routerCalls >= ROUTER_MAX_PER_SESSION) {
                return Promise.resolve(null);
            }
            routerCalls++;

            return fetch(ROUTER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript: routerTranscript(),
                    shortlist: shortlist || []
                })
            })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (body) {
                    if (!body || !body.intent) { return null; }
                    // answerAs returns null for an id it does not recognise,
                    // so an unknown id degrades to the normal handoff.
                    return bot.answerAs(body.intent, lastText);
                })
                .catch(function () { return null; });   // offline, blocked, slow: fall through
        }

        /* ---------------- persistence ---------------- */

        function save(role, text) {
            try {
                var hist = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
                hist.push({ role: role, text: text });
                sessionStorage.setItem(STORE_KEY, JSON.stringify(hist.slice(-MAX_STORED)));
            } catch (e) { /* private mode — transcript just won't persist */ }
        }

        /* sessionStorage is same-origin, not trusted. Anything already able to
           write to it could put a crafted role in here, and `role` is
           concatenated straight into a class name. Text is safe either way —
           bubble() writes textContent — but the shape is checked before use
           rather than after something has gone wrong. */
        function restore() {
            var hist = [];
            try { hist = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); } catch (e) { }
            if (!Array.isArray(hist)) { return false; }

            var clean = hist.filter(function (m) {
                return m && ROLES[m.role] === true && typeof m.text === 'string';
            }).slice(-MAX_STORED);

            clean.forEach(function (m) { bubble(m.role, m.text.slice(0, MAX_INPUT * 8)); });
            return clean.length > 0;
        }

        // Persist what the bot knows, not just what was said — otherwise a
        // reload leaves the guest's dates on screen but gone from the bot.
        function saveState() {
            try { sessionStorage.setItem(STATE_KEY, JSON.stringify(bot.exportState())); } catch (e) { }
        }

        function restoreState() {
            try {
                var raw = sessionStorage.getItem(STATE_KEY);
                if (raw) return bot.importState(JSON.parse(raw));
            } catch (e) { /* corrupt or unavailable — start clean */ }
            return false;
        }

        function forget() {
            try {
                sessionStorage.removeItem(STORE_KEY);
                sessionStorage.removeItem(STATE_KEY);
            } catch (e) { }
        }

        /* ---------------- conversation ---------------- */

        function handoffText() {
            var F = KNOWLEDGE.FACTS || {};
            return 'I still cannot place that one, and I would rather say so than guess. ' +
                (F.phone ? F.phone : F.email) + ' reaches a person who will know.';
        }

        /* The same handoff, phrased to be appended rather than to stand
           alone. The two cannot share a string: after the matcher has just
           offered a guess, "I still cannot place that one" contradicts the
           sentence directly above it. */
        function handoffLine() {
            var F = KNOWLEDGE.FACTS || {};
            return 'If I am still not getting it, ' + (F.phone ? F.phone : F.email) +
                ' reaches a person who will know.';
        }

        function say(text, chips) {
            var wait = Math.min(1400, 380 + String(text).length * 7);
            var dots = typing();
            busy = true;
            setTimeout(function () {
                dots.remove();
                bubble('bot', text);
                renderChips(chips);
                save('bot', text);
                busy = false;
            }, wait);
        }

        function submit(text) {
            /* Sliced here as well as capped on the element. maxLength is a
               courtesy to someone typing; it does nothing about a chip, a
               paste handled oddly, or anything calling submit() directly. */
            text = String(text || '').trim().slice(0, MAX_INPUT);
            if (!text || busy) return;

            lastGuestText = text;
            bubble('me', text);
            save('me', text);
            renderChips([]);
            ui.input.value = '';
            ui.input.style.height = 'auto';
            ui.send.disabled = true;

            // "start over" wipes the stored conversation, not just the bot's memory.
            if (/^\s*(start over|reset|restart|clear)\s*$/i.test(text)) {
                forget();
                ui.log.textContent = '';
            }

            var reply = bot.respond(text);

            /* Two misses running is real evidence that the local matcher is
               not going to get there — the guest has already rephrased once.
               This is the rung below the human handoff, so the assistant gets
               exactly one attempt before we stop guessing and hand over. */
            var stuck = bot.context.unknownStreak === 2;

            /* Two misses running, and nothing to escalate to.
             *
             * Guessing a third time is how a chatbot earns its reputation, so
             * this does not. It keeps whatever the matcher did manage — often
             * a named near-miss with chips, which is genuinely useful — and
             * puts a real person at the end of it. Instant, free, and true:
             * nothing here knows the answer, so it says so and points at
             * someone who does. */
            if (stuck && !ROUTER_URL) {
                // The generic fallback already ends with this chip; the
                // near-miss branch does not. Add it only if it is missing.
                var chips = (reply.chips || []).slice();
                if (chips.indexOf(HUMAN_CHIP) === -1) { chips.push(HUMAN_CHIP); }

                saveState();
                say(reply.text + '\n\n' + handoffLine(), chips);
                return;
            }

            if (stuck) {
                var shortlist = (reply.alternatives || []).map(function (a) {
                    return a.intent && a.intent.id;
                }).filter(Boolean);

                var dots = typing();
                busy = true;
                askAssistant(text, shortlist).then(function (routed) {
                    dots.remove();
                    busy = false;
                    saveState();
                    if (routed) {
                        say(routed.text, routed.chips);
                    } else {
                        // Offer the option rather than only trying silently —
                        // and keep the original reply, which already says
                        // something useful about having missed.
                        say(reply.text, (reply.chips || []).concat([ASSISTANT_CHIP]));
                    }
                });
                return;
            }

            saveState();
            say(reply.text, reply.chips);
        }

        /* ---------------- open / close ---------------- */

        function open() {
            ui.panel.setAttribute('aria-hidden', 'false');
            ui.scrim.setAttribute('aria-hidden', 'false');
            ui.launcher.setAttribute('aria-expanded', 'true');
            // Hiding the wrapper stops the ring animations too — no point
            // burning frames on an attention-getter behind an open panel.
            ui.beacon.hidden = true;
            setTimeout(function () { ui.input.focus(); }, 60);
            scroll();
        }

        function shut() {
            ui.panel.setAttribute('aria-hidden', 'true');
            ui.scrim.setAttribute('aria-hidden', 'true');
            ui.launcher.setAttribute('aria-expanded', 'false');
            ui.beacon.hidden = false;
            ui.launcher.focus();
        }

        /* ---------------- guiding prompts ----------------
           Appears for a while, goes away, comes back with a different
           question. A permanently parked bubble becomes furniture and
           stops being read; an intermittent one keeps its meaning.

           The × dismisses ONLY the prompts. The launcher is untouched —
           someone who does not want to be asked things should not have to
           lose the way of asking things. */
        (function () {
            var SHOW_MS = 9000;    // long enough to read without hurrying
            var GAP_MS = 24000;    // and long enough away not to nag
            var FIRST_MS = 3200;   // let the page arrive first

            /* Sections the guest has actually scrolled to. A prompt about the
               pool is only honest once they have reached the pool; offering it
               on arrival is the same guesswork the old list did. */
            var seenSections = [];
            var here = promptsFor(seenSections);

            var sections = document.querySelectorAll('[id]');
            if (sections.length && 'IntersectionObserver' in window) {
                var watcher = new IntersectionObserver(function (entries) {
                    var changed = false;
                    entries.forEach(function (e) {
                        if (e.isIntersecting && seenSections.indexOf(e.target.id) === -1) {
                            seenSections.push(e.target.id);
                            changed = true;
                        }
                    });
                    // Recompute only when something new came into view.
                    if (changed) { here = promptsFor(seenSections); }
                }, { threshold: 0.25 });
                Array.prototype.forEach.call(sections, function (el) { watcher.observe(el); });
            }

            var index = Math.floor(Math.random() * Math.max(here.length, 1));
            var timer = null;
            var dismissed = false;

            try {
                dismissed = Boolean(sessionStorage.getItem(NUDGE_KEY));
            } catch (e) { /* private mode: show it, no harm done */ }

            function hide() {
                ui.nudge.classList.remove('is-in');
                // Left in the DOM through the fade, then taken out of the
                // tab order — a hidden control must not be focusable.
                timer = setTimeout(function () {
                    ui.nudge.hidden = true;
                }, 450);
            }

            function show() {
                if (dismissed) {
                    return;
                }
                /* `here` grows as sections come into view, so re-read it each
                   time rather than caching a length that may be stale. */
                if (here.length === 0) { return; }
                var prompt = here[index % here.length];
                index = (index + 1) % here.length;

                ui.nudgeAsk.textContent = prompt.say;
                // What actually gets asked. Kept off the visible text so the
                // offer can be in Carman's voice while the question stays in
                // the phrasing the matcher expects.
                ui.nudgeAsk.dataset.ask = prompt.ask;
                ui.nudge.hidden = false;
                // A frame's delay so the transition has a start state to run
                // from; setting both at once just snaps it in.
                requestAnimationFrame(function () {
                    ui.nudge.classList.add('is-in');
                });
            }

            function cycle() {
                show();
                timer = setTimeout(function () {
                    hide();
                    timer = setTimeout(cycle, GAP_MS);
                }, SHOW_MS);
            }

            function dismiss() {
                dismissed = true;
                clearTimeout(timer);
                hide();
                try { sessionStorage.setItem(NUDGE_KEY, '1'); } catch (e) { }
            }

            if (!dismissed) {
                timer = setTimeout(cycle, FIRST_MS);
            }

            // Reading it should not make it disappear mid-sentence.
            ui.nudge.addEventListener('mouseenter', function () { clearTimeout(timer); });
            ui.nudge.addEventListener('mouseleave', function () {
                if (!dismissed) {
                    timer = setTimeout(function () {
                        hide();
                        timer = setTimeout(cycle, GAP_MS);
                    }, 2500);
                }
            });

            ui.nudgeAsk.addEventListener('click', function () {
                /* The visible text is an offer ("I can arrange a cook, if you
                   would like one"); the question is what the bot is good at
                   answering. Submitting the offer would send the bot a
                   statement it has no intent for. */
                var question = ui.nudgeAsk.dataset.ask || ui.nudgeAsk.textContent;
                dismiss();
                open();
                submit(question);
            });

            ui.nudgeClose.addEventListener('click', function (event) {
                event.stopPropagation();   // never reaches the ask button
                dismiss();
            });

            // Opening the chat any other way makes the prompts redundant.
            ui.launcher.addEventListener('click', dismiss);
        })();

        ui.launcher.addEventListener('click', open);
        ui.close.addEventListener('click', shut);
        ui.scrim.addEventListener('click', shut);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && ui.panel.getAttribute('aria-hidden') === 'false') shut();
        });

        ui.form.addEventListener('submit', function (e) {
            e.preventDefault();
            submit(ui.input.value);
        });

        // Enter sends, Shift+Enter makes a new line.
        ui.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(ui.input.value);
            }
        });

        ui.input.addEventListener('input', function () {
            ui.send.disabled = !ui.input.value.trim();
            ui.input.style.height = 'auto';
            ui.input.style.height = Math.min(ui.input.scrollHeight, 110) + 'px';
        });

        /* ---------------- first run ---------------- */

        var hadTranscript = restore();
        restoreState();

        if (!hadTranscript) {
            bubble('bot', 'Hello! I can answer most things about Ikshaa Luxury Villa — rates, availability, ' +
                'the rooms and pool, house rules, how to get here. Ask in your own words.');
            renderChips(['What are the rates?', 'How many bedrooms?', 'How far is the beach?', 'Is it available?']);
        } else if (bot.context.pendingSlot) {
            // Mid-booking when the page reloaded: pick the thread back up.
            renderChips((KNOWLEDGE.BOOKING.chips || {})[bot.context.pendingSlot] || []);
        }

        // Arriving from the chat icon (chaticon.html) means the guest has already
        // asked for the chat — don't make them click a second time.
        if (/[?&]chat=open\b/.test(location.search) || location.hash === '#chat') open();
    }

    /* ---------------------------------------------------------------------
     * Loading the brain.
     *
     * nlu.js, knowledge.js and bot.js are 34KB of language processing across
     * three requests, and they used to be three <script defer> tags on every
     * page of the site — paid on every first visit, by everyone, for a panel
     * most people never open.
     *
     * They are fetched here instead: when the browser goes idle, or on the
     * first sign of a human, whichever comes first. First paint no longer
     * competes with them, and by the time anybody reaches for the launcher
     * they have long since arrived.
     *
     * Order matters and is why this is a chain rather than three parallel
     * appends: bot.js reads NLU and KNOWLEDGE off window at parse time.
     * ------------------------------------------------------------------ */
    var BRAIN = ['chat/nlu.js', 'chat/knowledge.js', 'chat/bot.js'];

    function loadBrain(done) {
        var i = 0;
        (function next() {
            if (i >= BRAIN.length) { return done(); }
            var s = document.createElement('script');
            s.src = BRAIN[i++];
            s.async = false;              // preserve execution order
            s.onload = next;
            s.onerror = function () {
                // One missing file must not leave a launcher that does
                // nothing when pressed. Give up quietly and draw no widget.
                console.warn('[chat] could not load ' + s.src);
            };
            document.head.appendChild(s);
        })();
    }

    var started = false;
    function start() {
        if (started) { return; }
        started = true;
        WAKE.forEach(function (evt) { window.removeEventListener(evt, start); });
        loadBrain(init);
    }

    var WAKE = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

    function schedule() {
        WAKE.forEach(function (evt) {
            window.addEventListener(evt, start, { once: true, passive: true });
        });
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(start, { timeout: 2500 });
        } else {
            setTimeout(start, 1500);      // Safari has no requestIdleCallback
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
    else schedule();
})();
