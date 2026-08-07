'use strict';

const NLU = require('../public/chat/nlu.js');
const Bot = require('../public/chat/bot.js');

const NOW = '2026-08-05T12:00:00';           // fixed clock so date tests are stable

describe('normalisation', () => {
    it('lowercases, strips punctuation noise and collapses whitespace', () => {
        expect(NLU.normalise('  HELLO   There!!  ')).toBe('hello there!!');
    });

    it('expands contractions', () => {
        expect(NLU.normalise("I'm here and it's fine")).toContain('i am');
        expect(NLU.normalise("don't")).toBe('do not');
        expect(NLU.normalise("can't")).toBe('can not');
    });

    it('expands texting shorthand', () => {
        expect(NLU.normalise('plz tell me ur rates')).toBe('please tell me your rates');
        expect(NLU.normalise('thx')).toBe('thanks');
    });

    it('collapses stretched words', () => {
        expect(NLU.normalise('heyyyyy')).toBe('heyy');
        expect(NLU.normalise('sooooo cool')).toBe('soo cool');
    });

    it('strips accents', () => {
        expect(NLU.normalise('café')).toBe('cafe');
    });
});

describe('stemming', () => {
    it.each([
        ['bedrooms', 'bedroom'], ['swimming', 'swim'], ['booked', 'book'],
        ['cancelled', 'cancel'], ['prices', 'price'], ['children', 'child'],
        ['people', 'person'], ['staying', 'stai'], ['cleaning', 'clean']
    ])('%s -> %s', (word, expected) => {
        expect(NLU.stem(word)).toBe(expected);
    });

    it('does not mangle short words', () => {
        expect(NLU.stem('bed')).toBe('bed');
        expect(NLU.stem('ac')).toBe('ac');
    });
});

describe('fuzzy matching', () => {
    it('measures edit distance', () => {
        expect(NLU.editDistance('kitten', 'sitting', 5)).toBe(3);
        expect(NLU.editDistance('abc', 'abc', 2)).toBe(0);
    });

    it('counts a transposition as one edit', () => {
        expect(NLU.editDistance('teh', 'the', 2)).toBe(1);
    });

    it('bails out beyond the limit', () => {
        expect(NLU.editDistance('abcdefgh', 'zz', 2)).toBeGreaterThan(2);
    });

    it('gives similar-sounding words the same phonetic key', () => {
        expect(NLU.phonetic('kitchen')).toBe(NLU.phonetic('kichen'));
    });
});

describe('utterance analysis', () => {
    it('detects questions without a question mark', () => {
        expect(NLU.analyse('is there a pool').isQuestion).toBe(true);
        expect(NLU.analyse('the pool is nice').isQuestion).toBe(false);
    });

    it('classifies question type', () => {
        expect(NLU.analyse('how much is it?').questionType).toBe('how_much');
        expect(NLU.analyse('how many bedrooms?').questionType).toBe('how_many');
        expect(NLU.analyse('where is the villa?').questionType).toBe('where');
        expect(NLU.analyse('is it free?').questionType).toBe('yes_no');
    });

    it('finds negation and its scope', () => {
        const a = NLU.analyse('i do not want breakfast');
        expect(a.negated).toBe(true);
        expect(a.negatedTokens.has('breakfast')).toBe(true);
    });

    it('stops negation at a conjunction', () => {
        const a = NLU.analyse('not the pool but the beach');
        expect(a.negatedTokens.has('pool')).toBe(true);
        expect(a.negatedTokens.has('beach')).toBe(false);
    });

    it('reads sentiment', () => {
        expect(NLU.analyse('this is beautiful').sentiment).toBe(1);
        expect(NLU.analyse('this is terrible and useless').sentiment).toBe(-1);
        expect(NLU.analyse('is there parking').sentiment).toBe(0);
    });

    it('flags gibberish', () => {
        expect(NLU.analyse('asdfgh').gibberish).toBe(true);
        expect(NLU.analyse('is there a pool').gibberish).toBe(false);
    });
});

