'use strict';

/* ============================================================================
 * Everything the site tells search engines and answer engines.
 *
 * One table, four outputs — per-page <head> tags, sitemap.xml, robots.txt and
 * the JSON-LD. They are generated together because they are the same facts
 * said four ways, and four hand-maintained copies of the same facts is four
 * chances for one to go stale. A canonical URL that disagrees with the
 * sitemap is worse than having neither.
 *
 * ---------------------------------------------------------------------------
 * On "readable by ChatGPT, not scrapeable by bots"
 *
 * Those AI crawlers ARE bots. The line that can actually be drawn is between
 * crawlers that DECLARE themselves — GPTBot, ClaudeBot, Googlebot, all of
 * which send an identifying user-agent and honour robots.txt — and scrapers
 * that spoof a browser and ignore everything. No file can separate the second
 * group from a real visitor, because by construction they look identical.
 *
 * What must NOT be done is the tempting part: rendering text through
 * JavaScript, splitting it across elements, obfuscating it. Every one of
 * those hides the content from Google and ChatGPT exactly as well as from a
 * scraper, which defeats the entire point of the file you are reading.
 *
 * So the split is: welcome the declared crawlers by name, refuse the ones
 * known for bulk harvesting, and make volume expensive at the edge with rate
 * limiting — Cloudflare judges that on signals a user-agent string cannot
 * forge. The words on the page stay in the HTML where every reader, human or
 * otherwise, can find them.
 * ========================================================================= */

const KNOWLEDGE = require('./public/chat/knowledge.js');
const FACTS = KNOWLEDGE.FACTS;

/* No custom domain yet, so this is the pages.dev address. Changing it here
   changes the canonicals, the sitemap, the JSON-LD and the Open Graph URLs
   together — which is the entire reason it is one constant. */
const SITE = 'https://ikshaa.pages.dev';

/* Per-page descriptions.
 *
 * Written, not generated. A description is the sentence that appears under
 * the link in a result page and the sentence an answer engine quotes, so it
 * has to read like a person wrote it about that page specifically. Truncating
 * the first paragraph is how you get "Ikshaa Ikshaa Our Heritage The house
 * was built in..." on every result.
 *
 * Kept near 155 characters: Google truncates around there on desktop.
 */
