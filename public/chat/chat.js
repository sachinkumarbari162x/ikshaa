/* =====================================================================
 * chat.js — the widget. Builds its own DOM, owns no business logic:
 * every reply comes from Bot (bot.js), which is independently testable.
 * ===================================================================== */
(function () {
    'use strict';

    var STORE_KEY = 'ikshaa.chat.transcript';
    var STATE_KEY = 'ikshaa.chat.state';
    var MAX_STORED = 40;

    var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.4A8.4 8.4 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4z"/></svg>';
    var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';


    /* Questions the bot can actually answer well — each maps onto a real
       intent in knowledge.js. A prompt the bot then fumbles is worse than
       no prompt, so this list is deliberately conservative and avoids
       everything sitting behind an unverified fact (rates, check-in). */
    var PROMPTS = [
        'How many bedrooms are there?',
        'What is included in a stay?',
        'How do I get there from the airport?',
        'Is the pool private?',
        'Is breakfast included?',
        'Can you cook for us?',
        'When is the best time to come?',
        'How do I book?'
    ];

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
                chip.addEventListener('click', function () { submit(label); });
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

        /* ---------------- persistence ---------------- */

        function save(role, text) {
            try {
                var hist = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
                hist.push({ role: role, text: text });
                sessionStorage.setItem(STORE_KEY, JSON.stringify(hist.slice(-MAX_STORED)));
            } catch (e) { /* private mode — transcript just won't persist */ }
        }

        function restore() {
            var hist = [];
            try { hist = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); } catch (e) { }
            hist.forEach(function (m) { bubble(m.role, m.text); });
            return hist.length > 0;
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
            text = String(text || '').trim();
            if (!text || busy) return;

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

            var index = Math.floor(Math.random() * PROMPTS.length);
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
                ui.nudgeAsk.textContent = PROMPTS[index];
                index = (index + 1) % PROMPTS.length;
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
                var question = ui.nudgeAsk.textContent;
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

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
