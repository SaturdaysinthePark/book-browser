#!/usr/bin/env node
// build-layouts.mjs — the point layouts for the ?v=lab network variants.
//
// Every book is a point (genre colour, size = connections). Four ways to place them, so we can
// compare which map is easiest to read:
//   spiral  one sunflower spiral, sorted by connections: the most connected in the middle, the
//           one-off name-drops as the outer haze. Guide rings mark where 50+/20+/10+/5+/2+ links end.
//   petals  the same spiral, but each genre owns a wedge (sized to it): a mixed heart of famous
//           books in the centre, genres fanning out as petals. Within a petal, books that mention
//           each other (Louvain sub-communities) take neighbouring angles.
//   blend   the genre-continent map (stars-data.js), with every book pulled toward the centre by
//           its connections: hubs of every genre meet in a shared core, one-offs stay in their blob.
//   fame    a chart: x = how many books it mentions, y = how many books mention it (log scales),
//           seeded jitter so books with the same counts spread into soft clouds.
// Genre per book = its continent's genre in stars-data.js (books without one join their
// neighbours' genre there), so run `npm run bj:stars` first.
//
// Output: layouts-data.js →
//   window.BookJumprLayouts = { keys, deg, layouts: { <name>: { xy: [x0,y0,x1,y1,…], reg: [regionIdx…],
//                                                    regions: [{x,y,r,lx,ly,name,genre}], guides } } }
//
// Run:  npm run bj:layouts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadData, mulberry32, buildLevel, louvain } from './cluster-communities.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = Math.PI * (3 - Math.sqrt(5)), PHI = (Math.sqrt(5) - 1) / 2;
const S = 12;   // spacing between neighbouring points (world units)

const { MENTIONS } = loadData(join(ROOT, 'bookjumpr-data.js'));
const stars = new Function('window', readFileSync(join(ROOT, 'stars-data.js'), 'utf8') + '\n;return window.BookJumprStars;')({});

// ---- graph ----
const keys = stars.nodes.map((n) => n[0]), N = keys.length, idx = new Map(keys.map((k, i) => [k, i]));
const din = new Int32Array(N), dout = new Int32Array(N), adj = Array.from({ length: N }, () => []), pairs = [], seen = new Set();
for (const [s, t] of MENTIONS) {
  if (s === t || !idx.has(s) || !idx.has(t)) continue;
  const a = idx.get(s), b = idx.get(t);
  dout[a]++; din[b]++;
  const pk = a < b ? a + '-' + b : b + '-' + a;
  if (seen.has(pk)) continue;
  seen.add(pk); pairs.push([a, b]); adj[a].push(b); adj[b].push(a);
}
const deg = Array.from({ length: N }, (_, i) => din[i] + dout[i]);
const genre = stars.nodes.map((n) => stars.regions[n[3]].genre);
const GNAME = (g) => stars.regions.find((r) => r.genre === g).name;
const hashOf = (k) => { let h = 2166136261; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const round = (v) => Math.round(v * 10) / 10;
// global rank: most connected first (ties: more mentioned-by, then key)
const rank = keys.map((_, i) => i).sort((a, b) => deg[b] - deg[a] || din[b] - din[a] || (keys[a] < keys[b] ? -1 : 1));
const radiusOf = (j) => S * Math.sqrt(j + (j ? 0.6 : 0)) * (1 + 0.15 * j / N);   // the haze breathes a little

// grid-hashed de-overlap: nobody closer than `min`
const collide = (xy, min, iters) => {
  const cell = min, n = xy.length / 2;
  for (let it = 0; it < iters; it++) {
    const grid = new Map(); let moved = 0;
    for (let i = 0; i < n; i++) { const gk = Math.floor(xy[2 * i] / cell) + ',' + Math.floor(xy[2 * i + 1] / cell); (grid.get(gk) || grid.set(gk, []).get(gk)).push(i); }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(xy[2 * i] / cell), cy = Math.floor(xy[2 * i + 1] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const list = grid.get(gx + ',' + gy); if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          let dx = xy[2 * j] - xy[2 * i], dy = xy[2 * j + 1] - xy[2 * i + 1], d = Math.hypot(dx, dy);
          if (d >= min) continue;
          if (d < 1e-6) { dx = ((hashOf(keys[j]) % 7) - 3) || 1; dy = ((hashOf(keys[i]) % 5) - 2) || 1; d = Math.hypot(dx, dy); }
          const p = (min - d) / 2, ux = dx / d, uy = dy / d;
          xy[2 * i] -= ux * p; xy[2 * i + 1] -= uy * p; xy[2 * j] += ux * p; xy[2 * j + 1] += uy * p; moved++;
        }
      }
    }
    if (!moved) break;
  }
};
// centre a layout on its bounding box
const centre = (xy) => {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < xy.length; i += 2) { x0 = Math.min(x0, xy[i]); x1 = Math.max(x1, xy[i]); y0 = Math.min(y0, xy[i + 1]); y1 = Math.max(y1, xy[i + 1]); }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  for (let i = 0; i < xy.length; i += 2) { xy[i] -= mx; xy[i + 1] -= my; }
  return [mx, my];
};

