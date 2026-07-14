# Detecting mentions from a book PDF

A fast path from *"I just read this book"* to *rows in the BookJumpr graph*, without
feeding a whole 100k-word novel to an LLM. The detector does the cheap mechanical work
(zero tokens); a human or an LLM verifies only a short candidate list.

## The pipeline

```
 PDF  ──bj:detect──▶  <slug>.candidates.json  ──verify──▶  <slug>.batch.json  ──bj import──▶  DB  ──bj:build──▶  site
(you)   (mechanical)      (ranked shortlist)    (LLM/human)    (importer format)                          
```

All working files live in **`inbox/pending/`**, which is gitignored (source PDFs and
generated files never get committed).

### 1. Build the dictionary (once, then whenever you want it refreshed)

```bash
npm run bj:dict
```

Builds **`tools/dict/titles.json`** (committed) from three sources, each tagged with a
**tier**:

- **catalog** (tier 0) — the Project Gutenberg catalog (~66k public-domain works). Broad
  but noisy: it lists common words like *Japan* / *Sound* / *Peace* as obscure titles.
- **famous** (tier 1) — **goodbooks-10k** (the 10k most-popular Goodreads books, modern
  *and* classic, with clean authors) plus every title already in `bookjumpr.db`. This fills
  what Gutenberg lacks (*1984*, *Beloved*, *The Road*) and gives better authors.

Both raw dumps download from GitHub mirrors (`gutenberg.org` is often unreachable from
sandboxes); if a download fails the command prints a `curl` line. The compact `titles.json`
value is `normalizedTitle → [author, famousFlag]`.

The dictionary is both a **booster** (it confirms titles the heuristics flagged and
auto-fills the author) and — for the **famous** tier — a **finder**: because that tier is
clean, a bare one-word match from it (e.g. *Macbeth*) is kept on its own. A title missing
entirely (e.g. Kafka's *The Castle*, public-domain nowhere) is still caught by the other
signals.

### 2. Detect candidates

```bash
# drop the PDF in inbox/pending/ first
npm run bj:detect -- inbox/pending/KafkaOnTheShore.pdf --title "Kafka on the Shore"
```

Writes `inbox/pending/kafka-on-the-shore.candidates.json` — a ranked shortlist. Each
candidate carries its surrounding quote, a score, which **signals** fired, and (if known)
the dictionary author. Signals:

| signal | weight | meaning |
| --- | --- | --- |
| `quoted` | 3 | inside quotes and title-shaped (not dialogue) |
| `dict` | 3 | matches `titles.json` (also supplies the author) |
| `byline` | 3 | author attached — "Sophocles' *Oedipus Rex*", "…, by Sophocles" |
| `trigger` | 2 | near a reading word (read, novel, wrote, library, …) |
| `list` | 2 | enumerated next to another title (`X, and Y, 'Z'`) |
| `reads` | — | a reading verb directly governs it ("read *Ulysses*") — gate only |
| `famous` | 1 | the dict hit is from the curated (tier-1) list |
| `titlecase` | 1 | a Title-Case run of 2–6 words |

Candidates scoring **≥ 3** are kept (top 200). **Single-word** titles are noisy in real
prose — a 76k dictionary has a book named after nearly every place and common word (*Paris*,
*Winter*, *Nature*) — so a lone word is kept **only** with a *strong* signal: `quoted`,
`byline`, or `reads` (a reading verb directly before it). Mere trigger-proximity or
famous-tier membership is not enough. Multi-word titles are unaffected. Trade-off: a bare
one-word mention with no nearby cue (e.g. "*Macbeth* again") is missed — use `--full` or
review for those. `STOPWORD_TITLES` (`tools/normtitle.mjs`) blocks the most common words.

Project Gutenberg `.txt` files have their license header/footer stripped automatically, so
the boilerplate ("the Foundation", disclaimers, volunteer names) never becomes candidates.
Plain `.txt` input is accepted alongside PDF (handy for tests).

Under-detected? `--full` writes the cleaned text to `<slug>.fulltext.txt` to read directly.

### 3. Verify → batch

An LLM (or you) turns the candidate list into `inbox/pending/<slug>.batch.json` in the
[importer format](../inbox/batch.example.json): confirm each is a **real published book or
play**, resolve canonical **title + author**, and drop the exclusions —

- ✗ scripture (the Bible), newspapers/periodicals
- ✗ author name-drops with no title, fictional/in-world books, the source book itself
- ✗ Title-Case noise: character names, places, chapter titles
- ✗ **editorial apparatus** — an edition's introduction, preface, footnotes, endnotes, or
  translator/reference notes. Only the work's **own authored text** counts (a character reads,
  quotes, or names a book; an author-chosen chapter epigraph). Scholarly Gutenberg editions
  bundle a lot of this — e.g. a Jonson edition's career essay names dozens of other plays.
- ✗ **anachronisms** — a work published *after* the source (a book can't name a later work in
  its own text), which is almost always apparatus. `bj doctor` flags these where both
  publication years are known.

Put the triggering quote in each mention's `note` (stored, not shown on the site) and an
optional `confidence` (`high`/`medium`/`low`, ignored by the importer) to speed review.

### 4. Review + import

```bash
npm run bj -- import inbox/pending/<slug>.batch.json
npm run bj:build
```

The importer auto-creates stub books for anything new, dedupes on `(source, mentioned)`,
and routes identity through `slug()`, so re-running is safe.

## Precision & recall notes

- **False positives** are controlled by the human/LLM gate in step 3 — the dictionary never
  auto-imports. Every kept row shows its quote, so review is fast.
- **Recall gaps**: a title that is neither Title-Case, quoted, in the dictionary, nor near a
  trigger can be missed (rare in practice). Use `--full` for a book that looks light.
- Tunables live at the top of `tools/detect.mjs` (`TRIGGERS`, `TRIGGER_WINDOW`, `KEEP`).
