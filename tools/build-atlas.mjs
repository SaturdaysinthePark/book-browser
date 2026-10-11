#!/usr/bin/env node
// build-atlas.mjs — layout for the network "Atlas" (#/network with ?net=v3).
//
// The constellation map lays books out in rings by connection count, so related books end up
// scattered. The Atlas groups them instead:
//   1. Louvain communities over the undirected mention graph (same as build-regions.mjs).
//   2. Inside each community, a sunflower (phyllotaxis) spiral sorted by connections: the hubs sit
//      in the middle and everything else spirals outward — compact, overlap-free, deterministic.
//   3. Communities are packed as circles by a small force simulation: springs pull communities
//      that mention each other together, collisions keep them apart, gentle gravity keeps the
//      whole map round. Unconnected little islands settle around the edge.
//
// Output: atlas-data.js →
//   window.BookJumprAtlas = { nodes: [[key, x, y, regionIdx, degree], …],
//                             regions: [{ x, y, r, name, authors, size, hub }] }
// Only regions with >= LABEL_MIN books get a name; the rest have name ''.
//
// Run:  npm run bj:atlas
//
// --organic (npm run bj:stars) writes stars-data.js (window.BookJumprStars) for Explorer+ (?net=v4)
// instead: same communities, but seeded jitter on every book and tighter gaps between groups, so
// they read as loose constellations rather than perfect spirals in circles. atlas-data.js is untouched.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadData, mulberry32, buildLevel, louvain, modularity } from './cluster-communities.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORGANIC = process.argv.includes('--organic');
const SPACING = 13;      // world units between neighbouring books inside a region
const GAP = ORGANIC ? 12 : 26;   // breathing room between region circles
const JITTER = ORGANIC ? 0.35 : 0;   // ± this share of SPACING, per book
const LABEL_MIN = 10;    // regions at least this big get a name
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const { NODES, MENTIONS } = loadData(join(ROOT, 'bookjumpr-data.js'));
const idOf = new Map(), keyOf = [];
const id = (k) => { if (!idOf.has(k)) { idOf.set(k, keyOf.length); keyOf.push(k); } return idOf.get(k); };
const edges = [], seen = new Set(), deg = new Map();
for (const [s, t] of MENTIONS) {
  if (s === t) continue;
  deg.set(s, (deg.get(s) || 0) + 1); deg.set(t, (deg.get(t) || 0) + 1);
  const a = id(s), b = id(t), pk = a < b ? a + '-' + b : b + '-' + a;
  if (seen.has(pk)) continue;
  seen.add(pk); edges.push([a, b, 1]);
}
const n = keyOf.length;
const base = buildLevel(n, edges);
const rng = mulberry32(1);
let best = null;
for (let r = 0; r < 10; r++) { const c = louvain(base, 1, rng); const q = modularity(base, c, 1); if (!best || q > best.q) best = { c, q }; }
const comm = best.c;

// ---- communities, ordered by size ----
const byComm = new Map();
for (let i = 0; i < n; i++) { if (!byComm.has(comm[i])) byComm.set(comm[i], []); byComm.get(comm[i]).push(i); }
const groups = [...byComm.values()].sort((a, b) => b.length - a.length || (keyOf[a[0]] < keyOf[b[0]] ? -1 : 1));
const gOf = new Int32Array(n);
groups.forEach((g, gi) => g.forEach((i) => { gOf[i] = gi; }));
const dg = (i) => deg.get(keyOf[i]) || 0;

// ---- 2. sunflower inside each region (local coords around 0,0) ----
const local = new Float64Array(n * 2);
const jrng = mulberry32(11);
const R = groups.map((g) => {
  g.sort((a, b) => dg(b) - dg(a) || (keyOf[a] < keyOf[b] ? -1 : 1));
  g.forEach((i, j) => {
    const rr = SPACING * Math.sqrt(j + (j ? 0.6 : 0)), th = j * GOLDEN;
    const jx = j ? (jrng() * 2 - 1) * JITTER * SPACING : 0, jy = j ? (jrng() * 2 - 1) * JITTER * SPACING : 0;
    local[i * 2] = Math.cos(th) * rr + jx; local[i * 2 + 1] = Math.sin(th) * rr + jy;
  });
  return SPACING * Math.sqrt(g.length + 0.6) + 6;
});