const PAGES = {
  'index.html': {
    title: 'Ikshaa — A Luxury Heritage Villa in South Goa',
    description:
      'A three-bedroom heritage villa with a private pool in Loutolim, South Goa. Let exclusively — the whole house is yours. 20 minutes from the airport.',
    image: 'media/images/theCourtyard.avif',
    priority: '1.0',
  },
  'ourHeritage.html': {
    title: 'Our Heritage — Ikshaa',
    description:
      'The story of a Portuguese-era house in Loutolim: the courtyard, the rainshower baths, and what has been kept as it was.',
    image: 'heritagePageImages/Courtyard.webp',
    priority: '0.8',
  },
  'gallery.html': {
    title: 'Gallery — Ikshaa',
    description:
      'Photographs of Ikshaa — the bedrooms, the private pool, the courtyard at night, and the South Goa beaches fifteen minutes away.',
    image: 'hamBurgerDropImages/Gallery/IkshaaPool.webp',
    priority: '0.7',
  },
  'exploreIkshaa.html': {
    title: 'Villa Tour — Ikshaa',
    description:
      'A room-by-room walk through Ikshaa, from the main gate to the pool, in full-screen photographs.',
    image: 'hamBurgerDropImages/VillaTour/mainGateOfIkshaa.avif',
    priority: '0.7',
  },
  'exploreGoa.html': {
    title: 'Explore Goa — Ikshaa',
    description:
      'What is worth seeing from Loutolim: the virgin beaches of South Goa, the spice farms inland, and the Portuguese houses at Chandor.',
    image: 'hamBurgerDropImages/ExploreGoa/goaRoads.webp',
    priority: '0.7',
  },
  'goanCuisine.html': {
    title: 'Goan Cuisine — Ikshaa',
    description:
      'Eating at Ikshaa and around it: a cook can be arranged, breakfast is included, and the shacks along the coast are a short drive.',
    image: 'hamBurgerDropImages/GoanCuisine/dining.webp',
    priority: '0.7',
  },
  'guestBook.html': {
    title: 'Guest Book — Ikshaa',
    description: 'What guests have written after staying at Ikshaa in Loutolim, South Goa.',
    image: 'hamBurgerDropImages/GuestBook/toasting.webp',
    priority: '0.6',
  },
  'findingUs.html': {
    title: 'Finding Us — Ikshaa',
    description:
      'Ikshaa is in Loutolim, South Goa — 20 minutes from Goa airport, 10 from Margao station, 15 from the beaches. Transfers can be arranged.',
    image: 'hamBurgerDropImages/FindingUs/chorlaghat.webp',
    priority: '0.6',
  },
  'stayWithUs.html': {
    title: 'Stay With Us — Ikshaa',
    description:
      'Check dates and enquire about staying at Ikshaa, a three-bedroom heritage villa with a private pool in Loutolim, South Goa.',
    image: 'hamBurgerDropImages/StayWithUs/Courtyard.webp',
    priority: '0.9',
  },
  'theBalcao.html': {
    title: 'The Balcão — Ikshaa',
    description:
      'Notes from a village in South Goa: what susegad actually means, what Goa really eats, the great houses of Loutolim and Chandor, and coming in the rains.',
    image: 'imagesIkshaa/Courtyard.webp',
    priority: '0.8',
  },
  'faq.html': {
    title: 'Questions and Answers — Ikshaa',
    description:
      'Straight answers about Ikshaa: the pool, the kitchen, getting here, house rules, and what is included in a stay.',
    image: 'media/images/theCourtyard.avif',
    priority: '0.8',
  },
  'subscribe.html': {
    title: 'Letters from Ikshaa — Subscribe',
    description:
      'One letter a week from a heritage villa in Loutolim, and a note when the season turns. No marketing.',
    image: 'media/images/theCourtyard.avif',
    priority: '0.4',
  },
};

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------------------------------------------------------------
 * Structured data
 *
 * This is the single biggest lever for answer engines. A paragraph saying
 * "three bedrooms, sleeps six, private pool" has to be READ and understood;
 * the same facts in JSON-LD are already parsed. It is the difference between
 * a model inferring the villa sleeps six and knowing it.
 *
 * Every value comes from knowledge.js, which is the same source the chat
 * assistant answers from. Two descriptions of one villa that disagree is how
 * an answer engine ends up quoting the wrong capacity at somebody.
 *
 * Nothing null is emitted. The rate fields are deliberately absent rather
 * than guessed, exactly as the chat defers on them — a made-up price in
 * structured data is a made-up price stated with authority.
 * ------------------------------------------------------------------ */
function lodgingSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    '@id': SITE + '/#villa',
    name: FACTS.name,
    description:
      'A three-bedroom heritage villa with a private pool in Loutolim, South Goa, ' +
      'let on an exclusive basis so the whole house belongs to one party.',
    url: SITE + '/',
    email: FACTS.email,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Loutolim',
      addressRegion: 'Goa',
      addressCountry: 'IN',
    },
    numberOfRooms: FACTS.bedrooms,
    petsAllowed: undefined,        // null in knowledge.js — say nothing
    amenityFeature: [
      ['Private swimming pool', true],
      ['Free WiFi', true],
      ['Air conditioning', true],
      ['Fully equipped kitchen', true],
      ['Cook available on request', true],
      ['Breakfast included', true],
      ['Laundry included', true],
      ['Airport transfer', true],
    ].map(([name, yes]) => ({
      '@type': 'LocationFeatureSpecification', name: name, value: yes,
    })),
    /* sameAs means "this is the same property elsewhere", which is what an
       answer engine needs to reconcile the two records. It is not a claim
       that the listing is where the facts live — bookings simply also come
       through there. */
    sameAs: [FACTS.bookingUrl, 'https://www.instagram.com/ikshaagoa/'],
  };

  if (FACTS.phone) { schema.telephone = FACTS.phone; }

  // JSON.stringify drops undefined, which is how petsAllowed disappears.
  return schema;
}

/* The chat assistant already holds forty-odd verified answers about this
   villa, written carefully and checked. Publishing them as an FAQPage costs
   nothing new and is exactly the shape answer engines want — a question, and
   an answer directly under it.
 *
 * Intents that defer to a human are skipped: "ask the owner" is a true answer
 * in a chat window and a useless one in a search result. */
