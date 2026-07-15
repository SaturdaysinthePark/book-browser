#!/usr/bin/env node
// build-network-data.mjs — precompute the Network page's layout, offline, in Node.
//
// Reads the book graph (bookjumpr-data.js) + the Louvain communities (analysis/
// communities.json), joins community rows to the site's book ids, and computes a
// TWO-LEVEL layout the browser can render without ever running its own O(n²) pass:
//
//   Level 1  islands  — one disc per community, packed with padding so regions read
//                       as distinct landmasses. Neighborhood/mixed sized by member
//                       count; fan-out communities collapse to a single hub marker.
//   Level 2  interior — Fruchterman-Reingold on each neighborhood/mixed community's
//                       INTERNAL edges, scaled to fit its disc. Fan-out members are
//                       NOT laid out; their spokes are generated on demand in the UI.
//
// Emits network-data.js: `window.BookJumprNetwork = { nodes, edges, communities, meta }`
// (a file://-friendly global, exactly like bookjumpr-data.js).
//
// Join strategy (the CSV/JSON `key` IS the site id — verified 100% — but we don't
// trust that blindly): match on key first, fall back to normalized title+author.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// genre → ink-on-paper accent (mirrors P.GEN3 in app.js)
const GENRE_COLOR = {
  'FICTION': '#c4682e', 'POETRY & EPICS': '#a34a9c', 'DRAMA & PLAYS': '#c33d2e',
  'CRIME & MYSTERY': '#2e8156', 'SCI-FI': '#3d6fb0', 'FANTASY': '#7b5bb5',
  'HORROR': '#4a3b52', 'ADVENTURE & TRAVEL': '#c04a70', 'HISTORY': '#8a5a3a',
  'BIOGRAPHY & MEMOIR': '#2f5590', 'PHILOSOPHY': '#3f7d7d', 'PSYCHOLOGY': '#7ba03c',
  'POLITICS & WORLD': '#6e6e6e', 'BUSINESS & ECONOMICS': '#8c6d24',
  'ESSAYS & JOURNALISM': '#7d4a66', 'HUMOR & COMEDY': '#d9a62b',
  'FOOD & COOKING': '#a04a2a', 'MISC': '#141414',
};
const genreColor = (g) => GENRE_COLOR[String(g || '').trim().toUpperCase()] || '#141414';