// ---- 3. pack regions: springs between related regions + collisions + gravity ----
const G = groups.length;
const cross = new Map();
for (const [a, b] of edges) {
  const ga = gOf[a], gb = gOf[b];
  if (ga === gb) continue;
  const k = ga < gb ? ga * G + gb : gb * G + ga;
  cross.set(k, (cross.get(k) || 0) + 1);
}
const links = [...cross.entries()].map(([k, w]) => [Math.floor(k / G), k % G, w]);
const px = new Float64Array(G), py = new Float64Array(G);
const prng = mulberry32(7);
for (let g = 0; g < G; g++) {   // seed on a spiral, biggest in the middle
  const rr = 40 * Math.sqrt(g) * 6, th = g * GOLDEN;
  px[g] = Math.cos(th) * rr + (prng() - 0.5); py[g] = Math.sin(th) * rr + (prng() - 0.5);
}
for (let it = 0; it < 600; it++) {
  const cool = 1 - it / 600;
  const fx = new Float64Array(G), fy = new Float64Array(G);
  for (const [a, b, w] of links) {               // related regions attract
    const dx = px[b] - px[a], dy = py[b] - py[a], d = Math.hypot(dx, dy) || 1;
    const target = R[a] + R[b] + GAP, f = (d - target) * 0.02 * Math.min(4, Math.sqrt(w));
    fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f;
  }
  for (let g = 0; g < G; g++) {                  // gentle gravity, weaker for big regions
    fx[g] -= px[g] * 0.004; fy[g] -= py[g] * 0.004;
  }
  for (let g = 0; g < G; g++) { px[g] += fx[g] * (0.4 + cool); py[g] += fy[g] * (0.4 + cool); }
  for (let pass = 0; pass < 2; pass++) {         // resolve overlaps
    for (let a = 0; a < G; a++) for (let b = a + 1; b < G; b++) {
      const dx = px[b] - px[a], dy = py[b] - py[a], d = Math.hypot(dx, dy) || 0.01, min = R[a] + R[b] + GAP * 0.6;
      if (d >= min) continue;
      const push = (min - d) / 2, ux = dx / d, uy = dy / d;
      const wa = R[b] / (R[a] + R[b]), wb = R[a] / (R[a] + R[b]);   // small regions move more
      px[a] -= ux * push * 2 * wa; py[a] -= uy * push * 2 * wa; px[b] += ux * push * 2 * wb; py[b] += uy * push * 2 * wb;
    }
  }
}
// Settle: collisions only (springs off), so no two regions overlap in the final map.
for (let it = 0; it < 400; it++) {
  let moved = 0;
  for (let a = 0; a < G; a++) for (let b = a + 1; b < G; b++) {
    const dx = px[b] - px[a], dy = py[b] - py[a], d = Math.hypot(dx, dy) || 0.01, min = R[a] + R[b] + GAP * 0.5;
    if (d >= min) continue;
    const push = (min - d) / 2 + 0.01, ux = dx / d, uy = dy / d;
    const wa = R[b] / (R[a] + R[b]), wb = R[a] / (R[a] + R[b]);
    px[a] -= ux * push * 2 * wa; py[a] -= uy * push * 2 * wa; px[b] += ux * push * 2 * wb; py[b] += uy * push * 2 * wb;
    moved++;
  }
  for (let g = 0; g < G; g++) { px[g] *= 0.999; py[g] *= 0.999; }   // a whisper of gravity keeps it compact
  if (!moved && it > 20) break;
}
// recentre
let cx = 0, cy = 0, tot = 0;
for (let g = 0; g < G; g++) { const w = groups[g].length; cx += px[g] * w; cy += py[g] * w; tot += w; }
cx /= tot; cy /= tot;

const overridesPath = join(ROOT, 'tools', 'region-names.json');
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};
const round = (v) => Math.round(v * 10) / 10;
const regions = groups.map((g, gi) => {
  const hubKey = keyOf[g[0]], big = g.length >= LABEL_MIN;
  const authors = [];
  if (big) for (const i of g) { const a = NODES[keyOf[i]] && NODES[keyOf[i]][1]; if (a && a !== 'Anonymous' && authors.indexOf(a) < 0) authors.push(a); if (authors.length === 3) break; }
  const title = NODES[hubKey] ? NODES[hubKey][0] : hubKey;
  return { x: round(px[gi] - cx), y: round(py[gi] - cy), r: round(R[gi]), size: g.length, hub: hubKey,
    name: big ? (overrides[hubKey] || 'Around ' + title) : '', authors };
});
const nodes = [];
for (let i = 0; i < n; i++) {
  const gi = gOf[i];
  nodes.push([keyOf[i], round(px[gi] - cx + local[i * 2]), round(py[gi] - cy + local[i * 2 + 1]), gi, dg(i)]);
}
const out = { nodes, regions };
const file = ORGANIC ? 'stars-data.js' : 'atlas-data.js';
writeFileSync(join(ROOT, file),
  '// GENERATED by tools/build-atlas.mjs' + (ORGANIC ? ' --organic' : '') + ' from bookjumpr-data.js — do not hand-edit.\n'
  + (ORGANIC
    ? '// Explorer+ star map: the Atlas communities as loose constellations (jittered, tighter gaps).\n'
      + 'window.BookJumprStars = '
    : '// Network "Atlas" layout: books grouped by reading neighbourhood (Louvain), hubs at each centre.\n'
      + 'window.BookJumprAtlas = ')
  + JSON.stringify(out) + ';\n');
const named = regions.filter((r) => r.name).length;
console.log(`✓ wrote ${file} — ${n} books, ${G} regions (${named} named), Q=${best.q.toFixed(3)}`);