describe('entity extraction', () => {
    it('reads guest counts, including spelled-out numbers', () => {
        expect(NLU.extractEntities('we are 6 people', NOW).guests).toBe(6);
        expect(NLU.extractEntities('for four adults', NOW).guests).toBe(4);
        expect(NLU.extractEntities('party of 8', NOW).guests).toBe(8);
    });

    it('reads nights', () => {
        expect(NLU.extractEntities('3 nights please', NOW).nights).toBe(3);
        expect(NLU.extractEntities('staying a week', NOW).nights).toBe(7);
        expect(NLU.extractEntities('just the weekend', NOW).nights).toBe(2);
    });

    it('separates children from adults', () => {
        const e = NLU.extractEntities('2 adults and 2 kids', NOW);
        expect(e.guests).toBe(2);
        expect(e.children).toBe(2);
    });

    it('resolves relative dates against a fixed clock', () => {
        expect(NLU.extractDates('tomorrow', NOW)).toContain('2026-08-06');
        expect(NLU.extractDates('in 3 days', NOW)).toContain('2026-08-08');
        expect(NLU.extractDates('next week', NOW)).toContain('2026-08-12');
    });

    it('resolves named weekdays forward', () => {
        // 2026-08-05 is a Wednesday; the next Friday is the 7th
        expect(NLU.extractDates('on friday', NOW)).toContain('2026-08-07');
    });

    it('parses absolute dates in either order', () => {
        expect(NLU.extractDates('12 december', NOW)).toContain('2026-12-12');
        expect(NLU.extractDates('december 12', NOW)).toContain('2026-12-12');
        expect(NLU.extractDates('25th dec 2026', NOW)).toContain('2026-12-25');
    });

    it('rolls a past date into next year', () => {
        expect(NLU.extractDates('3 january', NOW)).toContain('2027-01-03');
    });

    it('picks up email and budget', () => {
        expect(NLU.extractEntities('mail me at a.b@test.co.in', NOW).email).toBe('a.b@test.co.in');
        expect(NLU.extractEntities('my budget is 20000 rupees', NOW).budget).toBe(20000);
    });
});

describe('date ranges', () => {
    const range = (t) => NLU.extractEntities(NLU.normalise(t), NOW);

    it.each([
        ['12th to the 15th', '2026-08-12', '2026-08-15', 3],
        ['12-15 dec', '2026-12-12', '2026-12-15', 3],
        ['20 dec to 24 dec', '2026-12-20', '2026-12-24', 4],
        ['check in 20 dec check out 24 dec', '2026-12-20', '2026-12-24', 4],
        ['aug 12 until aug 15', '2026-08-12', '2026-08-15', 3],
        ['12/08 to 15/08', '2026-08-12', '2026-08-15', 3]
    ])('%s -> %s..%s (%i nights)', (text, arrival, departure, nights) => {
        const e = range(text);
        expect(e.arrival).toBe(arrival);
        expect(e.departure).toBe(departure);
        expect(e.nights).toBe(nights);
    });

    it('carries a range across a year boundary', () => {
        const e = range('28 dec to 3 jan');
        expect(e.arrival).toBe('2026-12-28');
        expect(e.departure).toBe('2027-01-03');
        expect(e.nights).toBe(6);
    });

    it('keeps both endpoints in the flat dates array', () => {
        expect(range('12-15 dec').dates).toEqual(['2026-12-12', '2026-12-15']);
    });

    it('derives a departure from one date plus a night count', () => {
        const e = range('12 december for 3 nights');
        expect(e.arrival).toBe('2026-12-12');
        expect(e.departure).toBe('2026-12-15');
    });

    it('does not read counts as a range', () => {
        expect(range('for 2 to 3 nights').arrival).toBeUndefined();
        expect(range('for 2 to 3 nights').nights).toBe(3);
        expect(range('for 2 to 3 nights').guests).toBeUndefined();
        expect(range('can 4 to 6 people stay').arrival).toBeUndefined();
    });

    it('rejects impossible dates', () => {
        expect(range('31 february').dates).toEqual([]);
    });

    it('prefers an explicit date over a relative one', () => {
        // Both rules fire; the explicit date must win rather than yielding two.
        expect(range('arriving friday the 12th of december').dates).toEqual(['2026-12-12']);
    });
});