// ---- spiral ----
const spiral = () => {
  const xy = new Float64Array(2 * N);
  rank.forEach((i, j) => { const r = radiusOf(j), th = j * GOLDEN; xy[2 * i] = Math.cos(th) * r; xy[2 * i + 1] = Math.sin(th) * r; });
  const rings = [];
  for (const [t, label] of [[50, '50+ links'], [20, '20+'], [10, '10+'], [5, '5+'], [2, '2+']]) {
    const j = rank.findIndex((i) => deg[i] < t);
    if (j > 0) rings.push({ r: round(radiusOf(j)), t: label });
  }
  rings.push({ r: round(radiusOf(N - 1) + S), t: '1 link' });
  return { xy, reg: new Array(N).fill(0), regions: [], guides: { rings } };
};

// ---- petals ----
// genre order around the circle (greedy by shared mentions) + each book's sub-community slice of its genre
let _prep = null;
const genrePrep = () => {
  if (_prep) return _prep;
  const gs = [...new Set(genre)].sort((a, b) => genre.filter((x) => x === b).length - genre.filter((x) => x === a).length);
  const cnt = new Map(gs.map((g) => [g, genre.filter((x) => x === g).length]));
  // order around the circle: greedy by shared mentions, so related genres are neighbours
  const cross = new Map();
  for (const [a, b] of pairs) { if (genre[a] === genre[b]) continue; const k = [genre[a], genre[b]].sort().join('|'); cross.set(k, (cross.get(k) || 0) + 1); }
  const link = (a, b) => cross.get([a, b].sort().join('|')) || 0;
  const rest = gs.slice(1), order = [gs[0]];
  while (rest.length) { const last = order[order.length - 1]; let bi = 0, bv = -1; rest.forEach((g, i) => { const v = link(last, g) + cnt.get(g) * 1e-3; if (v > bv) { bv = v; bi = i; } }); order.push(rest.splice(bi, 1)[0]); }
  const sub = new Array(N);
  order.forEach((g) => {
    const members = []; for (let i = 0; i < N; i++) if (genre[i] === g) members.push(i);
    const li = new Map(members.map((i, j) => [i, j])), edges = [];
    for (const [x, y] of pairs) if (li.has(x) && li.has(y)) edges.push([li.get(x), li.get(y), 1]);
    const comm = members.length > 2 ? louvain(buildLevel(members.length, edges), 1, mulberry32(5)) : members.map(() => 0);
    const by = new Map(); members.forEach((i, j) => { const c = comm[j]; (by.get(c) || by.set(c, []).get(c)).push(i); });
    const comms = [...by.values()].sort((p, q) => q.length - p.length);
    let f = 0;
    comms.forEach((list, ci) => { const fr = list.length / members.length; list.forEach((i) => { sub[i] = [f, fr, g + ':' + ci]; }); f += fr; });
  });
  return (_prep = { order, cnt, sub });
};
const petals = () => {
  const { order, cnt, sub } = genrePrep(), counters = new Map();
  // wedges (a small gap between petals); inside each, sub-communities get contiguous sub-ranges
  const GAPA = 0.03, span = Math.PI * 2 - GAPA * order.length;
  let a = -Math.PI / 2;
  const wedge = new Map();
  order.forEach((g) => { const w = span * cnt.get(g) / N; wedge.set(g, [a, a + w]); a += w + GAPA; });
  const xy = new Float64Array(2 * N), reg = new Array(N);
  const gi = new Map(order.map((g, i) => [g, i]));
  rank.forEach((i, j) => {
    const [a0, a1] = wedge.get(genre[i]), [f0, fr, ck] = sub[i];
    const m = counters.get(ck) || 0; counters.set(ck, m + 1);
    const frac = f0 + fr * (0.08 + 0.84 * ((m * PHI + 0.5) % 1));
    const th = a0 + (a1 - a0) * frac, r = radiusOf(j);
    xy[2 * i] = Math.cos(th) * r; xy[2 * i + 1] = Math.sin(th) * r; reg[i] = gi.get(genre[i]);
  });
  collide(xy, S * 0.62, 40);
  const R = radiusOf(N - 1);
  const regions = order.map((g) => {
    const [a0, a1] = wedge.get(g), am = (a0 + a1) / 2, rr = R + 26;
    return { x: 0, y: 0, r: round(R), lx: round(Math.cos(am) * rr), ly: round(Math.sin(am) * rr + 6), name: GNAME(g), genre: g, size: cnt.get(g), tip: 1 };
  });
  return { xy, reg, regions, guides: {} };
};

