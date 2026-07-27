# BookJumpr — Data Pipeline Guide

How to add books and references, manage them, and rebuild the site.

---

## 1. How it works

BookJumpr's website is generated from data. There is one **source of truth** — a small
SQLite database — and a **build step** that compiles it into the single file the site
reads:

```
   bookjumpr.db  ──(npm run bj:build)──▶  bookjumpr-data.js  ──▶  the website
  (SQLite: your          regenerated                 loaded by index.html / app.js
   books & mentions)     each rebuild
```

- The **database never ships to the browser.** Only the generated `bookjumpr-data.js`
  does. You never hand-edit that file — the build overwrites it.
- Every change follows the same shape: **edit the database → rebuild → the site updates.**
- A human-readable **CSV mirror** (`data/books.csv`, `data/mentions.csv`) is refreshed on
  every build, so each change is easy to review and back up.

Key files:

| File | What it is |
| --- | --- |
| `bookjumpr.db` | The database — the source of truth (committed to git) |
| `bookjumpr-data.js` | **Generated.** What the site loads. Do not hand-edit |
| `data/books.csv`, `data/mentions.csv` | Human-readable mirror of the DB (refreshed on build) |
| `inbox/` | Drop-zone for JSON batches to import (`inbox/batch.example.json` is a template) |
| `tools/` | The pipeline scripts (CLI, build, admin server, validation) |

> **Requirement:** Node 22.5+ (uses the built-in `node:sqlite`). The npm scripts already
> pass the needed `--experimental-sqlite` flag — you never type it.

---

## 2. The data model

Everything is two lists:

- **Books** — a title, and optionally `author`, `year`, `synopsis`. A book with those
  details gets a full page with a synopsis. Books are identified **author-first** by a
  key of `slug(author)/slug(title)` (`"Kafka on the Shore"` by Haruki Murakami →
  `haruki-murakami/kafka-on-the-shore`), which is also its URL (`#/<author>/<title>`).
  A book with no known author uses the `anonymous/` author segment. Because the author
  leads, two different authors can share a title with no collision — the two "Essays"
  become `ralph-waldo-emerson/essays` and `robert-louis-stevenson/essays`.
- **Mentions** — "book A names book B inside its text." A mention has a **source** (the
  book doing the mentioning), a **mentioned** book, and optionally the mentioned book's
  **author**.

You don't have to add a book before referencing it. If a mention names a book that isn't
in the database yet, it's **created automatically** as an identity-only entry — it gets a
page immediately and simply "waits for a synopsis" until you add one. Unknown fields
default to empty (`author` → `""`, `year` → `0`, `synopsis` → `""`).

Each `(source, mentioned)` pair is unique — adding the same reference twice is a no-op.

### Genres & cover styles

Every cover is procedural — a colored **band** + a hand-drawn **icon** chosen by the book's
**genre**. There are **18 built-in genres** (Fiction, Sci-Fi, History, Philosophy, Poetry &
Epics, … and **MISC**). A book with **no genre assigned** shows the plain black **MISC**
cover; assign a genre and the cover switches to that genre's color + icon. (Genre is
independent of metadata — any book, even a synopsis-less one, can have a genre.)

```bash
npm run bj -- genres                                       # list the 18 assignable genres
npm run bj -- set-genre --title "Dune" --genre "SCI-FI"    # assign (case-insensitive)
npm run bj -- set-genre --title "Dune" --genre ""          # clear → back to MISC
npm run bj:build
```

- **Admin UI:** open a book → the **Genre** dropdown (saves immediately) → **Rebuild site**.
- **JSON import:** add `"genre": "SCI-FI"` to a `books[]` entry, or a top-level
  `"genres": [ { "title": "Dune", "genre": "SCI-FI" } ]` array (genre-only, no metadata).

Genres are stored per book and emitted to the site as a `GENRES` map in `bookjumpr-data.js`.

---

## 3. Four ways to add & manage data

Pick whichever fits the moment. They all write to the same database.

### a. Paste it to Claude  *(easiest for a list or a new book)*

Just paste what you have, in plain English — a list of references, or one book with the
books it mentions. For example:

> Add *Norwegian Wood* by Haruki Murakami (1987) — it mentions *The Great Gatsby* and
> *The Magic Mountain* by Thomas Mann.

Claude turns that into a batch file in `inbox/`, runs the import, rebuilds, and confirms
the new counts. Under the hood it's the JSON format below — you can paste that directly
too if you prefer.

**Batch JSON format** (`inbox/*.json`, also see `inbox/batch.example.json`):

```json
{
  "books": [
    { "title": "Norwegian Wood", "author": "Haruki Murakami", "year": 1987,
      "synopsis": "A student in 1960s Tokyo is pulled between two very different women." }
  ],
  "mentions": [
    { "source": "Norwegian Wood", "mentioned": "The Great Gatsby", "author": "F. Scott Fitzgerald" },
    { "source": "Norwegian Wood", "mentioned": "The Magic Mountain", "author": "Thomas Mann" }
  ]
}
```

Then:

```bash
npm run bj -- import inbox/batch.json
npm run bj:build
```

- **A list of books** → many entries in `books[]` and `mentions[]`.
- **A single book + its references** → one entry in `books[]` and its `mentions[]`
  (or just `mentions[]` if you're only linking books that already exist).

### b. The command line

```bash
# add / update a book's metadata
npm run bj -- add-book --title "Norwegian Wood" --author "Haruki Murakami" --year 1987 --synopsis "…"

# add one reference (both books are created automatically if new)
npm run bj -- add-mention --source "Norwegian Wood" --mentioned "The Great Gatsby" --author "F. Scott Fitzgerald"

# import a batch file
npm run bj -- import inbox/batch.json

npm run bj:build          # regenerate the site
```

### c. A spreadsheet (CSV)

Best for bulk edits. Export, edit in Numbers / Excel / Google Sheets, re-import:

```bash
npm run bj:export                 # writes data/books.csv + data/mentions.csv
# …edit the CSVs (columns: books.csv → title,author,year,synopsis;
#                          mentions.csv → source_title,mentioned_title,mentioned_author)…
npm run bj -- import-csv          # load your edits back in (upsert)
npm run bj:build
```

`import-csv --replace` treats the CSVs as the **complete** source of truth (replaces all
mentions/metadata with what's in the files). Without `--replace` it only adds/updates.

### d. The admin web UI  *(point-and-click)*

```bash
npm run admin
# opens a local server → http://localhost:8918/admin
```

A local page (localhost only, never exposed) to:
- add / edit / delete books and mentions with forms and a searchable table,
- paste a JSON batch,
- click **Rebuild site**, then **View site** to see the result.

Nothing is written to the live `bookjumpr-data.js` until you click **Rebuild site**.

---

## 4. Viewing & inspecting

```bash
npm run bj -- stats                 # books / mentions / indexed counts (matches the site's Stats page)
npm run bj -- list books            # every book (● has metadata, ○ identity-only) with in/out degree
npm run bj -- list mentions         # every reference
npm run bj -- search "gatsby"       # find books by title or author
npm run bj -- slug "Kafka on the Shore"   # the title-slug half of the key (URL is #/<author>/<title>)
```

To see the live site:

```bash
npm run serve                       # http://localhost:8917/index.html
```

Then open the **Stats** page (the counts there should match `npm run bj -- stats`) and the
new book at `#/<author>/<title>`.

---

## 5. Rebuild & verify

```bash
npm run bj:build          # regenerate bookjumpr-data.js (+ refresh the CSV mirror)
npm run bj -- build --check   # dry run: does the site data differ from the DB? (writes nothing)
```

`build` runs validation first and refuses if there are **errors** (pass `--force` to
override). After building, reload the site and confirm the change.

---

## 6. Validate (`doctor`)

```bash
npm run bj:doctor
```

Reports:
- the **synopsis backlog** — the most-mentioned books that still have no synopsis (your
  "what to add next" queue),
- author conflicts, orphaned books, self-mentions, whitespace/future-year hygiene,
- **errors** that would break the site (a mention pointing at a missing book, identity
  drift) — these block `build`.

`npm run bj -- doctor --fix` applies safe fixes (trims stray whitespace in author/synopsis).

---

## 7. Backups & git

The project is under git. Both the **database** (`bookjumpr.db`) and the **CSV mirror**
(`data/*.csv`) are committed, so:

- every data change is recoverable, and
- a `git diff` of `data/*.csv` shows exactly which books/mentions changed, in plain text.

A typical change is just:

```bash
npm run bj -- import inbox/batch.json && npm run bj:build
git add -A && git commit -m "Add Murakami references"
```

---

## 8. Bulk-adding popular public-domain titles from Project Gutenberg

> A step-by-step invocable version of this section lives at
> `.claude/skills/gutenberg-import/SKILL.md` — use it directly for "add N more Gutenberg
> books" style tasks.

A common request is "find N popular books we haven't added yet and import them." This is
higher-risk than a normal `paste it to Claude` add because it involves a dedup search step
*before* the import, and because mention-mining only means something if it's grounded in
the real text. Lessons learned the hard way (see project memory for full detail):

- **Dedup-check against the full book list, not `data/books.csv`.** The CSV only contains
  books with metadata (`has_meta=1`). A "stub" — a book that exists only because some other
  book mentions it, with no synopsis yet — is invisible in the CSV but is already a real
  entry in `bookjumpr-data.js`'s `NODES` object (and has a live page on the site). Checking
  a candidate title against the CSV alone will produce false "absent" verdicts for any
  popular classic that already got auto-created as a stub. Check the full `NODES` set (or
  query `bookjumpr.db` directly) instead.
- **A shared title with a different author is not a duplicate.** Books key on
  `slug(author)/slug(title)`, so e.g. three different "Antigone"s (Sophocles, Alfieri,
  Anouilh) or two different "The Art of War"s (Sun Tzu, Machiavelli) coexist fine as long
  as each import includes the correct `author`. Don't skip a title just because something
  with the same name already exists — check whether the *author* actually matches first.
- **Synopsis and mentions must come from the real fetched text, never paraphrased from
  general knowledge.** It's tempting (and much faster) to write a synopsis and guess at
  mentions from familiarity with a classic book — but this has produced at least one
  outright fabricated mention in practice. Always fetch the actual Gutenberg (or
  archive.org, if not on Gutenberg) full text and read it before writing anything.
- **No fixed year cutoff — Gutenberg's own hosting is the only bar.** Gutenberg won't host
  a work still under US copyright, so there's no need to additionally pre-filter candidates
  by publication year.
- **Watch for two known recurring bugs after any batch that both creates new mentions and
  touches an existing book's author field:**
  1. An "prefer the fuller author name" backfill can silently change a book's stored
     `author` (e.g. "Cicero" → "Marcus Tullius Cicero") without re-deriving its slug,
     which desyncs the two and trips `bj doctor`'s identity-drift check. Fix: revert the
     author field to whatever the existing slug implies.
  2. The same real-world entity can get created twice under different author-name
     spellings (e.g. "Lao Tzu" vs "Laozi" both for *Tao Te Ching*). Fix: pick the more-
     linked one as canonical, re-point any mentions from the duplicate via `add-mention`
     / a mentions-only import, then `bj -- remove-book` the orphaned duplicate.
  Always run `npm run bj:build -- --check` after a batch and treat any doctor error as one
  of these known classes before assuming something new is wrong.

---

## 9. Troubleshooting

- **`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`** — you ran a `tools/*.mjs` file directly
  without the flag. Use the npm scripts (`npm run bj -- …`), which add
  `--experimental-sqlite --no-warnings`.
- **`bookjumpr.db-wal` / `-shm` files** — normal SQLite write-ahead-log sidecars; they're
  git-ignored and safe to leave. They clear when no process has the DB open.
- **`build --check` shows an unexpected change** — the DB and the site file are out of
  sync; run `npm run bj:build` to regenerate, then review the `data/*.csv` diff.
- **Experiment safely** — set `BOOKJUMPR_DB=/tmp/scratch.db` before a command to run it
  against a throwaway database instead of the real one.