describe('segmentation', () => {
    it('splits multiple questions', () => {
        expect(NLU.segment('Is there wifi? How far is the beach?')).toHaveLength(2);
    });

    it('splits on a joining "and"', () => {
        const parts = NLU.segment('do you have wifi and is parking free');
        expect(parts.length).toBeGreaterThan(1);
    });

    it('leaves a single question alone', () => {
        expect(NLU.segment('how much does it cost per night')).toHaveLength(1);
    });

    // Splitting on "." used to shred an address into "a", "b@test" and "com",
    // which then defeated redaction downstream.
    it('does not split an email address', () => {
        expect(NLU.segment('mail me at a.b@test.co.in'))
            .toEqual(['mail me at a.b@test.co.in']);
    });

    it('does not split a phone number or a decimal', () => {
        expect(NLU.segment('ring +91 98765 43210')).toHaveLength(1);
        expect(NLU.segment('the rate is 12.5 thousand')).toHaveLength(1);
    });

    it('restores protected text intact when it does split', () => {
        const parts = NLU.segment('email a.b@test.com and is parking free');
        expect(parts.some(p => p.includes('a.b@test.com'))).toBe(true);
    });
});

/* The eval corpus doubles as a regression gate. `npm run eval` gives the full
 * report; these floors just stop a "small tweak" quietly undoing the tuning.
 * Measured at the time of writing: 87.6% accuracy, 5.0% wrong, 0% false
 * confidence. Floors sit a little below that to tolerate honest noise. */
describe('eval gate', () => {
    const CORPUS = require('../eval/corpus.js');
    const KNOWLEDGE = require('../public/chat/knowledge.js');

    const engine = new NLU.Engine({ concepts: KNOWLEDGE.CONCEPTS });
    engine.addAll(KNOWLEDGE.INTENTS).train();

    const scored = CORPUS.map(c => {
        const r = engine.match(c.text, {}, NOW);
        return { expected: c.intent, predicted: r.status === 'confident' && r.intent ? r.intent.id : null };
    });
    const positives = scored.filter(s => s.expected);
    const negatives = scored.filter(s => !s.expected);

    it('gets at least 85% of labelled utterances right', () => {
        const acc = positives.filter(s => s.predicted === s.expected).length / positives.length;
        expect(acc).toBeGreaterThanOrEqual(0.85);
    });

    it('answers confidently but wrongly at most 8% of the time', () => {
        const wrong = positives.filter(s => s.predicted && s.predicted !== s.expected).length / positives.length;
        expect(wrong).toBeLessThanOrEqual(0.08);
    });

    it('never answers an out-of-domain question confidently', () => {
        const answered = negatives.filter(s => s.predicted);
        expect(answered.map(s => s.predicted)).toEqual([]);
    });
});

describe('hard negatives', () => {
    it('push a confusable intent down', () => {
        const KNOWLEDGE = require('../public/chat/knowledge.js');
        const withNeg = KNOWLEDGE.INTENTS.filter(i => i.negativeExamples && i.negativeExamples.length);
        expect(withNeg.length).toBeGreaterThan(5);
    });

    it('separate the pairs they were written for', () => {
        const bot = new Bot({ random: Bot.seeded(1) });
        expect(bot.respond('how far is the sea', NOW).intent).toBe('beach');
        expect(bot.respond('how deep is the pool', NOW).intent).toBe('pool');
        bot.reset();
        expect(bot.respond('what time can we arrive', NOW).intent).toBe('checkin');
        expect(bot.respond('when do we have to leave', NOW).intent).toBe('checkout');
    });
});

