# Handoff: BookJumpr — Book Constellation Explorer

## Overview
An interactive "constellation" map of a book-mention network: ~1,800 books where an edge means Book A mentions Book B. Users pan/zoom a canvas-rendered starfield, search or tap popular books, and focus a book to trace its 1st-hop connections (with animated directional flow lines) and 2nd-hop onward citations. When idle, ambient "constellation tours" highlight long mention-chains one at a time.

**Scope note: BOOKS mode only.** The reference file also contains an AUTHORS mode (toggle in the header + `author-graph.js`). Do NOT implement the Authors experience yet — omit the BOOKS/AUTHORS toggle entirely and hard-code books mode. The data file for authors is intentionally not included.

## About the Design Files
The files in `reference/` are **design references created in HTML** — a working prototype showing intended look and behavior, not production code to copy directly. Recreate this design in your target codebase's existing environment (React, Vue, Svelte, vanilla TS, etc.) using its established patterns. If no environment exists yet, a small Vite + TypeScript app (React optional — the heavy lifting is one `<canvas>`) is the natural fit. The canvas rendering/interaction logic in the reference is framework-agnostic vanilla JS and CAN be ported nearly 1:1.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interaction timings are final. Recreate pixel-perfectly.

## Data

`data/book-graph.js` exports `BG` (use as-is; it will grow — treat as replaceable input):

```
BG.meta: { books, backbone, edges, leaves, extent (world size, px),
           rings: [{r, v}]  // guide circles: radius r = "v+ connections"
         }
BG.nodes: [{ n: title, a: author, x, y (precomputed layout coords),
             o: out-degree, i: in-degree, f: 1=fiction 0=nonfiction,
             yr: year, sy: synopsis, ls: label score (popularity for label priority) }]
BG.edges: [[fromIdx, toIdx, weight]]   // "from mentions to", weight = mention count
BG.leaves: [{ name }]                  // rim books cited by only one hub
BG.leavesFor: { hubIdx: [leafIdx...] }
```

Derived at load (see `prep()` in the reference): `adjOut`, `adjIn`, `neigh` (undirected neighbor sets), `order` (by total degree), `labelOrder` (by `ls`), and `chains` (precomputed tour paths — greedy walk following highest-weight out-edge, length 4–6, non-overlapping starts, shuffled).

## Screens / Views
Single full-viewport screen.