// ---- band: the petals unrolled into a strip that loops sideways ----
// Genres are columns across the strip, in the petals' circular order (so the last column leads back
// into the first, and the map can wrap). Distance from the middle line = global popularity rank
// (√ of rank, so the famous get room): every genre's most connected books line the centre, one-offs
// fade to the top and bottom edges. Inside a column, sub-communities take neighbouring x ranges.
const band = () => {
  const { order, cnt, sub } = genrePrep(), counters = new Map();
  const P = 2000, GAP = 16, Hh = 260;
  const usable = P - GAP * order.length, col = new Map();
  let x = -P / 2;
  order.forEach((g) => { const w = usable * cnt.get(g) / N; col.set(g, [x + GAP / 2, x + GAP / 2 + w]); x += w + GAP; });
  const xy = new Float64Array(2 * N), reg = new Array(N), gi = new Map(order.map((g, i) => [g, i]));
  rank.forEach((i, j) => {
    const [x0, x1] = col.get(genre[i]), [f0, fr, ck] = sub[i];
    const m = counters.get(ck) || 0; counters.set(ck, m + 1);
    const frac = f0 + fr * (0.06 + 0.88 * ((m * PHI + 0.5) % 1));
    const yy = Hh * Math.sqrt((j + 0.5) / N) * (j % 2 ? 1 : -1);   // √: the famous get room, the one-offs compress
    xy[2 * i] = x0 + (x1 - x0) * frac; xy[2 * i + 1] = yy; reg[i] = gi.get(genre[i]);
  });
  collide(xy, S * 0.6, 30);
  const lines = [];
  for (const [t, label] of [[50, '50+ links'], [20, '20+'], [10, '10+'], [5, '5+'], [2, '2+']]) {
    const j = rank.findIndex((i) => deg[i] < t);
    if (j > 0) lines.push({ y: round(Hh * Math.sqrt(j / N)), t: label });
  }
  const regions = order.map((g) => {
    const [x0, x1] = col.get(g);
    return { x: round((x0 + x1) / 2), y: 0, r: round((x1 - x0) / 2), lx: round((x0 + x1) / 2), ly: round(-Hh - 12), name: GNAME(g), genre: g, size: cnt.get(g) };
  });
  return { xy, reg, regions, guides: { band: { P, h: round(Hh), lines, cols: order.map((g) => round(col.get(g)[0] - GAP / 2)) } } };
};

