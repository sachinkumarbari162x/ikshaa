/* =====================================================================
 * bot.js — the dialogue manager.
 *
 * Turns NLU output into a reply: handles compound questions, follow-ups
 * that lean on the previous topic, ambiguity, remembered entities and
 * graceful failure. Stateful — one instance per conversation.
 * ===================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./nlu.js'), require('./knowledge.js'));
    } else {
        root.Bot = factory(root.NLU, root.KNOWLEDGE);
    }
}(typeof self !== 'undefined' ? self : this, function (NLU, KNOWLEDGE) {
    'use strict';

    var ORDINALS = { first: 0, '1st': 0, one: 0, former: 0, second: 1, '2nd': 1, two: 1, latter: 1 };

    // Strip anything that identifies the guest before it reaches the miss log.
    // The log exists to find wording we failed on, not to collect contact details.
    function redact(text) {
        return String(text)
            .replace(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi, '[email]')
            .replace(/\+?\d[\d\s\-()]{7,14}\d/g, '[phone]');
    }

    /**
     * Deterministic PRNG (mulberry32). Pass `random: Bot.seeded(1)` to make
     * variant selection reproducible in tests and eval runs.
     */
    function seeded(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function Bot(options) {
        options = options || {};
        this.knowledge = options.knowledge || KNOWLEDGE;
        this.engine = new NLU.Engine({
            concepts: this.knowledge.CONCEPTS,
            thresholds: options.thresholds
        });
        this.engine.addAll(this.knowledge.INTENTS).train();

        this.random = options.random || Math.random;
        // Sink for utterances we failed to understand. Swap it for anything with
        // a .push(entry) — an array, or a shim posting to an endpoint.
        this.missLog = options.missLog || [];
        this.onMiss = options.onMiss || null;

        this.reset();
    }

    Bot.seeded = seeded;

    Bot.prototype.reset = function () {
        this.context = {
            lastIntentId: null,
            topicTokens: [],
            memory: {},          // entities accumulated across the conversation
            booking: { arrival: null, departure: null, nights: null, guests: null, month: null },
            pendingSlot: null,   // which booking slot we last asked for
            pendingClarify: null,
            turn: 0,
            recentVariants: {},  // intentId -> last variant index used
            unknownStreak: 0
        };
        return this;
    };

    /* --------------------------------------------------------------
     * Serialisation
     *
     * The widget restores the visible transcript from sessionStorage; without
     * this the bot's own memory did not come back, so after a reload a guest
     * saw their dates on screen while the bot had silently forgotten them.
     * ------------------------------------------------------------ */

    var STATE_VERSION = 1;

    Bot.prototype.exportState = function () {
        var c = this.context;
        return {
            v: STATE_VERSION,
            memory: c.memory,
            booking: c.booking,
            pendingSlot: c.pendingSlot,
            pendingClarify: c.pendingClarify,
            lastIntentId: c.lastIntentId,
            topicTokens: c.topicTokens,
            turn: c.turn
        };
    };

    /** Rehydrate from exportState(). Returns false if the payload is unusable. */
    Bot.prototype.importState = function (state) {
        if (!state || state.v !== STATE_VERSION) return false;

        // Storage is same-origin and self-written, but it is still input:
        // validate shapes rather than trusting them.
        var strings = function (v) {
            return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
        };
        var plain = function (v) {
            return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
        };

        var c = this.context;
        c.memory = plain(state.memory);
        c.booking = Object.assign(
            { arrival: null, departure: null, nights: null, guests: null, month: null },
            plain(state.booking)
        );
        c.pendingSlot = typeof state.pendingSlot === 'string' ? state.pendingSlot : null;
        c.pendingClarify = strings(state.pendingClarify).length ? strings(state.pendingClarify) : null;
        c.lastIntentId = typeof state.lastIntentId === 'string' ? state.lastIntentId : null;
        c.topicTokens = strings(state.topicTokens);
        c.turn = typeof state.turn === 'number' && isFinite(state.turn) ? state.turn : 0;
        return true;
    };

    /* --------------------------------------------------------------
     * Booking slot-filling
     *
     * The state is just the three things you cannot quote a stay without:
     * arrival, nights, guests. Everything the guest reads lives in
     * knowledge.BOOKING, so this stays property-agnostic.
     * ------------------------------------------------------------ */

    Bot.prototype.syncBooking = function () {
        var m = this.context.memory, b = this.context.booking;
        ['arrival', 'departure', 'nights', 'guests', 'month'].forEach(function (k) {
            if (m[k] !== undefined && m[k] !== null) b[k] = m[k];
        });
        return b;
    };

    Bot.prototype.missingSlot = function () {
        var b = this.syncBooking();
        var slots = (this.knowledge.BOOKING && this.knowledge.BOOKING.slots) || [];
        for (var i = 0; i < slots.length; i++) if (!b[slots[i]]) return slots[i];
        return null;
    };

    /** Ask for exactly the next missing slot, or confirm a complete set. */
    Bot.prototype.bookingReply = function (analysis) {
        var B = this.knowledge.BOOKING;
        if (!B) return null;                       // knowledge pack has no booking flow

        var ctx = { facts: this.knowledge.FACTS, booking: this.syncBooking(), analysis: analysis };
        var missing = this.missingSlot();

        if (!missing) {
            this.context.pendingSlot = null;
            return { text: this.pick('booking:summary', B.summary(ctx)), chips: B.confirmChips || [] };
        }

        this.context.pendingSlot = missing;
        return {
            text: this.pick('booking:' + missing, B.ask[missing](ctx)),
            chips: (B.chips && B.chips[missing]) || []
        };
    };

    /**
     * A bare "4" or "12" answers whatever we just asked for. Returns true when
     * this turn supplied the outstanding slot.
     */
    Bot.prototype.fillPendingSlot = function (text, entities, now) {
        var slot = this.context.pendingSlot;
        if (!slot) return false;
        if (entities[slot] !== undefined && entities[slot] !== null) return true;

        var bare = String(text).trim().match(/^\D{0,6}(\d{1,2})\D{0,8}$/);
        if (!bare) return false;
        var n = parseInt(bare[1], 10);

        if (slot === 'nights' || slot === 'guests') {
            this.context.memory[slot] = n;
            return true;
        }
        if (slot === 'arrival' && this.context.memory.month) {
            // "12" is a day only once we know which month they meant.
            var e = NLU.extractEntities(NLU.normalise(n + ' ' + this.context.memory.month), now);
            if (e.arrival || (e.dates && e.dates.length)) {
                this.context.memory.arrival = e.arrival || e.dates[0];
                return true;
            }
        }
        return false;
    };

    /**
     * Record an utterance we did not confidently understand.
     *
     * The default sink is an in-memory array; pass `missLog` (anything with
     * .push) or `onMiss` (a callback) to ship these somewhere. This log is the
     * labelling queue for eval/corpus.js — it is how the bot improves from
     * real traffic rather than from guesswork.
     */
    Bot.prototype.logMiss = function (result, status) {
        var entry = {
            at: new Date().toISOString(),
            turn: this.context.turn,
            text: redact(result.analysis ? result.analysis.raw : ''),
            status: status,
            confidence: result.confidence || 0,
            topIntent: result.intent ? result.intent.id : null,
            alternatives: (result.alternatives || []).slice(0, 3).map(function (a) {
                return { intent: a.intent.id, confidence: Math.round(a.confidence * 1000) / 1000 };
            })
        };
        if (this.missLog && typeof this.missLog.push === 'function') this.missLog.push(entry);
        if (typeof this.onMiss === 'function') {
            try { this.onMiss(entry); } catch (e) { /* a broken sink must not break the reply */ }
        }
        return entry;
    };

    Bot.prototype.intentById = function (id) {
        for (var i = 0; i < this.knowledge.INTENTS.length; i++) {
            if (this.knowledge.INTENTS[i].id === id) return this.knowledge.INTENTS[i];
        }
        return null;
    };

    // Pick a phrasing, avoiding the one used last time for this intent.
    Bot.prototype.pick = function (intentId, value) {
        if (!Array.isArray(value)) return value;
        if (value.length === 1) return value[0];
        var last = this.context.recentVariants[intentId];
        var idx = Math.floor(this.random() * value.length);
        if (idx === last) idx = (idx + 1) % value.length;
        this.context.recentVariants[intentId] = idx;
        return value[idx];
    };

    /**
     * Is this intent's own subject sitting inside a negation?
     *
     * "No pets, right?" and "is the pool not heated?" are confirmations of a
     * negative, and reading them as plain questions produces an answer that
     * contradicts the framing ("Yes — ..." to "so there's no wifi?").
     */
    Bot.prototype.topicNegated = function (intent, analysis) {
        var scope = analysis.negatedTokens;
        if (!scope || !scope.size) return false;

        var negStems = new Set();
        scope.forEach(function (t) { negStems.add(NLU.stem(t)); });

        var topic = (intent.keywords || []).concat(
            (intent.concepts || []).map(function (c) { return c.replace('@', ''); }));

        return topic.some(function (w) { return negStems.has(NLU.stem(w)); });
    };

    Bot.prototype.render = function (intent, analysis) {
        var ctx = {
            facts: this.knowledge.FACTS,
            entities: Object.assign({}, this.context.memory, analysis.entities),
            analysis: analysis,
            negated: this.topicNegated(intent, analysis),
            questionType: analysis.questionType,
            memory: this.context.memory
        };
        var out = typeof intent.answer === 'function' ? intent.answer(ctx) : intent.answer;
        return this.pick(intent.id, out);
    };

    Bot.prototype.remember = function (entities) {
        var m = this.context.memory;
        Object.keys(entities).forEach(function (k) {
            var v = entities[k];
            if (v === undefined || v === null) return;
            if (Array.isArray(v)) { if (v.length) m[k] = v; }
            else m[k] = v;
        });
    };

    Bot.prototype.setTopic = function (intent) {
        this.context.lastIntentId = intent.id;
        // Keywords make the best anchor for resolving "it"/"that" next turn.
        this.context.topicTokens = (intent.keywords || []).slice(0, 4)
            .concat((intent.concepts || []).map(function (c) { return c.replace('@', ''); }));
    };

    /* --------------------------------------------------------------
     * Handling a clarification the bot asked for last turn
     * ------------------------------------------------------------ */
    Bot.prototype.resolveClarification = function (text) {
        var pending = this.context.pendingClarify;
        if (!pending) return null;

        var norm = NLU.normalise(text);
        var tokens = NLU.tokenise(norm);

        for (var i = 0; i < tokens.length; i++) {
            if (ORDINALS[tokens[i]] !== undefined) {
                var pick = pending[ORDINALS[tokens[i]]];
                if (pick) return this.intentById(pick);
            }
        }
        // "the pool one" / "price"
        for (var p = 0; p < pending.length; p++) {
            var intent = this.intentById(pending[p]);
            if (!intent) continue;
            var hit = (intent.keywords || []).some(function (k) { return norm.indexOf(k) >= 0; }) ||
                norm.indexOf(intent.id) >= 0;
            if (hit) return intent;
        }
        if (/^\s*(yes|yeah|yep|sure|ok|okay)\b/.test(norm)) return this.intentById(pending[0]);
        return null;
    };

    /* --------------------------------------------------------------
     * "Is there a gym?" — asking about things that are not here
     *
     * The matcher's job is to find the closest topic, and it always finds
     * one. Asked whether there was a gym it returned the perimeter-security
     * answer; asked about hiring a boat, airport transfers; asked about a
     * sauna, the monsoon forecast. Every one of those was stated as fact.
     * Measured over twenty realistic "do you have X" questions the villa has
     * no answer for, eight came back confidently wrong.
     *
     * That is the worst thing this assistant can do. A guest who is told the
     * wrong thing plans around it, and finds out on arrival.
     *
     * The rule below is about knowledge rather than scoring: if the thing
     * being asked about appears NOWHERE in the knowledge base, no answer
     * drawn from that knowledge base can be about it. That is arithmetic,
     * not a heuristic, and it lets the bot say the one true thing it has —
     * I do not know, and here is who does.
     * ------------------------------------------------------------ */

    /* Every word the knowledge base contains, answer prose included.
     *
     * Answers are functions, so their words are only reachable through
     * toString(). Skipping it would cost real vocabulary: `generator` and
     * `inverter` appear nowhere but inside the power answer, so "is there a
     * generator" would be declined as a thing we have never heard of —
     * exactly the false decline this must not produce. */
    var vocabularies = typeof WeakMap === 'function' ? new WeakMap() : null;

    function vocabularyOf(knowledge) {
        var cached = vocabularies && vocabularies.get(knowledge);
        if (cached) { return cached; }

        var raw = [];
        (function harvest(value, depth) {
            if (value === null || value === undefined || depth > 6) { return; }
            var type = typeof value;
            if (type === 'string') { raw.push(value); return; }
            if (type === 'function') { raw.push(Function.prototype.toString.call(value)); return; }
            if (type !== 'object') { return; }
            Object.keys(value).forEach(function (key) {
                raw.push(key);                       // ids and concept names count as words
                harvest(value[key], depth + 1);
            });
        }([knowledge.FACTS, knowledge.CONCEPTS, knowledge.INTENTS], 0));

        var vocab = {};
        raw.join(' ').toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').forEach(function (word) {
            if (word.length > 2) { vocab[word] = true; }
        });
        if (vocabularies) { vocabularies.set(knowledge, vocab); }
        return vocab;
    }

    /* Only questions about whether a thing EXISTS. "How do I get to the
       beach" is not one and must not be caught here — it is a question the
       villa can answer, and declining it would be the new failure. */
    var EXISTENTIAL = [
        /\b(?:is|are)\s+there\s+(?:a|an|any|some)?\s*([a-z][a-z\s-]{1,28})/i,
        /\bdo(?:es)?\s+(?:you|the\s+villa|the\s+house|they)\s+(?:have|offer|provide|rent|hire)\s+(?:a|an|any|some)?\s*([a-z][a-z\s-]{1,28})/i,
        /\bcan\s+i\s+(?:hire|rent|borrow)\s+(?:a|an|any|some)?\s*([a-z][a-z\s-]{1,28})/i
    ];

    /* Words that carry no topic of their own.
     *
     * They have to be stripped rather than merely ignored, because the test
     * below passes on ANY known word: "is there a gym on site" kept returning
     * the perimeter answer purely because `site` appears in the knowledge
     * base, which rescued a phrase whose only real noun was `gym`. Location
     * and availability words do this constantly — they are common, they are
     * always in vocabulary, and they never name the thing being asked about. */
    var FILLER = {
        the: 1, and: 1, any: 1, some: 1, for: 1, with: 1, that: 1, this: 1,
        you: 1, your: 1, our: 1, there: 1, here: 1, villa: 1, house: 1,
        please: 1, also: 1, would: 1, could: 1, are: 1, was: 1, does: 1,
        site: 1, onsite: 1, nearby: 1, near: 1, close: 1, around: 1,
        anywhere: 1, available: 1, place: 1, area: 1, property: 1, premises: 1
    };

    /* The phrase asked about, when nothing in it is known. Null otherwise —
       and null is the common case, because the test is deliberately hard to
       fail: ONE recognised word anywhere in the phrase lets the matcher
       proceed as normal. A wrong decline turns a guest away from a question
       the villa could have answered, so certainty is required to decline. */
    Bot.prototype.unknownThing = function (text) {
        var vocab = vocabularyOf(this.knowledge);

        for (var i = 0; i < EXISTENTIAL.length; i++) {
            var found = EXISTENTIAL[i].exec(String(text));
            if (!found) { continue; }

            var words = found[1].toLowerCase().split(/[^a-z]+/).filter(function (word) {
                return word.length > 2 && !FILLER[word];
            });
            if (!words.length) { continue; }

            var known = words.some(function (word) {
                // "weddings" is "wedding"; the vocabulary stores what it found.
                return vocab[word] || (word.slice(-1) === 's' && vocab[word.slice(0, -1)]);
            });
            if (known) { return null; }

            return words.join(' ');
        }
        return null;
    };

    /* Says what is missing by name. "I have nothing on file about a gym" is
       worth far more to a guest than the generic shrug — it confirms the
       question was understood, and that the answer simply is not here. */
    Bot.prototype.notOnFile = function (phrase) {
        var F = this.knowledge.FACTS;
        return {
            text: 'I have nothing on file about "' + phrase + '" at the villa, and I would rather ' +
                'say that than answer with something close but wrong. ' +
                (F.phone ? F.phone : F.email) + ' will know for certain.',
            chips: ['What are the rates?', 'Is there a pool?', 'Talk to a human']
        };
    };

    /* --------------------------------------------------------------
     * Fallbacks
     * ------------------------------------------------------------ */
    Bot.prototype.fallback = function (result) {
        var F = this.knowledge.FACTS;
        this.context.unknownStreak++;

        // Escalation outranks everything — three misses means stop guessing.
        if (this.context.unknownStreak >= 3) {
            return {
                text: 'I keep missing what you need, and that is on me — I only know the villa basics. ' +
                    'Reach ' + (F.phone ? F.phone : F.email) + ' and a person will sort it out properly.',
                chips: ['Start over']
            };
        }

        if (result.analysis.gibberish) {
            return {
                text: 'That one got past me — was it a typo? Try it in plain words and I will do better.',
                chips: ['Rates', 'Availability', 'House rules']
            };
        }

        // If something scored weakly, name it rather than shrugging.
        var near = result.alternatives.filter(function (a) { return a.confidence > 0.16; });
        if (near.length && this.context.unknownStreak < 3) {
            var guess = near[0].intent;
            return {
                text: 'I am not certain I follow. Were you asking about ' + this.describe(guess.id) + '?',
                chips: near.slice(0, 3).map(function (a) { return this.chipFor(a.intent.id); }, this).filter(Boolean),
                pendingClarify: near.slice(0, 2).map(function (a) { return a.intent.id; })
            };
        }

        return {
            text: 'I did not catch that. I am good on rates, availability, the rooms and pool, check-in, ' +
                'house rules and getting here — try me on one of those.',
            chips: ['What are the rates?', 'How many bedrooms?', 'Is there a pool?', 'Talk to a human']
        };
    };

    var LABELS = {
        price: 'what it costs', availability: 'booking dates', capacity: 'how many it sleeps',
        pool: 'the pool', wifi: 'the wifi', ac: 'air conditioning', kitchen: 'the kitchen',
        food: 'food and breakfast', location: 'where the villa is', beach: 'the beach',
        airport: 'the airport', transfer: 'getting around', parking: 'parking',
        checkin: 'check-in times', checkout: 'check-out times', pets: 'bringing pets',
        smoking: 'smoking', parties: 'parties and events', children: 'coming with kids',
        cancellation: 'cancellations', payment: 'how to pay', housekeeping: 'cleaning and laundry',
        safety: 'safety', power: 'power backup', tv: 'the TV', accessibility: 'accessibility',
        weather: 'the weather', activities: 'things to do nearby', photos: 'photos',
        contact: 'contacting the owner',

        /* Completing the set. These were missing, so describe() fell back to
           the raw id — "bot identity" reads oddly in "I think you are asking
           about…", and the router prompt needs a real description for every
           id it is allowed to choose. */
        tourguide: 'arranging a guide or a day trip',
        gatherings: 'arranging catering or staff for a get-together',
        bot_identity: 'whether this is a person or software',
        capabilities: 'what this assistant can help with',
        complaint: 'the guest being unhappy with the answers',
        compliment: 'the guest being complimentary',
        greeting: 'saying hello', goodbye: 'saying goodbye', thanks: 'saying thank you'
    };

    var CHIPS = {
        price: 'What are the rates?', availability: 'Is it available?', capacity: 'How many bedrooms?',
        pool: 'Tell me about the pool', wifi: 'Is there wifi?', kitchen: 'Is there a kitchen?',
        location: 'Where is it?', beach: 'How far is the beach?', airport: 'How far is the airport?',
        checkin: 'Check-in time?', pets: 'Are pets allowed?', payment: 'How do I pay?',
        cancellation: 'Cancellation policy?', children: 'Is it kid friendly?',
        activities: 'What is nearby?', contact: 'Talk to a human'
    };

    /* Render a named intent, as though the matcher had chosen it.
     *
     * This is what lets the remote router return a topic id and have the
     * ANSWER still come from knowledge.js. The id is checked against the
     * intent list first, so an id from anywhere — including a model — can
     * only ever select an existing answer, never introduce text.
     */
    Bot.prototype.answerAs = function (id, text, now) {
        var intent = this.intentById(id);
        if (!intent) { return null; }

        var result = this.engine.match(String(text || ''), {}, now);
        var reply = this.render(intent, result.analysis);

        // Treat it as a real answer: the streak resets, and the topic sticks
        // so the next "is it heated?" resolves against it.
        this.context.unknownStreak = 0;
        this.setTopic(intent);
        this.remember(result.analysis.entities);

        return { text: reply, intent: intent.id, chips: [], status: 'routed' };
    };

    Bot.prototype.describe = function (id) { return LABELS[id] || id.replace(/_/g, ' '); };
    Bot.prototype.chipFor = function (id) { return CHIPS[id] || null; };

    /* --------------------------------------------------------------
     * Main entry point
     * ------------------------------------------------------------ */
    Bot.prototype.respond = function (input, now) {
        this.context.turn++;
        var text = String(input || '').trim();

        if (!text) {
            return { text: 'Ask me anything about the villa — rates, dates, the pool, house rules.', chips: [], intent: null };
        }

        if (/^\s*(start over|reset|restart|clear)\s*$/i.test(text)) {
            this.reset();
            return { text: 'Fresh start. What would you like to know about the villa?', chips: ['Rates', 'Availability', 'Where is it?'], intent: null };
        }

        // 1) Were we waiting on a clarification?
        if (this.context.pendingClarify) {
            var resolved = this.resolveClarification(text);
            this.context.pendingClarify = null;
            if (resolved) {
                var an = NLU.analyse(text, now);
                this.remember(an.entities);
                this.setTopic(resolved);
                this.context.unknownStreak = 0;
                return {
                    text: this.render(resolved, an),
                    chips: resolved.chips || [],
                    intent: resolved.id,
                    confidence: 1,
                    resolvedFromClarification: true
                };
            }
        }

        // 2) Were we waiting on a booking slot? A bare "4" or "3 nights" answers
        //    it — but only when the message is not clearly about something else,
        //    so the flow can never hijack an unrelated question.
        if (this.context.pendingSlot) {
            var pre = NLU.analyse(text, now);
            this.remember(pre.entities);
            if (this.fillPendingSlot(text, pre.entities, now)) {
                var probe = this.engine.match(text, this.context, now);
                var elsewhere = probe.status === 'confident' && probe.intent &&
                    probe.intent.id !== 'availability';
                if (!elsewhere) {
                    var slotReply = this.bookingReply(pre);
                    if (slotReply) {
                        this.context.unknownStreak = 0;
                        return {
                            text: slotReply.text,
                            chips: slotReply.chips,
                            intent: 'availability',
                            confidence: 1,
                            corrections: [],
                            segments: 1,
                            usedContext: true,
                            booking: Object.assign({}, this.context.booking),
                            memory: Object.assign({}, this.context.memory)
                        };
                    }
                }
            }
        }

        // 3) Split compound input: "hi, is there wifi and can I bring a dog?"
        var segments = NLU.segment(text);
        var replies = [], chips = [], seen = {}, best = null, pending = null;
        var self = this;

        segments.forEach(function (seg, i) {
            if (!NLU.tokenise(NLU.normalise(seg)).length) return;

            var result = self.engine.match(seg, self.context, now);
            self.remember(result.analysis.entities);

            /* Checked before `best` is set, so a coincidental match on a
               thing we have never heard of cannot become the reported
               intent. Reporting `safety` for "is there a gym" would be the
               same confident wrongness in the return value that the reply
               has just refused to print. */
            var absent = self.unknownThing(seg);
            if (absent) {
                self.logMiss(result, 'absent');       // the owner's list of facts to add
                var missing = self.notOnFile(absent);
                replies.push(missing.text);
                chips = chips.concat(missing.chips);
                /* unknownStreak is deliberately untouched. This reply already
                   hands over to a person, and incrementing would stack the
                   widget's own handoff on top of it — the same phone number
                   twice in one message. */
                return;
            }

            // A bare date/party-size with no clear intent is a booking enquiry.
            if (result.status === 'unknown') {
                var e = result.analysis.entities;
                if ((e.dates && e.dates.length) || e.guests || e.nights) {
                    result = { intent: self.intentById('availability'), confidence: 0.55, status: 'confident', analysis: result.analysis, alternatives: [] };
                }
            }

            // Anything we could not answer confidently is worth capturing —
            // this log becomes the labelling queue for the eval corpus.
            if (result.status !== 'confident') self.logMiss(result, result.status);

            if (!best || result.confidence > best.confidence) best = result;

            // In a multi-part message, only act on parts we actually understood.
            // "me and my friends are planning a trip" is conversational filler
            // sitting next to a real question — guessing at it just adds noise.
            if (result.status === 'unknown' || (result.status === 'unsure' && segments.length > 1)) {
                if (segments.length === 1) {
                    var fb = self.fallback(result);
                    replies.push(fb.text);
                    chips = chips.concat(fb.chips || []);
                    pending = fb.pendingClarify || null;
                }
                return;
            }

            var intent = result.intent;
            if (seen[intent.id]) return;                       // don't answer the same thing twice
            seen[intent.id] = true;

            // Availability is a workflow, not an answer: drive toward the missing slot.
            if (intent.id === 'availability') {
                var bk = self.bookingReply(result.analysis);
                if (bk) {
                    replies.push(bk.text);
                    chips = chips.concat(bk.chips || []);
                    self.setTopic(intent);
                    self.context.unknownStreak = 0;
                    return;
                }
            }

            // A greeting alongside other questions becomes a short opener.
            if (intent.id === 'greeting' && segments.length > 1 && i === 0) {
                replies.push('Hello!');
            } else {
                var body = self.render(intent, result.analysis);
                if (result.status === 'unsure') {
                    body = 'I think you are asking about ' + self.describe(intent.id) + ' — ' +
                        body.charAt(0).toLowerCase() + body.slice(1) +
                        '\n\nIf that was not it, say it another way and I will try again.';
                    // A hedged answer always offers a way out.
                    chips = chips.concat(['What are the rates?', 'Is it available?', 'Talk to a human']);
                } else if (result.ambiguousWith) {
                    pending = [intent.id, result.ambiguousWith.id];
                    body = body + '\n\n(Or did you mean ' + self.describe(result.ambiguousWith.id) + '?)';
                }
                replies.push(body);
                chips = chips.concat(intent.chips || []);
            }

            self.setTopic(intent);
            self.context.unknownStreak = 0;
        });

        if (!replies.length) {
            var fb2 = this.fallback(best || { alternatives: [], analysis: NLU.analyse(text, now) });
            replies.push(fb2.text);
            chips = fb2.chips || [];
            pending = fb2.pendingClarify || null;
        }

        this.context.pendingClarify = pending;

        // Soften if the guest sounds annoyed and we did understand them.
        var mood = best && best.analysis ? best.analysis.sentimentScore : 0;
        if (mood <= -2 && best && best.status === 'confident' && best.intent.id !== 'complaint') {
            var F2 = this.knowledge.FACTS;
            replies.push('If this is going in circles, ' + (F2.phone ? F2.phone : F2.email) + ' gets you a person.');
        }

        return {
            text: replies.join('\n\n'),
            chips: chips.filter(function (c, i, a) { return c && a.indexOf(c) === i; }).slice(0, 4),
            intent: best && best.intent ? best.intent.id : null,
            confidence: best ? best.confidence : 0,
            corrections: best ? best.corrections : [],
            segments: segments.length,
            usedContext: best ? best.usedContext : false,
            booking: Object.assign({}, this.syncBooking()),
            memory: Object.assign({}, this.context.memory)
        };
    };

    return Bot;
}));
