#!/usr/bin/env node
// build-stars.mjs — the star map layout for the ?v=next network (and Explorer+ ?net=v4).
//
// Books are laid out in genre "continents", so where a star sits and its colour say the same thing:
//   1. Continent per book: its genre (GEN3 names, as app.js's genreByName). Books without a genre
//      take the majority genre of the books they are linked to (label propagation over the mention
//      graph, a few passes); anything still unknown lands in a small "Unsorted" continent. The
//      book's own (unknown) genre is not changed — the map still draws it grey.
//   2. Inside a continent, books that mention each other sit together: Louvain on the continent's
//      own subgraph, each sub-community a wedge of one sunflower disc (hubs toward the middle).
//   3. Continents are packed as circles: springs pull genres that mention each other together,
//      collisions keep them apart, then a collision-only settle so none overlap.
//
// Output: stars-data.js →
//   window.BookJumprStars = { nodes: [[key, x, y, continentIdx, degree], …],
//                             regions: [{ x, y, r, lx, ly, name, genre, size, hub }] }  (lx/ly: name anchor)
//
// Run:  npm run bj:stars

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadData, mulberry32, buildLevel, louvain } from './cluster-communities.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPACING = 12.5, JITTER = 0.25, GAP = 40, SMALL_SUB = 5;
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

// ---- 2. inside each continent: one disc, its sub-communities as wedges ----
// A single sunflower per continent; its slots are split by angle into contiguous sectors, one per
// Louvain sub-community (sized to it). Inside a sector, the most connected books take the slots
// nearest the centre, so every continent reads as one round shape with related books together.
// Books without a genre of their own sort after known ones of equal degree, toward the rim.
const names = [...new Set(cont)].sort((a, b) => cont.filter((x) => x === b).length - cont.filter((x) => x === a).length);
const local = new Map();          // i -> [x, y] relative to its continent centre
const contR = [], contSize = [], contHub = [], contTop = [];
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
  subs = subs.filter((sub) => { if (sub.length < SMALL_SUB) { rest.push(...sub); return false; } return true; });
  if (rest.length) subs.push(rest);
  subs.sort((a, b) => b.length - a.length);
  const N = members.length, slots = [];
  for (let j = 0; j < N; j++) {
    const r = SPACING * Math.sqrt(j + (j ? 0.6 : 0)), th = (j * GOLDEN) % (Math.PI * 2);
    slots.push({ r, th });
  }
  slots.sort((a, b) => a.th - b.th);
  const rank = (i) => dg(i) - (own[i] ? 0 : 0.5);
  let k = 0;
  for (const sub of subs) {
    const bucket = slots.slice(k, k + sub.length).sort((a, b) => a.r - b.r); k += sub.length;
    sub.sort((a, b) => rank(b) - rank(a) || (keyOf[a] < keyOf[b] ? -1 : 1));
    sub.forEach((i, j) => {
      const sl = bucket[j], jr = sl.r ? (rng() * 2 - 1) * JITTER * SPACING : 0, jt = sl.r ? (rng() * 2 - 1) * JITTER * SPACING / Math.max(sl.r, SPACING) : 0;
      local.set(i, [Math.cos(sl.th + jt) * (sl.r + jr), Math.sin(sl.th + jt) * (sl.r + jr)]);
    });
  }
  const R = SPACING * Math.sqrt(N + 0.6) + 6;
  // name anchor: the top edge of the dots near the middle (4th percentile of y within ±40% r)
  const ys = members.map((i) => local.get(i)).filter(([x]) => Math.abs(x) < R * 0.4).map(([, y]) => y).sort((a, b) => a - b);
  contTop.push(ys.length ? ys[Math.floor(ys.length * 0.04)] : -R);
  contR.push(R); contSize.push(N);
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

// centre the whole map on its bounding box (the packer centres on mass), so "Fit" is balanced
{
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  names.forEach((g, gi) => { x0 = Math.min(x0, C.px[gi] - contR[gi]); x1 = Math.max(x1, C.px[gi] + contR[gi]); y0 = Math.min(y0, C.py[gi] - contR[gi]); y1 = Math.max(y1, C.py[gi] + contR[gi]); });
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  names.forEach((g, gi) => { C.px[gi] -= mx; C.py[gi] -= my; });
}
const round = (v) => Math.round(v * 10) / 10;
const regions = names.map((g, gi) => ({ x: round(C.px[gi]), y: round(C.py[gi]), r: round(contR[gi]), lx: round(C.px[gi]), ly: round(C.py[gi] + contTop[gi]),
  name: LABEL[g] || g, genre: g, size: contSize[gi], hub: keyOf[contHub[gi]] }));
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
