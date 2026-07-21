#!/usr/bin/env node
// build-book-graph.mjs — precompute the Constellation page's data, offline, from the DB.
//
// Reads bookjumpr.db (the source of truth) and emits constellation-data.js:
//   window.BookGraph = { all, fiction, nonfiction }
// where each of those three is its own independently-computed graph —
//   { meta, nodes, edges, leaves, leavesFor }
// a file://-friendly global, exactly like network-data.js / bookjumpr-data.js.
//
// Three lenses, three independent layouts: "all" is the full mention graph; "fiction" and
// "nonfiction" are defined by the CITING (source) book's category, not the target's — a mention
// (source, target) belongs to the Nonfiction lens iff the source is nonfiction, regardless of
// what it cites; the target shows up too, whatever its own genre. A book earns a spot only via
// its own citing/cited-by activity within that lens's source-category — being cited by the OTHER
// category earns it nothing. So a nonfiction book that's only ever cited by fiction books doesn't
// appear in the Nonfiction lens, while a novel heavily quoted by nonfiction essayists DOES appear
// there (as a target/hub), and independently may also appear in the Fiction lens if it has its
// own fiction-sourced citation activity — lenses are not a strict partition of books by genre.
// Each lens reruns the ENTIRE pipeline below fresh (degree, backbone/leaf split, PageRank label
// priority, radial force sim) over its own filtered mention set.
//
// The design: a radial "constellation". The mention graph is split into
//   backbone — books that are a source, or are cited by >1 book (rendered as stars, given x/y)
//   leaves   — books cited by exactly one hub and citing nothing (rim books; positioned on
//              demand in the UI, so they carry no x/y here, only a leavesFor hub mapping)
// Backbone nodes are laid out by a Fruchterman-Reingold force sim PLUS a radial spring that
// pulls each node toward a target radius = f(degree): most-connected → center, so the guide
// rings ("20+/8+/3+/1+ CONNECTIONS") read as real connection tiers. A tangential angular-spread
// force evens the star density around the circle so edge-attraction can't collapse the field
// into a one-sided arc (which read as an "off-center" constellation). `ls` is a PageRank-style
// popularity used only for label priority. Deterministic (seeded) → byte-stable output.
//
// NOTE (data limits): the DB's `mentions` table is UNIQUE(source,target), so every edge weight
// is 1 (flow-line thickness / strongest-link are uniform — they degrade gracefully). Node x/y
// are freshly computed here and intentionally do NOT match the design handoff's frozen coords;
// fidelity lives in the renderer, layout comes from data.
//
// Run:  npm run bj:graph      (adds --experimental-sqlite for you)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { open } from './db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EXTENT = 2000;          // world is EXTENT×EXTENT, centered at origin (coords ≈ ±1000)
const RIM = EXTENT / 2 - 40;  // outermost usable radius (matches the engine's leaf rim)

// Guide-ring anchors: a book with v+ total connections sits within radius r. The radial layout
// is anchored to exactly these, so the rings mark the band boundaries.
const RING_ANCHORS = [{ v: 20, r: 210 }, { v: 8, r: 440 }, { v: 3, r: 710 }, { v: 1, r: 920 }];
const INNER_R = 56;           // radius the single most-connected book is pulled toward

// Fiction/nonfiction from genre (MISC/unknown → fiction; matches the corpus's heavy fiction skew).
const NONFICTION = new Set([
  'HISTORY', 'BIOGRAPHY & MEMOIR', 'PHILOSOPHY', 'PSYCHOLOGY', 'POLITICS & WORLD',
  'BUSINESS & ECONOMICS', 'ESSAYS & JOURNALISM', 'FOOD & COOKING',
]);
const isFiction = (genre) => (NONFICTION.has(String(genre || '').trim().toUpperCase()) ? 0 : 1);