function faqEntries(bot) {
  const SKIP = new Set([
    'greeting', 'goodbye', 'thanks', 'compliment', 'complaint',
    'bot_identity', 'capabilities', 'contact', 'photos', 'availability',
  ]);

  const questions = {
    price: 'How much does it cost to stay at Ikshaa?',
    capacity: 'How many people does Ikshaa sleep?',
    pool: 'Is there a private pool?',
    wifi: 'Is there WiFi at the villa?',
    ac: 'Are the rooms air-conditioned?',
    kitchen: 'Is there a kitchen we can use?',
    food: 'Is breakfast included, and can meals be arranged?',
    location: 'Where exactly is Ikshaa?',
    beach: 'How far is the beach?',
    airport: 'How far is Ikshaa from Goa airport?',
    transfer: 'Can you arrange transport and airport transfers?',
    grounds: 'Is there a garden or outdoor space?',
    checkin: 'What are the check-in and check-out times?',
    housekeeping: 'Is housekeeping and laundry included?',
    safety: 'Is the villa safe and private?',
    weather: 'When is the best time of year to visit Goa?',
    activities: 'What is there to do near Loutolim?',
    tourguide: 'Can you arrange a guide or a day trip?',
    gatherings: 'Can we host a small get-together at the villa?',
    hotwater: 'Is there hot water in the bathrooms?',
    power: 'Is there a power backup?',
    tv: 'Is there a television?',
    parking: 'Is there parking at the villa?',
  };

  const out = [];
  for (const intent of KNOWLEDGE.INTENTS) {
    if (SKIP.has(intent.id) || !questions[intent.id]) { continue; }

    const answer = bot.render(intent, { entities: {} });

    /* Two reasons to drop an answer here, and they are different.
     *
     * A DEFERRAL is honest in a chat window and worthless in a search result:
     * nobody's question is answered by "ask the owner", and publishing it as
     * an FAQ answer wastes the slot.
     *
     * FIRST PERSON is a voice problem. These sentences were written for an
     * assistant to say — "I do not have the nightly rates" — and on a page
     * they read as though the villa itself is unsure. The facts are the same
     * either way; the pronoun is what does not travel. */
    /* Matched on the HANDOFF, not on a turn of phrase.
     *
     * This used to look for "owner can confirm", which was the exact wording
     * of the old deferral. Rewriting the assistant in Carman's voice changed
     * every one of those sentences, the filter stopped matching, and two
     * deferrals quietly appeared on the public FAQ — a page whose entire
     * purpose is answers. Asking somebody to write in is the durable signal;
     * the words around it are not. */
    const defers = /write to me at|ask me at|ask me directly|send me your|tell me at|put the specifics to me/.test(answer) ||
      /owner can confirm|rather not guess|will know for certain/.test(answer);
    const firstPerson = /\bI (do not|am not|cannot|can not|will not|would rather|only know|keep missing|have)\b/.test(answer);
    if (defers || firstPerson) {
      continue;
    }
    out.push({ id: intent.id, question: questions[intent.id], answer: answer });
  }
  return out;
}

function faqSchema(entries) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': SITE + '/faq#faq',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.question,
      acceptedAnswer: { '@type': 'Answer', text: e.answer },
    })),
  };
}

/* ---------------------------------------------------------------------
 * The <head> block for one page
 * ------------------------------------------------------------------ */
