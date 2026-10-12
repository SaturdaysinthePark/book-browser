# BookJumpr films

A template for short, playful motion films of bookjumpr.com, in 16:9 and 9:16. The first: *How are books connected?* (20 s). Prompt: [PROMPT.md](PROMPT.md).
Not part of the site (Netlify only publishes the files listed in `netlify.toml`).

| File | What it is |
| --- | --- |
| `films/<film>.json` | **A film's config** — its question (+ the accented word), the path of book ids, the end text, the default layout |
| `films/<film>.data.js` | The film's data, **generated** from the site's by `build-data.mjs`: the path's books and genre colours, each hop's quote (verbatim — it fails if a hop or quote isn't really in the data), the wall, the starfield |
| `flow.html` | The film engine. Every frame is computed from time by `seek(t)`. `?film=<film>`, `?layout=stage\|chain`, `?w=1080&h=1920` for the vertical cut, `?bpm=`, `?play` to preview in a browser |
| `build-data.mjs` | `node video/build-data.mjs <film>` (from the repo root) |
| `render.mjs` | `node video/render.mjs --film <film> [--layout chain] [--w 1080 --h 1920] [--stills 0,14,28]` → `video/out/<film>[-chain]-<w>x<h>.mp4` |

## Making another film

1. Copy `films/jane-eyre-to-gatsby.json` to `films/<new>.json`; set `question`, `accent` (the word set in rust italic), `path` (book ids from `bookjumpr-data.js`, each next to the last by a real mention) and `end`.
2. `node video/build-data.mjs <new>` — it prints each hop's quote, or fails naming the hop with no quoted mention.
3. Preview: `http://localhost:8917/video/flow.html?film=<new>&play` (add `&layout=chain`, `&w=1080&h=1920`).
4. `node video/render.mjs --film <new>` (and `--layout chain`, `--w 1080 --h 1920`).

Any number of hops works: each takes 4.5 beats (stage) or 4.2 (chain), and the film grows to fit. Covers take their colour from the book's genre in the database, so re-tagging a book and running `npm run bj:build` then `build-data.mjs` recolours it.

## Layouts

- **stage** — one hop at a time, big: the current book and the next, a speech bubble between them, then the leap; finished books slide into a trail along the bottom.
- **chain** — every hop on one screen: the books in a row (a column in 9:16), each quote pinned beside its hop and left there, so by the end the whole path reads at once (held for 1.6 beats before the network).

## Beat map — jane-eyre-to-gatsby, stage layout (120 BPM · 40 beats · 20 s; chain: 40.4 beats)

| Beats | Time | Scene |
| --- | --- | --- |
| 0–6 | 0–3 s | **Question** — "Have you ever wondered how books are connected?" pops in word by word; the book hops along the words and lands on the "?" |
| 6–10 | 3–5 s | **Big view** — a wall of covers ripples out and drifts; the book browses a few covers |
| 10–12 | 5–6 s | **Zoom** — a cursor taps *Jane Eyre*; the camera dives in |
| 12–30 | 6–15 s | **Hops** — Jane Eyre → *Looking for Alaska* → *Moby-Dick* → *The Storied Life of A. J. Fikry* → *The Great Gatsby*; each: next book pops in, a speech bubble from the book that says it, the title highlighted, a leap along a dotted arc |
| 30–35 | 15–17.5 s | **Network** — the trail becomes dots at their real places on the map, joined by the path; pull back to every book |
| 35–40 | 17.5–20 s | **End** — stars gather into the logo, the book lands on its arc, *BookJumpr*, bookjumpr.com |

The four lines, verbatim from the data:
- *Looking for Alaska* (John Green): "Muting Decapitation would be like reading only every other word of Jane Eyre."
- *Looking for Alaska*: "He lay on the top bunk, reading for his English class. Moby-Dick."
- *The Storied Life of A. J. Fikry* (Gabrielle Zevin): "'Do you like Moby Dick?' he asks."
- *The Storied Life of A. J. Fikry*: "The Great Gatsby is unquestionably dazzling, but that novel occasionally seems overgroomed to me, like a garden topiary."
