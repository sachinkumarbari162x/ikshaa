/* =====================================================================
 * nlu.js — a small natural-language understanding engine.
 *
 * No AI, no network, no dependencies. Everything here is deterministic
 * string processing + linear algebra you could do on paper:
 *
 *   text → normalise → spell-correct → stem → expand concepts
 *        → vectorise (TF-IDF) → cosine-match against intent examples
 *        → blend with keyword/pattern/bigram evidence → confidence
 *
 * Works as a <script> (window.NLU) and under require() (jest).
 * ===================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NLU = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* =================================================================
     * 1. Lexical resources
     * ============================================================== */

    var CONTRACTIONS = {
        "i'm": 'i am', "im": 'i am', "i've": 'i have', "i'd": 'i would', "i'll": 'i will',
        "you're": 'you are', "youre": 'you are', "you've": 'you have', "you'd": 'you would',
        "you'll": 'you will', "we're": 'we are', "were": 'we are', "we've": 'we have',
        "we'd": 'we would', "we'll": 'we will', "they're": 'they are', "they've": 'they have',
        "it's": 'it is', "its": 'it is', "that's": 'that is', "thats": 'that is',
        "what's": 'what is', "whats": 'what is', "where's": 'where is', "wheres": 'where is',
        "who's": 'who is', "hows": 'how is', "how's": 'how is', "there's": 'there is',
        "theres": 'there is', "here's": 'here is', "let's": 'let us', "lets": 'let us',
        "don't": 'do not', "dont": 'do not', "doesn't": 'does not', "doesnt": 'does not',
        "didn't": 'did not', "didnt": 'did not', "isn't": 'is not', "isnt": 'is not',
        "aren't": 'are not', "arent": 'are not', "wasn't": 'was not', "wasnt": 'was not',
        "weren't": 'were not', "werent": 'were not', "haven't": 'have not', "havent": 'have not',
        "hasn't": 'has not', "hasnt": 'has not', "hadn't": 'had not', "hadnt": 'had not',
        "won't": 'will not', "wont": 'will not', "wouldn't": 'would not', "wouldnt": 'would not',
        "can't": 'can not', "cant": 'can not', "cannot": 'can not',
        "couldn't": 'could not', "couldnt": 'could not', "shouldn't": 'should not',
        "shouldnt": 'should not', "mustn't": 'must not', "ain't": 'is not',
        // texting shorthand — people type this at a chat widget constantly
        gonna: 'going to', wanna: 'want to', gotta: 'got to', lemme: 'let me',
        gimme: 'give me', kinda: 'kind of', sorta: 'sort of', dunno: 'do not know',
        u: 'you', ur: 'your', r: 'are', n: 'and', y: 'why', k: 'ok', kk: 'ok',
        pls: 'please', plz: 'please', plss: 'please', thx: 'thanks', ty: 'thanks',
        tnx: 'thanks', tq: 'thanks', np: 'no problem', asap: 'urgently',
        info: 'information', pic: 'picture', pics: 'pictures', pref: 'prefer',
        abt: 'about', bcz: 'because', bcoz: 'because', cuz: 'because', coz: 'because',
        wat: 'what', wht: 'what', hw: 'how', wen: 'when', wer: 'where',
        whr: 'where', wher: 'where', hru: 'how are you', nite: 'night', nites: 'nights',
        rmz: 'rooms', rm: 'room', avl: 'available', avlbl: 'available', bkng: 'booking',
        yeah: 'yes', yep: 'yes', yup: 'yes', ya: 'yes', yaa: 'yes', yah: 'yes',
        nope: 'no', nah: 'no', naa: 'no', ok: 'okay', okey: 'okay', okk: 'okay'
    };

    var NUMBER_WORDS = {
        zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
        eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
        fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
        nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
        couple: 2, few: 3, several: 3, dozen: 12
    };

    var STOPWORDS = new Set(('a an the of to in on at for from by with about as is are was were ' +
        'be been being am do does did doing have has had having will would shall should may ' +
        'might must can could i you he she it we they me him her us them my your his their our ' +
        'this that these those there here then than so very just really quite actually please ' +
        'kindly hey and or but if while also too much many some any all each').split(' '));

    // Content words that must never be discarded even though they are short.
    var KEEP = new Set(['no', 'not', 'pet', 'dog', 'cat', 'car', 'ac', 'tv', 'wifi', 'bed', 'pay', 'cost', 'kid', 'far', 'how', 'why', 'who', 'when', 'where', 'what', 'yes', 'ok']);

    // Ordinary English the spell-corrector must leave alone. Without this it
    // "fixes" real words into domain vocabulary — "set me back" -> "set me book".
    var COMMON = new Set(('back sell tell give take make want need know think look come went get put ' +
        'say see use find work call try ask feel seem leave keep let begin help talk turn start show ' +
        'hear play run move live believe bring happen write sit stand lose meet include continue set ' +
        'learn change lead understand watch follow stop create speak read spend grow open walk win ' +
        'offer remember love consider appear buy wait serve send expect build stay fall cut reach ' +
        'remain suggest raise pass require report decide pull mean means meant guess wonder mind ' +
        'thing things time times year years way ways day days man world life hand part eye woman ' +
        'place places week weeks case point number group problem fact idea question answer sort type ' +
        'good new first last long great little own other others old right left big high different ' +
        'small large next early young important public bad same able sure fine okay nice easy hard ' +
        'quick slow late soon later maybe perhaps still even ever again once always never often ' +
        'sometimes usually already yet almost enough more most less least better best worse worst ' +
        'both either whether during before after until since between around near close over under ' +
        'above below inside outside behind through across along toward against upon within without ' +
        'much many lot lots bit little more well also though because since unless whereas therefore ' +
        'anyway besides instead rather quite pretty somewhat totally really truly honestly actually ' +
        'plan plans planning planned trip trips friend friends family families holiday holidays ' +
        'vacation vacations travel travelling traveling coming visiting group groups everyone ' +
        'someone anyone nobody nothing something anything myself ourselves together alone').split(' '));

    function isRealWord(t) { return COMMON.has(t) || STOPWORDS.has(t); }

    var NEGATORS = new Set(['not', 'no', 'never', 'without', 'nor', 'neither', 'none', 'hardly', 'barely', 'except']);

    var QUESTION_HEADS = new Set(['what', 'where', 'when', 'who', 'whom', 'whose', 'why', 'how', 'which',
        'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'will', 'would',
        'should', 'may', 'might', 'have', 'has', 'had', 'am']);

    var PRONOUNS = new Set(['it', 'its', 'that', 'this', 'they', 'them', 'those', 'these', 'there', 'one']);

    var POSITIVE = new Set(['good', 'great', 'nice', 'love', 'lovely', 'awesome', 'amazing', 'perfect',
        'excellent', 'beautiful', 'wonderful', 'best', 'fantastic', 'super', 'cool', 'happy',
        'thanks', 'thank', 'brilliant', 'helpful', 'gorgeous', 'stunning']);

    var NEGATIVE = new Set(['bad', 'awful', 'terrible', 'worst', 'hate', 'angry', 'annoyed', 'annoying',
        'useless', 'stupid', 'dumb', 'rubbish', 'poor', 'disappointed', 'frustrating', 'frustrated',
        'slow', 'broken', 'wrong', 'horrible', 'sucks', 'scam', 'rude']);

    var MONTHS = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
        may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
        september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
    };

    var WEEKDAYS = {
        sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3,
        wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6
    };

    /* =================================================================
     * 2. Normalisation
     * ============================================================== */

    function stripAccents(s) {
        return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
    }

    function normalise(text) {
        var s = stripAccents(String(text || '').toLowerCase());

        s = s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
        s = s.replace(/[–—]/g, '-');

        // "heyyyy" / "soooo" -> "heyy" / "soo"  (keep a doubling so it still reads as emphasis)
        s = s.replace(/(.)\1{2,}/g, '$1$1');

        // expand contractions and shorthand, longest-token-first
        s = s.replace(/[a-z']+/g, function (w) {
            return Object.prototype.hasOwnProperty.call(CONTRACTIONS, w) ? CONTRACTIONS[w] : w;
        });

        s = s.replace(/[^a-z0-9?!.,:;/\-\s@']/g, ' ');
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    function tokenise(text) {
        var raw = text.match(/[a-z0-9][a-z0-9'\-]*/g) || [];
        return raw.map(function (t) { return t.replace(/^'+|'+$/g, ''); }).filter(Boolean);
    }

    /* =================================================================
     * 3. Stemming (compact Porter-style suffix stripper)
     * ============================================================== */

    var IRREGULAR = {
        children: 'child', people: 'person', persons: 'person', men: 'man', women: 'woman',
        feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose', beds: 'bed',
        prices: 'price', places: 'place', has: 'have', had: 'have', is: 'be', are: 'be',
        was: 'be', were: 'be', been: 'be', am: 'be', does: 'do', did: 'do', done: 'do',
        went: 'go', goes: 'go', gone: 'go', paid: 'pay', kids: 'kid', buses: 'bus',
        left: 'leave', kept: 'keep', slept: 'sleep', took: 'take', taken: 'take'
    };

    function isVowel(w, i) {
        var c = w[i];
        if ('aeiou'.indexOf(c) >= 0) return true;
        return c === 'y' && i > 0 && 'aeiou'.indexOf(w[i - 1]) < 0;
    }

    function measure(w) {
        var m = 0, i = 0, n = w.length;
        while (i < n && isVowel(w, i)) i++;            // skip leading vowels
        while (i < n) {
            while (i < n && !isVowel(w, i)) i++;        // consonants
            if (i >= n) break;
            while (i < n && isVowel(w, i)) i++;         // vowels
            if (i >= n) { m++; break; }
            m++;
            while (i < n && isVowel(w, i)) i++;
        }
        return m;
    }

    function hasVowel(w) {
        for (var i = 0; i < w.length; i++) if (isVowel(w, i)) return true;
        return false;
    }

    function stem(word) {
        var w = word;
        if (IRREGULAR[w]) return IRREGULAR[w];
        if (w.length < 4) return w;

        // step 1a — plurals
        if (/sses$/.test(w)) w = w.slice(0, -2);
        else if (/[^aeiou]ies$/.test(w)) w = w.slice(0, -3) + 'y';
        else if (/ies$/.test(w)) w = w.slice(0, -2);
        else if (/([^s])s$/.test(w)) w = w.slice(0, -1);

        // step 1b — -ed / -ing
        var changed = false;
        if (/eed$/.test(w)) {
            if (measure(w.slice(0, -1)) > 0) w = w.slice(0, -1);
        } else if (/ed$/.test(w) && hasVowel(w.slice(0, -2))) {
            w = w.slice(0, -2); changed = true;
        } else if (/ing$/.test(w) && hasVowel(w.slice(0, -3))) {
            w = w.slice(0, -3); changed = true;
        }
        if (changed) {
            if (/(at|bl|iz)$/.test(w)) w += 'e';
            // Undo the doubled consonant of "stopped"/"cancelled". Porter exempts
            // l/s/z, but that leaves British "cancell"; allow those once the stem
            // is long enough (m>1) so "fall" and "pass" survive intact.
            else if (/([^aeiouy])\1$/.test(w) && (!/([lsz])\1$/.test(w) || measure(w) > 1)) {
                w = w.slice(0, -1);
            } else if (measure(w) === 1 && /[^aeiou][aeiou][^aeiouwxy]$/.test(w)) w += 'e';
        }

        // step 1c — trailing y
        if (/y$/.test(w) && hasVowel(w.slice(0, -1))) w = w.slice(0, -1) + 'i';

        // step 4 — derivational suffixes (only on long enough stems)
        var s4 = [['ization', 'ize'], ['ational', 'ate'], ['fulness', 'ful'], ['ousness', 'ous'],
        ['iveness', 'ive'], ['ation', 'ate'], ['ement', ''], ['ment', ''], ['ness', ''],
        ['able', ''], ['ible', '']];
        for (var i = 0; i < s4.length; i++) {
            var suf = s4[i][0];
            if (w.length > suf.length + 2 && w.slice(-suf.length) === suf) {
                var base = w.slice(0, -suf.length);
                if (measure(base) > 1) { w = base + s4[i][1]; break; }
            }
        }
        return w;
    }

    /* =================================================================
     * 4. Fuzzy matching — typo tolerance
     * ============================================================== */

    // Damerau-Levenshtein with an early bail-out once we exceed `max`.
    function editDistance(a, b, max) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > max) return max + 1;

        var prev2 = [], prev = [], cur = [], i, j;
        for (j = 0; j <= b.length; j++) prev[j] = j;

        for (i = 1; i <= a.length; i++) {
            cur[0] = i;
            var best = cur[0];
            for (j = 1; j <= b.length; j++) {
                var cost = a[i - 1] === b[j - 1] ? 0 : 1;
                cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    cur[j] = Math.min(cur[j], prev2[j - 2] + 1);   // transposition
                }
                if (cur[j] < best) best = cur[j];
            }
            if (best > max) return max + 1;
            prev2 = prev.slice(); prev = cur.slice();
        }
        return prev[b.length];
    }

    // Crude phonetic key — catches "swiming"/"swimming", "kichen"/"kitchen".
    function phonetic(word) {
        var w = word.toLowerCase()
            .replace(/[^a-z]/g, '')
            .replace(/^(kn|gn|pn|wr)/, 'n')
            .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/sch/g, 'sk')
            .replace(/tch/g, 'ch')                       // kitchen == kichen
            .replace(/ch|sh|ti|ci/g, 'x').replace(/th/g, '0').replace(/qu/g, 'k')
            .replace(/[wh]/g, '').replace(/c/g, 'k').replace(/z/g, 's')
            .replace(/v/g, 'f').replace(/j/g, 'g');
        if (!w) return '';
        var head = w[0];
        var tail = w.slice(1).replace(/[aeiouy]/g, '');
        return (head + tail).replace(/(.)\1+/g, '$1').slice(0, 6);
    }

    // Deliberately tight. Two edits on an 8-letter word turned "planning" into
    // "landing" — close enough numerically, nonsense semantically.
    function tolerance(len) { return len <= 3 ? 0 : len <= 8 ? 1 : 2; }

    /* =================================================================
     * 5. Entity extraction
     * ============================================================== */

    function iso(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function addDays(d, n) { var c = new Date(d.getTime()); c.setDate(c.getDate() + n); return c; }

    function refDate(now) {
        var ref = now ? new Date(now) : new Date();
        ref.setHours(12, 0, 0, 0);
        return ref;
    }

    function fromIso(s) { return new Date(s + 'T12:00:00'); }

    function extractDates(text, now) {
        var ref = refDate(now);
        // Kept apart so an explicit date always beats a relative one — otherwise
        // "arriving friday the 12th of dec" yields two different answers.
        var relative = [], absolute = [];

        // "a long weekend in december" is about December, not this Saturday —
        // so relative shorthand is ignored once a month is named.
        var namedMonth = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/.test(text);

        if (/\btoday\b|\btonight\b/.test(text)) relative.push(iso(ref));
        if (/\btomorrow\b|\btmrw\b/.test(text)) relative.push(iso(addDays(ref, 1)));
        if (/\bday after tomorrow\b/.test(text)) relative.push(iso(addDays(ref, 2)));
        if (/\bnext week\b/.test(text)) relative.push(iso(addDays(ref, 7)));
        if (/\bnext month\b/.test(text)) {
            var nm = new Date(ref.getTime()); nm.setMonth(nm.getMonth() + 1); relative.push(iso(nm));
        }

        var inDays = text.match(/\bin (\d+) (day|week|month)s?\b/);
        if (inDays) {
            var n = parseInt(inDays[1], 10);
            var mult = inDays[2] === 'day' ? 1 : inDays[2] === 'week' ? 7 : 30;
            relative.push(iso(addDays(ref, n * mult)));
        }

        // "this weekend" / "next weekend" -> upcoming Saturday
        var wkend = namedMonth ? null : text.match(/\b(this|next|the)?\s*weekend\b/);
        if (wkend) {
            var delta = (6 - ref.getDay() + 7) % 7 || 7;
            if (wkend[1] === 'next') delta += 7;
            relative.push(iso(addDays(ref, delta)));
        }

        // "next friday" / "on monday"
        var wd = namedMonth ? null : text.match(/\b(next|this|on|coming)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
        if (wd) {
            var target = WEEKDAYS[wd[2]];
            var diff = (target - ref.getDay() + 7) % 7 || 7;
            if (wd[1] === 'next') diff += 7;
            relative.push(iso(addDays(ref, diff)));
        }

        // "12 aug", "aug 12", "12th august 2026", "12/08/2026"
        var explicit = oneDate(text, ref, null);
        if (explicit) absolute.push(explicit);

        var found = absolute.length ? absolute : relative;
        return found.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    }

    function dateFromParts(ref, day, month, text) {
        if (day < 1 || day > 31) return null;
        var yearMatch = String(text).match(/\b(20\d{2})\b/);
        var year = yearMatch ? +yearMatch[1] : ref.getFullYear();
        var d = new Date(year, month, day, 12);
        if (d.getMonth() !== month) return null;              // 31 february
        if (!yearMatch && d < ref) d.setFullYear(year + 1);
        return isNaN(d) ? null : iso(d);
    }

    function monthOf(fragment) {
        var words = String(fragment).match(/[a-z]{3,9}/g) || [];
        for (var i = 0; i < words.length; i++) {
            if (MONTHS[words[i]] !== undefined) return MONTHS[words[i]];
        }
        return null;
    }

    // One date out of a fragment. `monthHint` fills in for a bare day ("the 24th"),
    // which is how the tail of "20 dec to 24" has to be read.
    function oneDate(fragment, ref, monthHint) {
        var t = String(fragment);

        var dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s*)?([a-z]{3,9})\b/);
        if (dm && MONTHS[dm[2]] !== undefined) return dateFromParts(ref, +dm[1], MONTHS[dm[2]], t);

        var md = t.match(/\b([a-z]{3,9})\s*(\d{1,2})(?:st|nd|rd|th)?\b/);
        if (md && MONTHS[md[1]] !== undefined) return dateFromParts(ref, +md[2], MONTHS[md[1]], t);

        // 12/08/2026 or 12-08 (day first — the local convention)
        var num = t.match(/\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b/);
        if (num) {
            var yr = num[3] ? (num[3].length === 2 ? 2000 + +num[3] : +num[3]) : ref.getFullYear();
            var cand = new Date(yr, +num[2] - 1, +num[1], 12);
            if (isNaN(cand) || cand.getMonth() !== +num[2] - 1) return null;
            if (!num[3] && cand < ref) cand.setFullYear(yr + 1);
            return iso(cand);
        }

        if (monthHint !== null && monthHint !== undefined) {
            var bare = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
            if (bare) return dateFromParts(ref, +bare[1], monthHint, t);
        }
        return null;
    }

    function span(arrival, departure) {
        if (!arrival || !departure) return null;
        var nights = Math.round((fromIso(departure) - fromIso(arrival)) / 86400000);
        if (nights <= 0 || nights > 365) return null;
        return { arrival: arrival, departure: departure, nights: nights };
    }

    var RANGE_SEP = '(?:to|till|until|thru|through|upto|up\\s+to|-|–|—)';
    // "2 to 3 nights" and "4 to 6 people" are counts, not dates.
    var NOT_A_COUNT = '(?!\\s*(?:night|day|week|month|people|person|guest|adult|kid|child|pax|room|bedroom|bhk|hour|km))';

    /**
     * A stay is a span, not two loose dates. Returns { arrival, departure, nights }.
     */
    function extractRange(text, now) {
        var ref = refDate(now), r;

        // "check in 20 dec, check out 24 dec"
        var ci = text.match(/check\s*-?\s*in\b(.*?)\bcheck\s*-?\s*out\b(.*)/);
        if (ci) {
            r = span(oneDate(ci[1], ref, null), oneDate(ci[2], ref, monthOf(ci[1])));
            if (r) return r;
        }

        // "12 to 15 aug", "12-15 december", "from the 3rd till the 6th"
        var same = text.match(new RegExp(
            '\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*' + RANGE_SEP + '\\s*(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?' +
            NOT_A_COUNT + '\\s*(?:of\\s+)?([a-z]{3,9})?'));
        // Skip when slashes are present: in "12/08 to 15/08" this branch would
        // otherwise latch onto "08 to 15" and lose the real day.
        if (same && +same[2] > +same[1] && text.indexOf('/') < 0 &&
            !/\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/.test(text)) {
            var named = same[3] && MONTHS[same[3]] !== undefined;
            var arrival = dateFromParts(ref, +same[1], named ? MONTHS[same[3]] : ref.getMonth(),
                named ? text : '');
            if (arrival) {
                // Anchor the departure to the arrival's month and year, or a
                // month-boundary roll-forward splits the two endpoints apart.
                var a = fromIso(arrival);
                r = span(arrival, iso(new Date(a.getFullYear(), a.getMonth(), +same[2], 12)));
                if (r) return r;
            }
        }

        // "20 dec to 24 dec", "12/08 until 15/08", "28 dec to 3 jan"
        var parts = text.split(new RegExp('\\s+' + RANGE_SEP + '\\s+'));
        if (parts.length === 2) {
            r = span(oneDate(parts[0], ref, null), oneDate(parts[1], ref, monthOf(parts[0])));
            if (r) return r;
        }

        return null;
    }

    function wordsToNumbers(text) {
        return text.replace(/\b[a-z]+\b/g, function (w) {
            return NUMBER_WORDS[w] !== undefined ? NUMBER_WORDS[w] : w;
        });
    }

    function extractEntities(text, now) {
        var numeric = wordsToNumbers(text);
        var e = { dates: extractDates(numeric, now) };

        // "for 3 nights" is a duration, not a party size — hence the lookahead.
        // Also rejects "for 2 to 3 nights", where the 2 opens a range, not a party size.
        var UNITS = '(?!\\s*(?:nights?|days?|weeks?|months?|bedrooms?|rooms?|bhk|pm|am|hours?|' +
            '(?:to|till|until|-)\\s*\\d))';
        var guests = numeric.match(/\b(\d{1,2})\s*(?:adults?|guests?|people|person|pax|of us|friends?)\b/) ||
            numeric.match(new RegExp('\\b(?:for|we are|there are|party of|group of|book for)\\s*(\\d{1,2})\\b' + UNITS));
        if (guests) e.guests = parseInt(guests[1], 10);

        var kids = numeric.match(/\b(\d{1,2})\s*(?:kids?|childrens?|child|children|infants?|babies|baby|toddlers?)\b/);
        if (kids) e.children = parseInt(kids[1], 10);

        var nights = numeric.match(/\b(\d{1,2})\s*(?:nights?|days?|evenings?)\b/);
        if (nights) e.nights = parseInt(nights[1], 10);
        else if (/\b(?:a |one )?week\b/.test(numeric)) e.nights = 7;
        else if (/\blong weekend\b/.test(numeric)) e.nights = 3;
        else if (/\bweekend\b/.test(numeric)) e.nights = 2;

        var money = numeric.match(/(?:rs\.?|inr|₹|\$|usd)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:rs\.?|inr|rupees|dollars?)/);
        if (money) e.budget = parseInt((money[1] || money[2]).replace(/,/g, ''), 10);

        var email = text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/);
        if (email) e.email = email[0];

        var phone = text.match(/\+?\d[\d\s\-]{7,14}\d/);
        if (phone && !e.dates.length) e.phone = phone[0].trim();

        var rooms = numeric.match(/\b(\d{1,2})\s*(?:rooms?|bedrooms?|bhk)\b/);
        if (rooms) e.rooms = parseInt(rooms[1], 10);

        // A stay is a span. A range wins over the loose date list; failing that,
        // a single date plus a night count still gives us a departure.
        var range = extractRange(numeric, now);
        if (range) {
            e.arrival = range.arrival;
            e.departure = range.departure;
            e.nights = range.nights;
            e.dates = [range.arrival, range.departure];
        } else if (e.dates.length) {
            e.arrival = e.dates[0];
            if (e.nights) e.departure = iso(addDays(fromIso(e.arrival), e.nights));
        }

        // A month with no day ("sometime in december") is still useful.
        if (!e.dates.length) {
            var bare = numeric.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
            if (bare) {
                var idx = MONTHS[bare[1]];
                e.month = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                    'August', 'September', 'October', 'November', 'December'][idx];
            }
        }

        return e;
    }

    /* =================================================================
     * 6. Analysis — everything we know about one utterance
     * ============================================================== */

    function questionType(tokens, text) {
        var head = tokens[0];
        if (/\bhow (?:much|many)\b/.test(text)) return /\bhow much\b/.test(text) ? 'how_much' : 'how_many';
        if (/\bhow far\b/.test(text)) return 'how_far';
        if (/\bhow long\b/.test(text)) return 'how_long';
        if (head === 'what') return 'what';
        if (head === 'where') return 'where';
        if (head === 'when') return 'when';
        if (head === 'who' || head === 'whom') return 'who';
        if (head === 'why') return 'why';
        if (head === 'how') return 'how';
        if (head === 'which') return 'which';
        for (var i = 0; i < tokens.length && i < 4; i++) {
            if (['what', 'where', 'when', 'why', 'how', 'who', 'which'].indexOf(tokens[i]) >= 0) return tokens[i];
        }
        if (QUESTION_HEADS.has(head)) return 'yes_no';
        return null;
    }

    var AUXILIARIES = ['is', 'are', 'was', 'were', 'do', 'does', 'did', 'will', 'would',
        'can', 'could', 'has', 'have', 'had', 'am', 'be', 'should', 'must'];

    // Mark which tokens fall inside a negation's scope (until a clause break).
    // Scope runs rightward from the negator, but an auxiliary immediately before
    // it ("smoking IS not allowed") means the subject on the left is the thing
    // being negated, so that clause gets pulled in too.
    function negationScope(tokens) {
        var scoped = new Set(), active = false, clause = [];
        for (var i = 0; i < tokens.length; i++) {
            var t = tokens[i];
            if (NEGATORS.has(t)) {
                if (i > 0 && AUXILIARIES.indexOf(tokens[i - 1]) >= 0) {
                    clause.forEach(function (c) { scoped.add(c); });
                }
                active = true;
                clause = [];
                continue;
            }
            if (['but', 'however', 'though', 'although', 'and', 'or'].indexOf(t) >= 0) {
                active = false;
                clause = [];
                continue;
            }
            if (active) scoped.add(t);
            else clause.push(t);
        }
        return scoped;
    }

    // Keyboard mashing: too few vowels for the length, or a long consonant run.
    function looksGibberish(t) {
        if (isRealWord(t)) return false;
        if (t.length < 5) return false;
        if (/(.)\1{2,}/.test(t)) return true;
        var vowels = (t.match(/[aeiou]/g) || []).length;
        if (vowels / t.length < 0.2) return true;
        return /[^aeiou]{4,}/.test(t);
    }

    function analyse(text, now) {
        var norm = normalise(text);
        var tokens = tokenise(norm);
        var stems = tokens.map(stem);
        var content = tokens.filter(function (t) { return !STOPWORDS.has(t) || KEEP.has(t); });

        var sentiment = 0;
        tokens.forEach(function (t) {
            var s = stem(t);
            if (POSITIVE.has(t) || POSITIVE.has(s)) sentiment++;
            if (NEGATIVE.has(t) || NEGATIVE.has(s)) sentiment--;
        });
        var negScope = negationScope(tokens);
        if (negScope.size) {
            tokens.forEach(function (t) { if (negScope.has(t) && POSITIVE.has(t)) sentiment -= 2; });
        }

        return {
            raw: String(text || ''),
            normalised: norm,
            tokens: tokens,
            stems: stems,
            content: content,
            entities: extractEntities(norm, now),
            isQuestion: /\?/.test(text) || QUESTION_HEADS.has(tokens[0]),
            questionType: questionType(tokens, norm),
            negated: negScope.size > 0,
            negatedTokens: negScope,
            sentiment: sentiment > 0 ? 1 : sentiment < 0 ? -1 : 0,
            sentimentScore: sentiment,
            polite: /\b(please|kindly|thank|thanks|sorry|appreciate)\b/.test(norm),
            shouting: /[A-Z]{4,}/.test(String(text)) && String(text).toUpperCase() === String(text),
            hasPronoun: tokens.some(function (t) { return PRONOUNS.has(t); }),
            wordCount: tokens.length,
            gibberish: tokens.length > 0 && tokens.every(looksGibberish)
        };
    }

    /* =================================================================
     * 7. Splitting compound utterances
     *    "hi, is there wifi and do you allow dogs?" -> 2 questions
     * ============================================================== */

    // Structures whose internal punctuation must survive sentence splitting.
    // Without this, "a.b@test.com" becomes the segments "a", "b@test" and "com" —
    // which also defeats any downstream redaction of the address.
    var PROTECTED = [
        /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi,   // email
        /\b(?:https?:\/\/|www\.)\S+/gi,                 // url
        /\+?\d[\d\s\-()]{7,14}\d/g,                     // phone
        /\b\d+\.\d+\b/g                                 // decimal
    ];

    var HOLD = '\u0001';

    function segment(text) {
        var held = [];
        var masked = String(text || '');
        PROTECTED.forEach(function (re) {
            masked = masked.replace(re, function (match) {
                held.push(match);
                return HOLD + (held.length - 1) + HOLD;
            });
        });

        var restore = function (s) {
            return s.replace(/\u0001(\d+)\u0001/g, function (_, i) { return held[+i]; });
        };

        // Chunk into sentences keeping their terminator. Written with match()
        // rather than a lookbehind split, which Safari < 16.4 cannot parse.
        var parts = (masked.match(/[^?!.;\n]+[?!.]*/g) || [])
            .map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length > 0; });

        var out = [];
        parts.forEach(function (p) {
            // Only split on "and"/"also"/comma when both halves carry their own content.
            // "n" catches "wifi n parking", which people type constantly.
            var sub = p.split(/\s*,\s*|\s+(?:and also|and|also|plus|as well as|n)\s+/i);
            if (sub.length > 1) {
                var meaty = sub.filter(function (s) {
                    return tokenise(normalise(s)).filter(function (t) {
                        return !STOPWORDS.has(t) || KEEP.has(t);
                    }).length >= 1;
                });
                if (meaty.length > 1) { out = out.concat(meaty.map(function (s) { return s.trim(); })); return; }
            }
            out.push(p);
        });
        return out.slice(0, 4).map(restore);
    }

    /* =================================================================
     * 8. The matcher
     * ============================================================== */

    // How many of an intent's best-matching examples get averaged, and how hard
    // a negative example pushes back. Both are measured by eval/run.js — change
    // them there, not by feel.
    var TOP_K = 2;
    var NEGATIVE_PENALTY = 0.6;

    function Engine(config) {
        config = config || {};
        this.intents = [];
        this.concepts = config.concepts || {};       // surface form -> @concept
        // Tuned against eval/corpus.js, not by feel. Accuracy is flat from 0.30
        // to 0.50, but the wrong-answer rate falls across that range (6.6% ->
        // 5.0%) while misses only rise 5.8% -> 7.4%. For a bot quoting refund
        // policies, a shrug beats a confident mistake, so take the top of the
        // plateau. Above 0.52 accuracy drops off a cliff.
        this.thresholds = Object.assign(
            { answer: 0.50, hedge: 0.30, ambiguous: 0.07 },
            config.thresholds || {}
        );
        this.vocabulary = new Set();
        this.df = Object.create(null);               // document frequency per term
        this.docCount = 0;
        this._conceptIndex = null;
    }

    Engine.prototype.add = function (intent) {
        this.intents.push(Object.assign({ examples: [], keywords: [], patterns: [], weight: 1 }, intent));
        return this;
    };

    Engine.prototype.addAll = function (list) {
        list.forEach(this.add, this);
        return this;
    };

    // Expand a surface token into its canonical concept token, if any.
    Engine.prototype.conceptsFor = function (tokens) {
        if (!this._conceptIndex) {
            this._conceptIndex = Object.create(null);
            var self = this;
            Object.keys(this.concepts).forEach(function (concept) {
                self.concepts[concept].forEach(function (surface) {
                    self._conceptIndex[surface] = concept;
                    self._conceptIndex[stem(surface)] = concept;
                });
            });
        }
        var out = [], idx = this._conceptIndex;
        // multiword concepts first ("swimming pool", "air conditioning")
        for (var i = 0; i < tokens.length; i++) {
            for (var span = Math.min(3, tokens.length - i); span >= 1; span--) {
                var phrase = tokens.slice(i, i + span).join(' ');
                var hit = idx[phrase] || idx[stem(phrase)];
                if (hit) { out.push(hit); break; }
            }
        }
        return out;
    };

    Engine.prototype.bagOf = function (tokens) {
        var stems = tokens.map(stem);
        var bag = stems.filter(function (t) { return !STOPWORDS.has(t) || KEEP.has(t); });
        bag = bag.concat(this.conceptsFor(tokens));
        for (var i = 0; i < stems.length - 1; i++) bag.push(stems[i] + '_' + stems[i + 1]);   // bigrams
        return bag;
    };

    // Build TF-IDF statistics over every example utterance.
    Engine.prototype.train = function () {
        var self = this;
        this.docCount = 0;
        this.df = Object.create(null);
        this.vocabulary = new Set();

        this.intents.forEach(function (intent) {
            intent._vectors = [];
            intent._keywordStems = (intent.keywords || []).map(stem);
            (intent.examples || []).forEach(function (ex) {
                var toks = tokenise(normalise(ex));
                toks.forEach(function (t) { self.vocabulary.add(t); });
                var bag = self.bagOf(toks);
                intent._vectors.push(bag);
                self.docCount++;
                new Set(bag).forEach(function (term) {
                    self.df[term] = (self.df[term] || 0) + 1;
                });
            });
            (intent.keywords || []).forEach(function (k) {
                tokenise(normalise(k)).forEach(function (t) { self.vocabulary.add(t); });
            });
        });

        Object.keys(this.concepts).forEach(function (c) {
            self.concepts[c].forEach(function (surface) {
                tokenise(surface).forEach(function (t) { self.vocabulary.add(t); });
            });
        });

        // Pre-weight every stored vector so scoring is a plain dot product.
        // Negative examples are vectorised with the same IDF but deliberately
        // excluded from it — they describe what an intent is NOT, so letting
        // them shape term weights would poison the positive side.
        this.intents.forEach(function (intent) {
            intent._weighted = intent._vectors.map(function (bag) { return self.vectorise(bag); });
            intent._negWeighted = (intent.negativeExamples || []).map(function (ex) {
                return self.vectorise(self.bagOf(tokenise(normalise(ex))));
            });
        });
        return this;
    };

    Engine.prototype.idf = function (term) {
        var df = this.df[term] || 0;
        return Math.log(1 + this.docCount / (1 + df));
    };

    Engine.prototype.vectorise = function (bag) {
        var tf = Object.create(null), i;
        for (i = 0; i < bag.length; i++) tf[bag[i]] = (tf[bag[i]] || 0) + 1;

        var vec = Object.create(null), norm = 0;
        for (var term in tf) {
            var w = (1 + Math.log(tf[term])) * this.idf(term);
            if (term.indexOf('@') === 0) w *= 1.7;              // concepts are strong signal
            else if (term.indexOf('_') > 0) w *= 1.25;          // bigrams a little stronger
            vec[term] = w;
            norm += w * w;
        }
        norm = Math.sqrt(norm) || 1;
        for (var t2 in vec) vec[t2] /= norm;
        return vec;
    };

    function cosine(a, b) {
        var sum = 0;
        var small = Object.keys(a).length < Object.keys(b).length ? a : b;
        var large = small === a ? b : a;
        for (var k in small) if (large[k]) sum += small[k] * large[k];
        return sum;
    }

    // Correct a token against the trained vocabulary.
    Engine.prototype.correctToken = function (token) {
        if (this.vocabulary.has(token) || token.length < 4 || /\d/.test(token) || isRealWord(token)) return token;

        var max = tolerance(token.length), best = null, bestDist = max + 1;
        var key = phonetic(token);

        this.vocabulary.forEach(function (word) {
            if (Math.abs(word.length - token.length) > max) return;
            var d = editDistance(token, word, max);
            // People rarely fumble the first letter; anything past a single edit
            // that also changes it is a different word, not a typo.
            if (d > 1 && word[0] !== token[0]) return;
            if (d < bestDist) { bestDist = d; best = word; }
            else if (d === bestDist && best && word.length === token.length && best.length !== token.length) best = word;
        });

        if (best && bestDist <= max) return best;

        // last resort: same phonetic shape ("kichen" -> "kitchen")
        var phon = null;
        this.vocabulary.forEach(function (word) {
            if (!phon && word.length >= 4 && phonetic(word) === key) phon = word;
        });
        return phon || token;
    };

    Engine.prototype.correct = function (tokens) {
        var self = this, corrections = [];
        var fixed = tokens.map(function (t) {
            var c = self.correctToken(t);
            if (c !== t) corrections.push({ from: t, to: c });
            return c;
        });
        return { tokens: fixed, corrections: corrections };
    };

    /**
     * Score one utterance against every intent.
     * @returns {{intent, confidence, alternatives, analysis, corrections}}
     */
    Engine.prototype.match = function (text, context, now) {
        context = context || {};
        var analysis = analyse(text, now);
        var fixed = this.correct(analysis.tokens);
        analysis.corrections = fixed.corrections;
        analysis.correctedTokens = fixed.tokens;

        var tokens = fixed.tokens.slice();

        // Pronoun / ellipsis resolution: "is it heated?" right after the pool topic.
        //
        // Three guards, all learned the hard way. Borrow only when the guest is
        // (a) actually asking something — "that's a shame" must not inherit the
        // last topic, (b) not naming a concept of their own, since "can we bring
        // our labrador" is a new subject, and (c) short enough to be elliptical.
        var borrowed = false;
        if (context.topicTokens && context.topicTokens.length) {
            var ownConcepts = this.conceptsFor(tokens);
            var contentCount = tokens.filter(function (t) { return !STOPWORDS.has(t) || KEEP.has(t); }).length;
            if (analysis.isQuestion && !ownConcepts.length && (analysis.hasPronoun || contentCount <= 2)) {
                tokens = tokens.concat(context.topicTokens);
                borrowed = true;
            }
        }

        var bag = this.bagOf(tokens);
        var vec = this.vectorise(bag);
        var stemSet = new Set(tokens.map(stem));
        var conceptSet = new Set(this.conceptsFor(tokens));
        var norm = analysis.normalised;

        var results = this.intents.map(function (intent) {
            // (a) similarity to the intent's shape, as the mean of its top-k
            //     examples. A single max let one lucky example carry an intent,
            //     which is what blurred pool/beach and checkin/checkout.
            var sims = [];
            for (var i = 0; i < intent._weighted.length; i++) {
                sims.push(cosine(vec, intent._weighted[i]));
            }
            sims.sort(function (x, y) { return y - x; });
            var k = Math.min(TOP_K, sims.length);
            var cos = 0;
            for (var s = 0; s < k; s++) cos += sims[s];
            cos = k ? cos / k : 0;

            // (b) keyword coverage
            var kw = 0;
            if (intent._keywordStems.length) {
                var hits = intent._keywordStems.filter(function (k) { return stemSet.has(k); }).length;
                kw = hits / Math.min(intent._keywordStems.length, 3);
                if (kw > 1) kw = 1;
            }

            // (c) required concepts
            var conceptHit = 0;
            if (intent.concepts && intent.concepts.length) {
                var ch = intent.concepts.filter(function (c) { return conceptSet.has(c); }).length;
                conceptHit = ch / intent.concepts.length;
            }

            // (d) explicit patterns — the strongest evidence we have
            var pattern = 0;
            for (var p = 0; p < intent.patterns.length; p++) {
                if (intent.patterns[p].test(norm)) { pattern = 1; break; }
            }

            var score = 0.46 * cos + 0.24 * kw + 0.30 * conceptHit;

            // Naming every concept an intent asks for is strong evidence on its
            // own — "can we bring our labrador" needs no other overlap to mean
            // pets. This used to be a flat floor of 0.62, which made every
            // concept hit score *identically* and left ties to be broken by
            // array order. Keeping the cosine term in the floor preserves
            // ordering between two intents that both matched a concept.
            if (conceptHit === 1 && intent.concepts && intent.concepts.length) {
                score = Math.max(score, 0.48 + 0.34 * cos + 0.10 * kw);
            }
            if (pattern) score = Math.max(score, 0.88);

            // (e) hard negatives: phrasings that look like this intent but aren't
            var negSim = 0;
            for (var nx = 0; nx < intent._negWeighted.length; nx++) {
                var nc = cosine(vec, intent._negWeighted[nx]);
                if (nc > negSim) negSim = nc;
            }
            if (negSim > 0) score *= (1 - NEGATIVE_PENALTY * negSim);
            if (intent.questionTypes && analysis.questionType &&
                intent.questionTypes.indexOf(analysis.questionType) >= 0) score += 0.06;
            if (intent.requiresQuestion && !analysis.isQuestion) score *= 0.75;

            score *= intent.weight;
            return { intent: intent, confidence: Math.min(score, 1), cos: cos, kw: kw, pattern: !!pattern };
        });

        results.sort(function (a, b) { return b.confidence - a.confidence; });

        var top = results[0] || { confidence: 0, intent: null };
        var second = results[1] || { confidence: 0, intent: null };

        return {
            intent: top.intent,
            confidence: top.confidence,
            ambiguousWith: (top.confidence >= this.thresholds.hedge &&
                top.confidence - second.confidence < this.thresholds.ambiguous &&
                second.intent) ? second.intent : null,
            alternatives: results.slice(0, 3).filter(function (r) { return r.confidence > 0.12; }),
            analysis: analysis,
            usedContext: borrowed,
            corrections: fixed.corrections,
            status: top.confidence >= this.thresholds.answer ? 'confident'
                : top.confidence >= this.thresholds.hedge ? 'unsure' : 'unknown'
        };
    };

    return {
        Engine: Engine,
        analyse: analyse,
        normalise: normalise,
        tokenise: tokenise,
        stem: stem,
        segment: segment,
        phonetic: phonetic,
        editDistance: editDistance,
        extractEntities: extractEntities,
        extractDates: extractDates,
        extractRange: extractRange,
        STOPWORDS: STOPWORDS
    };
}));