describe('context persistence', () => {
    const NOWISH = '2026-08-05T12:00:00';

    it('round-trips what the bot knows', () => {
        const a = new Bot({ random: Bot.seeded(1) });
        a.respond('i want to book 20 december for 3 nights', NOWISH);

        const b = new Bot({ random: Bot.seeded(1) });
        expect(b.importState(JSON.parse(JSON.stringify(a.exportState())))).toBe(true);

        expect(b.context.booking).toEqual(a.context.booking);
        expect(b.context.pendingSlot).toBe(a.context.pendingSlot);
        expect(b.context.memory.nights).toBe(3);
    });

    it('resumes a half-finished booking after a reload', () => {
        const a = new Bot({ random: Bot.seeded(1) });
        a.respond('i want to book', NOWISH);
        a.respond('20 december', NOWISH);
        expect(a.context.pendingSlot).toBe('nights');

        const b = new Bot({ random: Bot.seeded(1) });
        b.importState(a.exportState());
        const res = b.respond('3', NOWISH);          // bare answer still lands
        expect(b.context.pendingSlot).toBe('guests');
        expect(res.booking.nights).toBe(3);
    });

    it('rejects a payload from another version', () => {
        const b = new Bot();
        expect(b.importState({ v: 99, memory: { guests: 4 } })).toBe(false);
        expect(b.context.memory.guests).toBeUndefined();
    });

    it('survives a corrupt payload without throwing', () => {
        const b = new Bot();
        expect(() => b.importState(null)).not.toThrow();
        expect(() => b.importState({ v: 1, memory: 'nope', topicTokens: 'nope', booking: 7 })).not.toThrow();
        expect(b.context.topicTokens).toEqual([]);
        expect(b.context.booking.arrival).toBeNull();
    });
});

describe('miss log', () => {
    const NOWISH = '2026-08-05T12:00:00';

    it('records what it could not understand', () => {
        const bot = new Bot({ random: Bot.seeded(1) });
        bot.respond('do you sell helicopters', NOWISH);
        expect(bot.missLog).toHaveLength(1);
        expect(bot.missLog[0]).toMatchObject({ status: expect.stringMatching(/unknown|unsure/) });
    });

    it('does not record what it understood', () => {
        const bot = new Bot({ random: Bot.seeded(1) });
        bot.respond('how much per night', NOWISH);
        expect(bot.missLog).toHaveLength(0);
    });

    it('redacts contact details out of the logged text', () => {
        const bot = new Bot({ random: Bot.seeded(1) });
        bot.respond('my cousin zxqwj at a.b@test.com wants +91 98765 43210 tickets', NOWISH);
        const logged = bot.missLog[0].text;
        expect(logged).toContain('[email]');
        expect(logged).toContain('[phone]');
        expect(logged).not.toContain('a.b@test.com');
        expect(logged).not.toContain('98765');
    });

    it('supports a swappable sink', () => {
        const seen = [];
        const bot = new Bot({ random: Bot.seeded(1), onMiss: e => seen.push(e) });
        bot.respond('qwlkejqwe', NOWISH);
        expect(seen).toHaveLength(1);
    });

    it('survives a sink that throws', () => {
        const bot = new Bot({ random: Bot.seeded(1), onMiss: () => { throw new Error('sink down'); } });
        expect(() => bot.respond('qwlkejqwe', NOWISH)).not.toThrow();
    });
});

/* ================================================================== */

