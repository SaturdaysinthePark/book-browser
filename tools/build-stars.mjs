#!/usr/bin/env node
// build-stars.mjs — the star map layout for the ?v=next network (and Explorer+ ?net=v4).
//
// Books are laid out in genre "continents", so where a star sits and its colour say the same thing:
//   1. Continent per book: its genre (GEN3 names, as app.js's genreByName). Books without a genre
//      take the majority genre of the books they are linked to (label propagation over the mention
//      graph, a few passes); anything still unknown lands in a small "Unsorted" continent. The
//      book's own (unknown) genre is not changed — the map still draws it grey.
//   2. Inside a continent, books that mention each other sit together: Louvain on the continent's
//      own subgraph, each sub-community a sunflower (hubs in the middle, seeded jitter), packed.
//   3. Continents are packed as circles: springs pull genres that mention each other together,
//      collisions keep them apart, then a collision-only settle so none overlap.
//
// Output: stars-data.js →
//   window.BookJumprStars = { nodes: [[key, x, y, continentIdx, degree], …],
//                             regions: [{ x, y, r, name, genre, size, hub }] }
//
// Run:  npm run bj:stars

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadData, mulberry32, buildLevel, louvain } from './cluster-communities.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPACING = 12.5, JITTER = 0.3, SUB_GAP = 9, GAP = 34, SMALL_SUB = 5;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const GENRES = ['FICTION', 'POETRY & EPICS', 'DRAMA & PLAYS', 'CRIME & MYSTERY', 'SCI-FI', 'FANTASY', 'HORROR', 'ADVENTURE & TRAVEL',
  'HISTORY', 'BIOGRAPHY & MEMOIR', 'PHILOSOPHY', 'PSYCHOLOGY', 'POLITICS & WORLD', 'BUSINESS & ECONOMICS', 'ESSAYS & JOURNALISM',
  'HUMOR & COMEDY', 'FOOD & COOKING'];
const LABEL = { 'FICTION': 'Fiction', 'POETRY & EPICS': 'Poetry & epics', 'DRAMA & PLAYS': 'Drama', 'CRIME & MYSTERY': 'Crime & mystery',
  'SCI-FI': 'Sci-fi', 'FANTASY': 'Fantasy', 'HORROR': 'Horror', 'ADVENTURE & TRAVEL': 'Adventure & travel', 'HISTORY': 'History',
  'BIOGRAPHY & MEMOIR': 'Lives & memoirs', 'PHILOSOPHY': 'Philosophy', 'PSYCHOLOGY': 'Psychology', 'POLITICS & WORLD': 'Politics',
  'BUSINESS & ECONOMICS': 'Business', 'ESSAYS & JOURNALISM': 'Essays', 'HUMOR & COMEDY': 'Humour', 'FOOD & COOKING': 'Food', 'MISC': 'Unsorted' };

const { NODES, MENTIONS } = loadData(join(ROOT, 'bookjumpr-data.js'));
const idOf = new Map(), keyOf = [];
const id = (k) => { if (!idOf.has(k)) { idOf.set(k, keyOf.length); keyOf.push(k); } return idOf.get(k); };
const pairs = [], seen = new Set(), deg = new Map();
for (const [s, t] of MENTIONS) {
  if (s === t) continue;
  deg.set(s, (deg.get(s) || 0) + 1); deg.set(t, (deg.get(t) || 0) + 1);
  const a = id(s), b = id(t), pk = a < b ? a + '-' + b : b + '-' + a;
  if (seen.has(pk)) continue;
  seen.add(pk); pairs.push([a, b]);
}
const n = keyOf.length;
const dg = (i) => deg.get(keyOf[i]) || 0;
const adj = Array.from({ length: n }, () => []);
for (const [a, b] of pairs) { adj[a].push(b); adj[b].push(a); }

// ---- 1. continent per book ----
const own = keyOf.map((k) => { const g = String((NODES[k] && NODES[k][4]) || '').trim().toUpperCase(); return GENRES.includes(g) ? g : null; });
const cont = own.slice();
let propagated = 0;
for (let pass = 0; pass < 4; pass++) {
  const next = cont.slice();
  for (let i = 0; i < n; i++) {
    if (cont[i]) continue;
    const votes = new Map();
    for (const j of adj[i]) if (cont[j]) votes.set(cont[j], (votes.get(cont[j]) || 0) + 1 + Math.sqrt(dg(j)) * 0.01);
    let best = null, bv = 0;
    for (const [g, v] of votes) if (v > bv || (v === bv && g < best)) { best = g; bv = v; }
    if (best) { next[i] = best; propagated++; }
  }
  for (let i = 0; i < n; i++) cont[i] = next[i];
}
for (let i = 0; i < n; i++) if (!cont[i]) cont[i] = 'MISC';

