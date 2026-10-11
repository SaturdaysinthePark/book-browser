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
const petals = () => {
  const gs = [...new Set(genre)].sort((a, b) => genre.filter((x) => x === b).length - genre.filter((x) => x === a).length);
  const cnt = new Map(gs.map((g) => [g, genre.filter((x) => x === g).length]));
  // order around the circle: greedy by shared mentions, so related genres are neighbours
  const cross = new Map();
  for (const [a, b] of pairs) { if (genre[a] === genre[b]) continue; const k = [genre[a], genre[b]].sort().join('|'); cross.set(k, (cross.get(k) || 0) + 1); }
  const link = (a, b) => cross.get([a, b].sort().join('|')) || 0;
  const rest = gs.slice(1), order = [gs[0]];
  while (rest.length) { const last = order[order.length - 1]; let bi = 0, bv = -1; rest.forEach((g, i) => { const v = link(last, g) + cnt.get(g) * 1e-3; if (v > bv) { bv = v; bi = i; } }); order.push(rest.splice(bi, 1)[0]); }
  // wedges (a small gap between petals); inside each, sub-communities get contiguous sub-ranges
  const GAPA = 0.03, span = Math.PI * 2 - GAPA * order.length;
  let a = -Math.PI / 2;
  const wedge = new Map(), sub = new Array(N), counters = new Map();
  order.forEach((g) => {
    const w = span * cnt.get(g) / N; wedge.set(g, [a, a + w]); a += w + GAPA;
    const members = []; for (let i = 0; i < N; i++) if (genre[i] === g) members.push(i);
    const li = new Map(members.map((i, j) => [i, j])), edges = [];
    for (const [x, y] of pairs) if (li.has(x) && li.has(y)) edges.push([li.get(x), li.get(y), 1]);
    const comm = members.length > 2 ? louvain(buildLevel(members.length, edges), 1, mulberry32(5)) : members.map(() => 0);
    const by = new Map(); members.forEach((i, j) => { const c = comm[j]; (by.get(c) || by.set(c, []).get(c)).push(i); });
    const comms = [...by.values()].sort((p, q) => q.length - p.length);
    let f = 0;
    comms.forEach((list, ci) => { const fr = list.length / members.length; list.forEach((i) => { sub[i] = [f, fr, g + ':' + ci]; }); f += fr; });
  });
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
const fame = () => {
  const W = 1700, H = 1150, maxIn = Math.max(...din), maxOut = Math.max(...dout);
  const lx = (v) => Math.log(1 + v) / Math.log(1 + maxOut), ly = (v) => Math.log(1 + v) / Math.log(1 + maxIn);
  const X = (v) => 90 + (W - 160) * lx(v), Y = (v) => H - 90 - (H - 160) * ly(v);
  const xy = new Float64Array(2 * N);
  for (let i = 0; i < N; i++) {
    const rnd = mulberry32(hashOf(keys[i]));
    const sxp = X(dout[i] + 0.5) - X(dout[i]), syp = Y(din[i]) - Y(din[i] + 0.5);   // half a step in each direction
    // round (gaussian) clouds rather than boxes, clipped to the cell
    const g1 = Math.sqrt(-2 * Math.log(1 - rnd())), th = rnd() * Math.PI * 2;
    // a count of 0 is the edge of the chart: nudge those inward only, never across the axis
    var jx = Math.max(-1, Math.min(1, g1 * Math.cos(th) * 0.38)), jy = Math.max(-1, Math.min(1, g1 * Math.sin(th) * 0.38));
    if (dout[i] === 0) jx = Math.abs(jx);
    if (din[i] === 0) jy = Math.abs(jy);
    xy[2 * i] = X(dout[i]) + jx * sxp;
    xy[2 * i + 1] = Y(din[i]) - jy * syp;
  }
  const ticks = [0, 1, 3, 10, 30, 100, 300];
  const axes = {
    x0: X(0) - 10, y0: Y(0) + 10, x1: W - 40, y1: 50,   // just outside the smallest values
    tx: ticks.filter((v) => v <= maxOut * 1.2).map((v) => ({ x: round(X(v)), t: String(v) })),
    ty: ticks.filter((v) => v <= maxIn * 1.2).map((v) => ({ y: round(Y(v)), t: String(v) })),
    xt: 'mentions more books →', yt: '↑ mentioned by more books',
    caps: [
      { x: X(0) - 20, y: -22, t: '↖ The canon', s: 'mentioned a lot, names little' },
      { x: W - 250, y: Y(0) + 130, t: 'Name-droppers ↘', s: 'names a lot, rarely mentioned' },
      { x: W - 160, y: -22, t: 'Hubs ↗', s: 'both' },
      { x: X(0) - 20, y: Y(0) + 130, t: '↙ Footnotes', s: 'one mention, names nothing' }
    ]
  };
  const [mx, my] = centre(xy);
  const sh = (o, kx, ky) => { o[kx] = round(o[kx] - mx); if (ky) o[ky] = round(o[ky] - my); };
  axes.x0 = round(axes.x0 - mx); axes.x1 = round(axes.x1 - mx); axes.y0 = round(axes.y0 - my); axes.y1 = round(axes.y1 - my);
  axes.tx.forEach((t) => sh(t, 'x')); axes.ty.forEach((t) => { t.y = round(t.y - my); });
  axes.caps.forEach((c) => sh(c, 'x', 'y'));
  return { xy, reg: new Array(N).fill(0), regions: [], guides: { axes } };
};

const out = { keys, deg, layouts: {} };
for (const [name, fn] of [['spiral', spiral], ['petals', petals], ['blend', blend], ['fame', fame]]) {
  const L = fn();
  if (name !== 'fame') centre(L.xy);
  out.layouts[name] = { xy: Array.from(L.xy, Math.round), reg: L.reg, regions: L.regions, guides: L.guides };
}
writeFileSync(join(ROOT, 'layouts-data.js'),
  '// GENERATED by tools/build-layouts.mjs from bookjumpr-data.js + stars-data.js — do not hand-edit.\n'
  + '// Point layouts for the ?v=lab network variants (spiral, petals, blend, fame).\n'
  + 'window.BookJumprLayouts = ' + JSON.stringify(out) + ';\n');
const top = rank.slice(0, 10).map((i) => keys[i].split('/')[1]).join(', ');
console.log(`✓ wrote layouts-data.js — ${N} books × 4 layouts · most connected: ${top}`);
