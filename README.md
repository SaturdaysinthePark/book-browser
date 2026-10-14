# BookJumpr

**Every book is a door to more books.** BookJumpr maps the books mentioned *inside*
other books — when a character reads one, quotes one, or name-drops one — and turns
those moments into a network you can wander.

This is a standalone, dependency-free implementation of the **BookJumpr v2** design.

## Run it

It's a static site plus one small Netlify edge function (per-page titles and crawler text).

```bash
npm run serve          # http://localhost:8917/ — serves like Netlify: every path loads the app, with its page's head
node tools/check-seo.mjs [baseURL]   # what search engines get, no browser needed
node tools/test-site.mjs [baseURL]   # clicks through the app in Chromium (needs Playwright)
npm run bj:og        # renders each book's share card into og/ (then npm run bj:build)
```

A plain static server (`python3 -m http.server`) only works for the homepage now: book and author pages are real
paths (`/haruki-murakami/norwegian-wood`) that need the "every path → index.html" fallback `tools/serve.mjs` and
Netlify provide.

## What's here

| File | Purpose |
| --- | --- |
| `index.html` | Page shell + global styles + the original template markup (embedded as `<script id="bj-template">`) |
| `app.js` | The application: a small template compiler + the ported component logic + React mount |
| `explorer.js` | The network **Explorer** (`?net=v2`): fan-to-fan navigation built on the book page's neighbourhood — lazy-loaded |
| `network-regions.js` | "Reading neighbourhoods" for the Explorer's entry — **generated** by `npm run bj:regions` (Louvain) |
| `layouts-data.js` | Point layouts for the network page (the starfield, Influence, Petals) — **generated** by `npm run bj:layouts` |
| `atlas.js` | Canvas star-map renderer: the **Atlas** (`?net=v3`) and the Explorer+ mini-map / full view — lazy-loaded |
| `atlas-data.js` | Atlas layout (books grouped by Louvain community) — **generated** by `npm run bj:atlas` |
| `stars-data.js` | Genre-continent layout (Explorer+, and the starting arrangement for the network starfield) — **generated** by `npm run bj:stars` |
| `home.js` | The interactive home-wall engine (endless shelf / infinite canvas / shelf rows) — imperative, transforms only |
| `bookjumpr-data.js` | The dataset the site loads — **generated** from the database by `npm run bj:build` (don't hand-edit) |
| `bookjumpr-notes.js` | Mention quotes/context, lazy-loaded on book pages — **generated** by `npm run bj:build` |
| `bookjumpr.db` | SQLite database — the **source of truth** for books & mentions |
| `tools/` | The data pipeline (CLI, build, validation, admin server) |
| `admin.html` | Local point-and-click admin UI (served by `npm run admin`) |
| `data/` | Human-readable CSV mirror of the database (refreshed on every build) |
| `inbox/` | Drop-zone for JSON import batches (`batch.example.json` is a template) |
| `docs/DATA-PIPELINE.md` | **Full guide** to adding/managing books & references |
| `favicon.svg` | Tab icon (the arc-and-book motif) |
| `vendor/` | React 18.3.1 + ReactDOM 18.3.1 (UMD), vendored so the site is fully offline / CDN-free |
| `_design/` | The original Claude Design source files, kept for reference |

## Screens

- **Home** — an endless, scrollable wall of covers on doodled graph paper behind the hero + search
  (`?home=b` 2D canvas, pan any direction — the default · `?home=a` endless shelf · `?home=c` shelf rows · `?home=classic` the static wall;
  `?wall=dark` for the charcoal wall). See `docs/ui-ux-overhaul.md`.
- **Book** — the book in the middle of its fan (books that mention it flow in, books it mentions flow
  out), a side panel (mini-map, cover, author, synopsis), and every mention as quote cards ("Mentions" /
  "Mentioned by"; tabs and swipeable cover shelves on phones). "Zoom out" morphs the fan into the network.
- **Search** — ranked results (with an as-you-type suggestion dropdown); ⌘F / Ctrl+F jumps to the search box
- **Stats** — the 30 most name-dropped books and the 30 most name-dropped authors
- **Network** — every book as a star on one even starfield whose edges join, so it pans forever; genres are
  territories, one-off mentions are faint dust, stars lean toward the mouse. Select a star for its in/out links,
  "Open →" morphs it back into its book page. **Influence** (switch, top right) is a binned chart — x = books it
  mentions, y = books that mention it — and the stars travel between the two views.
- **Query flags:** `?v=classic` — the classic book page and constellation network; `?net=petals` — adds the
  Petals layout to the network switcher; `?net=v2` / `v3` / `v4` / `map` — the earlier network comparisons
  (Explorer, Atlas, Explorer+, classic constellation).
- **About** — how the dataset works

Routing uses real paths, author-first: a book lives at `/<author>/<title>` (e.g.
`/fyodor-dostoevsky/crime-and-punishment`) and an author's page at `/<author>`; plus
`/search/<q>`, `/stats`, `/network`, `/about`. Deep links and the back button work, and old `#/…` links are
rewritten to their path on load. `netlify.toml` sends every path to `index.html`; the edge function
`netlify/edge-functions/seo.js` (rendering via `netlify/seo/render.js`, data from `netlify/seo/data.js`, built by
`tools/build-seo.mjs`) gives each page its own title, description, canonical URL, JSON-LD and crawler text, and a
404 for books or authors that don't exist.

## How it was built

The design shipped as a Claude Design `.dc.html` prototype: an `<x-dc>` template with
`{{ }}` bindings, `<sc-if>`/`<sc-for>` control flow and `style-hover` pseudo-classes,
driven by a `class Component extends DCLogic` React component — all of which only runs
inside Claude Design's proprietary `support.js` runtime.

This implementation removes that dependency:

1. **`app.js` includes a ~150-line, self-contained template compiler** that turns the
   *exact original template markup* (embedded verbatim in `index.html`) into a real
   React element tree. It implements only the subset the template uses:
   `{{ }}` interpolation, `sc-if`, `sc-for`, inline-`style` objects, `style-hover`
   (via a small injected stylesheet), events, and CSS custom properties. It is **not**
   the proprietary runtime — no streaming, editor bridge, `x-import`, helmet, or CDN
   loading.
2. **The component logic is ported essentially verbatim** — the data graph, the
   procedural genre covers and hand-drawn genre icons, the ego graph, the
   force-directed network layout, search, routing and stats. Only `render()` is rewired
   to the compiler instead of the DC runtime.

The result is a genuine React SPA that faithfully reproduces the design's look and
behavior while being something you can host anywhere and maintain as ordinary code.

## The data model

Everything on the site is derived from two lists:

```
mentions  →  [ source book, mentioned book, mentioned author ]
books     →  title → [ author, year, synopsis ]
```

Books without a metadata row still get a page — they just wait for a synopsis.

## Detecting mentions from a PDF

Instead of hand-authoring every mention, you can fast-track them from a source book's PDF.
`tools/detect.mjs` mechanically extracts a short, ranked list of candidate book references
(quoted titles, Title-Case runs, dictionary matches, reading-word proximity) so only that
shortlist needs verifying — not the whole book. See **[docs/detector.md](docs/detector.md)**.

```bash
npm run bj:dict                                              # build the known-titles dictionary (once)
npm run bj:detect -- inbox/pending/Book.pdf --title "Book"   # PDF -> candidates.json
# verify candidates -> inbox/pending/<slug>.batch.json, then:
npm run bj -- import inbox/pending/<slug>.batch.json && npm run bj:build
```

## Growing the dataset (data pipeline)

The data lives in a lightweight **SQLite database** (`bookjumpr.db`). You edit the
database, then rebuild the site's data file from it — the website itself never changes:

```
bookjumpr.db  ──(npm run bj:build)──▶  bookjumpr-data.js  ──▶  the site
```

Requires Node 22.5+ (uses the built-in `node:sqlite`; the npm scripts pass the needed
flag for you). Quick start:

```bash
npm run bj:seed                     # one-time: load the current data into the database
npm run bj -- add-mention --source "Dune" --mentioned "The Bible"   # add a reference
npm run bj -- set-genre --title "Dune" --genre "SCI-FI"   # pick a cover style (else MISC)
npm run bj -- import inbox/batch.json    # or import a JSON batch (a list, or one book + refs)
npm run bj:build                    # regenerate bookjumpr-data.js
npm run admin                       # …or manage it all in a local web UI (localhost:8918/admin)
```

Four ways to add & manage data — **paste it to Claude**, the **CLI**, a **spreadsheet**
(CSV round-trip), or the **admin UI** — plus how to view, rebuild, validate, and back up,
are all covered in **[docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md)**.