// ---- generic circle packing: springs (weighted links) + collisions + gravity, then settle ----
function pack(R, links, gap, seed) {
  const G = R.length, px = new Float64Array(G), py = new Float64Array(G), rng = mulberry32(seed);
  const order = R.map((r, i) => i).sort((a, b) => R[b] - R[a]);
  order.forEach((g, j) => { const rr = (R[order[0]] + gap) * Math.sqrt(j) * 1.2, th = j * GOLDEN; px[g] = Math.cos(th) * rr + (rng() - 0.5); py[g] = Math.sin(th) * rr + (rng() - 0.5); });
  const collide = (minGap) => {
    let moved = 0;
    for (let a = 0; a < G; a++) for (let b = a + 1; b < G; b++) {
      const dx = px[b] - px[a], dy = py[b] - py[a], d = Math.hypot(dx, dy) || 0.01, min = R[a] + R[b] + minGap;
      if (d >= min) continue;
      const push = (min - d) / 2 + 0.01, ux = dx / d, uy = dy / d, wa = R[b] / (R[a] + R[b]), wb = R[a] / (R[a] + R[b]);
      px[a] -= ux * push * 2 * wa; py[a] -= uy * push * 2 * wa; px[b] += ux * push * 2 * wb; py[b] += uy * push * 2 * wb;
      moved++;
    }
    return moved;
  };
  for (let it = 0; it < 500; it++) {
    const cool = 1 - it / 500, fx = new Float64Array(G), fy = new Float64Array(G);
    for (const [a, b, w] of links) {
      const dx = px[b] - px[a], dy = py[b] - py[a], d = Math.hypot(dx, dy) || 1;
      const f = (d - (R[a] + R[b] + gap)) * 0.02 * Math.min(4, Math.sqrt(w));
      fx[a] += dx / d * f; fy[a] += dy / d * f; fx[b] -= dx / d * f; fy[b] -= dy / d * f;
    }
    for (let g = 0; g < G; g++) { fx[g] -= px[g] * 0.006; fy[g] -= py[g] * 0.006; px[g] += fx[g] * (0.4 + cool); py[g] += fy[g] * (0.4 + cool); }
    collide(gap * 0.6); collide(gap * 0.6);
  }
  for (let it = 0; it < 500; it++) {
    const moved = collide(gap * 0.5);
    for (let g = 0; g < G; g++) { px[g] *= 0.999; py[g] *= 0.999; }
    if (!moved && it > 20) break;
  }
  let cx = 0, cy = 0, tot = 0;
  for (let g = 0; g < G; g++) { const w = R[g] * R[g]; cx += px[g] * w; cy += py[g] * w; tot += w; }
  cx /= tot; cy /= tot;
  let ext = 0;
  for (let g = 0; g < G; g++) { px[g] -= cx; py[g] -= cy; ext = Math.max(ext, Math.hypot(px[g], py[g]) + R[g]); }
  return { px, py, ext };
}
const sunflower = (ids, rng, out) => {
  ids.sort((a, b) => dg(b) - dg(a) || (keyOf[a] < keyOf[b] ? -1 : 1));
  ids.forEach((i, j) => {
    const rr = SPACING * Math.sqrt(j + (j ? 0.6 : 0)), th = j * GOLDEN;
    const jx = j ? (rng() * 2 - 1) * JITTER * SPACING : 0, jy = j ? (rng() * 2 - 1) * JITTER * SPACING : 0;
    out.set(i, [Math.cos(th) * rr + jx, Math.sin(th) * rr + jy]);
  });
  return SPACING * Math.sqrt(ids.length + 0.6) + 4;
};

