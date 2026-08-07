/* =====================================================================
 * corpus.js — labelled utterances for measuring the matcher.
 *
 * Rule for adding entries: DO NOT copy phrasings out of knowledge.js
 * examples. This set exists to measure generalisation to wording the
 * engine has never seen. Anything lifted from training inflates the
 * score and hides the regression you were trying to catch.
 *
 * `intent: null` means "the bot should NOT be confident here" — either a
 * genuine out-of-domain question or filler. These drive the
 * false-confidence rate, which matters more than raw accuracy: a wrong
 * confident answer about a cancellation policy is worse than a shrug.
 * ===================================================================== */
module.exports = [
    /* ---------------- social ---------------- */
    { text: 'hiya', intent: 'greeting' },
    { text: 'good evening!', intent: 'greeting' },
    { text: 'hello, anyone about?', intent: 'greeting' },
    { text: 'morning', intent: 'greeting' },

    { text: 'right, im off', intent: 'goodbye' },
    { text: 'thats everything, cheerio', intent: 'goodbye' },
    { text: 'later!', intent: 'goodbye' },

    { text: 'brilliant, cheers for that', intent: 'thanks' },
    { text: 'thanks so much for the help', intent: 'thanks' },
    { text: 'appreciated', intent: 'thanks' },

    { text: 'am i chatting to a machine', intent: 'bot_identity' },
    { text: 'are you an actual person or software', intent: 'bot_identity' },
    { text: 'whats your name then', intent: 'bot_identity' },

    { text: 'what sort of things can i ask you', intent: 'capabilities' },
    { text: 'how do i use this', intent: 'capabilities' },
    { text: 'show me the options', intent: 'capabilities' },

    /* ---------------- money ---------------- */
    { text: 'whats the damage per night', intent: 'price' },
    { text: 'how much am i looking at for a weekend', intent: 'price' },
    { text: 'give me an idea of the nightly rate', intent: 'price' },
    { text: 'is this place pricey', intent: 'price' },
    { text: 'what would four nights come to', intent: 'price' },
    { text: 'ballpark cost please', intent: 'price' },

    { text: 'which cards do you accept', intent: 'payment' },
    { text: 'can i settle by bank transfer', intent: 'payment' },
    { text: 'how much upfront do you need', intent: 'payment' },
    { text: 'is there a security deposit to pay', intent: 'payment' },

    { text: 'what if i have to pull out', intent: 'cancellation' },
    { text: 'do i get my money back if plans change', intent: 'cancellation' },
    { text: 'can i move my dates later', intent: 'cancellation' },
    { text: 'refund terms please', intent: 'cancellation' },

    /* ---------------- booking ---------------- */
    { text: 'are you taking bookings for december', intent: 'availability' },
    { text: 'id like to reserve the villa', intent: 'availability' },
    { text: 'is the place free that week', intent: 'availability' },
    { text: 'any openings next month', intent: 'availability' },
    { text: 'can we get it from the 12th', intent: 'availability' },

    { text: 'how many can you sleep', intent: 'capacity' },
    { text: 'will nine of us fit', intent: 'capacity' },
    { text: 'number of bathrooms please', intent: 'capacity' },
    { text: 'is it big enough for two families', intent: 'capacity' },

    /* ---------------- the property ---------------- */
    { text: 'tell me about the swimming pool', intent: 'pool' },
    { text: 'is the pool ours alone', intent: 'pool' },
    { text: 'how deep does the pool go', intent: 'pool' },
    { text: 'can we swim after dark', intent: 'pool' },

    { text: 'will i be able to work online from there', intent: 'wifi' },
    { text: 'hows the broadband speed', intent: 'wifi' },
    { text: 'is the connection reliable', intent: 'wifi' },

    { text: 'are the rooms air conditioned', intent: 'ac' },
    { text: 'does the bedroom have cooling', intent: 'ac' },

    { text: 'can we self cater', intent: 'kitchen' },
    { text: 'are pots and pans provided', intent: 'kitchen' },
    { text: 'is there a proper cooker', intent: 'kitchen' },

    { text: 'do we get breakfast in the morning', intent: 'food' },
    { text: 'can someone cook for us', intent: 'food' },
    { text: 'any decent places to eat close by', intent: 'food' },

    { text: 'is there a telly', intent: 'tv' },
    { text: 'can we stream shows there', intent: 'tv' },

    { text: 'who does the cleaning', intent: 'housekeeping' },
    { text: 'are bed sheets included', intent: 'housekeeping' },
    { text: 'can i get washing done', intent: 'housekeeping' },

    { text: 'do the lights stay on in a cut', intent: 'power' },
    { text: 'is there a backup generator', intent: 'power' },

    { text: 'is the place secure at night', intent: 'safety' },
    { text: 'is anybody on site if something breaks', intent: 'safety' },

    { text: 'are there many steps to climb', intent: 'accessibility' },
    { text: 'would it suit someone in a wheelchair', intent: 'accessibility' },

    /* ---------------- getting there ---------------- */
    { text: 'whereabouts in goa is this', intent: 'location' },
    { text: 'which village is the villa in', intent: 'location' },
    { text: 'can you send the exact spot', intent: 'location' },

    { text: 'how long to walk to the sea', intent: 'beach' },
    { text: 'is the shore within reach', intent: 'beach' },
    { text: 'which is the nearest beach', intent: 'beach' },

    { text: 'how far out is the terminal', intent: 'airport' },
    { text: 'which airport do i fly into', intent: 'airport' },

    { text: 'can someone collect us when we land', intent: 'transfer' },
    { text: 'do you sort out taxis', intent: 'transfer' },
    { text: 'can we hire a scooter locally', intent: 'transfer' },

    { text: 'somewhere to leave the car', intent: 'parking' },
    { text: 'is parking included', intent: 'parking' },

    /* ---------------- rules and timings ---------------- */
    { text: 'earliest we can get the keys', intent: 'checkin' },
    { text: 'what time do we arrive', intent: 'checkin' },
    { text: 'can we drop bags early', intent: 'checkin' },

    { text: 'when must we vacate', intent: 'checkout' },
    { text: 'any chance of a later departure', intent: 'checkout' },

    { text: 'would you allow a small dog', intent: 'pets' },
    { text: 'is the villa pet friendly', intent: 'pets' },
    { text: 'travelling with our cat, is that ok', intent: 'pets' },

    { text: 'anywhere i can have a cigarette', intent: 'smoking' },
    { text: 'is vaping indoors alright', intent: 'smoking' },

    { text: 'could we hold a small birthday do', intent: 'parties' },
    { text: 'are we allowed music late', intent: 'parties' },
    { text: 'is a wedding function permitted', intent: 'parties' },

    { text: 'is it suitable for a toddler', intent: 'children' },
    { text: 'do you have a cot for the baby', intent: 'children' },
    { text: 'good spot for a family holiday?', intent: 'children' },

    /* ---------------- around the stay ---------------- */
    { text: 'when is the nicest time of year to come', intent: 'weather' },
    { text: 'does it pour during monsoon', intent: 'weather' },
    { text: 'how humid does it get', intent: 'weather' },

    { text: 'anything worth seeing round there', intent: 'activities' },
    { text: 'is there much of a night scene', intent: 'activities' },
    { text: 'what do people do in the area', intent: 'activities' },

    { text: 'can i see more images', intent: 'photos' },
    { text: 'got a gallery anywhere', intent: 'photos' },

    { text: 'give me the owners number', intent: 'contact' },
    { text: 'id rather speak to a real person', intent: 'contact' },
    { text: 'whats the whatsapp', intent: 'contact' },

    { text: 'this looks absolutely stunning', intent: 'compliment' },
    { text: 'what a gorgeous property', intent: 'compliment' },

    { text: 'youre not much use are you', intent: 'complaint' },
    { text: 'this is a waste of time', intent: 'complaint' },

    /* ---------------- confusable pairs ----------------
     * These are the ones that actually cost precision. Each names one
     * topic strongly while brushing against its neighbour. */
    { text: 'is the pool near the beach', intent: 'pool' },
    { text: 'can we walk from the beach to the villa', intent: 'beach' },
    { text: 'what time is check in on arrival day', intent: 'checkin' },
    { text: 'what time must we be out on the last day', intent: 'checkout' },
    { text: 'how much is it per night', intent: 'price' },
    { text: 'how do i actually send the money', intent: 'payment' },
    { text: 'is there a cooker in the kitchen', intent: 'kitchen' },
    { text: 'is dinner provided', intent: 'food' },
    { text: 'how many people does it sleep', intent: 'capacity' },
    { text: 'is it free on those dates', intent: 'availability' },
    { text: 'how far is the airport from the villa', intent: 'airport' },
    { text: 'can you arrange a car from the airport', intent: 'transfer' },

    /* ---------------- should NOT be confident ---------------- */
    { text: 'do you sell helicopters', intent: null },
    { text: 'what is the capital of peru', intent: null },
    { text: 'asdkjh qwlkej', intent: null },
    { text: 'zxcvbnm', intent: null },
    { text: 'my cousin is getting married next year', intent: null },
    { text: 'i once went to portugal', intent: null },
    { text: 'can you write me a poem', intent: null },
    { text: 'what football team do you support', intent: null },
    { text: 'is the stock market open today', intent: null },
    { text: 'tell me a joke', intent: null },
    { text: 'we are planning a trip with some friends', intent: null },
    { text: 'just having a look around', intent: null }
];
