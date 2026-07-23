# BookJumpr — SEO Audit

_Written as part of the pre-launch polish pass. Covers what's fixed in this pass, what's still open, and what's the highest-leverage next investment._

## Site model (why this audit reads the way it does)

BookJumpr is a single-page app: one `index.html` document with client-side hash routing (`#/`, `#/<author>/<title>`, `#/<author>`, `#/search/<q>`, `#/stats`, `#/network`, `#/about`), all rendered by `app.js` from two bundled JS data files. There is no server-side rendering and no per-page HTML — every "page" is the same document with different in-memory state. That one fact drives almost every finding below.

## Fixed in this pass

- **Open Graph + Twitter Card tags** on the homepage `<head>`: title, description, image (1200×630 branded PNG), url, type, site name. Link-unfurlers (iMessage, Slack, X, Discord) now show a real card instead of nothing.
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

No analytics snippet and no Search Console (or Bing Webmaster) verification meta tag exist anywhere in the repo. This is a deliberate pre-launch decision left to you — not auto-added, since the right choice (privacy-respecting analytics vs. full GA4, whether to verify Search Console before or after the custom domain is finalized) depends on decisions outside this audit's scope.

## Domain note

All canonical/OG/sitemap/robots URLs in this pass point at `bookjumpr.netlify.app` (confirmed as the current production URL — no custom domain is connected yet). If a custom domain gets connected before launch, every URL added in this pass needs a follow-up update.

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