// ---- 2. inside each continent: sub-communities as small sunflowers, packed ----
const names = [...new Set(cont)].sort((a, b) => cont.filter((x) => x === b).length - cont.filter((x) => x === a).length);
const local = new Map();          // i -> [x, y] relative to its continent centre
const contR = [], contSize = [], contHub = [];
const rng = mulberry32(11);
names.forEach((g, gi) => {
  const members = []; for (let i = 0; i < n; i++) if (cont[i] === g) members.push(i);
  const li = new Map(); members.forEach((i, j) => li.set(i, j));
  const edges = [];
  for (const [a, b] of pairs) if (li.has(a) && li.has(b)) edges.push([li.get(a), li.get(b), 1]);
  const comm = members.length > 2 ? louvain(buildLevel(members.length, edges), 1, mulberry32(3 + gi)) : members.map(() => 0);
  const by = new Map();
  members.forEach((i, j) => { const c = comm[j]; if (!by.has(c)) by.set(c, []); by.get(c).push(i); });
  let subs = [...by.values()], rest = [];
  subs = subs.filter((s) => { if (s.length < SMALL_SUB) { rest.push(...s); return false; } return true; });
  if (rest.length) subs.push(rest);
  const subOf = new Map(); subs.forEach((s, si) => s.forEach((i) => subOf.set(i, si)));
  const pos = new Map(), R = subs.map((s) => sunflower(s, rng, pos));
  const cross = new Map();
  for (const [a, b] of pairs) {
    if (!subOf.has(a) || !subOf.has(b)) continue;
    const sa = subOf.get(a), sb = subOf.get(b); if (sa === sb) continue;
    const k = sa < sb ? sa + ',' + sb : sb + ',' + sa; cross.set(k, (cross.get(k) || 0) + 1);
  }
  const links = [...cross.entries()].map(([k, w]) => { const [a, b] = k.split(',').map(Number); return [a, b, w]; });
  const P = subs.length > 1 ? pack(R, links, SUB_GAP, 5 + gi) : { px: [0], py: [0], ext: R[0] };
  for (const [i, [x, y]] of pos) { const s = subOf.get(i); local.set(i, [P.px[s] + x, P.py[s] + y]); }
  contR.push(P.ext + 6); contSize.push(members.length);
  contHub.push(members.slice().sort((a, b) => dg(b) - dg(a))[0]);
});

// ---- 3. pack continents; genres that mention each other border each other ----
const gIdx = new Map(names.map((g, i) => [g, i]));
const crossG = new Map();
for (const [a, b] of pairs) {
  const ga = gIdx.get(cont[a]), gb = gIdx.get(cont[b]); if (ga === gb) continue;
  const k = ga < gb ? ga + ',' + gb : gb + ',' + ga; crossG.set(k, (crossG.get(k) || 0) + 1);
}
const linksG = [...crossG.entries()].map(([k, w]) => { const [a, b] = k.split(',').map(Number); return [a, b, w / 10]; });
const C = pack(contR, linksG, GAP, 7);

const round = (v) => Math.round(v * 10) / 10;
const regions = names.map((g, gi) => ({ x: round(C.px[gi]), y: round(C.py[gi]), r: round(contR[gi]), name: LABEL[g] || g, genre: g, size: contSize[gi], hub: keyOf[contHub[gi]] }));
const nodes = [];
for (let i = 0; i < n; i++) { const gi = gIdx.get(cont[i]), [x, y] = local.get(i); nodes.push([keyOf[i], round(C.px[gi] + x), round(C.py[gi] + y), gi, dg(i)]); }
// sanity: continents must not overlap
let overlaps = 0;
for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) if (Math.hypot(regions[a].x - regions[b].x, regions[a].y - regions[b].y) < regions[a].r + regions[b].r) overlaps++;
writeFileSync(join(ROOT, 'stars-data.js'),
  '// GENERATED by tools/build-stars.mjs from bookjumpr-data.js — do not hand-edit.\n'
  + '// Star map: every book in its genre "continent" (unknown genres join their neighbours\' genre), related books together.\n'
  + 'window.BookJumprStars = ' + JSON.stringify({ nodes, regions }) + ';\n');
console.log(`✓ wrote stars-data.js — ${n} books in ${regions.length} continents (${propagated} placed by their neighbours, ${contSize[gIdx.get('MISC')] || 0} unsorted), ${overlaps} overlaps`);
for (const r of regions) console.log(`  ${String(r.size).padStart(5)}  ${r.name}`);