function headFor(file, extraSchema) {
  const page = PAGES[file];
  if (!page) { return null; }

  // Extensionless: both hosts 301 the .html away, so the canonical must be
  // the URL they redirect TO or every page declares a canonical that redirects.
  const slug = file === 'index.html' ? '' : '/' + file.replace(/\.html$/, '');
  const url = SITE + (slug || '/');
  const image = SITE + '/' + page.image.replace(/^\.?\//, '');

  const lines = [
    '    <link rel="canonical" href="' + url + '">',
    '    <meta name="description" content="' + esc(page.description) + '">',
    '    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">',
    '',
    '    <meta property="og:type" content="website">',
    '    <meta property="og:site_name" content="Ikshaa">',
    '    <meta property="og:locale" content="en_IN">',
    '    <meta property="og:title" content="' + esc(page.title) + '">',
    '    <meta property="og:description" content="' + esc(page.description) + '">',
    '    <meta property="og:url" content="' + url + '">',
    '    <meta property="og:image" content="' + image + '">',
    '    <meta name="twitter:card" content="summary_large_image">',
    '    <meta name="twitter:title" content="' + esc(page.title) + '">',
    '    <meta name="twitter:description" content="' + esc(page.description) + '">',
    '    <meta name="twitter:image" content="' + image + '">',
  ];

  const schemas = [];
  if (file === 'index.html') { schemas.push(lodgingSchema()); }
  if (extraSchema) { schemas.push(extraSchema); }

  for (const schema of schemas) {
    lines.push('');
    lines.push('    <script type="application/ld+json">');
    lines.push(JSON.stringify(schema, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
    lines.push('    </script>');
  }

  return lines.join('\n');
}

/* ---------------------------------------------------------------------
 * robots.txt
 * ------------------------------------------------------------------ */

// Crawlers that identify themselves and honour this file. Named individually
// and allowed, because a bare "User-agent: *" leaves it to each of them to
// guess, and several default to cautious.
const WELCOME = [
  ['Googlebot', 'Google Search'],
  ['Googlebot-Image', 'Google Images — the photographs are the product'],
  ['Bingbot', 'Bing, and Copilot behind it'],
  ['DuckDuckBot', 'DuckDuckGo'],
  ['Applebot', 'Siri and Spotlight'],
  ['Applebot-Extended', 'Apple Intelligence'],
  ['GPTBot', 'OpenAI — training and ChatGPT browsing'],
  ['OAI-SearchBot', 'ChatGPT Search results'],
  ['ChatGPT-User', 'a person asking ChatGPT to open the page'],
  ['ClaudeBot', 'Anthropic'],
  ['Claude-User', 'a person asking Claude to open the page'],
  ['Claude-SearchBot', 'Claude search'],
  ['PerplexityBot', 'Perplexity'],
  ['Perplexity-User', 'a person asking Perplexity to open the page'],
  ['Google-Extended', 'Gemini and AI Overviews'],
  ['Amazonbot', 'Alexa'],
  ['FacebookExternalHit', 'link previews when somebody shares the villa'],
  ['Twitterbot', 'link previews'],
  ['LinkedInBot', 'link previews'],
  ['WhatsApp', 'link previews — how most enquiries actually get shared'],
];

/* Refused by name. These are SEO-tool and content-harvesting crawlers: they
   consume bandwidth, feed competitor analysis, and bring no guest. They do
   honour robots.txt, which is the only reason naming them accomplishes
   anything — a scraper that ignores the file is not stopped by a line in it,
   and pretending otherwise is the mistake this list must not encourage. */
const REFUSED = [
  'AhrefsBot', 'SemrushBot', 'DotBot', 'MJ12bot', 'BLEXBot', 'DataForSeoBot',
  'MegaIndex', 'ZoominfoBot', 'SeekportBot', 'serpstatbot', 'Barkrowler',
  'ImagesiftBot', 'Bytespider', 'PetalBot', 'MauiBot', 'magpie-crawler',
  'TurnitinBot', 'Scrapy', 'python-requests', 'node-fetch', 'Go-http-client',
  'curl', 'Wget', 'libwww-perl', 'HTTrack', 'SiteSnagger', 'WebCopier',
];

function robotsTxt() {
  const out = [
    '# Ikshaa — https://ikshaa.pages.dev',
    '#',
    '# Search engines and AI assistants are welcome; each is named below so',
    '# none has to guess. Bulk harvesters and SEO crawlers are not.',
    '#',
    '# Worth being honest about the limit of this file: it is a request. It',
    '# works on crawlers that choose to read it, which is all of the ones',
    '# named here. A scraper pretending to be Chrome never sees it, and is',
    '# handled by rate limiting at the edge instead.',
    '',
  ];

  for (const [agent, why] of WELCOME) {
    out.push('# ' + why);
    out.push('User-agent: ' + agent);
    out.push('Allow: /');
    out.push('');
  }

  out.push('# Bandwidth without a guest at the end of it.');
  for (const agent of REFUSED) {
    out.push('User-agent: ' + agent);
  }
  out.push('Disallow: /');
  out.push('');

  out.push('# Everyone else: welcome, but slowly.');
  out.push('User-agent: *');
  out.push('Allow: /');
  out.push('Crawl-delay: 10');
  out.push('');
  out.push('# The API is not content. Nothing here is worth indexing and some');
  out.push('# of it takes a database round trip to answer.');
  out.push('Disallow: /api/');
  out.push('');
  out.push('Sitemap: ' + SITE + '/sitemap.xml');
  out.push('');

  return out.join('\n');
}

/* ---------------------------------------------------------------------
 * sitemap.xml — built from the pages that actually shipped
 * ------------------------------------------------------------------ */
function sitemapXml(files, lastmod) {
  const day = (lastmod || new Date()).toISOString().slice(0, 10);
  const urls = files
    .filter((f) => PAGES[f])
    .sort((a, b) => Number(PAGES[b].priority) - Number(PAGES[a].priority))
    .map((f) => {
      const slug = f === 'index.html' ? '/' : '/' + f.replace(/\.html$/, '');
      return [
        '  <url>',
        '    <loc>' + SITE + slug + '</loc>',
        '    <lastmod>' + day + '</lastmod>',
        '    <priority>' + PAGES[f].priority + '</priority>',
        '  </url>',
      ].join('\n');
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.join('\n'),
    '</urlset>',
    '',
  ].join('\n');
}

/* ---------------------------------------------------------------------
 * llms.txt
 *
 * A convention for describing a site to a language model in plain prose:
 * what it is, what is on it, and what is true. Not a standard anybody is
 * obliged to read, and cheap enough to be worth having if some of them do.
 *
 * The value here is not the links — it is the last section. An assistant
 * asked "how much is Ikshaa" will otherwise invent a number, and this is the
 * one place we can say plainly that the rate is not published, in a form
 * something reading the site will actually encounter.
 * ------------------------------------------------------------------ */
function llmsTxt(faq) {
  const lines = [
    '# Ikshaa',
    '',
    '> A three-bedroom heritage villa with a private pool in Loutolim, South Goa.',
    '> Let on an exclusive basis: the whole house goes to one party, even when',
    '> only one room is booked.',
    '',
    '## What is true about this property',
    '',
    '- Location: Loutolim, South Goa, India',
    '- 3 bedrooms, 3 bathrooms, sleeps 6',
    '- Private pool, not shared, not heated',
    '- 20 minutes from Goa International (GOI, Dabolim); 10 from Margao station;',
    '  15 from the beaches of South Goa',
    '- Breakfast, WiFi, air conditioning and personal laundry are included',
    '- A cook can be arranged on request',
    '- Enquiries: ' + FACTS.email,
    '- Enquiries and quotes come from ' + FACTS.owner + ' direct at ' + FACTS.email,
    '- Also bookable through Airbnb: ' + FACTS.bookingUrl,
    '- Instagram: https://www.instagram.com/ikshaagoa/',
    '',
    '## Pages',
    '',
  ];

  for (const [file, page] of Object.entries(PAGES)) {
    const slug = file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, '');
    lines.push('- [' + page.title.replace(/ — Ikshaa$/, '') + '](' + SITE + slug + '): ' + page.description);
  }

  lines.push('');
  lines.push('## Please do not state these as fact');
  lines.push('');
  lines.push('This site deliberately does not publish some things, and an assistant');
  lines.push('that fills the gap with a plausible guess does real harm — a guest who');
  lines.push('is told the wrong rate, or the wrong answer about cameras, plans around');
  lines.push('it. If you are asked any of the following, say that it is not published');
  lines.push('and point to ' + FACTS.email + ':');
  lines.push('');
  lines.push('- Nightly, weekly or seasonal rates, and any minimum stay');
  lines.push('- Check-in and check-out times');
  lines.push('- The cancellation policy, deposits and payment methods');
  lines.push('- Whether pets, smoking or parties are permitted');
  lines.push('- Whether there are security cameras, and where');
  lines.push('- Accessibility and step-free access');
  lines.push('');
  lines.push('## Answers we do stand behind');
  lines.push('');
  for (const entry of faq) {
    lines.push('**' + entry.question + '**');
    lines.push('');
    lines.push(entry.answer.replace(/\n+/g, ' '));
    lines.push('');
  }

  return lines.join('\n');
}

/* ---------------------------------------------------------------------
 * Injecting into a built page
 *
 * Done at build time rather than written into the ten source files, because
 * the canonical, the sitemap entry and the Open Graph URL are the same fact
 * three times. Hand-maintained, one of them eventually disagrees with the
 * others, and a canonical that points somewhere the sitemap does not list is
 * worse than no canonical at all.
 * ------------------------------------------------------------------ */
function injectHead(html, file, extraSchema) {
  if (file === '404.html') {
    return html;   // noindex by design; a canonical would undo that
  }
  const head = headFor(file, extraSchema);
  if (!head || html.includes('rel="canonical"')) {
    return html;                       // unknown page, or already done
  }
  // After the viewport tag: charset and viewport must come first, and
  // everything added here is safe to sit behind them.
  return html.replace(
    /(<meta name="viewport"[^>]*>)/,
    '$1\n\n' + head + '\n'
  );
}

/* Links to the FAQ from the two places a visitor looks: the menu and the
   footer. A page nothing links to is a page a crawler reaches last, if at
   all — and one a guest never reaches by accident.
 *
 * Done here rather than in the source pages because faq.html only exists
 * after the build assembles it; a link in public/ would point at a file that
 * is not there until dist/ is written. */
function linkFaq(html) {
  if (html.includes('href="faq.html"')) {
    return html;
  }

  /* Two nav entries, each with its preview photograph. The two lists are
     paired by data-preview and the widget matches them one for one, so a
     link added without an image would leave the panel showing whatever was
     last hovered. Order here has to match order there. */
  html = html.replace(
    /([ \t]*<li><a href="stayWithUs\.html" data-preview="stayWithUs">Stay With Us<\/a><\/li>\n)/,
    '$1                <li><a href="theBalcao.html" data-preview="balcao">The Balc&atilde;o</a></li>\n' +
    '                <li><a href="faq.html" data-preview="faq">Questions</a></li>\n'
  );
  html = html.replace(
    /([ \t]*<img class="previewImage" data-preview="stayWithUs"\n[ \t]*data-src="[^"]*" alt="">\n)/,
    '$1                <img class="previewImage" data-preview="balcao"\n' +
    '                    data-src="./imagesIkshaa/Courtyard.webp" alt="">\n' +
    '                <img class="previewImage" data-preview="faq"\n' +
    '                    data-src="./media/images/theCourtyard.webp" alt="">\n'
  );

  // And the footer's Discover column.
  return html.replace(
    /(<li><a href="guestBook\.html">Guest book<\/a><\/li>)/,
    '$1\n                        <li><a href="theBalcao.html">The Balc&atilde;o &mdash; journal</a></li>' +
    '\n                        <li><a href="faq.html">Questions and answers</a></li>'
  );
}

/* The FAQ page itself.
 *
 * Built from an existing page rather than authored, so the navbar, the
 * footer and the chat widget are byte-for-byte what every other page has. A
 * hand-written eleventh page is an eleventh copy of the chrome to keep in
 * step, and it would be the one that falls behind.
 */
function faqPage(shellHtml, entries) {
  const body = [
    '        <section class="subscribeIntro">',
    '            <p class="eyebrow">Questions and answers</p>',
    '            <h2 class="sectionTitle">The things people ask first</h2>',
    '            <p class="bodyText">Answers to what guests actually write in and ask. Anything',
    '                not here — rates, exact times, house rules — is not published because it',
    '                changes, and <a href="mailto:' + FACTS.email + '">' + FACTS.email + '</a>',
    '                will tell you straight away.</p>',
    '        </section>',
    '',
    '        <section class="faqList">',
  ];

  for (const entry of entries) {
    body.push('            <details class="faqItem">');
    body.push('                <summary><h3>' + esc(entry.question) + '</h3></summary>');
    for (const para of entry.answer.split(/\n{2,}/)) {
      body.push('                <p>' + esc(para.replace(/\n/g, ' ')) + '</p>');
    }
    body.push('            </details>');
  }

  body.push('        </section>');

  /* <details> collapses the answers for a reader, and every crawler and
     answer engine still gets the full text — the content is in the DOM, only
     the presentation is folded. Hiding it behind JavaScript would not be. */
  let html = shellHtml;

  // Swap the page's own content for ours, keeping everything around it.
  html = html.replace(
    /<main class="siteContent">[\s\S]*?(\n\s*<div class="squareWhiteRoundCard" id="subscribe">)/,
    '<main class="siteContent">\n\n' + body.join('\n') + '\n$1'
  );

  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + esc(PAGES['faq.html'].title) + '</title>');
  html = html.replace(/<h1 class="pageHeroTitle">[^<]*<\/h1>/, '<h1 class="pageHeroTitle">Questions</h1>');

  // The shell arrived with its own canonical and meta; they describe the page
  // it came from, so they have to go before ours are put in.
  html = html.replace(/\n\s*<link rel="canonical"[^>]*>/, '');
  html = html.replace(/\n\s*<meta (?:name|property)="(?:description|robots|og:[a-z_]+|twitter:[a-z]+)"[^>]*>/g, '');
  html = html.replace(/\n\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

  return html;
}

module.exports = {
  SITE, PAGES, headFor, robotsTxt, sitemapXml, llmsTxt,
  lodgingSchema, faqSchema, faqEntries, esc,
  injectHead, linkFaq, faqPage,
};