// deterministic RNG (mulberry32) so the layout is stable run-to-run
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Target radius (from origin) for a node of total degree `deg`. Monotonic-decreasing, anchored
// on the ring boundaries: deg=1→920, 3→708, 8→425, 20→177, maxDeg→INNER_R.
function targetRadius(deg, maxDeg) {
  const [r20, r8, r3, r1] = [210, 440, 710, 920];
  if (deg >= 20) { const hi = Math.max(21, maxDeg); const t = Math.min(1, (deg - 20) / (hi - 20)); return r20 + (INNER_R - r20) * t; }
  if (deg >= 8) { const t = (deg - 8) / (20 - 8); return r8 + (r20 - r8) * t; }
  if (deg >= 3) { const t = (deg - 3) / (8 - 3); return r3 + (r8 - r3) * t; }
  const t = Math.max(0, (deg - 1)) / (3 - 1); return r1 + (r3 - r1) * t;
}

// Runs the full backbone/leaf split + degree + PageRank + radial-force-layout pipeline over
// whatever (bookRows, mentionRows) subset it's handed — this is what makes each lens ("all",
// "fiction", "nonfiction") an independently-recomputed graph rather than a filtered view of one.
// `mentionRows` is already filtered by whatever rule defines this lens (for fiction/nonfiction:
// source's category — see file header); everything below is genre-blind and just builds a graph
// out of whatever mentions it's given, exactly like the "all" lens already did from the start.
function buildGraphForMode(label, bookRows, mentionRows) {
  const book = new Map();
  for (const r of bookRows) book.set(r.slug, r);

  // ---- degrees + citer sets (from this mode's mentions, incl. leaf-targeted ones) ----
  const outDeg = new Map(), inDeg = new Map(), sourcesOf = new Map(), touched = new Set();
  for (const [s, t] of mentionRows) {
    if (s === t) continue;
    outDeg.set(s, (outDeg.get(s) || 0) + 1);
    inDeg.set(t, (inDeg.get(t) || 0) + 1);
    if (!sourcesOf.has(t)) sourcesOf.set(t, new Set());
    sourcesOf.get(t).add(s);
    touched.add(s); touched.add(t);
  }
  const oOf = k => outDeg.get(k) || 0;
  const iOf = k => inDeg.get(k) || 0;

  // ---- split: leaf = cited by exactly one source AND cites nothing; else backbone ----
  const isLeaf = (k) => oOf(k) === 0 && (sourcesOf.get(k)?.size || 0) === 1;
  const universe = [...touched].filter(k => book.has(k));   // books that appear in this mode's mention graph
  const backboneKeys = universe.filter(k => !isLeaf(k));
  const leafKeys = universe.filter(k => isLeaf(k));

  // deterministic node order: descending total degree, then slug (index 0 = most connected)
  backboneKeys.sort((a, b) => (oOf(b) + iOf(b)) - (oOf(a) + iOf(a)) || (a < b ? -1 : 1));
  const bIdx = new Map(backboneKeys.map((k, i) => [k, i]));
  const isBackbone = k => bIdx.has(k);

  // ---- backbone edges + leavesFor (leaves grouped under their single citing hub) ----
  const leafIdx = new Map(leafKeys.map((k, i) => [k, i]));
  const edgeSet = new Set();     // dedupe (should already be unique) "a>b"
  const edges = [];
  const leavesFor = {};
  for (const [s, t] of mentionRows) {
    if (s === t || !isBackbone(s)) continue;         // every source is backbone (it has out>0)
    if (isBackbone(t)) {
      const a = bIdx.get(s), b = bIdx.get(t), key = a + '>' + b;
      if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([a, b, 1]); }
    } else if (leafIdx.has(t)) {
      const hub = bIdx.get(s), li = leafIdx.get(t);
      (leavesFor[hub] || (leavesFor[hub] = [])).push(li);
    }
  }

  // ---- ls: PageRank-style popularity over the backbone graph (label priority only) ----
  const n = backboneKeys.length;
  const outAdj = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) outAdj[a].push(b);
  let pr = new Array(n).fill(1 / n);
  const dcy = 0.85;
  for (let it = 0; it < 50; it++) {
    const next = new Array(n).fill((1 - dcy) / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) { if (outAdj[i].length === 0) dangling += pr[i]; else { const share = dcy * pr[i] / outAdj[i].length; for (const j of outAdj[i]) next[j] += share; } }
    const dShare = dcy * dangling / n;
    for (let i = 0; i < n; i++) next[i] += dShare;
    pr = next;
  }
  const maxPr = Math.max(...pr, 1e-9);
  const lsOf = i => +(pr[i] / maxPr * 95 + 0.3).toFixed(2);

  // ---- degree-radial force layout for the backbone ----
  const rng = mulberry32(7);
  const degOf = i => oOf(backboneKeys[i]) + iOf(backboneKeys[i]);
  const maxDeg = Math.max(...backboneKeys.map((k) => oOf(k) + iOf(k)), 1);
  const Rt = new Array(n);
  const px = new Array(n), py = new Array(n);
  for (let i = 0; i < n; i++) {
    Rt[i] = targetRadius(degOf(i), maxDeg);
    const a = i * Math.PI * (3 - Math.sqrt(5)) + rng() * 0.3;   // golden-angle seed + tiny jitter
    px[i] = Math.cos(a) * Rt[i]; py[i] = Math.sin(a) * Rt[i];
  }
  const ITERS = 600, KREP = 0.9, KATT = 0.018, REST = 62, KRAD = 0.22, KANG = 100;
  // Cap on the per-iteration angular-spreading rotation (see below) — `want = 2π/n` grows as n
  // shrinks, so on a small/sparse lens (e.g. ~230 nodes) KANG*deficit can reach >2 radians in a
  // single step: applied as a straight tangential displacement, that badly overshoots the actual
  // circular correction and compounds into an exponential blow-up over 600 iterations (every node
  // ends up pinned to the rim). Capping keeps each step in the small-angle-safe range regardless
  // of n; empirically a no-op for graphs large/dense enough to never approach this cap (verified
  // against the ~1000- and ~750-node lenses — zero cap engagements, byte-identical output).
  const ANG_STEP_CAP = 0.85;
  // per-node personal-space radius, scaled by degree — high-degree hubs render as bigger circles
  // (see nodeR() in constellation-view.js) and get pulled toward the same crowded inner band, so
  // they need more separation than low-degree rim stars get from a flat SEP.
  const sep = new Array(n);
  for (let i = 0; i < n; i++) sep[i] = 22 + Math.min(46, Math.sqrt(degOf(i)) * 6);
  const order = new Array(n), th = new Array(n);
  for (let it = 0; it < ITERS; it++) {
    const cool = 1 - it / ITERS;                 // 1 → 0
    const step = 0.9 * cool + 0.15;
    const dx = new Array(n).fill(0), dy = new Array(n).fill(0);
    // short-range anti-overlap repulsion (keeps stars from stacking without global spreading)
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      let ex = px[a] - px[b], ey = py[a] - py[b];
      let d = Math.hypot(ex, ey); if (d < 1e-4) { ex = rng() - 0.5; ey = rng() - 0.5; d = 1e-4; }
      const SEP = sep[a] + sep[b];
      if (d < SEP) { const f = KREP * (SEP - d) / d; dx[a] += ex * f; dy[a] += ey * f; dx[b] -= ex * f; dy[b] -= ey * f; }
    }
    // edge attraction (connected books form neighborhood arcs)
    for (const [a, b] of edges) {
      const ex = px[a] - px[b], ey = py[a] - py[b];
      const d = Math.hypot(ex, ey) || 1e-4; const f = KATT * (d - REST);
      dx[a] -= (ex / d) * f; dy[a] -= (ey / d) * f; dx[b] += (ex / d) * f; dy[b] += (ey / d) * f;
    }
    // radial spring toward degree-target radius (forms the ring structure)
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(px[i], py[i]) || 1e-4;
      const f = KRAD * (Rt[i] - r);
      dx[i] += (px[i] / r) * f; dy[i] += (py[i] / r) * f;
    }
    // angular spreading: even the star density around the circle so edge-attraction can't collapse
    // the whole field into a one-sided arc. Sort by angle; where two angular neighbors sit closer
    // than the even spacing (2π/n), push them apart *tangentially* (perpendicular to their radius),
    // which evens the density without disturbing each node's degree-target radius / the guide rings.
    for (let i = 0; i < n; i++) { order[i] = i; th[i] = Math.atan2(py[i], px[i]); }
    order.sort((a, b) => th[a] - th[b]);
    const want = 2 * Math.PI / n;
    for (let s = 0; s < n; s++) {
      const i = order[s], j = order[(s + 1) % n];
      let g = th[j] - th[i]; if (g < 0) g += 2 * Math.PI;
      const deficit = want - g;
      if (deficit > 0) {
        const f = Math.min(KANG * deficit, ANG_STEP_CAP);  // tangential unit dir (-y,x)/r, scaled by r ⇒ (-y,x)
        dx[i] += py[i] * f; dy[i] -= px[i] * f;   // nudge i backward along its ring
        dx[j] -= py[j] * f; dy[j] += px[j] * f;   // nudge j forward along its ring
      }
    }
    for (let i = 0; i < n; i++) { px[i] += dx[i] * step; py[i] += dy[i] * step; }
  }
  // recenter + clamp within rim (preserving each node's angle)
  let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += px[i]; cy += py[i]; } cx /= n; cy /= n;
  for (let i = 0; i < n; i++) {
    px[i] -= cx; py[i] -= cy;
    const r = Math.hypot(px[i], py[i]);
    if (r > RIM) { px[i] *= RIM / r; py[i] *= RIM / r; }
  }

  // ---- assemble ----
  const round = v => Math.round(v * 10) / 10;
  const nodes = backboneKeys.map((k, i) => {
    const r = book.get(k);
    return {
      n: r.title, a: r.author, x: round(px[i]), y: round(py[i]),
      o: oOf(k), i: iOf(k), f: isFiction(r.genre), yr: r.year || 0,
      sy: r.synopsis || '', ls: lsOf(i), key: k,
    };
  });
  const leaves = leafKeys.map((k) => { const r = book.get(k); return { name: r.title, a: r.author, key: k }; });

  const rings = RING_ANCHORS.filter(ring => backboneKeys.some(k => (oOf(k) + iOf(k)) >= ring.v));
  const meta = {
    books: backboneKeys.length + leafKeys.length,
    backbone: backboneKeys.length,
    edges: edges.length,
    leaves: leafKeys.length,
    rings, extent: EXTENT, exact: true,
    generatedFrom: 'bookjumpr.db',
  };

  console.log(`[${label}] universe:  ${meta.books} books  (${meta.backbone} backbone + ${meta.leaves} leaves)`);
  console.log(`[${label}] edges:     ${meta.edges} (backbone, weight 1)`);
  console.log(`[${label}] leavesFor: ${Object.keys(leavesFor).length} hubs`);
  console.log(`[${label}] rings:     ${rings.map(r => r.v + '+@' + r.r).join(', ')}`);
  console.log(`[${label}] maxDeg:    ${maxDeg}  (node[0] = ${nodes[0] && nodes[0].n})`);

  return { meta, nodes, edges, leaves, leavesFor };
}

