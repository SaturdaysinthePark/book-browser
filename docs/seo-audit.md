# BookJumpr — SEO Audit

_Written as part of the pre-launch polish pass. Covers what's fixed in this pass, what's still open, and what's the highest-leverage next investment._

## Site model (why this audit reads the way it does)

BookJumpr is a single-page app: one `index.html` document with client-side hash routing (`#/`, `#/<author>/<title>`, `#/<author>`, `#/search/<q>`, `#/stats`, `#/network`, `#/about`), all rendered by `app.js` from two bundled JS data files. There is no server-side rendering and no per-page HTML — every "page" is the same document with different in-memory state. That one fact drives almost every finding below.

## Fixed in this pass

- **Open Graph + Twitter Card tags** on the homepage `<head>`: title, description, image (1200×630 PNG — since replaced by the fan-out card, see below), url, type, site name. Link-unfurlers (iMessage, Slack, X, Discord) now show a real card instead of nothing.
- **`robots.txt`**: allows crawling, explicitly disallows `/admin.html`, points to the sitemap.
- **`sitemap.xml`**: lists the root URL only (see below for why).
- **`document.title` now updates per route** (home/book/author/search/stats/network/about) — previously every route showed the same static browser-tab title, which was a real bug independent of the OG-tag scope decision.
- **`manifest.json`** + `apple-touch-icon.png` + `theme-color` — completes "add to home screen" support and gives mobile browser chrome a correct background color.

## Why the sitemap only lists one URL

Every book and author page is a `#/...` hash fragment on the same `index.html` document, not a separate crawlable URL. A sitemap's job is to enumerate distinct documents a crawler should fetch — there's only one right now. Listing thousands of fake `bookjumpr.netlify.app/#/author/title` entries would overstate what the site can actually deliver to a crawler that doesn't execute JavaScript, and most crawlers ignore the fragment portion of a URL for sitemap purposes regardless. This is the same root constraint that kept rich link previews homepage-only in this pass.

## Crawlability reality check

- **Googlebot** renders JavaScript via its indexing pipeline and can plausibly index hash-routed content, though with delay and no guarantee every route gets crawled or ranked as a distinct result.
- **Bing, DuckDuckGo, and most AI answer engines** (ChatGPT browsing, Perplexity, Claude) generally do not execute JavaScript when fetching a page. They will only ever see the generic homepage shell's `<head>` and whatever static text sits in the initial HTML (currently: none of the book/author content, since it's all rendered into `#app` by React after data loads).
- **Practical effect**: today, no individual book or author page is meaningfully discoverable through search or AI-answer citation. Only the homepage is.

## The biggest lever left on the table: per-book prerendering

This is deliberately **not** part of this pass (scoped out in favor of homepage-only rich links), but it's the single highest-impact SEO investment available. Concretely: a build step that generates a static HTML snapshot per book/author — each with its own accurate `<title>`, `<meta description>`, and OG tags — served at a real path a non-JS crawler can fetch. This is architecturally realistic later: every book already has a stable `author-slug/title-slug` key (see `P.authorSlug`/`P.slug` in `app.js`), and `tools/build.mjs` already regenerates JS data from `bookjumpr.db` on every build, so a parallel "render N static HTML files" step fits the existing pipeline shape. Recommend treating this as a distinct future initiative, not a launch blocker.

## Structured data (JSON-LD)

Once real per-book pages exist (see above), each should carry `schema.org/Book` structured data — `name`, `author`, `datePublished`, and a `mentions`/`isPartOf` relationship capturing the mention graph. Not worth adding to the single shared homepage today — a generic `Book` schema on a page that isn't about one specific book would be inaccurate, and inaccurate structured data is worse than none.

## Core Web Vitals

The site loads `bookjumpr-data.js` (~910KB) unconditionally on every single page view, plus (before this pass) `constellation-data.js` (~1.2MB) and `constellation-view.js` even though the network graph is only used on `#/network`. This pass lazy-loads the constellation pair so they only fetch on first visit to that route — the single highest-leverage Core Web Vitals fix available without a rebuild. `bookjumpr-data.js` remains eager since nearly every route needs it (search, book pages, author pages, stats). `app.js` (70KB) and `constellation-view.js` (71KB) are both unminified hand-written source with no bundler — a future minification pass would trim this further but wasn't part of this scope.

## Image alt text

Not applicable today — book "covers" are pure CSS/SVG constructions (`P.triCover` in `app.js`), not `<img>` tags. Nothing to caption. If the site ever adds real cover-art images, this becomes a real requirement.

## Internal linking

The mention graph itself (`b.out`/`b.in` on every book) is a strong internal-linking asset — every book page already links to the books it mentions and the books that mention it. This structure is invisible to non-JS crawlers today for the same reason everything else is, but it's exactly the kind of topical link density that helps once real per-book pages exist.

## Analytics / Search Console

GA4 is on the site (`G-8G7W4RXNKE` in `index.html`). Search Console and Bing Webmaster aren't verified yet. The
simplest route needs no code: add the domain in Search Console and verify it with the DNS TXT record it gives you
(this covers every URL on bookjumpr.com), then submit `https://bookjumpr.com/sitemap.xml`. Bing Webmaster can
import the site straight from Search Console. If you'd rather verify by meta tag, the
`google-site-verification` / `msvalidate.01` tags go in `index.html`'s `<head>`.