// ---- wrap: the genre continents on a surface whose edges join ----
// The continents from stars-data.js (same shapes), re-packed into a box with periodic edges: a
// continent near the right edge is a neighbour of one near the left, so the map can be panned in
// any direction forever without a border, and each book still appears once. Packing uses the
// shortest way round for both collisions and the springs that pull related genres together.
const wrap = () => {
  const regs = stars.regions.map((R, ri) => ({ ri, r: R.r + 10, x: 0, y: 0 }));
  const area = regs.reduce((a, R) => a + Math.PI * (R.r + 14) * (R.r + 14), 0) / 0.62;
  const PX = Math.round(Math.sqrt(area * 1.6)), PY = Math.round(area / PX);
  const mi = (d, P) => d - P * Math.round(d / P);   // minimum-image difference
  const rnd = mulberry32(17);
  regs.forEach((R) => { R.x = (rnd() - 0.5) * PX; R.y = (rnd() - 0.5) * PY; });
  const gidx = new Map(stars.regions.map((R, i) => [R.genre, i]));
  const cross = new Map();
  for (const [a, b] of pairs) { const ga = gidx.get(genre[a]), gb = gidx.get(genre[b]); if (ga === gb) continue; const k = Math.min(ga, gb) + ',' + Math.max(ga, gb); cross.set(k, (cross.get(k) || 0) + 1); }
  const links = [...cross.entries()].map(([k, w]) => { const [a, b] = k.split(',').map(Number); return [a, b, w]; });
  for (let it = 0; it < 900; it++) {
    const cool = 1 - it / 900;
    for (const [a, b, w] of links) {
      const A = regs[a], B = regs[b], dx = mi(B.x - A.x, PX), dy = mi(B.y - A.y, PY), d = Math.hypot(dx, dy) || 1;
      const f = (d - (A.r + B.r + 30)) * 0.004 * Math.min(4, Math.sqrt(w / 10)) * cool;
      A.x += dx / d * f; A.y += dy / d * f; B.x -= dx / d * f; B.y -= dy / d * f;
    }
    for (let a = 0; a < regs.length; a++) for (let b = a + 1; b < regs.length; b++) {
      const A = regs[a], B = regs[b], dx = mi(B.x - A.x, PX), dy = mi(B.y - A.y, PY), d = Math.hypot(dx, dy) || 0.01, min = A.r + B.r + 24;
      if (d >= min) continue;
      const p = (min - d) / 2, wa = B.r / (A.r + B.r), wb = A.r / (A.r + B.r);
      A.x -= dx / d * p * 2 * wa; A.y -= dy / d * p * 2 * wa; B.x += dx / d * p * 2 * wb; B.y += dy / d * p * 2 * wb;
    }
    regs.forEach((R) => { R.x = mi(R.x, PX); R.y = mi(R.y, PY); });
  }
  let overlaps = 0;
  for (let a = 0; a < regs.length; a++) for (let b = a + 1; b < regs.length; b++) if (Math.hypot(mi(regs[b].x - regs[a].x, PX), mi(regs[b].y - regs[a].y, PY)) < regs[a].r + regs[b].r) overlaps++;
  const xy = new Float64Array(2 * N), reg = stars.nodes.map((n) => n[3]);
  stars.nodes.forEach((n, i) => { const S0 = stars.regions[n[3]], R = regs[n[3]]; xy[2 * i] = mi(R.x + (n[1] - S0.x), PX); xy[2 * i + 1] = mi(R.y + (n[2] - S0.y), PY); });
  const regions = stars.regions.map((S0, ri) => {
    const R = regs[ri];
    return { x: round(R.x), y: round(R.y), r: S0.r, lx: round(R.x + (S0.lx - S0.x)), ly: round(R.y + (S0.ly - S0.y)), name: S0.name, genre: S0.genre, size: S0.size };
  });
  console.log(`  wrap: ${PX}×${PY} surface, ${overlaps} continent overlaps`);
  return { xy, reg, regions, guides: { torus: { P: PX, PY } } };
};

