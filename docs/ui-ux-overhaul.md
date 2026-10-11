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

## Next steps (not done)

- Colour or cluster the network by community (`analysis/communities.json`). Consider WebGL points if real phones still struggle.
- Bring the About page's CSS mini-covers onto `P.coverHTML`.
- On B, a long press on touch could show the neighbour arcs that desktop gets on hover.
