/* =====================================================================
 * knowledge.js — what the bot knows and how it says it.
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │  ⚠  EVERY VALUE IN `FACTS` BELOW IS A PLACEHOLDER.                │
 * │     Replace them with the villa's real rates, times and policies  │
 * │     before this goes anywhere near a guest. Nothing else in the   │
 * │     codebase hardcodes these — edit here only.                    │
 * └───────────────────────────────────────────────────────────────────┘
 * ===================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KNOWLEDGE = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ================= PLACEHOLDER FACTS — EDIT ME ================= */
    var FACTS = {
        /* ┌─────────────────────────────────────────────────────────────┐
           │  Values marked VERIFIED come from ikshaa.com, the Airbnb     │
           │  listing, or a distributor page, and match what the rest of  │
           │  the site says. Values marked UNKNOWN are still placeholders │
           │  — the bot is written to hand those to a human rather than   │
           │  guess, so do not invent numbers here.                       │
           └─────────────────────────────────────────────────────────────┘ */

        // ---- VERIFIED ----
        name: 'Ikshaa Luxury Villa',
        area: 'Loutolim, South Goa',
        bedrooms: 3,
        bathrooms: 3,
        sleeps: 6,
        extraBed: false,

        // The villa is never shared. This is the single most important
        // policy on the page and the one guests ask about most.
        exclusive: 'The villa is let on an exclusive basis — the whole house is yours even if you book one room',
        deposit: '50% to confirm the booking, non-refundable',

        pool: 'private, for the use of your party alone',
        wifi: 'complimentary WiFi throughout',
        ac: 'air-conditioned bedrooms and living room',
        kitchen: 'large and fully equipped',
        cook: 'a cook can be arranged — ask when booking',
        breakfast: 'complimentary English breakfast every morning, plus unlimited tea, coffee and juices all day',
        dinner: 'provided on request; there is also a barbeque in the gazebo',
        laundry: 'personal laundry included',
        tv: 'satellite TV and DVD, and iPod docking',
        newspaper: 'a daily newspaper',
        wellness: 'massage services and yoga can be arranged at the house',
        medical: 'medical service on call',
        childcare: 'baby sitting, with prior intimation',
        shower: "Goa's biggest rainshower heads",

        airport: 'Goa International (GOI, Dabolim)',
        airportDistance: 'a 20 minute drive',
        airportTransfer: 'complimentary — tell us your flight and we will arrange the car',
        railway: 'Margao station is a 10 minute drive',
        beachName: 'the virgin beaches of South Goa',
        beachDistance: 'a 15 minute drive',

        email: 'nyaragoa@gmail.com',
        bookingUrl: 'https://www.airbnb.co.in/rooms/17852391',

        // ---- UNKNOWN — the bot must not state these ----
        // Set them and the answers turn on automatically; leave them null
        // and every reply that would need one defers to a human instead.
        rateWeekday: null,
        rateWeekend: null,
        ratePeak: null,
        minNights: null,
        securityDeposit: null,
        checkIn: null,
        checkOut: null,
        earlyCheckIn: null,
        cancellation: null,
        housekeeping: null,
        parking: null,
        payments: null,
        power: null,
        staff: null,
        pets: null,
        smoking: null,
        parties: null,
        children: null,
        accessible: null,
        poolHeated: null,
        bestTime: 'November to February is dry and warm. June to September is the monsoon — green, dramatic, and the house at its most private',

        // ikshaa.com publishes no telephone number. Until one exists the
        // bot points at email, which is real.
        phone: null
    };
    /* =============== END PLACEHOLDER FACTS — EDIT ME =============== */

    /* Concepts map many surface words onto one canonical token. This is
     * what lets "wi-fi", "internet", "broadband" and "network" all hit the
     * same intent without listing every phrasing as an example. */

    /* ---------------------------------------------------------------
     * Guards.
     *
     * Every FACTS value above may legitimately be null — the unknown
     * ones are null ON PURPOSE, so nobody is tempted to invent a rate
     * or a check-in time. These make a missing value degrade to
     * something true rather than printing "null" at a guest.
     * ------------------------------------------------------------ */

    // Whatever contact route actually exists. Phone first if we ever get
    // one; email is real today.
    function contact() {
        return FACTS.phone ? FACTS.phone + ' or ' + FACTS.email : FACTS.email;
    }

    // For facts that may be missing: say the value, or say we will find out.
    function fact(value, fallback) {
        return value ? value : (fallback || 'something the owner can confirm — ' + contact());
    }

    var CONCEPTS = {
        '@price': ['price', 'cost', 'rate', 'rates', 'charge', 'charges', 'fee', 'fees', 'tariff',
            'pricing', 'expensive', 'cheap', 'affordable', 'budget', 'quote', 'how much',
            'per night', 'nightly rate', 'money', 'set me back', 'set us back', 'worth'],
        // NB: concepts must be *topics*, never generic predicates. "available",
        // "do" and "see" all used to live here and hijacked unrelated questions
        // ("kitchen available?" became a booking enquiry). Keep them out.
        '@book': ['book', 'booking', 'reserve', 'reservation', 'vacancy',
            'free dates', 'rent', 'hire', 'confirm', 'opening', 'openings', 'slot', 'take bookings'],
        '@pool': ['pool', 'swimming pool', 'swim', 'swimming', 'plunge pool'],
        '@wifi': ['wifi', 'wi-fi', 'internet', 'broadband', 'network', 'connectivity', 'online', 'net', 'connection', 'signal'],
        '@ac': ['ac', 'a/c', 'air conditioning', 'air conditioner', 'aircon', 'cooling', 'fan'],
        '@bedroom': ['bedroom', 'bed', 'beds', 'room', 'rooms', 'sleep', 'sleeps', 'accommodate',
            'capacity', 'occupancy', 'bhk', 'bathrooms', 'washrooms'],
        '@bathroom': ['bathroom', 'toilet', 'washroom', 'shower', 'restroom', 'bath'],
        '@kitchen': ['kitchen', 'cook', 'cooking', 'stove', 'fridge', 'microwave', 'utensils', 'cookware', 'self cater', 'cater', 'cooker', 'pots', 'pans', 'hob'],
        '@food': ['food', 'meal', 'meals', 'breakfast', 'lunch', 'dinner', 'eat', 'chef', 'restaurant',
            'catering', 'grocery', 'groceries'],
        '@location': ['location', 'where', 'address', 'located', 'situated', 'directions', 'map', 'reach',
            'area', 'place', 'whereabouts', 'village', 'exact spot', 'goa', 'which part'],
        '@beach': ['beach', 'sea', 'ocean', 'shore', 'coast', 'sand'],
        '@airport': ['airport', 'flight', 'flights', 'dabolim', 'goi', 'terminal', 'landing'],
        // "drop" alone used to live here and made "can we drop bags early" a
        // transport question rather than a check-in one.
        '@transfer': ['transfer', 'pickup', 'pick up', 'drop off', 'taxi', 'cab', 'transport',
            'transportation', 'shuttle', 'collect us', 'hire', 'rental', 'chauffeur'],
        '@parking': ['parking', 'park', 'garage', 'car', 'vehicle', 'bike', 'scooter'],
        '@checkin': ['check in', 'checkin', 'check-in', 'arrival', 'arrive', 'arriving', 'keys', 'earliest', 'drop bags', 'luggage'],
        '@checkout': ['check out', 'checkout', 'check-out', 'departure', 'depart', 'leaving', 'leave', 'vacate', 'last day'],
        '@pets': ['pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'puppy', 'animal', 'animals',
            'labrador', 'retriever', 'husky', 'beagle', 'pug', 'poodle', 'terrier', 'shepherd',
            'kitten', 'doggo', 'furry friend'],
        '@smoking': ['smoke', 'smoking', 'cigarette', 'cigarettes', 'vape', 'vaping', 'hookah'],
        '@party': ['party', 'parties', 'event', 'events', 'celebration', 'wedding', 'function',
            'gathering', 'music', 'dj', 'loud'],
        '@children': ['child', 'children', 'kid', 'kids', 'baby', 'babies', 'infant', 'toddler', 'family'],
        '@cancel': ['cancel', 'cancellation', 'refund', 'refunds', 'reschedule', 'postpone', 'change dates', 'pull out', 'money back', 'back out', 'move my dates', 'change my dates'],
        '@pay': ['pay', 'payment', 'upi', 'card', 'cards', 'cash', 'transfer money', 'deposit', 'advance', 'gpay', 'paytm', 'bank transfer', 'upfront', 'in advance', 'settle', 'netbanking'],
        '@clean': ['clean', 'cleaning', 'housekeeping', 'maid', 'tidy', 'linen', 'towels', 'laundry', 'washing', 'sheets', 'bed sheets', 'bedding'],
        '@safety': ['safe', 'safety', 'secure', 'security', 'cctv', 'guard', 'lock', 'emergency', 'caretaker', 'on site'],
        '@weather': ['weather', 'climate', 'rain', 'rains', 'monsoon', 'temperature', 'hot', 'humid', 'season', 'time of year', 'humid', 'best time'],
        '@activity': ['activities', 'attractions', 'sightseeing', 'nearby', 'visit', 'explore',
            // "market" alone answered "is the stock market open today" — anchor
            // on the Goa-specific sense instead.
            'nightlife', 'night market', 'flea market', 'watersports', 'tour', 'worth seeing',
            'night scene', 'things to see'],
        // "person" was here and swallowed "6 people" — too generic to anchor on.
        '@contact': ['contact', 'call', 'phone', 'whatsapp', 'email', 'reach you', 'human',
            'real person', 'someone', 'manager', 'owner', 'speak', 'talk'],
        '@photos': ['photo', 'photos', 'picture', 'pictures', 'image', 'images', 'gallery'],
        '@tv': ['tv', 'television', 'netflix', 'streaming', 'entertainment', 'telly'],
        '@power': ['power', 'electricity', 'generator', 'inverter', 'backup', 'outage', 'load shedding', 'lights', 'power cut', 'cuts'],
        '@accessible': ['wheelchair', 'accessible', 'accessibility', 'disabled', 'mobility', 'ramp', 'elderly', 'steps', 'stairs', 'climb', 'step free']
    };

    var yn = function (bool, yes, no) { return bool ? yes : no; };

    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // "2026-12-20" -> "20 Dec 2026"
    function pretty(isoDate) {
        if (!isoDate) return '';
        var p = String(isoDate).split('-');
        return Number(p[2]) + ' ' + MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0];
    }

    /* The booking flow's copy. bot.js owns the state machine; everything the
     * guest actually reads lives here, so retargeting to another property is
     * still a single-file change. */
    var BOOKING = {
        slots: ['arrival', 'nights', 'guests'],

        ask: {
            arrival: function (ctx) {
                return ctx.booking.month
                    ? ['Happy to note that down — which date in ' + ctx.booking.month + ' would you arrive?']
                    : ['Happy to note that down. Which date would you arrive? "12 Dec" or "20 to 24 December" both work.'];
            },
            nights: function (ctx) {
                return ['Arriving ' + pretty(ctx.booking.arrival) + '. How many nights?'];
            },
            guests: function (ctx) {
                // Echo what we captured so a misread date gets corrected here,
                // not after the guest has sent it all to WhatsApp.
                var b = ctx.booking;
                return ['Got it — ' + pretty(b.arrival) +
                    (b.departure ? ' to ' + pretty(b.departure) : '') +
                    ', ' + b.nights + ' night' + (b.nights === 1 ? '' : 's') +
                    '. How many guests altogether?'];
            }
        },

        chips: {
            arrival: ['Next weekend', '20 to 24 December'],
            nights: ['2 nights', '3 nights', 'A week'],
            guests: ['2 guests', '4 guests', '6 guests']
        },

        summary: function (ctx) {
            var b = ctx.booking, F = ctx.facts, out = [];

            out.push('Here is what I have: ' + pretty(b.arrival) +
                (b.departure ? ' to ' + pretty(b.departure) : '') +
                ', ' + b.nights + ' night' + (b.nights === 1 ? '' : 's') +
                ', ' + b.guests + ' guest' + (b.guests === 1 ? '' : 's') + '.');

            if (b.guests > F.sleeps) {
                out.push('That is above the ' + F.sleeps + '-guest limit, so the owner would need to approve it.');
            }
            // Only raised when a minimum is actually known. `null < n` is
            // false, so an unset minimum silently never fired — which read
            // as "any length is fine", a claim nobody had made.
            if (F.minNights && b.nights < F.minNights) {
                out.push('Minimum stay is ' + F.minNights + ' nights, so that one may need stretching.');
            } else if (!F.minNights) {
                out.push('I do not know the minimum stay, so worth confirming.');
            }

            out.push('I cannot hold dates myself — send exactly that to ' + contact() +
                ' and they will confirm availability.');
            return out.join(' ');
        },

        confirmChips: ['What will that cost?', 'Cancellation policy?', 'Talk to a human']
    };

    /* Each intent: examples train the vector matcher, concepts/keywords add
     * targeted evidence, patterns are high-confidence shortcuts. */
    var INTENTS = [
        {
            id: 'greeting',
            examples: ['hi', 'hello', 'hey there', 'good morning', 'good evening', 'good afternoon',
                'hi there', 'hello anyone there', 'yo', 'greetings', 'namaste', 'hey'],
            patterns: [
                /^\s*(hi+|hey+|hiya|heya|hello+|yo+|namaste|hola|good (morning|evening|afternoon|day))\b/,
                // bare "morning" / "evening" — anchored so "evening rates?" is unaffected
                /^\s*(morning|evening|afternoon)\s*[!.]*$/
            ],
            weight: 1.05,
            answer: function () {
                return ['Hello! I look after questions about ' + FACTS.name + '. Ask me anything — rates, the pool, how far the beach is, whatever you need.',
                    'Hi there! Happy to help with anything about ' + FACTS.name + '. What would you like to know?'];
            },
            chips: ['What are the rates?', 'Is it available in December?', 'How far is the beach?']
        },
        {
            id: 'goodbye',
            examples: ['bye', 'goodbye', 'see you', 'talk later', 'that is all thanks', 'gtg', 'i am done',
                'see ya', 'catch you later', 'nothing else'],
            patterns: [/^\s*(bye+|goodbye|see (you|ya)|gtg|good night|cheerio|ciao|later)\b/,
                /\b(i am off|off now|catch you later|that is (it|all|everything))\b/],
            answer: function () {
                return ['Bye! Come back any time — and do reach out on ' + contact() + ' if you would rather talk to a person.',
                    'Take care! ' + FACTS.name + ' will be here when you are ready.'];
            }
        },
        {
            id: 'thanks',
            examples: ['thanks', 'thank you', 'thanks a lot', 'much appreciated', 'cheers', 'that helps',
                'perfect thanks', 'great thank you', 'appreciate it'],
            patterns: [/\b(thank(s| you)|much appreciated|appreciated|appreciate it|cheers)\b/],
            answer: function () {
                return ['Any time! Anything else you want to check?', 'Glad that helped. What else can I dig up?'];
            }
        },
        {
            id: 'bot_identity',
            examples: ['who are you', 'what are you', 'are you a bot', 'are you human', 'are you real',
                'what is your name', 'are you an ai', 'am i talking to a robot'],
            patterns: [/\b(are you (an? )?(bot|robot|human|real|ai|person|machine|software))\b/,
                /\bwhat('s| is) your name\b/,
                /\b(chatting|talking|speaking) (to|with) (a )?(bot|robot|machine|computer|human|person)\b/],
            answer: function () {
                return 'I am a small script, not a person and not an AI — just pattern matching over what I have been told about ' +
                    FACTS.name + '. I am good with the practical questions; for anything unusual, ' + contact() + ' reaches a human.';
            }
        },
        {
            id: 'capabilities',
            examples: ['what can you do', 'help', 'what can i ask', 'how does this work', 'what do you know',
                'give me options', 'menu'],
            patterns: [/^\s*(help|menu|options)\s*[?!.]*$/,
                /\bwhat (can|sort of things can|kind of things can) (you do|i ask)/,
                /\bhow (do i|does this) (use|work)/,
                /\bshow me (the )?(options|choices)\b/],
            answer: function () {
                return 'I can cover rates and availability, the rooms and pool, check-in times, the kitchen, house rules ' +
                    '(pets, smoking, parties), getting here from the airport, the beach, and how to pay or cancel. Just ask in your own words.';
            },
            chips: ['Rates', 'House rules', 'Getting here', 'Book it']
        },
        {
            id: 'price',
            negativeExamples: ['which payment methods do you take', 'how do i send the money', 'is a deposit needed'],
            concepts: ['@price'],
            keywords: ['price', 'cost', 'rate', 'charge', 'expensive', 'budget'],
            questionTypes: ['how_much', 'what'],
            examples: ['how much does it cost', 'what are your rates', 'price per night', 'how much per night',
                'what is the tariff', 'is it expensive', 'cost for 3 nights', 'what does a weekend cost',
                'rates for december', 'how much for the whole villa', 'give me a quote', 'nightly price',
                'what is the charge', 'how much money for two nights', 'daily rent'],
            patterns: [/\bhow much\b.*\b(night|stay|cost|villa|it)\b/, /\bwhat.*(price|rate|tariff|cost)\b/],
            answer: function (ctx) {
                var e = ctx.entities || {};

                /* Rates are the one thing a guest must never be guessed at,
                   and they are unset. One clean deferral — the earlier
                   version stitched the fallback in three times and produced
                   a sentence that said nothing, at length. */
                if (!FACTS.rateWeekday && !FACTS.rateWeekend && !FACTS.ratePeak) {
                    var ask = 'I do not have the nightly rates — they move with the season, so I would only mislead you. ' +
                        'The live prices are on the listing: ' + FACTS.bookingUrl + ', or ask ' + contact() + '.';
                    if (e.nights || e.checkIn) {
                        ask += ' Tell them your exact dates and they will quote you properly.';
                    }
                    return ask;
                }

                var lines = ['Weekdays are ' + fact(FACTS.rateWeekday) + ' and weekends ' + fact(FACTS.rateWeekend) +
                    ' for the whole villa. Peak season is ' + fact(FACTS.ratePeak) + '.'];
                if (e.nights) {
                    lines.push('For ' + e.nights + ' night' + (e.nights > 1 ? 's' : '') +
                        ' I would need your exact dates to say whether weekend pricing applies — want me to note them down?');
                } else if (FACTS.minNights) {
                    lines.push('Minimum stay is ' + FACTS.minNights + ' nights. Tell me your dates and I will be specific.');
                }
                return lines.join(' ');
            },
            chips: ['What about December?', 'How do I pay?', 'Is a deposit needed?']
        },
        {
            id: 'availability',
            negativeExamples: ['how many bedrooms are there', 'how many people does it fit', 'number of bathrooms'],
            concepts: ['@book'],
            keywords: ['available', 'book', 'reserve', 'vacancy', 'free'],
            examples: ['is it available', 'do you have availability', 'can i book for next weekend',
                'i want to book', 'is the villa free in december', 'any vacancy', 'can we reserve it',
                'i would like to make a reservation', 'is it open on the 20th', 'book it for me',
                'are you free next friday', 'want to stay for 3 nights'],
            patterns: [/\b(is|are) (it|the villa|you) (available|free|open|booked)\b/, /\bi (want|would like|wanna|need) to (book|reserve|stay)\b/],
            answer: function (ctx) {
                var e = ctx.entities || {};
                var bits = [];
                if (e.dates && e.dates.length) bits.push('from ' + e.dates[0]);
                else if (e.month) bits.push('sometime in ' + e.month);
                if (e.nights) bits.push('for ' + e.nights + ' night' + (e.nights > 1 ? 's' : ''));
                if (e.guests) bits.push('for ' + e.guests + ' guest' + (e.guests > 1 ? 's' : ''));

                if (bits.length) {
                    return 'Noted — ' + bits.join(', ') + '. I cannot see the live calendar from here, so the fastest confirmation is ' +
                        contact() + '. Quote those dates and they will hold it for you.';
                }
                return 'Quite possibly — the calendar moves fast though, and I cannot read it from here. Give me your dates ' +
                    '(something like "12 Dec for 3 nights, 4 of us") and I will pass them on, or message ' + contact() + ' directly.';
            },
            chips: ['12 Dec for 3 nights', 'What are the rates?', 'Cancellation policy?']
        },
        {
            id: 'capacity',
            negativeExamples: ['is the villa free in december', 'can i book those dates', 'any vacancy'],
            concepts: ['@bedroom'],
            keywords: ['bedroom', 'sleep', 'capacity', 'people', 'accommodate'],
            questionTypes: ['how_many'],
            examples: ['how many bedrooms', 'how many people can stay', 'does it sleep 6', 'how many can it accommodate',
                'is there room for 8', 'how many beds', 'we are 5 people will it fit', 'number of rooms',
                'can 7 of us stay', 'is it a 2 bhk', 'how many bathrooms', 'will 8 of us fit',
                'is it big enough for 10 of us'],
            patterns: [/\bhow many (bedroom|room|bed|people|guest|bathroom)/, /\b(sleep|accommodate|fit)s? (\d+|us)\b/,
                /\b(can|will|would|does it|is it big enough for)\b[^?]{0,20}\b\d{1,2} of us\b/],
            answer: function (ctx) {
                var e = ctx.entities || {};
                var base = FACTS.bedrooms + ' bedrooms and ' + FACTS.bathrooms + ' bathrooms, sleeping ' +
                    FACTS.sleeps + ' comfortably' + (FACTS.extraBed ? ', with an extra bed available on request' : '') + '.';
                if (e.guests) {
                    base += e.guests <= FACTS.sleeps
                        ? ' ' + e.guests + ' is well within that.'
                        : ' ' + e.guests + ' is over the ' + FACTS.sleeps + '-guest limit, so that would need checking with the owner first.';
                }
                return base;
            }
        },
        {
            id: 'pool',
            negativeExamples: ['how far is the sea', 'which beach is nearest', 'can we walk to the shore'],
            concepts: ['@pool'],
            keywords: ['pool', 'swim', 'heated', 'deep'],
            examples: ['is there a pool', 'do you have a swimming pool', 'is the pool private', 'is it heated',
                'how deep is the pool', 'can we swim at night', 'is the pool shared', 'pool size',
                'is the pool cleaned'],
            patterns: [/\b(swimming )?pool\b/],
            answer: function (ctx) {
                // null is unknown, not "unheated"
                var heat = FACTS.poolHeated
                    ? (ctx.negated ? 'Actually it is heated.' : 'It is heated.')
                    : (ctx.negated ? 'Correct — it is not heated, though Goa rarely makes you want that.'
                        : 'It is not heated, though Goa rarely makes you want that.');
                return 'Yes — a ' + FACTS.pool + '. ' + heat + ' It is yours alone, not shared.';
            },
            chips: ['Is it safe for kids?', 'How far is the beach?']
        },
        {
            id: 'wifi',
            concepts: ['@wifi'],
            keywords: ['wifi', 'internet', 'broadband', 'network'],
            examples: ['is there wifi', 'do you have internet', 'how fast is the wifi', 'is the internet good',
                'can i work from there', 'is wifi free', 'broadband speed', 'will i get network'],
            patterns: [/\b(wi-?fi|internet|broadband)\b/],
            answer: function (ctx) {
                // "so there is no wifi right?" must not be answered with "Yes —".
                return (ctx.negated ? 'There is, actually — ' : 'Yes — ') + FACTS.wifi +
                    ', included at no extra cost. It holds up fine for video calls, so remote work is realistic.';
            }
        },
        {
            id: 'ac',
            concepts: ['@ac'],
            keywords: ['ac', 'air', 'conditioning', 'cooling'],
            examples: ['is there ac', 'do the rooms have air conditioning', 'is it air conditioned',
                'any fans', 'does the living room have ac'],
            patterns: [/\b(a\/?c|air ?con|air conditioning|air conditioner)\b/],
            answer: function () { return 'Air conditioning ' + FACTS.ac + '.'; }
        },
        {
            id: 'kitchen',
            negativeExamples: ['can you provide a chef', 'is breakfast served', 'where can we eat out'],
            concepts: ['@kitchen'],
            keywords: ['kitchen', 'cook', 'stove', 'fridge'],
            examples: ['is there a kitchen', 'can we cook', 'does the kitchen have a fridge',
                'are utensils provided', 'is there a stove', 'can i make my own food'],
            patterns: [/\bkitchen\b/, /\bcan (we|i) cook\b/],
            answer: function () {
                return 'There is a kitchen — ' + FACTS.kitchen + '. ' + 'And ' + FACTS.cook + '.';
            }
        },
        {
            id: 'food',
            negativeExamples: ['is there a fridge', 'are utensils provided', 'is there a gas stove'],
            concepts: ['@food'],
            keywords: ['food', 'breakfast', 'meal', 'restaurant', 'chef'],
            examples: ['is breakfast included', 'do you serve food', 'are there restaurants nearby',
                'can you arrange a cook', 'where do we eat', 'is there a chef', 'food options',
                'can we order in'],
            patterns: [/\bbreakfast\b/, /\b(serve|provide|include).*(food|meal)/],
            answer: function () {
                return 'Breakfast is ' + FACTS.breakfast + '. ' + FACTS.cook.charAt(0).toUpperCase() + FACTS.cook.slice(1) +
                    '. There are also plenty of shacks and restaurants around ' + FACTS.beachName + ', and delivery apps cover the area.';
            }
        },
        {
            id: 'location',
            negativeExamples: ['is the area safe at night', 'how far is the beach', 'is there security'],
            concepts: ['@location'],
            keywords: ['location', 'where', 'address', 'located', 'directions'],
            questionTypes: ['where'],
            examples: ['where is the villa', 'what is the address', 'where exactly is it located',
                'which part of goa', 'is it north or south goa', 'how do i get there', 'send me the location',
                'is it far from the city'],
            patterns: [/\bwhere (is|are) (it|the villa|you|this)\b/, /\b(exact )?(address|location)\b/],
            answer: function () {
                return FACTS.name + ' is in ' + FACTS.area + '. ' + FACTS.beachName + ' is ' + FACTS.beachDistance +
                    ', and ' + FACTS.railway + '. The exact pin is shared once a booking is confirmed.';
            },
            chips: ['How far is the airport?', 'How far is the beach?']
        },
        {
            id: 'beach',
            negativeExamples: ['is the pool private', 'how deep is the pool', 'is the pool cleaned'],
            concepts: ['@beach'],
            keywords: ['beach', 'sea', 'ocean', 'shore'],
            questionTypes: ['how_far'],
            examples: ['how far is the beach', 'is it near the sea', 'can we walk to the beach',
                'is it beachfront', 'distance to the beach', 'which beach is closest'],
            patterns: [/\bbeach\b/, /\bhow far.*(sea|ocean)\b/],
            answer: function () {
                return FACTS.beachName + ' is ' + FACTS.beachDistance + '. Not beachfront, but easily walkable.';
            }
        },
        {
            id: 'airport',
            concepts: ['@airport'],
            keywords: ['airport', 'flight', 'dabolim'],
            questionTypes: ['how_far'],
            examples: ['how far is the airport', 'distance from airport', 'which airport should i fly into',
                'how long from dabolim', 'do you pick up from the airport', 'is mopa or dabolim closer'],
            patterns: [/\bairport\b/],
            answer: function () {
                return 'The nearest airport is ' + FACTS.airport + ' — ' + FACTS.airportDistance +
                    '. A transfer ' + FACTS.airportTransfer + '.';
            }
        },
        {
            id: 'transfer',
            concepts: ['@transfer'],
            keywords: ['transfer', 'pickup', 'taxi', 'cab', 'transport'],
            examples: ['can you arrange a pickup', 'do you provide transport', 'is a taxi available',
                'can i rent a scooter', 'how do we get around', 'do you have a driver'],
            patterns: [/\b(pick ?up|drop off|taxi|cab|driver|chauffeur)\b/],
            negativeExamples: ['what time can we arrive', 'can we leave luggage before check in',
                'where do i park the car'],
            answer: function () {
                return 'Airport transfers ' + FACTS.airportTransfer + '. Scooters and cars are easy to rent locally and the caretaker can set that up — ' +
                    'having your own wheels makes a big difference in Goa.';
            }
        },
        {
            id: 'parking',
            concepts: ['@parking'],
            keywords: ['parking', 'car', 'vehicle', 'scooter'],
            examples: ['is there parking', 'where do i park', 'can i park two cars', 'is parking free',
                'somewhere to keep the scooter'],
            patterns: [/\bpark(ing)?\b/],
            answer: function () { return 'Yes — ' + fact(FACTS.parking) + '. Scooters park inside too.'; }
        },
        {
            id: 'checkin',
            negativeExamples: ['when do we have to leave', 'can we stay later on the final day'],
            concepts: ['@checkin'],
            keywords: ['checkin', 'arrival', 'arrive', 'early'],
            questionTypes: ['when', 'what'],
            examples: ['what time is check in', 'when can we arrive', 'can we check in early',
                'is late arrival ok', 'what time can i get in'],
            patterns: [/\bcheck ?-?in\b/, /\bwhat time.*(arrive|arrival)\b/],
            answer: function () {
                return 'Check-in is ' + fact(FACTS.checkIn, 'flexible — ' + contact()) + ', check-out ' + fact(FACTS.checkOut, 'flexible') +
                    '. Late arrivals are fine; ' + fact(FACTS.earlyCheckIn, 'early check-in depends on the day before') + '.';
            }
        },
        {
            id: 'checkout',
            negativeExamples: ['what time can we arrive', 'is early arrival possible', 'can we get in sooner'],
            concepts: ['@checkout'],
            keywords: ['checkout', 'departure', 'leave', 'late'],
            examples: ['what time is check out', 'when do we have to leave', 'can we check out late',
                'is late checkout possible'],
            patterns: [/\bcheck ?-?out\b/],
            answer: function () {
                return 'Check-out is ' + fact(FACTS.checkOut, 'flexible') + '. Late check-out is usually possible if nobody arrives the same day — worth asking the caretaker the night before.';
            }
        },
        {
            id: 'pets',
            concepts: ['@pets'],
            keywords: ['pet', 'dog', 'cat', 'animal'],
            examples: ['are pets allowed', 'can i bring my dog', 'is it pet friendly', 'no pets right',
                'do you allow animals', 'travelling with a cat'],
            patterns: [/\b(pet|dog|cat|puppy)s?\b/],
            // ctx.negated is true for "no pets, right?" — a confirmation, not a
            // fresh question, so the reply agrees rather than announcing.
            answer: function (ctx) {
                if (FACTS.pets === null) {
                    return 'I do not want to guess at the pet policy — ' + contact() + ' will tell you straight away.';
                }
                if (FACTS.pets) {
                    return ctx.negated
                        ? 'Actually they are — pets are welcome, just mention yours when booking.'
                        : 'Pets are welcome — just mention yours when booking.';
                }
                return (ctx.negated ? 'That is right, no pets at the villa.' : 'Sorry, no pets at the villa.') +
                    ' If that is a dealbreaker, the owner sometimes knows pet-friendly places nearby — worth asking on ' +
                    contact() + '.';
            }
        },
        {
            id: 'smoking',
            concepts: ['@smoking'],
            keywords: ['smoke', 'smoking', 'cigarette', 'vape'],
            examples: ['can i smoke', 'is smoking allowed', 'is it a non smoking villa', 'can we vape inside',
                'somewhere to smoke'],
            patterns: [/\bsmok(e|ing)\b/, /\bvap(e|ing)\b/],
            answer: function (ctx) {
                return (ctx.negated ? 'That is right — smoking is ' : 'Smoking is ') + fact(FACTS.smoking) + '.';
            }
        },
        {
            id: 'parties',
            concepts: ['@party'],
            keywords: ['party', 'event', 'celebration', 'music'],
            examples: ['can we throw a party', 'are events allowed', 'can we play loud music',
                'is it ok for a birthday celebration', 'can we host a wedding', 'bachelor party'],
            patterns: [/\b(part(y|ies)|event|celebration|wedding|dj)\b/],
            answer: function (ctx) {
                return (ctx.negated ? 'Correct — ' : 'House policy: ') + fact(FACTS.parties) +
                    '. A quiet family celebration is fine — a full event is not. ' +
                    'If you are unsure which yours is, check with the owner first on ' + contact() + '.';
            }
        },
        {
            id: 'children',
            negativeExamples: ['is the villa big enough', 'how many can it sleep'],
            concepts: ['@children'],
            keywords: ['child', 'kid', 'baby', 'family'],
            examples: ['is it kid friendly', 'can we bring children', 'is it safe for a toddler',
                'do you have a cot', 'travelling with a baby', 'is it good for families'],
            patterns: [/\b(kid|child|children|baby|toddler|infant)s?\b/],
            answer: function () {
                return 'Children are ' + fact(FACTS.children) + ' A cot can usually be arranged with a bit of notice.';
            }
        },
        {
            id: 'cancellation',
            concepts: ['@cancel'],
            keywords: ['cancel', 'refund', 'reschedule'],
            examples: ['what is the cancellation policy', 'can i get a refund', 'what if i cancel',
                'can i change my dates', 'is my deposit refundable', 'what happens if my flight is cancelled'],
            patterns: [/\bcancel(lation)?\b/, /\brefund\b/],
            answer: function () {
                return fact(FACTS.cancellation) + '. Date changes are usually easier than cancelling — ask early and they will normally accommodate you.';
            }
        },
        {
            id: 'payment',
            negativeExamples: ['what is the nightly rate', 'how much for a week', 'is it expensive'],
            concepts: ['@pay'],
            keywords: ['pay', 'payment', 'upi', 'card', 'deposit'],
            examples: ['how do i pay', 'do you take cards', 'is upi accepted', 'can i pay cash',
                'how much advance is needed', 'is there a security deposit', 'when do i pay the balance'],
            patterns: [/\bhow.*(do i|to) pay\b/, /\b(upi|deposit|advance)\b/],
            answer: function () {
                return 'Payment is by ' + fact(FACTS.payments) + '. Terms are ' + FACTS.deposit +
                    ', plus a refundable security deposit of ' + fact(FACTS.securityDeposit) + '.';
            }
        },
        {
            id: 'housekeeping',
            concepts: ['@clean'],
            keywords: ['clean', 'housekeeping', 'laundry', 'towels'],
            examples: ['is there housekeeping', 'do you clean daily', 'are towels provided',
                'is laundry available', 'is there a washing machine', 'do you change the linen'],
            patterns: [/\b(clean|housekeep|laundry|towel|linen)/],
            answer: function () {
                return 'Housekeeping comes ' + fact(FACTS.housekeeping) + '. Linen and towels are provided and changed during your stay. Laundry: ' + FACTS.laundry + '.';
            }
        },
        {
            id: 'safety',
            negativeExamples: ['what is the address', 'which part of goa is it', 'send me directions'],
            concepts: ['@safety'],
            keywords: ['safe', 'security', 'cctv', 'emergency'],
            examples: ['is it safe', 'is there security', 'are there cameras', 'is the area safe at night',
                'what if there is an emergency', 'is anyone on site'],
            patterns: [/\b(safe|security|cctv|emergenc)/],
            answer: function () {
                return 'The villa is private and yours alone. ' + FACTS.area +
                    ' is a quiet residential stretch and comfortable to walk at night.';
            }
        },
        {
            id: 'power',
            concepts: ['@power'],
            keywords: ['power', 'electricity', 'generator', 'backup'],
            examples: ['is there a power backup', 'do you have a generator', 'are there power cuts',
                'what about load shedding'],
            patterns: [/\b(power|electric|generator|inverter|outage)/],
            answer: function () {
                return 'There is ' + fact(FACTS.power) + '. Cuts happen occasionally in Goa but are usually short.';
            }
        },
        {
            id: 'tv',
            concepts: ['@tv'],
            keywords: ['tv', 'television', 'netflix', 'entertainment'],
            examples: ['is there a tv', 'do you have netflix', 'what is there to watch',
                'is there a sound system'],
            patterns: [/\b(tv|television|netflix)\b/],
            answer: function () { return 'There is a ' + FACTS.tv + '.'; }
        },
        {
            id: 'accessibility',
            concepts: ['@accessible'],
            keywords: ['wheelchair', 'accessible', 'disabled', 'mobility'],
            examples: ['is it wheelchair accessible', 'are there stairs', 'is it suitable for elderly guests',
                'any steps to get in'],
            patterns: [/\b(wheelchair|accessib|disabled|mobility)/],
            answer: function () {
                if (FACTS.accessible === null) {
                    return 'I would rather not guess about access. Tell ' + contact() + ' what you need and they will describe the house honestly.';
                }
                return yn(FACTS.accessible,
                    'Yes, the villa is step-free and wheelchair accessible.',
                    'Honestly, not fully — there are steps and the layout is spread over levels. If you tell the owner the specific needs on ' +
                    contact() + ', they can tell you plainly whether it will work.');
            }
        },
        {
            id: 'weather',
            concepts: ['@weather'],
            keywords: ['weather', 'monsoon', 'season', 'rain'],
            examples: ['what is the weather like', 'when is the best time to visit', 'does it rain a lot',
                'how hot does it get', 'is monsoon a bad time', 'best season to come'],
            patterns: [/\b(weather|monsoon|climate|season|rain)/],
            answer: function () { return 'Best window is ' + FACTS.bestTime + '.'; }
        },
        {
            id: 'activities',
            negativeExamples: ['what does it cost', 'how much per night'],
            concepts: ['@activity'],
            keywords: ['activities', 'nearby', 'attractions', 'nightlife'],
            examples: ['what is there to do nearby', 'any attractions around', 'what can we do',
                'is there nightlife', 'places to visit', 'things to see', 'any water sports'],
            patterns: [/\bwhat.*(to do|is there to see)\b/, /\b(attraction|sightsee|nightlife|watersport)/],
            answer: function () {
                return 'Plenty within reach — ' + FACTS.beachName + ' and the shacks along it, the Saturday night market, ' +
                    'old Portuguese houses around Loutulim and Chandor, spice farms inland, and Palolem a bit further south. ' +
                    'The caretaker knows the good, non-touristy versions of all of it.';
            }
        },
        {
            id: 'photos',
            concepts: ['@photos'],
            keywords: ['photo', 'picture', 'gallery', 'see'],
            examples: ['can i see photos', 'show me pictures', 'do you have a gallery',
                'what does it look like', 'more images'],
            patterns: [/\b(photo|picture|image|gallery)s?\b/],
            answer: function () {
                return 'The photos cycling behind this chat are the villa — bedrooms, the pool, the courtyard at night, the beach nearby. ' +
                    'Close the chat to watch them full-screen, or ask ' + FACTS.email + ' for the full set.';
            }
        },
        {
            id: 'contact',
            concepts: ['@contact'],
            keywords: ['contact', 'call', 'phone', 'whatsapp', 'human'],
            examples: ['how do i contact you', 'can i talk to a human', 'what is your number',
                'give me the owner contact', 'i want to speak to someone', 'whatsapp number', 'email address'],
            patterns: [/\b(contact|phone|whatsapp|call|email)\b/, /\b(talk|speak) to (a )?(human|person|someone|owner|manager)\b/],
            answer: function () {
                return 'Reach us on ' + contact() + '. A real person answers, usually quickly.';
            }
        },
        {
            id: 'compliment',
            examples: ['this place looks amazing', 'beautiful villa', 'wow stunning', 'looks gorgeous',
                'you are helpful', 'nice bot', 'great photos'],
            patterns: [/\b(beautiful|gorgeous|stunning|amazing|lovely|wow)\b/],
            weight: 0.92,
            answer: function () {
                return ['Thank you — the courtyard at night is the one that gets everyone.',
                    'Glad it appeals! It photographs well, and it holds up in person.'];
            }
        },
        {
            id: 'complaint',
            examples: ['this is useless', 'you are not helping', 'you are stupid', 'terrible bot',
                'you do not understand anything', 'this is frustrating', 'worst chat ever'],
            patterns: [/\b(useless|stupid|dumb|terrible|worst|rubbish|not helping|waste of time)\b/],
            weight: 0.95,
            answer: function () {
                return 'Fair enough — I only know what I have been told about the villa, and I am clearly missing what you need. ' +
                    contact() + ' gets you a person who can actually help.';
            }
        }
    ];

    return { FACTS: FACTS, CONCEPTS: CONCEPTS, INTENTS: INTENTS, BOOKING: BOOKING };
}));