// ---- blend: a core of the most connected, genre blobs around it ----
// The ~300 books with 10+ links form a sunflower core in the middle (sorted, so the very top sit at
// the centre). Each genre continent keeps its other books as a filled disc (sorted by connections,
// no holes), pushed outward from the centre so it clears the core; then discs are de-overlapped.
const blend = () => {
  const CORE = 10, xy = new Float64Array(2 * N), reg = stars.nodes.map((n) => n[3]);
  const core = rank.filter((i) => deg[i] >= CORE);
  core.forEach((i, j) => { const r = S * Math.sqrt(j + (j ? 0.6 : 0)), th = j * GOLDEN; xy[2 * i] = Math.cos(th) * r; xy[2 * i + 1] = Math.sin(th) * r; });
  const Rc = S * Math.sqrt(core.length + 0.6) + 8;
  const isCore = new Uint8Array(N); core.forEach((i) => { isCore[i] = 1; });
  const discs = stars.regions.map((R, ri) => {
    const mem = rank.filter((i) => reg[i] === ri && !isCore[i]);
    const len = Math.hypot(R.x, R.y) || 1, h = hashOf(R.genre), ux = len > 1 ? R.x / len : Math.cos(h), uy = len > 1 ? R.y / len : Math.sin(h);
    return { ri, mem, r: S * Math.sqrt(mem.length + 0.6) + 6, x: R.x + ux * (Rc + 40), y: R.y + uy * (Rc + 40) };
  }).filter((d) => d.mem.length);
  // de-overlap discs (and keep them off the core), heavier discs move less
  for (let it = 0; it < 400; it++) {
    let moved = 0;
    for (let a = 0; a < discs.length; a++) {
      const A = discs[a], dc = Math.hypot(A.x, A.y) || 1, minc = Rc + A.r + 24;
      if (dc < minc) { A.x *= minc / dc; A.y *= minc / dc; moved++; }
      for (let b = a + 1; b < discs.length; b++) {
        const B = discs[b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01, min = A.r + B.r + 22;
        if (d >= min) continue;
        const p = (min - d) / 2, wa = B.r / (A.r + B.r), wb = A.r / (A.r + B.r);
        A.x -= dx / d * p * 2 * wa; A.y -= dy / d * p * 2 * wa; B.x += dx / d * p * 2 * wb; B.y += dy / d * p * 2 * wb; moved++;
      }
    }
    for (const D of discs) { const dc = Math.hypot(D.x, D.y) || 1, k = Math.max(Rc + D.r + 24, dc * 0.995) / dc; D.x *= k; D.y *= k; }   // a whisper of gravity
    if (!moved && it > 30) break;
  }
  for (const D of discs) D.mem.forEach((i, j) => { const r = S * Math.sqrt(j + (j ? 0.6 : 0)), th = j * GOLDEN; xy[2 * i] = D.x + Math.cos(th) * r; xy[2 * i + 1] = D.y + Math.sin(th) * r; });
  const byRi = new Map(discs.map((D) => [D.ri, D]));
  const regions = stars.regions.map((R, ri) => {
    const D = byRi.get(ri);
    if (!D) return { x: 0, y: 0, r: 0, lx: 0, ly: 0, name: '', genre: R.genre, size: 0 };
    return { x: round(D.x), y: round(D.y), r: round(D.r), lx: round(D.x), ly: round(D.y - D.r + 4), name: R.name, genre: R.genre, size: D.mem.length };
  });
  return { xy, reg, regions, guides: { rings: [{ r: round(Rc), t: 'the ' + core.length + ' most connected (10+ links)' }] } };
};

// ---- fame ----
// A binned chart: x = how many books it mentions, y = how many mention it, each in bins
// 0 · 1 · 2 · 3–5 · 6–10 · 11–20 · 21–50 · 51+. Every grid square is a "neighbourhood": its books
// packed as one round sunflower (most connected in the middle). Columns and rows are as wide as their
// biggest neighbourhood, so the huge low-count groups get room and the sparse famous corner stays tight.
// Every square is a region (the map bundles a selected book's links into each one); squares with
// enough books get a tint and a count label.
const fame = () => {
  const BINS = [[0, 0, '0'], [1, 1, '1'], [2, 2, '2'], [3, 5, '3–5'], [6, 10, '6–10'], [11, 20, '11–20'], [21, 50, '21–50'], [51, 1e9, '51+']];
  const bin = (v) => BINS.findIndex((B) => v >= B[0] && v <= B[1]);
  const SP = 9, PAD = 34, LABEL_MIN = 12;
  const cells = new Map();
  for (let i = 0; i < N; i++) { const ck = bin(dout[i]) + ',' + bin(din[i]); (cells.get(ck) || cells.set(ck, []).get(ck)).push(i); }
  // very large neighbourhoods pack tighter, so they don't squeeze every other column
  const spOf = (m) => SP * Math.min(1, Math.pow(300 / m, 0.25));
  const discR = (m) => spOf(m) * Math.sqrt(m + 0.6) + 5;
  const colW = BINS.map(() => 120), rowH = BINS.map(() => 90);
  for (const [ck, list] of cells) { const [c, r] = ck.split(',').map(Number), d = 2 * discR(list.length) + PAD; colW[c] = Math.max(colW[c], d); rowH[r] = Math.max(rowH[r], d + (list.length >= LABEL_MIN ? 40 : 10)); }
  const colX = [], rowY = [];   // centres; y grows downward (row 0 at the bottom)
  let acc = 0; colW.forEach((w, c) => { colX[c] = acc + w / 2; acc += w; }); const Wt = acc;
  acc = 0; const Ht = rowH.reduce((p, q) => p + q, 0);
  rowH.forEach((hh, r) => { rowY[r] = Ht - acc - hh / 2; acc += hh; });
  const xy = new Float64Array(2 * N), reg = new Array(N), regions = [];
  [...cells.entries()].sort().forEach(([ck, list]) => {
    const [c, r] = ck.split(',').map(Number), m = list.length, cx = colX[c], cy = rowY[r] + (m >= LABEL_MIN ? 14 : 0), R = discR(m);   // room for the count above
    list.sort((a, b) => deg[b] - deg[a] || (keys[a] < keys[b] ? -1 : 1));
    const sp = spOf(m);
    list.forEach((i, j) => { const rr = sp * Math.sqrt(j + (j ? 0.6 : 0)), th = j * GOLDEN; xy[2 * i] = cx + Math.cos(th) * rr; xy[2 * i + 1] = cy + Math.sin(th) * rr; reg[i] = regions.length; });
    const big = m >= LABEL_MIN;
    regions.push({ x: round(cx), y: round(cy), r: round(R), lx: round(cx), ly: round(cy - R + 2), name: big ? m.toLocaleString('en-US') + ' books' : '', genre: '', size: m, tint: big });
  });
  const bx = [0], by = [Ht];
  acc = 0; colW.forEach((w) => { acc += w; bx.push(round(acc)); });
  acc = 0; rowH.forEach((hh) => { acc += hh; by.push(round(Ht - acc)); });
  const axes = {
    x0: 0, y0: Ht, x1: Wt, y1: 0, grid: true,
    bx, by,
    tx: BINS.map((B, c) => ({ x: round(colX[c]), t: B[2] })),
    ty: BINS.map((B, r) => ({ y: round(rowY[r]), t: B[2] })),
    xt: 'mentions more books →', yt: '↑ mentioned by more books',
    caps: [   // pinned to the chart's corners on screen (atlas.js)
      { c: 'tl', t: '↖ The canon', s: 'mentioned a lot, names little' },
      { c: 'tr', t: 'Hubs ↗', s: 'both' },
      { c: 'bl', t: '↙ Footnotes', s: 'one mention, names nothing' },
      { c: 'br', t: 'Name-droppers ↘', s: 'names a lot, rarely mentioned' }
    ]
  };
  const mx = Wt / 2, my = Ht / 2;
  for (let i = 0; i < N; i++) { xy[2 * i] -= mx; xy[2 * i + 1] -= my; }
  regions.forEach((R) => { R.x = round(R.x - mx); R.y = round(R.y - my); R.lx = round(R.lx - mx); R.ly = round(R.ly - my); });
  axes.x0 -= mx; axes.x1 -= mx; axes.y0 -= my; axes.y1 -= my;
  axes.bx = axes.bx.map((v) => round(v - mx)); axes.by = axes.by.map((v) => round(v - my));
  axes.tx.forEach((t) => { t.x = round(t.x - mx); }); axes.ty.forEach((t) => { t.y = round(t.y - my); });
  return { xy, reg, regions, guides: { axes } };
};

const out = { keys, deg, layouts: {} };
for (const [name, fn] of [['spiral', spiral], ['petals', petals], ['band', band], ['wrap', wrap], ['blend', blend], ['fame', fame]]) {
  const L = fn();
  if (name !== 'fame' && name !== 'band' && name !== 'wrap') centre(L.xy);
  out.layouts[name] = { xy: Array.from(L.xy, Math.round), reg: L.reg, regions: L.regions, guides: L.guides };
}
writeFileSync(join(ROOT, 'layouts-data.js'),
  '// GENERATED by tools/build-layouts.mjs from bookjumpr-data.js + stars-data.js — do not hand-edit.\n'
  + '// Point layouts for the ?v=lab network variants (spiral, petals, blend, fame).\n'
  + 'window.BookJumprLayouts = ' + JSON.stringify(out) + ';\n');
const top = rank.slice(0, 10).map((i) => keys[i].split('/')[1]).join(', ');
console.log(`✓ wrote layouts-data.js — ${N} books × ${Object.keys(out.layouts).length} layouts · most connected: ${top}`);
