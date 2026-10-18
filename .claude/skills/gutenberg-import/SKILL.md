---
name: gutenberg-import
description: Reliably fetch Project Gutenberg book texts and turn them into a bookjumpr import batch (synopsis + genre + real in-narrative mentions). Use whenever adding public-domain books to the bookjumpr database from Project Gutenberg.
---

# Gutenberg import

Use this whenever the task is "add N more public-domain books" or "fill in stub books" for
bookjumpr. It replaces ad-hoc one-off searches with a resilient, repeatable procedure.

## 1. Dedup-check BEFORE doing any fetching

First skip anything in `data/checked-sources.csv`: books whose full text was already read for
mentions, including ones that turned out to name no other book. After scanning a book, append it
there (`slug,title,checked,text_source,mentions_found`) even when `mentions_found` is 0.

Check every candidate title against the **full identity set**, not just the metadata CSV:

```js
const fs = require("fs");
const src = fs.readFileSync("bookjumpr-data.js", "utf8");
const NODES = eval("(" + src.match(/const NODES = (\{.*?\});\s*\n/s)[1] + ")");
const titles = Object.values(NODES).map(v => [v[0], v[1]]); // [title, author]
```

`data/books.csv` only contains books with `has_meta=1` — a **stub** (auto-created because
some other book mentions it, no synopsis yet) is invisible there but fully real in `NODES`
and already has a live page on the site. Checking the CSV alone produces false "absent"
verdicts. This has bitten this project repeatedly (Shakespeare plays, Plato dialogues, The
City of God, Bhagavad Gita, Tao Te Ching, etc. were all wrongly proposed as new additions
before someone checked the live site).

Also watch for:
- **Alternate/translated titles** — a book can already exist under its French/German/
  original title (e.g. "A Harlot High and Low" already existed as "Splendeurs et misères
  des courtisanes"). Search both forms.
- **Near-duplicate stubs by the same author** — "Wilhelm Meister" vs "Wilhelm Meister's
  Apprenticeship", "Alice in Wonderland" vs "Alice's Adventures in Wonderland", "Tao Te
  Ching" under two transliterated author spellings ("Lao Tzu" / "Laozi"), a 3-way Grimm
  fairy-tale duplicate, "The French Revolution" vs "The French Revolution: A History" —
  all real duplicates found and merged this way. Group NODES by author and eyeball
  near-identical titles before adding anything new for a heavily-covered author.
- **Alternate titles**: a book can carry other titles it's known by (`npm run bj -- aliases --title T` lists them,
  `bj -- alias --title T --alias A` adds one). Imports resolve an alternate title to its book, so once
  "Alice in Wonderland" is an alias, a mention written that way lands on "Alice's Adventures in Wonderland".
  When you merge a duplicate (`merge-book`, which takes exact keys like `author/title`), its title becomes an
  alias automatically.
- **Same title, different author is FINE, not a duplicate** — books key on
  `slug(author)/slug(title)`, so e.g. three different "Antigone"s (Sophocles, Alfieri,
  Anouilh) coexist without collision. Just make sure the `author` field is present and
  correct in the import batch.

## 2. Resolve the Gutenberg ID

Prefer resolving against the **bulk catalog** rather than one-off web searches — searching
gutenberg.org's own search endpoint has been flaky (intermittent 504s) even when the
`cache/epub` file-serving endpoint works fine:

- `pg_catalog.csv.gz` — Gutenberg's full ~90k-row catalog (`Text#,Title,Authors,Subjects`).
  Download once, grep/match title+author-surname against it to get the numeric ID.
- If unavailable or a title genuinely isn't in the catalog, fall back to a targeted web
  search for the exact ID.

## 3. Fetch the real full text

```
https://www.gutenberg.org/cache/epub/<id>/pg<id>.txt
https://www.gutenberg.org/files/<id>/<id>-0.txt      (fallback)
```

**If gutenberg.org is blocked** (the cloud environment's network policy denies www.gutenberg.org and
archive.org), use **GITenberg** — the Gutenberg corpus mirrored on GitHub, reachable as raw files:

```
https://raw.githubusercontent.com/GITenberg/<Title-With-Hyphens>_<id>/master/<id>.txt   (or <id>-0.txt)
```
e.g. `Middlemarch_145`, `The-Age-of-Innocence_541`, `Gulliver-s-Travels_829` (apostrophes become hyphens).
Confirm the `Title:` / `Author:` header lines match before using it.

