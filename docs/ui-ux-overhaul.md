# BookJumpr — UI / UX / motion overhaul (Oct 2026)

This pass started with an audit of the live site in headless Chromium (Playwright): desktop
1440×900, tablet 834×1112, iPhone 13 and Pixel 7, with and without CPU throttling and with
`prefers-reduced-motion`. Below are the findings, what changed and how it was verified, and
the references and prompt patterns behind the decisions.

## Audit findings (before)

| Area | Finding |
| --- | --- |
| Home | Wheel and swipe did nothing (`scrollY` stayed 0). The page was a fixed `100dvh` screen with no input handlers. |
| Home, mobile | The hero card covered about 65% of the screen, leaving roughly two rows of the wall visible. |
| Home wall | Ink bands on an ink background read as stripes, not covers. Overlapping covers clipped titles ("ROBINSON CRUS"). Genre colour appeared only on hover, so never on touch. |
| Shuffle | Mid-animation, covers lost their outline against the background; the effect looked chaotic. |
| Covers | Four hard-coded size tiers with pixel font sizes; a heavy frame at small sizes; flat paper; black bands everywhere except the book-page hero. |
| Neighbourhood | Pills overlapped (e.g. Egyptian Nights / Italo Calvino / Confessions). Labels were cut at 20 characters. SVG lines scaled while pills didn't, so the two drifted apart at 640–1100px. The graph was static, and "+N more" did nothing. |
| Book page | 4,900 of 7,278 mentions carry a quote or context note in the DB, but none were shipped. The mobile page was about 11.8k px tall at 3×. |
| Network | 20 fps idle on desktop, about 8 fps on mobile emulation, about 1 fps panning at 4× throttle (600–1100 ms long tasks). Root cause: ~10k DOM size reads and array allocations per frame. |
| Motion | No page transitions. The SMIL logo and hero arc ignored reduced motion. |

## What changed

1. **Covers** (`P.coverHTML`, `.cv` CSS): one Penguin tri-band component sized entirely in container units (`cqi`), so it renders cleanly at every size.
   - Band colour is a `color-mix` driven by a registered `--lit` property (0 = ink, 1 = genre colour), so it can transition smoothly.
   - Titles use Gill Sans (Apple devices) with Cabin as the fallback, plus `text-wrap: balance`.
   - Paper detail: spine shading, a sheen that follows the pointer, and a 3D tilt on fine pointers.
   - The same HTML string is used by React pages and by the home engine.
2. **Home** (`home.js`): the wall now scrolls, drags and loops while the search box stays put.
   - Smoothing, release inertia, a slow ambient drift, and covers recycled in a ring buffer.
   - The hero compacts to a slim search bar once you start scrolling.
   - Colour spotlight: covers light up near the cursor, or sweep into colour as they cross the centre of the screen while you scroll on touch.
   - Shuffle reseeds the wall and flings it.
   - A doodled graph-paper backdrop sits on two parallax layers (grid 0.3×, doodles 0.6×).
   - Three variants share the engine: A endless shelf (default), B infinite canvas (neighbour arcs on hover), C shelf rows.
3. **Route transitions**: same-document View Transitions. A clicked cover morphs into the book-page hero.
4. **Book page**:
   - The neighbourhood is a full-width fan: mentioned-by on the left, mentions on the right, mutual mentions as two-way edges. On narrow screens it becomes a tree. Labels are measured so they never overlap; edges draw in, and "+N more" expands.
   - Mention cards show the quote or context from the lazily loaded `bookjumpr-notes.js`.
   - On mobile the cover sits beside the title.
   - A "Your jumps" trail of recently visited books, and a `#/network/<book>` deep link.
5. **Network**: per-frame cost cut about 10×.
   - The canvas size is cached; every node is projected once per frame into typed arrays.
   - Edges are bucketed by weight so stroke style is set once per bucket; picking does a cheap reject before measuring distance.
   - DPR is capped at 2, and purely ambient motion redraws at about 30 fps.
6. **Polish**:
   - Search suggestions show mini covers and support arrow-key navigation.
   - The sticky header hides while scrolling down.
   - Under reduced motion, SMIL animations jump to their end frame and freeze.

## Measurements (headless Chromium, software GPU, so treat as relative)

| | Before | After |
| --- | --- | --- |
| Network draw time, desktop (p50) | 16 ms | 1.4 ms |
| Long tasks during network pan, desktop | 26 | 3 |
| Network draw time, mobile at 4× throttle | 76 ms | 12 ms |
| Home engine JS per frame (p95) | — | under 3 ms |
| Neighbourhood label overlaps (Crime and Punishment, collapsed and expanded) | several | 0 |
| Console errors / horizontal scroll (12 routes × desktop, tablet, mobile, reduced motion) | — | none |