### Header (56px, flex row, 16px side padding, bottom border 1px #d8d3c4)
- Wordmark "BookJumpr" — Source Serif 4, 600, 20px.
- Stat line (desktop only) — IBM Plex Mono 10px, letter-spacing 0.1em, #8a8474, e.g. "528 OF 1786 BOOKS · 1258 TUCKED AT THE RIM · EXACT MENTION DATA".
- Search input (right-aligned; 220px desktop / 120px mobile) — 1px #1c1b18 border, 18px radius, bg #f9f8f3, mono 12px.
  - Dropdown (300px, border 1px #1c1b18, shadow `4px 4px 0 rgba(28,27,24,0.12)`): rows show title (serif 14px) + sub-line (mono 10px #8a8474 — author · N connections).
  - **Empty-focus state**: focusing the empty input shows the 6 most-connected books under a "MOST CONNECTED" header row (mono 8.5px, letter-spacing 0.16em).
  - Matches on title, author, and leaf names (leaves resolve to their citing hub). Use `onMouseDown` for row picks so blur doesn't eat the click.

### Canvas map (fills remaining viewport)
- Background #f4f2ec. DPR-aware sizing via ResizeObserver.
- Guide rings: dashed circles ([3,5] dash, rgba(28,27,24,0.055)) with "20+ CONNECTIONS" captions (mono 9px #b0a992) hidden while focused.
- Nodes: circles, radius `max(2.8, min(24, (2 + sqrt(o+i)*1.5) * sqrt(zoom) * 1.35))`; fill #f9f8f3, stroke #1c1b18 1.1px; inner dot when a node both mentions and is mentioned. Genre color on focus/hover: fiction #8f2d1a, nonfiction #2d6e52.
- Resting edges: #1c1b18, alpha `min(0.16, 0.05 + w*0.02)`, width `min(3, 0.5 + w*0.3)`.
- Labels: popularity-ordered (`ls`), collision-boxed, budget scales with zoom & viewport; Source Serif 4 italic 600, 10.5–17px, on a 0.88-alpha bg halo.
- Onboarding pulse: expanding ring on the most-connected node until first focus (rgba(143,45,26,·), 1.6s cycle).

### Ambient constellation tours (idle mode)
When nothing is focused: one precomputed chain (A→B→C→D…) fades in over 0.8s (#8f2d1a: 1.5px polyline at 0.55α, node halo rings at 0.7α, italic 12px labels with bg halos), holds 3.2s, fades out 0.8s, 0.7s gap, then the next chain. Any focus click stops it; clearing focus resumes. Tweakable off (`ambientTours` prop). Respect `prefers-reduced-motion` by disabling tours + flow-line animation (future-friendly addition).

### Focus mode (click/tap a node)
- **Auto-framing**: the camera fits the bounding box of focus + all hop-1 neighbors + top-8 hop-2 nodes (by `ls`) + leaf-bloom positions, with padding (desktop: 90 sides / 76 top / 110 bottom; mobile: 28 / 56 / 235 to clear the bottom chip). Zoom clamped to [0.28, 1.8] (mobile max 1.5). Ease-out cubic flyTo, 550ms.
- Outgoing mentions: animated dashed "flow" lines (#8f2d1a, dash [9,11], offset animates toward target). **Strongest link** (highest weight) drawn heavier (+0.8px) and brighter (0.85α vs 0.6).
- Incoming mentions: same flow style in #1a5f8f, flowing toward the focus.
- Hop-2 "onward" citations: faint dashed lines (#a0522d, dash [4,10], 0.28α) from each neighbor to what IT cites; hovering a neighbor isolates its chain (0.7α, others 0.08).
- Leaf bloom: rim-placed one-citation books on red flow lines with 2.5px dots and small italic labels.
- Non-neighborhood nodes dim to 0.12α; hop-2 to 0.45α.
- **Guaranteed labels**: focus (700 weight, genre color), every hop-1 neighbor (11px, #1c1b18), top-8 hop-2 (10px, #8a8474). Collision resolution tries above the node, then below.

### Focus chip (bottom-left card, 280px desktop / full-width mobile)
bg #f9f8f3, 1px #1c1b18 border, shadow `5px 5px 0 rgba(28,27,24,0.15)`, fadeIn 150ms.
- Title (serif 700 17px), author (mono 11px #5f5a4d), meta line (mono 9.5px #8a8474: FICTION/NONFICTION · year · mentions received/made).
- **STRONGEST LINK →** row (top out-edge by weight, else top in-edge): mono 8.5px #8f2d1a label + italic serif title, clickable → focuses that book. Divider `1px #e6e1d3` above.
- Buttons: DETAILS (solid #1c1b18) and OPEN PAGE ↗ (outline, only when `bookUrlPattern` prop set — pattern with `{title}`/`{author}` slug substitution).

### Details panel (replaces chip; 320px desktop / bottom-sheet 62% max-height mobile)
Header (title/author/meta/synopsis in italic serif 12.5px #3d3a33) + scrollable sections:
- "MENTIONED BY N BOOKS" (#1a5f8f) and "MENTIONS N BOOKS" (#8f2d1a); rows: italic serif 13px title + right-aligned mono 9.5px weight/onward info ("×3 → 7" = mentioned 3 times, chain continues to 7 more; "only here" for leaves). Rows click through to that book.

### Zoom rail (top-right column)
- "+" button (30px circle) / vertical rail (150px desktop, 96px mobile: 2px track at 0.22α, 16px draggable thumb, log-scale k∈[0.1,10], pointer-capture drag, wheel-over-rail zooms) / "−" button / "FIT" pill.
- Thumb position updates every frame from camera zoom (direct DOM style, not state).
- All buttons invert to #1c1b18/#f4f2ec on hover.

## Interactions & Behavior
- Drag to pan; wheel to zoom at cursor (`exp(-deltaY * 0.0016)`); pinch-zoom + tap on touch (8px slop, 500ms tap window, 20px touch pick tolerance vs 8px mouse).
- Click node → focus + auto-frame. Click same node / empty space / ✕ / Esc → clear focus (tours resume). FIT clears focus and fits world extent.
- Keyboard: `Esc` clears focus; `/` focuses search.
- Hover (desktop only): node fills genre color, cursor pointer; hovering acts as a transient focus preview.
- Render loop: rAF with dirty-flag; continuous redraw only while tweening, focused (flow animation), hovering, or idle-touring.

## State Management
`mode` (fixed 'books' for now), `focus` (node index | -1), `panelOpen`, `searchQ`, `searchResults`, `popular` (dropdown header flag), `isMobile` (<640px). Camera `{x, y, k}` + tween live outside reactive state (mutated per-frame). Tour: `tourIdx`/`tourT0` timestamps.

## Design Tokens
- Background #f4f2ec · surface #f9f8f3 · ink #1c1b18 · muted #8a8474 · faint #b0a992 · secondary text #5f5a4d / #3d3a33 · hairline #e6e1d3 / #d8d3c4 · hover fill #f0ecdf / #eee9db
- Accents: fiction/outgoing #8f2d1a · nonfiction #2d6e52 · incoming #1a5f8f · hop-2 #a0522d
- Type: Source Serif 4 (titles/labels, italic for book titles) + IBM Plex Mono (UI/meta). Google Fonts.
- Shadows: hard offset, no blur — `4-5px 4-5px 0 rgba(28,27,24,0.12-0.15)`
- Radii: 0 (cards/panels), 50% (round buttons), 13–18px (pills/input)
- Motion: flyTo 550ms ease-out-cubic; fadeIn 150ms; flow dash ~25fps drift; tour 0.8s/3.2s/0.8s/0.7s

## Growth / Data pipeline
The graph will keep growing. Keep the ingest contract: regenerate `book-graph.js` (nodes with precomputed x/y layout + `ls` scores, edges, leaves) offline and drop it in — the app derives everything else at load. For >5k nodes add: spatial grid for hit-testing, cached offscreen layer for resting edges/rings, viewport culling (already present for nodes/labels).

## Assets
None — no images or icons; everything is canvas-drawn or typographic. Fonts from Google Fonts (self-host in production if desired).

## Files
- `reference/Constellation v2.dc.html` — full working prototype (template markup + `Component` class with all canvas logic). The `<x-dc>` body is the DOM; the script class is the behavior. Ignore: `support.js` reference, the AUTHORS toggle, and `author-graph.js` import (books only).
- `data/book-graph.js` — production data, use as-is.