**On repeated timeouts/504s from gutenberg.org**: this has happened mid-session before (a
real outage, not a bad URL). Retry with backoff a reasonable number of times (e.g. 3-4
attempts over a minute or two). If it's still down:
- Try an alternate host from Gutenberg's official mirror list: `gutenberg.org/MIRRORS.ALL`.
- If the specific title isn't on gutenberg.org at all (checked via catalog, confirmed
  absent), try **archive.org** full-text search/borrow pages — this has worked for texts
  Gutenberg never digitized (e.g. Woolf's *To the Lighthouse* and *Orlando*, Faulkner's *As
  I Lay Dying*, Huxley's *Point Counter Point* were all found there instead).
- If a title only exists in a non-English translation, or only bundled inside an anthology/
  omnibus file, or is genuinely nowhere free online: **say so plainly and skip it**. Do not
  guess, paraphrase from training-data familiarity, or fabricate a synopsis/mentions for a
  book whose text you didn't actually obtain. This has happened before on this project
  (a fork once fabricated a mention for a book it never fetched) and is the single most
  important rule in this skill.

## 4. Read the real text — never paraphrase from memory

Fetching the file is not enough; actually read it before writing anything. For each book:

- **Synopsis**: 1-3 sentences, house style — punchy, present-tense, concrete plot/argument
  details, no spoiler-hedging language. Match the tone already in `data/books.csv`.
- **Genre**: assign from the canonical list in `tools/genres.mjs` (read it for the exact
  18 names — FICTION, POETRY & EPICS, PHILOSOPHY, HORROR, etc).
- **Mentions**: find genuine in-narrative mentions of *other real, published* books —
  dialogue, narration, or an author-chosen epigraph naming a title. Exclude:
  - editorial apparatus — a translator's/editor's introduction, footnotes, endnotes (only
    the work's own authored body text counts; scholarly Gutenberg editions bundle a lot of
    this and it's a common false-positive source)
  - generic/interchangeable reference-series mentions ("and so on" style categories) —
    keep specific singular quoted works instead
  - anything outside the main text written by the book's own author: a preface, introduction,
    dedication or notes by anyone else (printer, editor, translator, publisher) never counts, e.g.
    Caxton's preface to Le Morte d'Arthur
  - the author's own preface, introduction or Author's Note listing their other books or publishing
    history (e.g. Conrad's Author's Note to Typhoon, Baum's notes in the Oz books): only titles named in
    the work itself count
  - operas, ballets, songs, hymns and tunes, even when named by title
  - the Bible (owner's call; other scriptures such as the Vedas and Upanishads do count)
  - fictional/in-world books that don't exist outside the story (e.g. Lovecraft's
    Necronomicon, an invented novel-within-the-novel)
  - loose personality similes ("he was a regular Don Quixote") that don't cite an actual
    title being read/owned/discussed
  - anachronisms — a source can't name a work published after itself; `bj doctor` flags
    `mentioned.year > source.year` as a warning worth checking

## 5. Assemble, import, build

```json
{
  "books": [{ "title": "...", "author": "...", "year": 1234, "synopsis": "...", "genre": "..." }],
  "mentions": [{ "source": "...", "mentioned": "...", "author": "..." }],
  "genres": [{ "title": "...", "genre": "..." }]
}
```

```bash
npm run bj -- import inbox/<batch-name>.json
npm run bj:build
npm run bj:build -- --check     # must be clean
```

If `--check` reports an **identity-drift** doctor error: this is a known recurring bug
where the importer's "prefer the fuller author name" backfill (e.g. "Cicero" →
"Marcus Tullius Cicero") changes a book's `author` field without re-deriving its slug,
desyncing the two. Fix by reverting the author field to whatever the existing slug implies
— don't treat it as a new mystery each time.

## 6. Merging a found duplicate

1. Identify the canonical entry (fuller synopsis/genre, or more inbound mentions).
2. Re-point every mention currently pointing at the duplicate's title to the canonical
   title (via `bj -- add-mention` or a mentions-only import).
3. `bj -- remove-book` the now-orphaned duplicate.
4. `bj:build -- --check` to confirm clean.

See also: `docs/DATA-PIPELINE.md` §8, `docs/detector.md` (for in-copyright books via PDF
instead of Gutenberg), and this project's Claude memory files (`gutenberg-fetch-source.md`,
`gutenberg-dedup-normalize-accents.md`, `mentions-narrative-only.md`,
`mentions-exclude-generic-reference-series.md`) for the full incident history behind each
rule above.