## References

- Codrops tutorials:
  - [Infinite Parallax Grid](https://tympanus.net/codrops/2025/06/11/building-an-infinite-parallax-grid-with-gsap-and-seamless-tiling/) (2025)
  - [Infinite Canvas](https://tympanus.net/codrops/2026/01/07/infinite-canvas-building-a-seamless-pan-anywhere-image-space/) (2026)
  - [Infinite Scroll Gallery with Flip transitions](https://tympanus.net/codrops/2026/07/30/building-an-infinite-gsap-scroll-gallery-with-parallax-and-flip-transitions/) (2026)
- [The Pudding — 5,000 book covers](https://pudding.cool/2019/07/book-covers/).
- [scrolltide.co](https://www.scrolltide.co/): scroll-driven "cinematic" templates built on Lenis and GSAP ScrollTrigger. Its pages (and the referenced X posts) are blocked from the build container, so it was studied through search results only.

## Prompt patterns worth reusing

- **One bold moment.** "Use non-user-triggered motion sparingly… a single orchestrated moment lands better than scattered effects; spend your boldness in one place." (Anthropic, frontend-design skill). Here, that moment is the wall.
- **Animation rules.** "UI animations should stay under 300ms · exit animations ~20% faster than entrance · elements that animate together share easing and duration · don't animate what users see 100+ times a day." (Emil Kowalski / Vercel, web-animation-design).
- **Infinite wall spec.** "Toroidal wrap-around grid of cover tiles. Render only the viewport plus one ring, recycle DOM nodes, position with translate3d. Pointer-capture drag; velocity from the last ~100ms; friction ~0.94/frame, dt-normalised; wheel adds velocity; touch-action:none; reduced motion = no inertia or auto-drift."
- **Glowing network graph.** "Force layout in a worker (Barnes-Hut), additive blending so dense clusters self-brighten, node size by degree, Louvain communities for colour." Communities already exist in `analysis/communities.json` and are a natural next step for the network view.
- **Staged prompting.** Build layout, then motion, then particles, one layer per prompt. Name the stack and constraints first (including `prefers-reduced-motion`).

## Follow-ups after first review

- **Home hide list.** `HOME_HIDE` in `app.js` lists hate propaganda, explicit erotica and dated race/eugenics texts. It keeps them off the home walls, the shelf rows and the suggestion chips. They stay in search, on book pages and in the network.
- **Network Explorer (`?net=v2`).** It takes the book page's neighbourhood fan, which reviewers found the clearest view, and makes it the whole network experience:
  - one book sits in the middle;
  - click any pill to jump, and the pill morphs into the centre while the book you came from slides into the new fan;
  - hovering a pill shows how the two books connect, with the mention quote;
  - a jump trail and a "Find a path to…" tool;
  - the entry screen offers search, quick picks, "Surprise me" and Louvain "reading neighbourhoods" (`npm run bj:regions`).
  - The constellation map stays the default; `?net=map` switches back.

- **Network Atlas (`?net=v3`).** The whole network on one canvas, grouped into Louvain neighbourhoods (`npm run bj:atlas`); click to focus a book. Testers found it beautiful but the "Around Hamlet" groupings arbitrary and the circles too strict.
- **Explorer+ (`?net=v4`).** It leans into the Explorer and borrows the map's best parts as supporting layers:
  - the fan comes alive: dashes flow along each line in the mention's direction (in toward the centre, out away from it; mutual stays still), the centre pill has a slow heartbeat, and a spark runs along the edge you just hopped;
  - genre instead of neighbourhoods: genre chips over the fan act as both a legend and a filter (both sides are filtered before layout, so big fans shrink), and the entry's "Places to start" uses the themed shelves from the home wall;
  - the panel opens with a living mini-map ("Where you are"): every book as a star in its genre colour, your hops drawn across it in ink, and the camera glides to each new neighbourhood;
  - clicking it opens a full-screen star map with zoom, pan, pinch, search, a legend, flowing in/out lines for the selected star, and "Hop here" (or double-click) to jump the fan there. Esc closes it.
  - The stars come from `npm run bj:stars` (`build-atlas.mjs --organic`): the same communities with seeded jitter and tighter gaps, and no circles or names.
  - None of the motion runs under reduced motion; the ambient loop pauses when the canvas is off screen.

- **The connected experience (`?v=next`).** After testing Explorer+, the fan became the book page and the map became the zoomed-out view of the same thing:
  - **Book page** (`#/<author>/<title>`) = the fan in the middle (flowing lines, genre chips, spark on each hop), the panel (mini-map, cover, author link, synopsis, path finder) and every mention below as compact quote cards in two columns, "Mentions" and "Mentioned by". The genre chip filters the cards too, and hovering a card lights its pill.
  - **Network page** (`#/network`) = the star map: every book in its genre continent, named in its genre colour. Click a star to see its flowing in/out lines and a card.
  - **Zoom out**: the fan's pills fly to their stars and shrink into dots while the map fades in around them. **Open →** (or double-clicking a star) runs it in reverse, so the star's neighbours fly into the new fan's pills.
  - "Places to start" and the "your hops" line are gone.
  - **Genre continents** (`npm run bj:stars`, `tools/build-stars.mjs`): each book sits in its genre's area. The 41% without a genre join the genre most of their linked books have, but still draw grey. Inside a continent, books that mention each other cluster (Louvain on that genre's subgraph), and related genres border each other.
  - Reduced motion, the back button and deep links swap with no morph.

- **`?v=next`, round 2 (after phone testing).**
  - **Book page on phones** is built for portrait:
    - a slim header (small cover, title, author link, counts) with a map thumbnail that zooms out;
    - a 2-line synopsis that expands;
    - the fan as two swipeable **cover shelves** ("Mentioned by" above, "Mentions" below), with flowing lines into the book that follow the covers as you swipe. Tapping a cover opens a sheet with the quote and "Jump →";
    - **tabs** for the two lists, so a long "Mentions" list no longer buries "Mentioned by".
  - On tablets the book panel comes first. Everywhere, the genre chips and "Find a path to…" are gone, and the floating Classic/Next pill is desktop-only (the page ends with a "Switch to the classic view" link).
  - **Map:** no title block and no big legend, just continent names and a one-line key when a book is selected.
    - Continents get a soft tint, and their names stay visible (dimmed) while a book is selected, so you keep your bearings.
    - Hubs label their 30 best-connected neighbours.
  - **Continents are now one disc each:** sub-communities are wedges of a single sunflower. Unknown-genre books sit toward the rim and are drawn lighter, and names are anchored just above the actual dots.

- **Lab variants (`?v=lab`): the map as points, popular books first.**
  - The cover views (Canon, Timeline, Fame as covers) were dropped: books should be points.
  - `tools/build-layouts.mjs` (`npm run bj:layouts` → `layouts-data.js`) lays out all 4,910 books four ways, all drawn by the same canvas renderer (`atlas.js`) as the star map:
    - **Spiral:** one sunflower spiral sorted by connections. The most connected sit at the centre and the one-off name-drops form the outer haze; guide rings mark 50+ / 20+ / 10+ / 5+ / 2+ links.
    - **Petals:** the same spiral, but each genre owns a wedge sized to it. A mixed heart of famous books sits in the centre and genres fan out as petals (names at the tips); inside a petal, books that mention each other take neighbouring angles.
    - **Band:** the petals unrolled into a strip that **loops sideways forever**. Genres are columns in the petals' circular order, and distance from the middle line is popularity (√ of rank, so the famous get room). Scroll or drag to travel round; pinch, ⌘-scroll or +/− zooms.
    - **Wrap:** one starfield filling a surface whose edges join (left↔right and top↔bottom), so you can pan in any direction forever with each book drawn once.
      - The continents are only the starting arrangement. Every star then pushes its neighbours apart until the spacing is even (20 units), while mention links pull gently, so there are no blobs: genres become territories that blend at their borders, and the field fills the screen.
    - Both use `atlas.js` `wrapX`/`wrapY`: each book is drawn at its copy nearest the camera, picking works across the seams, selection flies the short way round, and the view is never wider than one loop.
    - **Blend:** the 302 books with 10+ links form a sorted core; each genre's other books form a filled disc around it.
    - **Fame:** a binned chart. x = how many books it mentions, y = how many mention it, in bins 0 · 1 · 2 · 3–5 · 6–10 · 11–20 · 21–50 · 51+, with solid grid lines between them.
      - Every square is a **neighbourhood**: its books packed as one round cluster, most connected in the middle, with a tint and a count once it has 12+ books. Columns and rows are as wide as their biggest neighbourhood, and the very largest packs tighter.
      - Selecting a book **bundles** its links: 3+ links of one kind into one neighbourhood become a single thicker line to its edge with a count badge (e.g. Don Quixote → 38 into the 3,385 one-off books), while the books inside still light up.
      - Corner captions (the canon, hubs, footnotes, name-droppers) are pinned to the chart's corners.
  - Selection, card, Open → and the dot zoom-out morph work the same in every variant.
  - At overview, the 25 most connected books are labelled (10 on phones).
  - The switcher choice is remembered for the session.

## Next steps (not done)

- Colour or cluster the network by community (`analysis/communities.json`). Consider WebGL points if real phones still struggle.
- Bring the About page's CSS mini-covers onto `P.coverHTML`.
- On B, a long press on touch could show the neighbour arcs that desktop gets on hover.