function main() {
  const db = open();
  const bookRows = db.prepare(`
    SELECT slug,
           title,
           COALESCE(author, '')   AS author,
           COALESCE(year, 0)      AS year,
           COALESCE(synopsis, '') AS synopsis,
           COALESCE(genre, '')    AS genre
    FROM books
  `).all();
  const mentions = db.prepare(`SELECT source_slug AS s, mentioned_slug AS t FROM mentions ORDER BY id`).all().map(r => [r.s, r.t]);
  db.close();

  const all = buildGraphForMode('all', bookRows, mentions);

  // Fiction/nonfiction lenses: a mention belongs to a lens iff its SOURCE (the citing book) is
  // that category — the target can be either category and still appears (see file header). Both
  // lenses draw from the same full, unfiltered `bookRows` since a target of any genre is a valid
  // node candidate; only the mention filter differs.
  const cat = new Map(bookRows.map(r => [r.slug, isFiction(r.genre)]));
  const fictionMentions = mentions.filter(([s, t]) => s !== t && cat.get(s) === 1);
  const fiction = buildGraphForMode('fiction', bookRows, fictionMentions);

  const nonfictionMentions = mentions.filter(([s, t]) => s !== t && cat.get(s) === 0);
  const nonfiction = buildGraphForMode('nonfiction', bookRows, nonfictionMentions);

  const out = { all, fiction, nonfiction };
  const js = `// GENERATED by tools/build-book-graph.mjs from bookjumpr.db — do not hand-edit.\nwindow.BookGraph = ${JSON.stringify(out)};\n`;
  writeFileSync(join(ROOT, 'constellation-data.js'), js);

  console.log('constellation-data.js written (all / fiction / nonfiction)');
}

main();
