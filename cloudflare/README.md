# Cloudflare deployment

Configuration only. **No copy of the site lives here** — what gets published
is `dist/`, the same directory Netlify publishes, produced by the same
`npm run build`. Two copies of a site are two sites, and the one nobody is
looking at is always the one that is wrong.

Cloudflare is now where this site is published. Netlify served it during the
comparison and still holds the old deployment; nothing there was deleted, it
is simply no longer the target.

---

## The point of this directory

To settle a question with measurements instead of opinion: **does Cloudflare
render this site faster than Netlify?**

I have been advocating Cloudflare on general grounds — unlimited bandwidth,
no cold starts, D1 and Hyperdrive nearby. None of that is evidence about
*this* site, on *these* photographs, from wherever the guests actually are.
Both hosts get byte-identical output, so any difference is delivery and
nothing else.

If Netlify wins or ties, the honest answer is to stay on Netlify — it
already works, and moving would be churn dressed up as progress.

---

## Deploying the test

You have two idle domains on Cloudflare. Use one; the other stays free for
whatever comes next.

```bash
npm run build                 # produces dist/ — do this first, both hosts serve it
npx wrangler login            # opens a browser once
npx wrangler pages deploy ../dist --project-name=ikshaa
```

Then attach a hostname in the Cloudflare dashboard —
**Workers & Pages → ikshaa → Custom domains** — for example:

```
ikshaa.brownodin.com
```

A subdomain of a domain already on Cloudflare needs no DNS work: the
nameservers are theirs, so the record appears immediately.

---

## Measuring it properly

The comparison is only worth having if it is fair. Both URLs serve the same
build, so:

- **Test the same page.** `/` and `/exploreIkshaa.html` — the second is the
  heavy one, 35 photographs.
- **Empty cache, every run.** A warm cache measures your own disk.
- **Several runs, take the median.** One cold request measures whichever
  edge you happened to hit while it was empty.
- **From more than one place.** Both networks are global; a result from one
  city is a result about that city. WebPageTest or PageSpeed Insights can
  run from elsewhere.

What actually matters for this site, in order:

| Metric | Why it matters here |
|---|---|
| **LCP** | The hero photograph. It is what "feels fast" means on a villa site. |
| **TTFB** | Pure delivery — the clearest signal of a difference between hosts. |
| **CLS** | Should be ~0 on both; if not, it is our markup, not the host. |

CLS being equal on both is the control. If it differs, the measurement is
wrong somewhere, because the HTML is identical.

---

## What is deliberately not here yet

**The Worker API.** A Worker cannot reach `localhost:5432`, so the newsletter
API cannot move until Postgres is somewhere public — Neon, Supabase or
Render — with Hyperdrive pointed at it. The commented block in
`wrangler.toml` is the shape it will take.

Until then the split is:

```
Cloudflare Pages    the static site (this test)
localhost           the API, the database, the sender
Netlify             the current live site, untouched
```

**Secrets.** None in this directory, and none in `wrangler.toml`. They go in
with `wrangler secret put NAME`, which stores them on Cloudflare rather than
in the repository.