function slug(t) {
  return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const authorSlug = (a) => slug(a || '') || 'anonymous';

function loadData(src) {
  const text = readFileSync(src, 'utf8');
  return new Function('window', `${text}\n;return window.BookJumprData;`)({});
}

// deterministic RNG so the layout is stable run-to-run
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const { NODES, MENTIONS } = loadData(join(ROOT, 'bookjumpr-data.js'));
  const communities = JSON.parse(readFileSync(join(ROOT, 'analysis/communities.json'), 'utf8')).communities;

  // in/out degree per book id
  const outDeg = new Map(), inDeg = new Map();
  for (const [s, t] of MENTIONS) { outDeg.set(s, (outDeg.get(s) || 0) + 1); inDeg.set(t, (inDeg.get(t) || 0) + 1); }
  const deg = (k) => (outDeg.get(k) || 0) + (inDeg.get(k) || 0);

  // title+author → id fallback index
  const taIndex = new Map();
  for (const k of Object.keys(NODES)) {
    const n = NODES[k];
    const key = `${slug(n[0])}::${authorSlug(n[1])}`;
    if (!taIndex.has(key)) taIndex.set(key, k);
  }
  let matchedByKey = 0, matchedByTA = 0, unmatched = 0;
  const resolveId = (memberKey, meta) => {
    if (NODES[memberKey]) { matchedByKey++; return memberKey; }
    if (meta) {
      const alt = taIndex.get(`${slug(meta[0])}::${authorSlug(meta[1])}`);
      if (alt) { matchedByTA++; return alt; }
    }
    unmatched++; return null;
  };

  // internal-edge adjacency, per community, for the interior force layout
  const commOf = new Map();
  communities.forEach((c) => c.members.forEach((m) => commOf.set(m, c.id)));

  const rng = mulberry32(7);

  // ---- Level 1: island radii ----
  // neighborhood/mixed discs sized to hold their members; fan-out = compact hub disc.
  const islands = communities.map((c) => {
    const isFanout = c.flavor === 'fan-out';
    const hubKey = (c.hubs[0] && c.hubs[0].key) || c.members[0];
    const hubDeg = deg(hubKey);
    const r = isFanout
      ? 7 + 1.8 * Math.sqrt(hubDeg)                 // hub marker radius
      : 16 + 7.2 * Math.sqrt(c.size);               // room for interior nodes
    return { c, isFanout, hubKey, hubDeg, r, x: 0, y: 0 };
  });

  // ---- pack islands: phyllotaxis seed + collision relaxation with padding ----
  // Padding scales with island size so big regions get real gutters, not a blob.
  const PAD = 34; // base gap between island edges → regions read as separate
  const padOf = (isl) => PAD + isl.r * 0.35;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const areaSum = islands.reduce((s, i) => s + (i.r + padOf(i)) ** 2, 0);
  const spread = Math.sqrt(areaSum) * 1.85;
  islands.slice().sort((a, b) => b.r - a.r).forEach((isl, i) => {
    const t = i * GOLDEN, rad = spread * Math.sqrt(i / islands.length);
    isl.x = Math.cos(t) * rad; isl.y = Math.sin(t) * rad;
  });
  for (let iter = 0; iter < 600; iter++) {
    for (let a = 0; a < islands.length; a++) {
      for (let b = a + 1; b < islands.length; b++) {
        const A = islands[a], B = islands[b];
        let dx = B.x - A.x, dy = B.y - A.y;
        let d = Math.hypot(dx, dy) || 0.01;
        const min = A.r + B.r + Math.max(padOf(A), padOf(B));
        if (d < min) {
          const push = (min - d) / 2;
          dx /= d; dy /= d;
          A.x -= dx * push; A.y -= dy * push; B.x += dx * push; B.y += dy * push;
        }
      }
    }
    for (const isl of islands) { isl.x *= 0.995; isl.y *= 0.995; } // gentle recentre
  }

  // ---- Level 2: interior force layout for neighborhood/mixed ----
  const nodes = [];
  const nodeIndex = new Map(); // id -> node array index (rendered nodes only)
  const edges = [];

  for (const isl of islands) {
    const c = isl.c;
    if (isl.isFanout) {
      const id = resolveId(isl.hubKey, NODES[isl.hubKey]);
      if (!id) continue;
      const meta = NODES[id] || [];
      isl.hubNodeIdx = nodes.length;
      nodeIndex.set(id, nodes.length);
      nodes.push({
        id, x: isl.x, y: isl.y, r: Math.max(5, isl.r), deg: deg(id),
        comm: c.id, flavor: c.flavor, hub: true,
        title: meta[0] || id, author: meta[1] || '', color: genreColor(meta[4]),
      });
      continue;
    }
    // members (resolved to ids)
    const mem = c.members.map((m) => resolveId(m, NODES[m])).filter(Boolean);
    const local = new Map(mem.map((id, i) => [id, i]));
    const n = mem.length;
    // internal edges of this community
    const iedges = [];
    for (const [s, t] of MENTIONS) {
      if (local.has(s) && local.has(t) && s !== t) iedges.push([local.get(s), local.get(t)]);
    }
    // FR layout in unit-ish space
    const px = new Array(n), py = new Array(n);
    for (let i = 0; i < n; i++) { const a = i * GOLDEN; const rr = Math.sqrt(i / n); px[i] = Math.cos(a) * rr; py[i] = Math.sin(a) * rr; }
    const k = 1.9 / Math.sqrt(n);
    for (let it = 0; it < 260; it++) {
      const dx = new Array(n).fill(0), dy = new Array(n).fill(0);
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        let ex = px[a] - px[b], ey = py[a] - py[b];
        let d2 = ex * ex + ey * ey; if (d2 < 1e-6) { ex = rng() - 0.5; ey = rng() - 0.5; d2 = 1e-6; }
        const f = (k * k) / d2;
        dx[a] += ex * f; dy[a] += ey * f; dx[b] -= ex * f; dy[b] -= ey * f;
      }
      for (const [a, b] of iedges) {
        let ex = px[a] - px[b], ey = py[a] - py[b];
        const d = Math.hypot(ex, ey) || 1e-4; const f = (d * d) / k * 0.9;
        dx[a] -= (ex / d) * f; dy[a] -= (ey / d) * f; dx[b] += (ex / d) * f; dy[b] += (ey / d) * f;
      }
      const temp = 0.10 * (1 - it / 260) + 0.004;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(dx[i], dy[i]) || 1e-4; const lim = Math.min(d, temp);
        px[i] += (dx[i] / d) * lim; py[i] += (dy[i] / d) * lim;
        px[i] -= px[i] * 0.006; py[i] -= py[i] * 0.006;
      }
    }
    // normalize to fit inside island disc (leave margin)
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.hypot(px[i], py[i]));
    const fit = (isl.r * 0.86) / (mx || 1);
    const baseIdx = nodes.length;
    for (let i = 0; i < n; i++) {
      const id = mem[i], meta = NODES[id] || [];
      nodeIndex.set(id, nodes.length);
      nodes.push({
        id, x: isl.x + px[i] * fit, y: isl.y + py[i] * fit,
        r: Math.max(1.6, 1.5 + 1.15 * Math.sqrt(deg(id))), deg: deg(id),
        comm: c.id, flavor: c.flavor, hub: false,
        title: meta[0] || id, author: meta[1] || '', color: genreColor(meta[4]),
      });
    }
    for (const [a, b] of iedges) edges.push([baseIdx + a, baseIdx + b]);
    isl.hubNodeIdx = nodeIndex.get(resolveId(isl.hubKey, NODES[isl.hubKey]));
  }

  // ---- full adjacency for hover ("show every connection a book has") ----
  // Every mention maps to a pair of RENDERED nodes: neighborhood/mixed books map to
  // themselves; fan-out members (not rendered until expanded) map to their hub. So a
  // hovered book lights up its true links, including cross-island ones.
  const islandByComm = new Map(islands.map((isl) => [isl.c.id, isl]));
  const renderIndexOf = (id) => {
    if (nodeIndex.has(id)) return nodeIndex.get(id);
    const cid = commOf.get(id);
    const isl = cid == null ? null : islandByComm.get(cid);
    return isl && isl.hubNodeIdx != null ? isl.hubNodeIdx : null;
  };
  const adjSet = nodes.map(() => new Set());
  for (const [s, t] of MENTIONS) {
    const a = renderIndexOf(s), b = renderIndexOf(t);
    if (a == null || b == null || a === b) continue;
    adjSet[a].add(b); adjSet[b].add(a);
  }
  const adj = adjSet.map((s) => [...s]);

  // ---- community metadata for the UI (labels, hub node, disc geometry, spokes) ----
  const commOut = islands.map((isl) => {
    const c = isl.c;
    const hubId = isl.hubNodeIdx == null ? null : nodes[isl.hubNodeIdx].id;
    return {
      id: c.id, flavor: c.flavor, size: c.size, starRatio: c.starRatio,
      label: (c.hubs[0] && c.hubs[0].title) || 'cluster',
      hubs: c.hubs.slice(0, 3).map((h) => h.title),
      cx: isl.x, cy: isl.y, r: isl.r,
      hubNode: isl.hubNodeIdx == null ? null : isl.hubNodeIdx,
      // fan-out spokes (the hub's bibliography) for on-demand expansion
      spokes: isl.isFanout
        ? c.members.map((m) => resolveId(m, NODES[m])).filter((id) => id && id !== hubId)
            .map((id) => { const nn = NODES[id] || []; return { id, title: nn[0] || id, author: nn[1] || '', color: genreColor(nn[4]), deg: deg(id) }; })
        : null,
    };
  });

  // world bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const isl of islands) {
    minX = Math.min(minX, isl.x - isl.r); maxX = Math.max(maxX, isl.x + isl.r);
    minY = Math.min(minY, isl.y - isl.r); maxY = Math.max(maxY, isl.y + isl.r);
  }

  const out = {
    meta: {
      generatedFrom: 'bookjumpr-data.js + analysis/communities.json',
      nodeCount: nodes.length, edgeCount: edges.length, communityCount: commOut.length,
      matchedByKey, matchedByTitleAuthor: matchedByTA, unmatched,
      bounds: { minX, minY, maxX, maxY },
      flavorCounts: commOut.reduce((m, c) => ((m[c.flavor] = (m[c.flavor] || 0) + 1), m), {}),
    },
    nodes, edges, adj, communities: commOut,
  };

  const js = `// GENERATED by tools/build-network-data.mjs — do not hand-edit.\nwindow.BookJumprNetwork = ${JSON.stringify(out)};\n`;
  writeFileSync(join(ROOT, 'network-data.js'), js);

  console.log('network-data.js written');
  console.log(`  nodes rendered: ${nodes.length}  (fan-out members collapsed to hubs)`);
  console.log(`  interior edges: ${edges.length}`);
  console.log(`  communities:    ${commOut.length}`, out.meta.flavorCounts);
  console.log(`  join → byKey ${matchedByKey}, byTitleAuthor ${matchedByTA}, unmatched ${unmatched}`);
  console.log(`  world bounds:   ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)}`);
}

main();
