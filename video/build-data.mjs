// Builds a film's data from the site's generated data (run from the repo root):
//   node video/build-data.mjs [film]          (film = a config in video/films/, default marriage-plot-to-romeo)
// reads video/films/<film>.json and writes video/films/<film>.data.js. Everything the film shows — the
// path's books, their quotes, the wall, the starfield — comes from the site's data, never typed in by hand.
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['bookjumpr-data.js', 'bookjumpr-notes.js', 'layouts-data.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const { NODES, MENTIONS } = ctx.window.BookJumprData;
const NOTES = {}; ctx.window.BookJumprNotes.NOTES.forEach(([i, n]) => { NOTES[i] = n; });
const L = ctx.window.BookJumprLayouts, W = L.layouts.wrap;

const GEN = { 'FICTION': '#c4682e', 'POETRY & EPICS': '#a34a9c', 'DRAMA & PLAYS': '#c33d2e', 'CRIME & MYSTERY': '#2e8156', 'SCI-FI': '#3d6fb0',
  'FANTASY': '#7b5bb5', 'HORROR': '#4a3b52', 'ADVENTURE & TRAVEL': '#c04a70', 'HISTORY': '#8a5a3a', 'BIOGRAPHY & MEMOIR': '#2f5590',
  'PHILOSOPHY': '#3f7d7d', 'PSYCHOLOGY': '#7ba03c', 'POLITICS & WORLD': '#6e6e6e', 'BUSINESS & ECONOMICS': '#8c6d24',
  'ESSAYS & JOURNALISM': '#7d4a66', 'HUMOR & COMEDY': '#d9a62b', 'FOOD & COOKING': '#a04a2a' };
const MISC = '#b3ad9f';

const deg = {};
MENTIONS.forEach(([a, b]) => { deg[a] = (deg[a] || 0) + 1; deg[b] = (deg[b] || 0) + 1; });
const book = k => ({ id: k, t: NODES[k][0], a: NODES[k][1], y: NODES[k][2], c: GEN[NODES[k][4]] || MISC });

// the film's config: its question, the path it follows (each hop must be a real mention) and its end card
const NAME = process.argv[2] || 'marriage-plot-to-romeo';
const CFG = JSON.parse(fs.readFileSync('video/films/' + NAME + '.json', 'utf8'));
const mention = (a, b) => MENTIONS.findIndex(([x, y]) => x === a && y === b);
// a fan film: fans[0].from mentions every book in fans[0].to; each later fan grows from a book of the one before
const FANS = Array.isArray(CFG.fans) ? CFG.fans : null;
let PATH = CFG.path, fans = null;
if (FANS) {
  const all = [];
  const add = k => { if (!NODES[k]) throw new Error('not in the data: ' + k); if (all.indexOf(k) < 0) all.push(k); return all.indexOf(k); };
  fans = FANS.map((f, fi) => {
    if (fi > 0 && FANS[fi - 1].to.indexOf(f.from) < 0) throw new Error('fan ' + (fi + 1) + ' must grow from a book in fan ' + fi + ': ' + f.from);
    const root = add(f.from), quotes = {};
    const spokes = f.to.map(k => {
      const e = mention(f.from, k);
      if (e < 0) throw new Error(NODES[f.from][0] + ' does not mention ' + (NODES[k] ? NODES[k][0] : k) + (mention(k, f.from) >= 0 ? ' (it is the other way round)' : ''));
      return add(k);
    });
    (f.quotes || []).concat(FANS[fi + 1] ? [FANS[fi + 1].from] : []).forEach(k => {   // the next fan's root needs its quote too (it's the hop)
      const e = mention(f.from, k);
      if (e < 0 || !NOTES[e]) throw new Error(NODES[f.from][0] + ' → ' + NODES[k][0] + ': no quote saved, so it can\'t be shown');
      quotes[all.indexOf(k)] = NOTES[e];
    });
    return { root, spokes, quotes, show: (f.quotes || []).map(k => all.indexOf(k)) };
  });
  // the book the film ends on goes last (the little book rides it onto the map)
  const lastFan = fans[fans.length - 1], end = lastFan.show.length ? lastFan.show[lastFan.show.length - 1] : lastFan.root;
  const order = all.map((k, i) => i).filter(i => i !== end).concat([end]);
  const remap = i => order.indexOf(i);
  fans.forEach(f => { f.root = remap(f.root); f.spokes = f.spokes.map(remap); f.show = f.show.map(remap); const q = {}; Object.keys(f.quotes).forEach(i => { q[remap(+i)] = f.quotes[i]; }); f.quotes = q; });
  PATH = order.map(i => all[i]);
}
if (!Array.isArray(PATH) || PATH.length < 2) throw new Error(NAME + '.json: "path" (or "fans") needs at least two book ids');
PATH.forEach(k => { if (!NODES[k]) throw new Error('not in the data: ' + k); });
const idx = k => L.keys.indexOf(k);
// every hop runs forward: each book on the path mentions the next one, quoted from its text
const hops = FANS ? [] : PATH.slice(1).map((to, i) => {
  const from = PATH[i], e = MENTIONS.findIndex(([a, b]) => a === from && b === to);
  if (e < 0) throw new Error(NODES[from][0] + ' does not mention ' + NODES[to][0] + (MENTIONS.some(([a, b]) => a === to && b === from) ? ' (it is the other way round)' : ''));
  if (!NOTES[e]) throw new Error(NODES[from][0] + ' mentions ' + NODES[to][0] + ', but there is no quote for it');
  return { from: i, to: i + 1, src: i, named: i + 1, quote: NOTES[e] };
});

// the starfield: every book on the site, at its real place on the network map, in its territory's colour
const regCol = W.regions.map(r => GEN[r.genre] || MISC);
const stars = { x: [], y: [], c: [], d: [] };
L.keys.forEach((k, i) => { stars.x.push(W.xy[2 * i]); stars.y.push(W.xy[2 * i + 1]); stars.c.push(W.reg[i]); stars.d.push(L.deg[i]); });

// the big view: the best-connected books (no Harry Potter), the path's books among them
const wall = Object.keys(deg).filter(k => NODES[k] && NODES[k][4] && !/harry potter/i.test(NODES[k][0]) && PATH.indexOf(k) < 0)
  .sort((x, y) => deg[y] - deg[x]).slice(0, 170).map(book);

const out = {
  name: NAME, question: CFG.question, accent: CFG.accent || null, end: CFG.end || 'bookjumpr.com', layout: CFG.layout || (FANS ? 'fan' : 'chain'),
  palette: regCol, misc: MISC, torus: W.guides.torus,
  path: PATH.map(k => ({ ...book(k), star: idx(k) })), hops, fans, wall, stars
};
fs.writeFileSync('video/films/' + NAME + '.data.js', '// generated by video/build-data.mjs from ' + NAME + '.json — do not hand-edit\nwindow.FILM = ' + JSON.stringify(out) + ';\n');
console.log('wrote video/films/' + NAME + '.data.js');
out.hops.forEach(h => console.log(out.path[h.src].t, 'mentions', out.path[h.named].t, '|', h.quote));
(out.fans || []).forEach((f, i) => {
  console.log('fan ' + (i + 1) + ': ' + out.path[f.root].t + ' → ' + f.spokes.map(k => out.path[k].t).join(' · '));
  Object.keys(f.quotes).forEach(k => console.log('    ' + out.path[f.root].t + ' mentions ' + out.path[k].t + ' | ' + f.quotes[k]));
});