## Domain note

All canonical/OG/sitemap/robots URLs point at `https://bookjumpr.com/` (the custom domain is live).

## Priority summary

| Priority | Item | Status |
|---|---|---|
| Done | OG/Twitter tags + preview image | Shipped this pass |
| Done | robots.txt / sitemap.xml | Shipped this pass |
| Done | Per-route document.title | Shipped this pass |
| Done | manifest.json / apple-touch-icon / theme-color | Shipped this pass |
| Done | Lazy-load constellation data (CWV) | Shipped this pass |
| Medium | Analytics + Search Console verification | Your call, not blocking |
| Medium | JSON-LD Book schema | Depends on prerendering existing first |
| Large / deferred | Per-book prerendering (SSG) | Biggest lever, future initiative |
| Large / deferred | Minify/bundle app.js + constellation-view.js | Nice to have, not urgent |

## Quick-wins pass (no new pages; the app unchanged)

- **Text for crawlers that don't run JavaScript** (Bing, most AI answer engines): `index.html` now carries a short
  block inside `<div id="app">` — what BookJumpr is, five real connections with their quotes, and the 30
  most-mentioned books. It's generated from the data by `tools/build-seo.mjs` (run by `npm run bj:build`; `--check`
  fails if it's stale). A class set before first paint hides it, and the app replaces `#app` when it renders, so
  visitors never see it.
- **`llms.txt`**: the same summary as plain text for AI crawlers, generated by the same script.
- **JSON-LD**: `WebSite` + `Organization` on the homepage (accurate for a homepage; no per-book `Book` schema
  without per-book pages).
- **Manifest icons**: `icon-192.png` and `icon-512.png` (maskable) for Android and Lighthouse.
- **Headers** (`netlify.toml`): `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` on every
  response; images cached for a day. Everything else keeps Netlify's revalidate-on-every-visit default, so a
  deploy shows up at once.
- **Share image**: the fan-out card (`social-preview.png?v=2`), made by `tools/render-social-preview.mjs`.

Still the biggest lever: real URLs for the app's book and author pages (`/author/book` instead of `#/author/book`)
with a saved copy of each page's text, so search engines can index every book. That's a routing change to the app
itself, deliberately not part of this pass.

## Search terms, AI answers and freshness

- **Title**: "BookJumpr: Books Mentioned Inside Other Books" (`<title>`, `og:title`, `twitter:title`, and the app's
  home-route tab title). It uses the phrases people search for; the tagline stays as the on-page headline.
- **`llms.txt`** now has a "Last updated" date and question-and-answer pairs drawn from the data (the most-mentioned
  books, which books mention them, and what a few well-known books mention).
- **`llms-full.txt`**: every book that mentions another, with what it mentions and the note/quote. One text file,
  about 1MB, so AI tools can answer "what books are mentioned in X" from BookJumpr's data.
- **Freshness**: the crawler block shows "Updated <date> · N books · N mentions", and `sitemap.xml` carries
  `<lastmod>`. The date is the newest book or mention timestamp in `bookjumpr.db`, so it moves only when the data
  does.
- All four outputs (the index.html block, `llms.txt`, `llms-full.txt`, `sitemap.xml`) come from
  `tools/build-seo.mjs`, which `npm run bj:build` runs.

## Real URLs and per-page heads

Book and author pages now have real URLs (`/haruki-murakami/norwegian-wood` instead of `#/haruki-murakami/norwegian-wood`),
so search engines can index each one. Nothing about how the app looks or navigates changed.

- **Routing** (`app.js`, `explorer.js`): the router reads the path; navigation uses `history.pushState`; back/forward
  use `popstate`. Old `#/…` links (already shared) are rewritten to their path on load. Query switches (`?v=classic`,
  `?net=v2`, `?home=a`) are kept across navigation.
- **Links**: book cards, author links, author-page books, search results and stats rows are real `<a href>` links
  (crawlers follow them; ⌘/Ctrl-click opens a new tab). Screenshots of every page type, desktop and mobile, are
  pixel-identical to before.
- **Netlify**: `netlify.toml` rewrites every non-file path to `index.html`. The edge function
  `netlify/edge-functions/seo.js` rewrites each page's `<title>`, description, canonical, Open Graph/Twitter tags, adds
  JSON-LD (`Book` with its `mentions`, `Person`, `BreadcrumbList`) and fills the hidden crawler block with that page's
  text and links. Unknown books/authors return 404 + noindex; search and `/network/<book>` pages are noindex;
  `/book/<key>` 301s to `/<key>`. If the function errors, Netlify serves the plain page (`onError: 'bypass'`).
- **Sitemap**: now lists ~3,100 pages (books with a synopsis, a mention, or two books mentioning them, plus their
  authors), each with its own `<lastmod>`.

### How to test

- Locally: `npm run serve`, then `node tools/check-seo.mjs` (server output: statuses, titles, canonicals, JSON-LD,
  crawler text — no browser needed) and `node tools/test-site.mjs` (clicks through the app in Chromium).
- On a Netlify deploy preview or the live site: `node tools/check-seo.mjs https://<preview-url>`.
- After it's live: in Search Console, URL-inspect `https://bookjumpr.com/haruki-murakami/norwegian-wood` and resubmit
  the sitemap; paste a book link into iMessage/Slack to see its own preview title.
