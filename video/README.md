# BookJumpr films

A template for short, playful motion films of bookjumpr.com, in 16:9 and 9:16. The first: *How are books connected?* — The Marriage Plot → Invisible Cities → Brave New World → Romeo and Juliet. Prompt: [PROMPT.md](PROMPT.md).
Not part of the site (Netlify only publishes the files listed in `netlify.toml`).

| File | What it is |
| --- | --- |
| `films/<film>.json` | **A film's config** — its question (+ the accented word), the path of book ids, the end text, the default layout |
| `films/<film>.data.js` | The film's data, **generated** from the site's by `build-data.mjs`: the path's books and genre colours, each hop's quote (verbatim — it fails if a hop or quote isn't really in the data), the wall, the starfield |
| `flow.html` | The film engine. Every frame is computed from time by `seek(t)`. `?film=<film>`, `?layout=stage\|chain`, `?w=1080&h=1920` for the vertical cut, `?bpm=`, `?play` to preview in a browser |
| `build-data.mjs` | `node video/build-data.mjs <film>` (from the repo root) |
| `render.mjs` | `node video/render.mjs --film <film> [--layout chain] [--w 1080 --h 1920] [--stills 0,14,28]` → `video/out/<film>[-chain]-<w>x<h>.mp4` |

## Making another film

1. Copy `films/marriage-plot-to-romeo.json` to `films/<new>.json`; set `question`, `accent` (the word set in rust italic), `path` (book ids from `bookjumpr-data.js`, **each book mentioning the next** — A mentions B mentions C) and `end`.
2. `node video/build-data.mjs <new>` — it prints each hop's quote, or fails naming the hop that isn't a quoted forward mention (and says so if the mention runs the other way).
3. Preview: `http://localhost:8917/video/flow.html?film=<new>&play` (add `&layout=chain`, `&w=1080&h=1920`).
4. `node video/render.mjs --film <new>` (and `--layout chain`, `--w 1080 --h 1920`).

Any number of hops works: each takes 4.5 beats (stage) or 4.2 (chain), and the film grows to fit. Covers take their colour from the book's genre in the database, so re-tagging a book and running `npm run bj:build` then `build-data.mjs` recolours it.

## Layouts

- **chain** (the default) — every hop on one screen: the books in a row (a column in 9:16), each quote pinned beside its hop and left there, so by the end the whole path reads at once (held for 1.6 beats before the network).
- **stage** — one hop at a time, big: the current book and the next, a speech bubble between them, then the leap; finished books slide into a trail along the bottom.

## Beat map — marriage-plot-to-romeo (120 BPM)

Stage: 35.5 beats (17.75 s). Chain: 36.2 beats (18.1 s) — 4.2 beats a hop and a 1.6-beat hold on the whole chain.

| Beats | Scene |
| --- | --- |
| 0–6 | **Question** — "Have you ever wondered how books are connected?" pops in word by word; the book hops along the words and lands on the "?" |
| 6–10 | **Big view** — a wall of covers ripples out and drifts; the book browses a few covers |
| 10–12 | **Zoom** — a cursor taps *The Marriage Plot*; the camera dives in |
| 12–25.5 | **Hops** — *The Marriage Plot* → *Invisible Cities* → *Brave New World* → *Romeo and Juliet*: each book's line, in a bubble from that book, the next title highlighted, a leap along a dotted arc (stage: one at a time; chain: all on one screen) |
| +0–5 | **Network** — the path becomes dots at their real places on the map, joined by the dotted path; pull back to every book |
| +5–10 | **End** — stars gather into the logo, the book lands on its arc, *BookJumpr*, bookjumpr.com |

The three lines, verbatim from the data (each book mentions the next):
- *The Marriage Plot* (Jeffrey Eugenides): "a girl ... was smoking a clove cigarette and reading Invisible Cities"
- *Invisible Cities* (Italo Calvino): "Already the Great Khan was leafing through his atlas, over the maps of the cities that menace in nightmares and maledictions: Enoch, Babylon, Yahooland, Butua, Brave New World."
- *Brave New World* (Aldous Huxley): "Upstairs in his room the Savage was reading Romeo and Juliet."
