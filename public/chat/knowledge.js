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
        /* Verified: the owner's name. Used so the prompts read as a person
           offering help rather than a form asking questions. */
        owner: 'Carman',
        area: 'Loutolim, South Goa',
        bedrooms: 3,
        beds: 4,
        // Was 3. The listing says 2, and the owner has confirmed the listing.
        bathrooms: 2,
        // Was 6, which is the comfortable number rather than the maximum the
        // listing accepts. Both are true and only one of them is bookable.
        sleeps: 9,
        sleepsComfortably: 6,
        extraBed: false,

        // The villa is never shared. This is the single most important
        // policy on the page and the one guests ask about most.
        exclusive: 'The villa is let on an exclusive basis — the whole house is yours even if you book one room',
        deposit: '50% to confirm the booking, non-refundable',

        pool: 'private, for the use of your party alone',
        wifi: 'complimentary high-speed WiFi throughout, for up to 25 devices',
        ac: 'air-conditioned bedrooms and living room',
        kitchen: 'large and fully equipped',
        cook: 'a cook can be arranged — ask when booking',
        breakfast: 'complimentary English breakfast every morning, plus unlimited tea, coffee and juices all day',
        dinner: 'provided on request; there is also a barbeque in the gazebo',
        laundry: 'personal laundry included',
        tv: 'satellite TV',
        newspaper: 'a daily newspaper',
        wellness: 'massage services and yoga can be arranged at the house',
        medical: 'medical service on call',
        water: 'filtered drinking water throughout',
        // Open to guests since 2009. Seventeen years of it is a trust signal
        // no amount of copy substitutes for.
        since: 2009,
        // Goa tourism registration. Worth showing: it is the difference
        // between a registered property and somebody's spare house.
        registration: 'HOTS000253',
        childcare: 'babysitting, with a little notice',
        shower: "Goa's biggest rainshower heads",

        /* Goa has had two international airports since 2023, and guests book
           into either without realising how far apart they are. */
        airport: 'Goa International (GOI, Dabolim)',
        airportDistance: 'a 20 minute drive',
        airportNorth: 'Manohar International (GOX, Mopa)',
        /* UNKNOWN. Mopa is in Pernem at the top of the state, so it is
           materially further than Dabolim — but "materially further" is all
           that can be said without a figure somebody has actually driven. */
        airportNorthDistance: null,
        airportTransfer: 'complimentary from Dabolim — send me your flight details and I will have '
            + 'the car waiting',
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
        checkIn: 'from 2pm, and the door is open until midnight',
        checkOut: 'by 11am',
        earlyCheckIn: null,
        cancellation: null,
        housekeeping: 'daily',
        parking: null,
        payments: null,
        power: '24/7 generator backup, indoors and out',
        // Asked often enough to route, never yet answered by the owner.
        hotWater: null,
        mosquito: null,
        evCharging: null,
        staff: null,
        pets: null,
        smoking: null,
        parties: null,
        children: null,
        accessible: null,
        poolHeated: null,

        /* Security. These stay null on purpose and are the last facts anyone
           should be tempted to guess at: a guest asking whether they are being
           recorded is asking a privacy question, and an invented "no cameras"
           is a lie with consequences. Fill them in from the owner or leave
           them alone. */
        cameras: null,          // are any fitted, and where — indoors is the part that matters
        perimeter: null,        // walls, gates, whether anyone is on site overnight

        /* Things guests keep asking to arrange. Unknown, not unavailable —
           the bot says "ask the owner", never "no". */
        tourGuide: null,        // can a guide be booked, and roughly what it costs
        eventCatering: null,    // extra staff / catering for a gathering
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
    /* fact() fallbacks are written as mid-sentence clauses so they can be
       embedded in a larger reply. When one has to open a sentence instead, it
       needs a capital — otherwise the answer reads as a broken fragment. */
    function Cap(text) {
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    }

    function fact(value, fallback) {
        return value ? value : (fallback ||
            'something I would rather confirm for you myself — write to me at ' + contact());
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
                out.push('That is above the ' + F.sleeps + '-guest limit, so I would need to approve it myself.');
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
                ' and I will confirm availability.');
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
                return ['Hello — ' + FACTS.owner + ' here. I look after ' + FACTS.name + '. Ask me anything: rates, the pool, how far the beach is, whatever you need to know before you come.',
                    'Hello! ' + FACTS.owner + ' here. Happy to help with anything about ' + FACTS.name + ' — what would you like to know?'];
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
            keywords: ['robot', 'bot', 'human', 'software', 'ai', 'machine', 'real'],
            examples: ['who are you', 'what are you', 'are you a bot', 'are you human', 'are you real',
                'what is your name', 'are you an ai', 'am i talking to a robot'],
            patterns: [/\b(are you|is this) (a |an )?(real|actual|human|person|bot|robot|machine|program|software|ai)\b/,
                /\b(are you (an? )?(bot|robot|human|real|ai|person|machine|software))\b/,
                /\bwhat('s| is) your name\b/,
                /\b(chatting|talking|speaking) (to|with) (a )?(bot|robot|machine|computer|human|person)\b/],
            answer: function () {
                return 'Straight answer: I am the assistant that hands over ' + FACTS.owner +
                    '\u2019s answers, not ' + FACTS.owner + ' herself — pattern matching across what she has ' +
                    'told me about the house, and neither a person nor an AI. I am good on the practical ' +
                    'things. For anything else, write to her at ' + contact() + ' and she will answer you herself.';
            }
        },
        {
            id: 'capabilities',
            examples: ['what can you do', 'help', 'what can i ask', 'how does this work', 'what do you know',
                'give me options', 'menu', 'what can you help me with', 'what are you able to answer'],
            /* "what can you help me with" fell through to "I did not catch
               that" — the most basic question a guest can ask, and the one
               the widget's own opener invites. */
            patterns: [/^\s*(help|menu|options)\s*[?!.]*$/,
                /\bwhat can you (help|assist)\b/,
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
            negativeExamples: ['is the deposit paid by card or transfer', 'what payment methods do you take', 'which payment methods do you take', 'how do i send the money', 'is a deposit needed'],
            concepts: ['@price'],
            keywords: ['price', 'cost', 'rate', 'charge', 'expensive', 'budget',
                'discount', 'deal', 'offer', 'minimum stay', 'min stay'],
            /* "what would a week come to" is a price question phrased without
               any of the words above. */
            questionTypes: ['how_much', 'what'],
            examples: ['how much does it cost', 'what are your rates', 'price per night', 'how much per night',
                'what is the tariff', 'is it expensive', 'cost for 3 nights', 'what does a weekend cost',
                'rates for december', 'how much for the whole villa', 'give me a quote', 'nightly price',
                'what is the charge', 'how much money for two nights', 'daily rent'],
            /* Multi-word keywords are tokenised and stemmed, so "minimum stay"
               never matched as a phrase. Patterns match the text itself. */
            patterns: [/\bminimum\s+(stay|nights?|booking|period)\b/, /\bmin\s+nights?\b/,
                /\b(discount|cheaper rate|better rate|any deals?)\b/,
                /\b(come to|work out at|set (us|me) back)\b/,
                /\bhow much\b.*\b(night|stay|cost|villa|it)\b/, /\bwhat.*(price|rate|tariff|cost)\b/],
            answer: function (ctx) {
                var e = ctx.entities || {};

                /* Rates are the one thing a guest must never be guessed at,
                   and they are unset. One clean deferral — the earlier
                   version stitched the fallback in three times and produced
                   a sentence that said nothing, at length. */
                if (!FACTS.rateWeekday && !FACTS.rateWeekend && !FACTS.ratePeak) {
                    var ask = 'I will not quote you a rate I cannot stand behind — they move with the ' +
                        'season, and a wrong number is worse than none. Send me your dates at ' +
                        contact() + ' and I will quote you properly.';
                    if (e.nights || e.checkIn) {
                        ask = ask.replace('Send me your dates', 'Send me those dates');
                    }
                    ask += ' You can also book us through Airbnb: ' + FACTS.bookingUrl + '.';
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
            keywords: ['available', 'book', 'reserve', 'vacancy'],
            /* 'free' alone is ambiguous — free of charge, or unoccupied. Only
               the second sense belongs here, and a date word is what tells
               them apart. */
            examples: ['is it available', 'do you have availability', 'can i book for next weekend',
                'i want to book', 'is the villa free in december', 'any vacancy', 'can we reserve it',
                'i would like to make a reservation', 'is it open on the 20th', 'book it for me',
                'are you free next friday', 'want to stay for 3 nights'],
            patterns: [/\bfree\b[^.?]{0,20}\b(week|weekend|night|date|month|day|then)\b/,
                /\b(get|have|take) (it|the (place|villa|house))\b/,
                /\b(is|are) (it|the villa|you) (available|free|open|booked)\b/, /\bi (want|would like|wanna|need) to (book|reserve|stay)\b/],
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
            keywords: ['bedroom', 'sleep', 'capacity', 'people', 'accommodate',
                'fit', 'big', 'group', 'family', 'families'],
            questionTypes: ['how_many'],
            examples: ['how many bedrooms', 'how many people can stay', 'does it sleep 6', 'how many can it accommodate',
                'is there room for 8', 'how many beds', 'we are 5 people will it fit', 'number of rooms',
                'can 7 of us stay', 'is it a 2 bhk', 'how many bathrooms', 'will 8 of us fit',
                'is it big enough for 10 of us'],
            patterns: [/\bhow many (bedroom|room|bed|people|guest|bathroom)/, /\b(sleep|accommodate|fit)s? (\d+|us)\b/,
                /\b(can|will|would|does it|is it big enough for)\b[^?]{0,20}\b\d{1,2} of us\b/,
                /\b(fit|big enough|large enough|room for|space for|enough (room|space|beds))\b/],
            answer: function (ctx) {
                var e = ctx.entities || {};
                var base = FACTS.bedrooms + ' bedrooms, ' + FACTS.beds + ' beds and ' +
                    FACTS.bathrooms + ' bathrooms. ' + FACTS.sleepsComfortably +
                    ' sleep comfortably, and the booking will take up to ' + FACTS.sleeps + '.';
                if (e.guests) {
                    base += e.guests <= FACTS.sleepsComfortably
                        ? ' ' + e.guests + ' is well within that.'
                        : e.guests <= FACTS.sleeps
                            ? ' ' + e.guests + ' fits, though it is above the number I would call comfortable — tell me who is coming and I will be straight with you about it.'
                            : ' ' + e.guests + ' is over the ' + FACTS.sleeps + ' the house takes, so that one needs me directly.';
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
                /* "Yes — a private, for the use of your party alone." The fact
                   is a description, not a noun the article can attach to.
                   The closing "It is yours alone, not shared" also went: the
                   fact already says exactly that, one sentence earlier. */
                return 'Yes — the pool is ' + FACTS.pool + '. ' + heat;
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
            answer: function () { return 'Yes — ' + FACTS.ac + '.'; }
        },
        {
            id: 'kitchen',
            negativeExamples: ['can you provide a chef', 'is breakfast served', 'where can we eat out',
                'can you arrange a cook', 'is there a chef available'],
            concepts: ['@kitchen'],
            keywords: ['kitchen', 'cook', 'stove', 'fridge', 'utensils', 'selfcater'],
            examples: ['is there a kitchen', 'can we cook', 'does the kitchen have a fridge',
                'are utensils provided', 'is there a stove', 'can i make my own food',
                'are we self catering', 'is it self catered', 'do we feed ourselves'],
            patterns: [/\bkitchen\b/, /\bcan (we|i) cook\b/],
            answer: function () {
                return 'There is a kitchen — ' + FACTS.kitchen + '. ' + 'And ' + FACTS.cook + '.';
            }
        },
        {
            id: 'food',
            negativeExamples: ['is there a fridge', 'are utensils provided', 'is there a gas stove'],
            concepts: ['@food'],
            /* The breakfast fact already promises "unlimited tea, coffee and
               juices all day", and the answer already mentions groceries —
               but "do you provide tea and coffee" and "is there a supermarket
               close by" both missed. The words were in the answer and not in
               the index, which is the easiest gap of all to leave open. */
            keywords: ['food', 'breakfast', 'meal', 'restaurant', 'chef', 'dinner', 'lunch',
                'tea', 'coffee', 'supermarket', 'vegetarian', 'vegan'],
            examples: ['is breakfast included', 'do you serve food', 'are there restaurants nearby',
                'can you arrange a cook', 'where do we eat', 'is there a chef', 'food options',
                'can we order in', 'do you provide tea and coffee',
                'is there a supermarket close by', 'can you cater for vegetarians'],
            patterns: [/\b(can|could|will) (someone|somebody|anyone) cook\b/,
                /\bbreakfast\b/, /\b(serve|provide|include).*(food|meal)/],
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
            // "how far is the nearest town" was answered with the airport.
            patterns: [/\bwhere (is|are) (it|the villa|you|this)\b/, /\b(exact )?(address|location)\b/,
                /\bnearest (town|village|city|shops?)\b/,
                /\bhow far.*\b(town|village|margao|panjim|city)\b/],
            answer: function () {
                return FACTS.name + ' is in ' + FACTS.area + '. It is ' + FACTS.beachDistance +
                    ' to ' + FACTS.beachName + ', and ' + FACTS.railway +
                    '. The exact pin is shared once a booking is confirmed.';
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
                return 'It is ' + FACTS.beachDistance + ' to ' + FACTS.beachName +
                    '. Not beachfront — the coast is a short drive rather than a walk.';
            }
        },
        {
            id: 'airport',
            negativeExamples: ['can you organise a car from the airport', 'will you send a vehicle to meet the flight'],
            concepts: ['@airport'],
            keywords: ['airport', 'flight', 'dabolim', 'mopa', 'gox', 'manohar', 'terminal'],
            questionTypes: ['how_far'],
            examples: ['how far is the airport', 'distance from airport', 'which airport should i fly into',
                'how long from dabolim', 'do you pick up from the airport', 'is mopa or dabolim closer',
                'how far is mopa', 'which airport is nearer', 'i am flying into the new airport',
                'is the old airport closer', 'how long from mopa to the villa'],
            patterns: [/\bairport\b/, /\b(mopa|dabolim|gox)\b/, /\bmanohar\b/],
            /* Both of them, and which to book — that is the decision behind
               the question. Naming only Dabolim was no use at all to somebody
               already holding a ticket into Mopa, and this intent listed "is
               mopa or dabolim closer" as an example while answering about one
               airport. */
            answer: function () {
                return 'Two of them, and they are a long way apart. ' + FACTS.airport +
                    ' is the near one — ' + FACTS.airportDistance +
                    ' — so fly into that if you have the choice. ' + FACTS.airportNorth +
                    ' sits at the top of the state and is ' +
                    fact(FACTS.airportNorthDistance,
                        'a good deal further; ask me at ' + contact() +
                        ' and I will tell you what that drive really takes before you book it') +
                    '. The transfer is ' + FACTS.airportTransfer +
                    '; from Mopa, tell me and I will arrange a car and tell you the fare.';
            }
        },
        /* Arriving by train had no intent of its own. "Margao station is a 10
           minute drive" appeared as a clause inside the location answer, so
           somebody asking about the railway got told where the villa is —
           which is not what they asked. Plenty of Indian guests come down on
           the Konkan line rather than fly. */
        {
            id: 'railway',
            keywords: ['train', 'railway', 'station', 'madgaon', 'margao station', 'konkan'],
            examples: ['how far is the railway station', 'can i come by train',
                'which station should i get off at', 'how far is madgaon station',
                'is margao station close', 'arriving by train'],
            patterns: [/\b(railway|train)\b/, /\b(madgaon|margao)\s+station\b/, /\bkonkan\b/],
            questionTypes: ['how_far', 'where'],
            answer: function () {
                return 'Come by train if it suits you — ' + FACTS.railway +
                    ', which is closer than the airport. Tell me your train and arrival time at ' +
                    contact() + ' and I will have a car meet you.';
            },
            chips: ['How far is the airport?', 'Can you arrange a car?']
        },
        {
            id: 'transfer',
            concepts: ['@transfer'],
            /* 'rent' as a bare keyword pulled "can i rent a scooter" into the
               availability intent, which is about renting the villa. What is
               wanted here is renting a VEHICLE, so it moves to patterns, where
               the object of the verb is part of the match. */
            keywords: ['transfer', 'pickup', 'taxi', 'cab', 'transport', 'scooter', 'driver'],
            examples: ['can you arrange a pickup', 'do you provide transport', 'is a taxi available',
                'can i rent a scooter', 'how do we get around', 'do you have a driver'],
            // "pick us up" missed: the pattern wanted "pick up" adjacent, so
            // any object between the verb and its particle slipped through.
            patterns: [/\b(pick ?up|drop off|taxi|cab|driver|chauffeur)\b/,
                /\bpick\s+(us|me|the group|everyone)\s+up\b/,
                /\b(railway|train)\s+station\b/,
                /\b(rent|hire)\w*\s+(a\s+|an\s+)?(scooter|bike|moped|motorbike|car|vehicle)\b/,
                /* "can you arrange a car" was answered with parking, because
                   @parking owns the word "car". Arranging one is a transport
                   question; parking one is not. */
                /\b(arrange|organi[sz]e|book|get|sort)\w*\s+(us\s+|me\s+)?(a\s+|an\s+)?(car|vehicle|driver|ride|lift)\b/,
                /\b(collect|meet|fetch) (us|me|you)\b/,
                /\b(car|ride|lift) (from|to) the airport\b/],
            negativeExamples: ['what time can we arrive', 'can we leave luggage before check in',
                'where do i park the car'],
            answer: function () {
                return 'Airport transfers are ' + FACTS.airportTransfer + '. Scooters and cars are easy to rent locally and the caretaker can set that up — ' +
                    'having your own wheels makes a big difference in Goa.';
            }
        },
        {
            id: 'parking',
            concepts: ['@parking'],
            /* 'scooter' alone was enough to pull 'can i rent a scooter' in here.
               Renting one is transport; this intent is only about where to
               leave it once you have it. */
            keywords: ['parking', 'park', 'vehicle'],
            /* 'car' cannot be a bare keyword here or it steals vehicle hire,
               but leaving one somewhere is unambiguously parking. */
            negativeExamples: ['can i rent a scooter', 'can we hire a car', 'do you have a driver',
                'how do we get around'],
            examples: ['is there parking', 'where do i park', 'can i park two cars', 'is parking free',
                'somewhere to keep the scooter'],
            patterns: [/\b(leave|keep|put|store)\s+(the\s+|our\s+|a\s+)?(car|vehicle|scooter|bike)\b/,
                /\bpark(ing)?\b/],
            answer: function () { return 'Parking is ' + fact(FACTS.parking) + '. Scooters park inside too.'; }
        },
        {
            id: 'checkin',
            negativeExamples: ['when do we have to leave', 'can we stay later on the final day'],
            concepts: ['@checkin'],
            keywords: ['checkin', 'arrival', 'arrive', 'early', 'let us in', 'caretaker', 'meet us'],
            questionTypes: ['when', 'what'],
            examples: ['what time is check in', 'when can we arrive', 'can we check in early',
                'is late arrival ok', 'what time can i get in'],
            /* "is anyone there to let us in" scored as a greeting — it reads
               like "is anyone there?" — and fell through. It is an arrival
               question about who meets you with the keys. */
            patterns: [/\bcheck ?-?in\b/, /\bwhat time.*(arrive|arrival)\b/,
                /\b(let|lets|letting) (us|me) in\b/, /\bmeet(ing)? us\b/,
                /\b(hand over|collect|pick up) the keys?\b/],
            answer: function () {
                /* The times are known now, so the sentence no longer offers to
                   find them out — that offer read as a deferral sitting next
                   to a real answer, which is worse than either alone. */
                return 'Check-in is ' + fact(FACTS.checkIn, 'flexible') + '. Check-out is ' +
                    fact(FACTS.checkOut, 'flexible') + '. ' +
                    // No Cap() here — a semicolon carries on the sentence.
                    'A late flight is no trouble at all; ' +
                    fact(FACTS.earlyCheckIn, 'arriving early depends on the day before, so ask me and I will check') + '.';
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
                    return 'I would rather tell you about pets myself than have you plan around a guess. ' +
                    'Write to me at ' + contact() + ' — tell me the breed and size, and I will answer straight away.';
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
            keywords: ['party', 'event', 'celebration', 'music', 'birthday', 'wedding', 'guests',
                'alcohol', 'drinks', 'booze', 'bar'],
            negativeExamples: ['is extra staff available for a celebration',
                'can you arrange catering for a get together', 'can a caterer come in'],
            examples: ['can we throw a party', 'are events allowed', 'can we play loud music',
                'is it ok for a birthday celebration', 'can we host a wedding', 'bachelor party',
                'can we bring our own alcohol', 'is it alright to play music in the evening'],
            patterns: [/\b(hold|throw|host|have) (a|an|our) [a-z ]{0,18}(party|do|bash|event|wedding|birthday)\b/,
                /\b(part(y|ies)|event|celebration|wedding|dj)\b/],
            answer: function (ctx) {
                return (ctx.negated ? 'Correct — ' : 'House policy: ') + fact(FACTS.parties) +
                    '. A quiet family celebration is fine — a full event is not. ' +
                    'If you are unsure which yours is, ask me first at ' + contact() + '.';
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
                return 'Children are ' + fact(FACTS.children) + '. A cot can usually be arranged with a bit of notice.';
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
                return 'The cancellation terms are ' +
                    fact(FACTS.cancellation, 'something I would rather put in writing for you before you pay anything — write to me at ' + contact()) +
                    '. Changing dates is usually easier than cancelling outright, so ask me early and I will do what I can.';
            }
        },
        {
            id: 'payment',
            negativeExamples: ['what is the nightly rate', 'how much for a week', 'is it expensive'],
            concepts: ['@pay'],
            keywords: ['pay', 'payment', 'upi', 'card', 'deposit', 'upfront', 'advance',
                'transfer', 'send'],
            examples: ['how do i pay', 'do you take cards', 'is upi accepted', 'can i pay cash',
                'how much advance is needed', 'is there a security deposit', 'when do i pay the balance'],
            patterns: [/\bhow.*(do i|to) pay\b/, /\b(upi|deposit|advance)\b/,
                /\b(up ?front|in advance|send (the |you )?(money|payment)|how do i pay|make the payment)\b/],
            answer: function () {
                return 'How you can pay is ' +
                    fact(FACTS.payments, 'something I will set out for you when you book — write to me at ' + contact()) +
                    '. Terms are ' + FACTS.deposit + ', plus a refundable security deposit, the amount of which is ' +
                    fact(FACTS.securityDeposit, 'something I will confirm with you at the same time') + '.';
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
                return 'Housekeeping comes ' + fact(FACTS.housekeeping, 'on a schedule I will confirm with you when you book — ask me at ' + contact()) +
                    '. Linen and towels are provided and changed during your stay. Laundry: ' + FACTS.laundry + '.';
            }
        },
        {
            id: 'safety',
            negativeExamples: ['what is the address', 'which part of goa is it', 'send me directions'],
            concepts: ['@safety'],
            keywords: ['safe', 'security', 'cctv', 'camera', 'surveillance', 'emergency',
                'gate', 'perimeter', 'guard', 'watchman'],
            examples: ['is it safe', 'is there security', 'are there cameras', 'is the area safe at night',
                'what if there is an emergency', 'is anyone on site', 'is the property gated',
                'are we being recorded', 'is there cctv inside', 'do you have a night guard',
                'is the perimeter secure', 'are there cameras in the bedrooms'],
            patterns: [/\b(safe|security|cctv|camera|surveill|record|emergenc|perimeter|gated?|guard|watchman)/],
            answer: function (ctx) {
                /* This intent listed 'are there cameras' as an example and then
                   answered with 'it is a quiet residential stretch', which is
                   not an answer to the question that was asked.

                   Whether a guest is being recorded is a privacy question. The
                   only honest replies are the true one or 'ask the owner'. An
                   invented, reassuring 'no cameras' would be the single worst
                   thing in this file to get wrong. */
                var asked = (ctx && ctx.analysis && ctx.analysis.normalised) || '';
                var aboutWatching = /\b(camera|cctv|surveill|record|watch|monitor|film)/.test(asked);
                var aboutPerimeter = /\b(perimeter|gated?|guard|watchman|wall|fence|on ?site)/.test(asked);

                var neighbourhood = 'The villa is let on an exclusive basis, so the house and grounds are yours ' +
                    'alone, and ' + FACTS.area + ' is a quiet residential stretch that is comfortable to walk at night.';

                if (aboutWatching) {
                    if (FACTS.cameras === null) {
                        return 'I am not going to guess about cameras. Whether any are fitted, and where, is ' +
                            'something to get in writing before you book rather than from me. Write to ' +
                            contact() + ' and ask directly. ' + neighbourhood;
                    }
                    return FACTS.cameras + ' ' + neighbourhood;
                }

                if (aboutPerimeter) {
                    return Cap(fact(FACTS.perimeter, 'how the grounds are enclosed, and whether anyone is on ' +
                        'site overnight, is worth asking ' + contact() + ' directly')) + '. ' + neighbourhood;
                }

                return neighbourhood + ' There is also ' + FACTS.medical + '.';
            }
        },

        {
            /* Distinct from `activities`, which lists what there is to see.
               This is about a person to show you round, which nobody has
               confirmed exists. */
            id: 'tourguide',
            concepts: ['@activities'],
            keywords: ['guide', 'guided', 'excursion', 'itinerary', 'sightseeing'],
            examples: ['can you arrange a guide', 'is there a tour guide', 'can we book a guided tour',
                'do you organise excursions', 'can someone show us around', 'is there a sightseeing tour',
                'can you plan an itinerary for us', 'we want a day trip with a driver'],
            patterns: [/\b(guide|guided tour|excursion|itinerar)\b/, /\bshow us (a|)round\b/,
                /\b(day trip|plan .*itinerary)\b/],
            negativeExamples: ['what is there to do nearby', 'which beach is closest', 'can i rent a scooter'],
            answer: function () {
                return Cap(fact(FACTS.tourGuide,
                    'let me arrange that with you directly rather than guess at it — write to me at ' +
                    contact() + ' and I will tell you what is possible and what it costs')) +
                    '. What I can tell you is where to point one: the old Portuguese houses at Loutolim and ' +
                    'Chandor, the spice farms inland, the Latin quarter in Panjim, and the beaches further south. ' +
                    'The caretaker can usually set up a car and driver, which covers most of what a guide would.';
            }
        },

        {
            /* `parties` answers whether an event is ALLOWED. This answers
               whether one can be ARRANGED: catering, extra hands, hiring in.
               Two different questions that were collapsing into one answer. */
            id: 'gatherings',
            concepts: ['@parties'],
            keywords: ['catering', 'caterer', 'gathering', 'celebration', 'decorations',
                'staff', 'waiter', 'server', 'hire'],
            examples: ['can you arrange catering for a get together', 'can we have a small family gathering',
                'can you organise a birthday dinner', 'is extra staff available for a celebration',
                'can you set up decorations', 'we want to host a lunch for twelve',
                'can a caterer come in', 'can you arrange a special dinner'],
            /* Negative lookbehind on "self": self-catering means cooking for
               yourself, which is the kitchen's business and very nearly the
               opposite of hiring a caterer. */
            patterns: [/\b(?<!self.)(cater|gathering|get.?together|celebrat|decoration)\b/],
            negativeExamples: ['can we throw a party', 'is loud music allowed', 'can we host a wedding'],
            answer: function () {
                return 'For something small and private the house is well set up: the kitchen is ' +
                    FACTS.kitchen + ', ' + FACTS.cook + ', and dinner is ' + FACTS.dinner + '. ' +
                    Cap(fact(FACTS.eventCatering,
                        'tell me what you have in mind at ' + contact() + ' and I will arrange a caterer ' +
                        'or extra staff — I know who is good locally and what the house can take')) + '. ' +
                    'The policy on larger events is a separate matter: ' +
                    fact(FACTS.parties, 'something I decide case by case — tell me what you have in mind') + '.';
            }
        },
        {
            id: 'power',
            concepts: ['@power'],
            keywords: ['power', 'electricity', 'generator', 'backup'],
            examples: ['is there a power backup', 'do you have a generator', 'are there power cuts',
                'what about load shedding'],
            /* The bare /electric/ swallowed "electric car", so EV charging
               could never reach its own intent and the answer came back about
               power cuts. The lookahead hands those two phrasings over and
               leaves "electricity" and "electric supply" where they were. */
            negativeExamples: ['can i charge an electric car', 'is there an ev charging point'],
            patterns: [/\b(power|electric(?!\s+(car|vehicle))|generator|inverter|outage)/],
            answer: function () {
                return 'Power backup is ' + fact(FACTS.power) + '. Cuts happen occasionally in Goa but are usually short.';
            }
        },

        /* The next three exist because the matcher was answering them with
           whatever scored closest, and the closest was absurd: hot water got
           the monsoon forecast, mosquito nets got the pet policy, and EV
           charging got the power-cut answer. Each was stated as fact.

           They carry no facts yet — the owner has not been asked. Routing
           them to an honest deferral is still strictly better than routing
           them confidently somewhere else, and it puts the three questions on
           the list of things to find out. */
        /* The outside of the house had no intent at all, so "is there a garden
           to sit out in" missed and "is there a barbecue we can use" missed —
           even though the dinner fact says, in as many words, that there is a
           barbeque in the gazebo. Both spellings are indexed, because British
           and Indian English disagree and a guest should not have to know
           which one the file uses. */
        {
            id: 'grounds',
            keywords: ['garden', 'lawn', 'grounds', 'outdoor', 'outside', 'gazebo',
                'barbecue', 'barbeque', 'bbq', 'grill', 'terrace', 'veranda', 'courtyard'],
            examples: ['is there a garden to sit out in', 'is there a barbecue we can use',
                'can we eat outside', 'is there outdoor seating', 'do you have a lawn',
                'is there a terrace', 'can we grill'],
            patterns: [/\b(garden|lawn|gazebo|barbe?c?que|bbq|terrace|veranda|courtyard)\b/,
                /\bsit\s+out(side)?\b/, /\beat\s+outside\b/],
            answer: function () {
                // Not a substring of FACTS.exclusive: stripping its opening
                // clause left "and they are yours alone — exclusive basis —
                // the whole house is yours", which reads like a fragment.
                return 'There are grounds around the house, and they are yours alone — the villa ' +
                    'is let on an exclusive basis. Dinner is ' + FACTS.dinner +
                    '. The pool is ' + FACTS.pool + '.';
            },
            chips: ['Is there a pool?', 'Can we get dinner made?']
        },
        {
            id: 'hotwater',
            keywords: ['hot water', 'geyser', 'water heater', 'immersion'],
            examples: ['is there hot water', 'do the showers have hot water',
                'is there a geyser', 'hot water in the bathrooms', 'water heater'],
            // "water" alone belongs to the pool; only the heated kind is this.
            patterns: [/\b(hot|warm)\s+water\b/, /\bgeyser\b/, /\bwater\s+heater\b/],
            answer: function () {
                return 'Whether every bathroom runs hot water around the clock is ' +
                    fact(FACTS.hotWater) +
                    '. The showers themselves are ' + FACTS.shower + '.';
            },
            chips: ['What is in the bathrooms?', 'Talk to a human']
        },
        {
            id: 'mosquitoes',
            keywords: ['mosquito', 'mosquitoes', 'mosquito net', 'repellent', 'insects', 'bugs'],
            examples: ['are there mosquito nets', 'is it mosquito free', 'do i need repellent',
                'are there a lot of mosquitoes', 'any insect problem'],
            patterns: [/\bmosquito(es|s)?\b/, /\brepellent\b/, /\binsect(s)?\b/],
            answer: function () {
                return 'Nets and repellent are ' + fact(FACTS.mosquito) +
                    '. Goa has mosquitoes, more so through the monsoon, so it is a fair thing to ask before you come.';
            },
            chips: ['Talk to a human']
        },
        {
            id: 'evcharging',
            keywords: ['ev charging', 'electric car', 'electric vehicle', 'charging point', 'car charger'],
            examples: ['can i charge an electric car', 'is there an ev charger',
                'do you have a charging point', 'can i plug in my ev'],
            /* Both orders, because @parking already owns "car" and would
               otherwise take this — that is exactly how it used to answer with
               scooter parking. */
            patterns: [
                /\b(ev|electric)\s+(car|vehicle|charg)/,
                /\bcharg(e|ing|er)\b.*\b(car|vehicle|ev)\b/,
                /\b(car|vehicle|ev)\b.*\bcharg(e|ing|er)\b/
            ],
            answer: function () {
                return 'A charging point for an electric car is ' + fact(FACTS.evCharging) +
                    '. Worth settling before you drive down rather than after.';
            },
            chips: ['Is there parking?', 'Talk to a human']
        },
        {
            id: 'tv',
            concepts: ['@tv'],
            keywords: ['tv', 'television', 'netflix', 'entertainment'],
            examples: ['is there a tv', 'do you have netflix', 'what is there to watch',
                'is there a sound system'],
            patterns: [/\b(tv|television|netflix)\b/],
            // "There is a satellite TV and DVD, and iPod docking" — the fact
            // is a list, so the article cannot lead it.
            answer: function () { return 'There is ' + FACTS.tv + '.'; }
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
                    return 'I will not guess about access — it matters far too much to get wrong. Tell me ' +
                    'exactly what you need at ' + contact() + ' and I will describe the house honestly, ' +
                    'steps, doorways and bathrooms included.';
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
            answer: function () { return FACTS.bestTime + '.'; }
        },
        {
            id: 'activities',
            negativeExamples: ['what does it cost', 'how much per night'],
            concepts: ['@activity'],
            keywords: ['activities', 'nearby', 'attractions', 'nightlife', 'around', 'area', 'visit'],
            examples: ['what is there to do nearby', 'any attractions around', 'what can we do',
                'is there nightlife', 'places to visit', 'things to see', 'any water sports'],
            patterns: [/\bwhat (is|are) there to (do|see)\b/,
                /\bwhat do (people|you|visitors) do\b/,
                /\bwhat.*(to do|is there to see)\b/, /\b(attraction|sightsee|nightlife|watersport)/],
            answer: function () {
                return 'Plenty within reach — ' + FACTS.beachName + ' and the shacks along it, the Saturday night market, ' +
                    'old Portuguese houses around Loutolim and Chandor, spice farms inland, and Palolem a bit further south. ' +
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
                return 'Write to me at ' + contact() + '. That reaches me directly rather than an ' +
                    'autoresponder, and I answer quickly.';
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
            keywords: ['useless', 'rubbish', 'terrible', 'awful', 'hopeless', 'annoying'],
            examples: ['this is useless', 'you are not helping', 'you are stupid', 'terrible bot',
                'you do not understand anything', 'this is frustrating', 'worst chat ever'],
            patterns: [/\b(not (much|very) (use|good|helpful)|no help|waste of time)\b/,
                /\b(useless|stupid|dumb|terrible|worst|rubbish|not helping|waste of time)\b/],
            weight: 0.95,
            answer: function () {
                return 'I am sorry — I am clearly missing what you actually need, and going round again ' +
                    'will not fix it. Write to me at ' + contact() + ' and I will answer you myself.';
            }
        }
    ];

    /* ---------------------------------------------------------------
     * What to actually DO next, per topic.
     *
     * A guest who asks the same thing twice did not get what they needed the
     * first time. Repeating the same sentence more loudly is what makes an
     * assistant infuriating, so the second answer states the position
     * formally and then names a concrete next step — a link to open, an
     * address to write to, and what to put in the message.
     *
     * "Email the owner" on its own is not a step. "Email the owner with your
     * dates and party size, and ask them to confirm in writing" is one.
     * ------------------------------------------------------------ */
    function nextStep(intentId) {
        var who = contact();

        switch (intentId) {
            case 'price':
            case 'payment':
                return 'send me your dates at ' + who + ' and I will quote you properly. ' +
                    'You can also book through our Airbnb listing at ' + FACTS.bookingUrl;
            case 'availability':
                return 'write to me at ' + who + ' with your arrival date, the number of nights and how many ' +
                    'of you there are — that is everything needed to check the calendar and hold it';
            case 'cancellation':
                return 'ask me at ' + who + ' for the cancellation terms in writing before you pay the deposit, ' +
                    'so what we agree is on record';
            case 'checkin':
            case 'checkout':
                return 'send me your flight or train time at ' + who + ' and I will confirm the arrival ' +
                    'arrangement — the caretaker needs to know when to meet you';
            case 'airport':
            case 'transfer':
                return 'send me your flight number and landing time at ' + who + ' and I will have the car waiting';
            case 'cameras':
            case 'safety':
                return 'ask me directly at ' + who + ' what is fitted and where. This is a privacy question and ' +
                    'you are entitled to a straight answer from me in writing';
            case 'pets':
            case 'smoking':
            case 'parties':
            case 'children':
                return 'put the specifics to me at ' + who + ' — the breed and size, or the number of guests and ' +
                    'the hours — and get the answer in writing before you book';
            case 'accessibility':
                return 'tell me at ' + who + ' exactly what access you need, and I will describe the ' +
                    'steps, doorways and bathrooms honestly rather than in general terms';
            case 'tourguide':
            case 'gatherings':
                return 'write to me at ' + who + ' with the date and what you have in mind, and I will tell you ' +
                    'what can be arranged and what it costs';
            default:
                return 'write to me at ' + who + ' with the question exactly as you have put it here — I answer ' +
                    'these myself, usually quickly, and can tell you what this assistant cannot';
        }
    }

    return {
        FACTS: FACTS, CONCEPTS: CONCEPTS, INTENTS: INTENTS, BOOKING: BOOKING,
        nextStep: nextStep
    };
}));
