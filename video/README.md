# The flow of a book — BookJumpr film

A 16-second, loopable motion film of bookjumpr.com, in 16:9 and 9:16. Prompt: [PROMPT.md](PROMPT.md).
Not part of the site (Netlify only publishes the files listed in `netlify.toml`).

| File | What it is |
| --- | --- |
| `flow.html` | The film. Every frame is computed from time by `seek(t)`; `?w=1080&h=1920` for the vertical cut, `?bpm=` for the tempo, `?play` to preview it looping in a browser |
| `film-data.js` | Titles, counts, the quote and the starfield, **generated** from the site's data by `build-data.mjs` |
| `build-data.mjs` | `node video/build-data.mjs` (from the repo root) |
| `render.mjs` | `node video/render.mjs [--w 1080 --h 1920] [--bpm 120] [--stills 0,9,16.8]` → PNG frames + MP4 in `video/out/` |

## Beat map (120 BPM · 32 beats · 16 s)

| Beats | Time | Scene | On the beat |
| --- | --- | --- | --- |
| 0–2 | 0.0–1.0 s | **Open** — end card (= last frame); tagline drops away, the logo shrinks into the header, its rule draws across | b1: header lands · wall starts rising |
| 1–4 | 0.5–2.0 s | **Wall** — covers rise column by column; a cursor glides in and clicks *Don Quixote* | b3.5: click · b4: the book lands on the cover |
| 4–8 | 2.0–4.0 s | **Fan** — the cover becomes the black pill; blue lines draw in (Mentioned by 75), rust out (Mentions 41), a pill every ¼ beat | b5: first in-line · b6: first out-line · b7/b8: counters land |
| 8–10 | 4.0–5.0 s | **Spotlight** — *How to Read and Why* lights up, the rest dims | b9: lit |
| 10–16 | 5.0–8.0 s | **Quote** — its pill opens into the quote card, words set in; "Madame Bovary" is highlighted; the book hops onto it | b10: card · b11–13: words · b14: highlight · b15: book lands |
| 16–22 | 8.0–11.0 s | **Jump** — "Madame Bovary" lifts out and arcs to its own pill; Don Quixote flies into "Your jumps"; the camera follows; its fan draws (26 / 4) | b17.6: landing · b18.3: fan · b19: trail |
| 22–28 | 11.0–14.0 s | **Zoom out** — the pill folds into its genre dot, the dot is one star of 5,145 (real map positions); its threads light | b23: dot · b24–26: pull back · b25: threads + name |
| 28–32 | 14.0–16.0 s | **End** — stars gather into the logo's dotted arc, the book hops onto its end, *BookJumpr*, tagline, stats | b30: arc · b30.5: book lands · b31: tagline · b31.6: stats |

Every quote, title and number comes from the data: Harold Bloom, *How to Read and Why*, on *Madame Bovary*: "The influence of Cervantes is intense upon Stendhal and Flaubert, whose Madame Bovary is "the female Quixote."" — 5,145 books · 7,764 mentions.
