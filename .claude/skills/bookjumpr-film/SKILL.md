---
name: bookjumpr-film
description: Make a short BookJumpr film — a chain of books where each one mentions the next (or a fan — one book and everything it mentions, then one of those fanning out), each hop shown with its real quote, rendered as an MP4 for the phone feed (9:16) and 16:9. Use when asked to make, render or re-render a BookJumpr film/video, find or check a chain/path of books for one, or fill a missing quote for a hop.
---

# BookJumpr film

A film follows a **forward chain** — Book A mentions Book B, which mentions Book C… — and shows each
hop as the line from the book's own text. The engine is in `video/` (`flow.html` draws every frame from
time; `render.mjs` pipes frames to ffmpeg). Read `video/README.md` for the moving parts; this is the
procedure.

## 1. Find or check a chain

```bash
node video/find-chains.mjs --check "The Goldfinch" "Franny and Zooey" "Peter Pan"   # a chain someone suggests
node video/find-chains.mjs --from "Middlemarch" --hops 2 --max-hops 4             # search from a book
node video/find-chains.mjs --hops 3 --exclude <film>                              # best-known chains, avoiding a film's books
```

`--check` marks each hop ✓ quoted · ⚠ no quote saved · ⚠ runs the other way · ✗ no mention. Books can be
given by title or id (use the id when a title is ambiguous, e.g. `william-dampier/a-new-voyage-round-the-world`).

Rules (each one came from a correction):
- **Forward only.** Every hop must read "X mentions Y". A hop that runs the other way doesn't make sense to viewers.
- **A real quote for every hop**, verbatim. Reading-list entries, epigraph credits and editors' summaries
  don't count (the finder filters them).
- **Books people have actually read**; no Harry Potter unless asked. Mixed genres give mixed cover colours
  (covers take their genre's colour; an all-Fiction chain is all orange).
- Long forward chains through famous books are rare: most need several books whose text is in the data.
  2–3 hops is normal; 5 is a find.

## 2. Fill a missing quote (public-domain books only)

When a hop exists but has no quote, get the line from the book's text — **never from memory**, and say so
plainly if a book names the next one only loosely (e.g. "Gulliver", "A Voyage round the world").

1. Fetch the text. **gutenberg.org and archive.org are blocked in the cloud environment; GITenberg on
   GitHub works**:
   `https://raw.githubusercontent.com/GITenberg/<Title-With-Hyphens>_<gutenberg-id>/master/<id>.txt`
   (e.g. `Middlemarch_145`, `The-Age-of-Innocence_541`, `Gulliver-s-Travels_829`; try `<id>-0.txt` too).
   Keep texts in the scratchpad, not the repo. Confirm the `Title:` / `Author:` header lines.
2. Search only the body between the `*** START OF` / `*** END OF` markers (not headers, footers or editors'
   notes) for the next book's title, a short form of it, or its author. Take the sentence, trimmed with "…".
3. Save it on the existing mention, **passing the current authors** — `--force` also overwrites the
   mentioned author, so read it from the database first:
   ```bash
   npm run bj -- add-mention --source "Middlemarch" --source-author "George Eliot" \
     --mentioned "Gulliver's Travels" --author "Jonathan Swift" --force --note "…"
   npm run bj:build && npm run bj:build -- --check      # must be clean
   ```
4. Commit the data (`bookjumpr.db`, `bookjumpr-notes.js`) **on its own**; the quotes also appear on the
   site's book pages once that reaches `main` — open a PR only when asked.

In-copyright books can't be fetched: point to `docs/detector.md` (find mentions in a PDF the user has).

## 3. Make the film

1. Copy a config in `video/films/` (e.g. `goldfinch-to-peter-pan.json`) to `<film>.json` — `question`,
   `accent` (the word in rust italic), `path` (book ids, in order), `end`, `"layout": "chain"`.
2. `node video/build-data.mjs <film>` — prints every hop's quote; fails on any hop that isn't a forward,
   quoted mention.
3. Preview: serve the repo (`npm run serve`) and open `/video/flow.html?film=<film>&play`
   (`&w=1080&h=1920` for vertical).

### Fan films (`"layout": "fan"`)

One book at the top, the books it mentions in a row below it (curved dotted lines, like the site's book page), then
one of those fans out into a row of its own. Config: copy
`video/films/norwegian-wood-fan.json` — `fans: [{ from, to: [ids], quotes: [ids] }, …]`. Find candidates with
`node video/find-chains.mjs --fan "Norwegian Wood"` (★ = quote saved; "→ mentions 13, 3 quoted" shows which books
can fan out next). Rules: about **5 books per fan** (one row; more and nothing reads on a phone), listed left to right with the
next fan's book in the middle; one quote card per fan — the hop
to the next fan's book, and on the last fan the book the film ends on (more cards is too much); each `to` book must be a forward mention of `from`. Timing for stills:
fan 1 lines from beat 12, its card at ≈ 12 + 0.45·n + 0.9, the leap 3.8 beats after, the next row 5.2 beats after; the
tree is held 2.8 beats before the network (`window.FILM_META` in the page gives BEATS).

## 4. Check stills before rendering

```bash
node video/render.mjs --film <film> --stills 11.6,<mid-hop>,<TN-0.2>,<TN+4>
node video/render.mjs --film <film> --w 1080 --h 1920 --stills <same>
```
Chain layout timing: hop k starts at beat 12 + 4.2k (mid-hop ≈ +2.3); the whole chain is held from
TN = 12 + 4.2 × hops + 1.6; the network follows. Look at the PNGs in `video/out/`: nothing touching the
frame edges, no card over a cover or another card, the little book on the dotted path.

## 5. Render and deliver

The vertical cut is the one people post (X, Instagram, TikTok), so check it first and hardest: in the feed it
plays at about a third of its size. Render social cuts at 30 fps.
```bash
node video/render.mjs --film <film> --w 1080 --h 1920 --fps 30   # run in the background (~2 min)
node video/render.mjs --film <film> --w 1920 --h 1080             # only if a widescreen cut is wanted
ffprobe -v error -show_entries stream=width,height,avg_frame_rate,nb_frames -show_entries format=duration video/out/<film>-*.mp4
```
frames = duration × fps. Send both MP4s, then commit `video/films/<film>.json` and
`<film>.data.js` (`video/out/` is gitignored).

## Knobs

- `--layout stage` (one hop at a time) instead of the default chain (all hops on one screen).
- `--bpm 100` slows everything (more reading time).
- Cover colours come from genres in the database: re-tag (`npm run bj -- set-genre …`, `bj:build`), then
  re-run `build-data.mjs`.
- Layout adapts to the chain's length (2–6 books checked); covers under 60px drop their title.
- The prompt the film was designed from: `video/PROMPT.md`.
