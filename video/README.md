# How are books connected? — BookJumpr film

A playful 20-second motion film of bookjumpr.com, in 16:9 and 9:16. Prompt: [PROMPT.md](PROMPT.md).
Not part of the site (Netlify only publishes the files listed in `netlify.toml`).

| File | What it is |
| --- | --- |
| `flow.html` | The film. Every frame is computed from time by `seek(t)`; `?w=1080&h=1920` for the vertical cut, `?bpm=` for the tempo, `?play` to preview it in a browser |
| `film-data.js` | The path, its quotes, the wall and the starfield, **generated** from the site's data by `build-data.mjs` (it fails if a quote isn't really in the data) |
| `build-data.mjs` | `node video/build-data.mjs` (from the repo root) |
| `render.mjs` | `node video/render.mjs [--w 1080 --h 1920] [--bpm 120] [--stills 0,14,28]` → PNG frames + MP4 in `video/out/` |

## Beat map (120 BPM · 40 beats · 20 s)

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