describe('bot', () => {
    let bot;
    beforeEach(() => { bot = new Bot(); });

    const intentOf = (text) => bot.respond(text, NOW).intent;

    describe('intent recognition across paraphrases', () => {
        it.each([
            ['hi', 'greeting'],
            ['hello there!', 'greeting'],
            ['good morning', 'greeting'],
            ['how much does it cost', 'price'],
            ['whats the price per night', 'price'],
            ['is it expensive', 'price'],
            ['what would a weekend set me back', 'price'],
            ['how many bedrooms are there', 'capacity'],
            ['can it sleep 6 people', 'capacity'],
            ['is there a swimming pool', 'pool'],
            ['do you have wifi', 'wifi'],
            ['is the internet any good', 'wifi'],
            ['where is the villa located', 'location'],
            ['how far is the beach', 'beach'],
            ['how far is the airport', 'airport'],
            ['are pets allowed', 'pets'],
            ['can i bring my dog', 'pets'],
            ['can i smoke', 'smoking'],
            ['what time is check in', 'checkin'],
            ['whats the cancellation policy', 'cancellation'],
            ['how do i pay', 'payment'],
            ['is it kid friendly', 'children'],
            ['can we throw a party', 'parties'],
            ['is there parking', 'parking'],
            ['what is there to do nearby', 'activities'],
            ['can i talk to a human', 'contact'],
            ['are you a bot', 'bot_identity'],
            ['thanks a lot', 'thanks'],
            ['bye', 'goodbye']
        ])('"%s" -> %s', (text, expected) => {
            expect(intentOf(text)).toBe(expected);
        });
    });

    describe('robustness to how people actually type', () => {
        it.each([
            ['HOW MUCH IS IT', 'price'],
            ['how much is it???', 'price'],
            ['hw much per nite', 'price'],
            ['is ther a swiming pool', 'pool'],
            ['do u hv wifi', 'wifi'],
            ['plz tell me the rates', 'price'],
            ['whr is it', 'location'],
            ['can i bring my dogg', 'pets'],
            ['kichen available?', 'kitchen']
        ])('handles "%s"', (text, expected) => {
            expect(intentOf(text)).toBe(expected);
        });

        it('reports the spelling corrections it made', () => {
            const res = bot.respond('is ther a swiming pool', NOW);
            expect(res.corrections.length).toBeGreaterThan(0);
        });
    });

    describe('context and follow-ups', () => {
        it('resolves "is it heated?" after the pool topic', () => {
            bot.respond('tell me about the pool', NOW);
            const res = bot.respond('is it heated?', NOW);
            expect(res.intent).toBe('pool');
            expect(res.usedContext).toBe(true);
        });

        it('resolves an elliptical follow-up', () => {
            bot.respond('how far is the beach', NOW);
            expect(bot.respond('and the airport?', NOW).intent).toBe('airport');
        });

        it('accumulates entities across turns', () => {
            bot.respond('we are 4 people', NOW);
            const res = bot.respond('for 3 nights', NOW);
            expect(res.memory.guests).toBe(4);
            expect(res.memory.nights).toBe(3);
        });

        it('forgets everything on reset', () => {
            bot.respond('we are 4 people', NOW);
            bot.reset();
            expect(bot.context.memory.guests).toBeUndefined();
        });
    });

    describe('compound input', () => {
        it('answers two questions in one message', () => {
            const res = bot.respond('is there wifi and are pets allowed?', NOW);
            expect(res.segments).toBeGreaterThan(1);
            expect(res.text.toLowerCase()).toMatch(/wifi|broadband|internet/);
            expect(res.text.toLowerCase()).toMatch(/pet/);
        });

        it('folds a greeting into a short opener', () => {
            const res = bot.respond('hi, how much does it cost?', NOW);
            expect(res.text).toMatch(/^Hello!/);
            expect(res.text).toMatch(/night/);
        });

        it('does not answer the same intent twice', () => {
            // Asserts de-duplication, not the wording: the rate answer no
            // longer opens "Weekdays are" while rates are unset, so anchor
            // on a phrase the reply actually contains either way.
            const res = bot.respond('how much is it and what is the price?', NOW);
            const marker = bot.knowledge.FACTS.rateWeekday ? /Weekdays are/g : /do not have the nightly rates/g;
            expect(res.text.match(marker) || []).toHaveLength(1);
        });
    });

    describe('entity-driven routing', () => {
        it('treats a bare date + party size as a booking enquiry', () => {
            const res = bot.respond('12 december for 3 nights, 4 of us', NOW);
            expect(res.intent).toBe('availability');
            expect(res.memory.nights).toBe(3);
            expect(res.memory.dates).toContain('2026-12-12');
        });

        it('echoes the dates back so the guest can check them', () => {
            const res = bot.respond('can i book 20 december for 2 nights', NOW);
            expect(res.text).toContain('20 Dec 2026');   // guest-readable, not ISO
        });
    });

    describe('negation-aware answers', () => {
        it('agrees rather than contradicting a negative question', () => {
            expect(bot.respond('so there is no wifi right?', NOW).text).toMatch(/^There is, actually/);
        });

        it('answers a plain question plainly', () => {
            expect(bot.respond('do you have wifi', NOW).text).toMatch(/^Yes —/);
        });

        it('confirms a negative house rule', () => {
            // Pets: FACTS.pets is null, so there is no rule to confirm and
            // the bot defers instead of agreeing with an assumption.
            expect(bot.respond('no pets allowed i assume', NOW).text).toMatch(/not.*guess|confirm|nyaragoa/i);
            // Parties: still a known rule, so negation handling is unchanged.
            expect(bot.respond('no parties right?', NOW).text).toMatch(/^Correct —/);
        });

        it('reads a negated subject to the left of the negator', () => {
            // "smoking IS not allowed" — the subject, not just what follows
            expect(bot.respond('so smoking is not allowed inside?', NOW).text)
                .toMatch(/that is right/i);
        });

        it('handles a negated attribute', () => {
            expect(bot.respond('is the pool not heated?', NOW).text).toMatch(/Correct — it is not heated/);
        });
    });

    describe('booking slot-filler', () => {
        it('asks for arrival first when nothing is known', () => {
            const res = bot.respond('i want to book', NOW);
            expect(bot.context.pendingSlot).toBe('arrival');
            expect(res.text).toMatch(/which date/i);
        });

        it('walks arrival -> nights -> guests one slot at a time', () => {
            bot.respond('i want to book', NOW);

            const a = bot.respond('20 december', NOW);
            expect(bot.context.pendingSlot).toBe('nights');
            expect(a.text).toMatch(/how many nights/i);

            const b = bot.respond('3', NOW);            // bare number answers the slot
            expect(bot.context.pendingSlot).toBe('guests');
            expect(b.text).toMatch(/how many guests/i);

            const c = bot.respond('4', NOW);
            expect(bot.context.pendingSlot).toBeNull();
            expect(c.booking).toMatchObject({ arrival: '2026-12-20', nights: 3, guests: 4 });
        });

        it('confirms immediately when one message carries everything', () => {
            const res = bot.respond('can i book 20 to 24 december for 4 of us', NOW);
            expect(bot.context.pendingSlot).toBeNull();
            expect(res.booking).toMatchObject({
                arrival: '2026-12-20', departure: '2026-12-24', nights: 4, guests: 4
            });
            expect(res.text).toMatch(/here is what i have/i);
        });

        it('never re-asks a slot it already has', () => {
            bot.respond('i want to book for 3 nights', NOW);
            expect(bot.context.pendingSlot).toBe('arrival');
            const res = bot.respond('20 december', NOW);
            expect(res.text).not.toMatch(/how many nights/i);
            expect(bot.context.pendingSlot).toBe('guests');
        });

        it('does not hijack an unrelated question mid-flow', () => {
            bot.respond('is it available', NOW);
            expect(bot.respond('is there a pool', NOW).intent).toBe('pool');
            expect(bot.context.pendingSlot).toBe('arrival');   // flow survives the detour
        });

        it('still banks entities from a message it did not treat as a slot answer', () => {
            bot.respond('is it available', NOW);
            const res = bot.respond('6 people', NOW);
            expect(res.booking.guests).toBe(6);
        });

        it('flags a party over capacity in the summary', () => {
            const res = bot.respond('book 20 to 22 december for 12 people', NOW);
            expect(res.text).toMatch(/above the 6-guest limit/i);
        });

        it('flags a stay under the minimum', () => {
            const res = bot.respond('book 20 to 21 december for 2 people', NOW);
            expect(res.text).toMatch(/minimum stay/i);
        });

        it('is dropped entirely by a reset', () => {
            bot.respond('i want to book on 20 december', NOW);
            bot.reset();
            expect(bot.context.pendingSlot).toBeNull();
            expect(bot.context.booking.arrival).toBeNull();
        });
    });

    describe('failure handling', () => {
        it('does not pretend to understand nonsense', () => {
            const res = bot.respond('asdkjhasd qwkjeh', NOW);
            expect(res.confidence).toBeLessThan(0.42);
            expect(res.text).toMatch(/typo|did not catch|not certain/i);
        });

        it('escalates to a human after repeated misses', () => {
            bot.respond('zxcvbn', NOW);
            bot.respond('qwertyu', NOW);
            const third = bot.respond('mnbvcxz', NOW);
            expect(third.text).toMatch(/reach|nyaragoa|email/i);
        });

        it('offers something useful instead of a dead end', () => {
            const res = bot.respond('do you sell helicopters', NOW);
            expect(res.chips.length).toBeGreaterThan(0);
        });

        it('answers an empty message gracefully', () => {
            expect(bot.respond('', NOW).text).toMatch(/ask me/i);
        });

        it('takes a complaint on the chin', () => {
            const res = bot.respond('this bot is useless', NOW);
            expect(res.intent).toBe('complaint');
            expect(res.text).toMatch(/\+91|person/i);
        });
    });

    describe('clarification', () => {
        it('can be answered by naming the topic', () => {
            bot.context.pendingClarify = ['price', 'availability'];
            const res = bot.respond('the price one', NOW);
            expect(res.intent).toBe('price');
            expect(res.resolvedFromClarification).toBe(true);
        });

        it('can be answered by position', () => {
            bot.context.pendingClarify = ['pool', 'beach'];
            expect(bot.respond('the second', NOW).intent).toBe('beach');
        });
    });

    // Each of these was a real misfire found by talking to the bot, not by
    // writing a test first. They stay here so they cannot come back.
    describe('regressions', () => {
        it('does not let the last topic hijack a non-question', () => {
            bot.respond('tell me about the pool', NOW);
            const res = bot.respond('thats a shame', NOW);
            expect(res.intent).not.toBe('pool');
        });

        it('does not let the last topic hijack a new subject', () => {
            bot.respond('is there a pool', NOW);
            expect(bot.respond('can we bring our labrador?', NOW).intent).toBe('pets');
        });

        it('treats "n" as "and" when splitting', () => {
            const res = bot.respond('do u hv wifi n ac in all rooms?', NOW);
            expect(res.text.toLowerCase()).toMatch(/wifi|complimentary/i);
            expect(res.text.toLowerCase()).toMatch(/air conditioning/);
        });

        it('does not read "available" as a booking enquiry on its own', () => {
            expect(bot.respond('kitchen available?', NOW).intent).toBe('kitchen');
        });

        it('does not read a bare "do" as asking about activities', () => {
            expect(bot.respond('do you sell helicopters', NOW).intent).not.toBe('activities');
        });

        it('ignores conversational filler beside a real question', () => {
            // Assert on intent, not text: greeting replies vary by design, and one
            // variant happens to mention the beach.
            const res = bot.respond('hey, me and my friends are planning a trip', NOW);
            expect(res.intent).toBe('greeting');
        });

        it('does not guess a topic from filler alone', () => {
            const res = bot.respond('we are planning a trip with some friends', NOW);
            expect(['airport', 'beach', 'activities']).not.toContain(res.intent);
        });

        it('reads "in december" as December, not this weekend', () => {
            const res = bot.respond('what about a long weekend in december', NOW);
            expect(res.memory.month).toBe('December');
            expect(res.memory.dates || []).not.toContain('2026-08-08');
        });

        it('does not correct ordinary English into villa vocabulary', () => {
            const res = bot.respond('what would a weekend set me back', NOW);
            expect(res.corrections.map(c => c.from)).not.toContain('back');
            expect(res.intent).toBe('price');
        });
    });

    describe('answer quality', () => {
        it('answers from FACTS, never inventing numbers', () => {
            const res = bot.respond('how much per night', NOW);
            const rate = bot.knowledge.FACTS.rateWeekday;

            if (rate) {
                expect(res.text).toContain(rate);
            } else {
                // The stronger case, and the one that holds today: with no
                // rate set the bot must NOT produce a number at all. This is
                // what stops a placeholder becoming a quote to a guest.
                expect(res.text).not.toMatch(/₹|Rs\.?\s*\d|\d{3,}\s*(?:\/|per)\s*night/i);
                expect(res.text).toMatch(/do not have|listing|nyaragoa/i);
            }
        });

        it('tailors capacity answers to the party size', () => {
            expect(bot.respond('can 12 of us stay', NOW).text).toMatch(/over the/);
        });

        it('says no clearly when the answer is no', () => {
            // FACTS.pets is null — the real policy was never verified. The
            // bot must hand this to a human rather than assert either way.
            expect(bot.respond('can i bring my dog', NOW).text).toMatch(/not.*guess|confirm|nyaragoa/i);
        });

        it('varies its greeting rather than repeating verbatim', () => {
            const seen = new Set();
            for (let i = 0; i < 25; i++) { bot.reset(); seen.add(bot.respond('hi', NOW).text); }
            expect(seen.size).toBeGreaterThan(1);
        });
    });
});
