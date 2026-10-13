// Finds and checks book chains for BookJumpr films (run from the repo root). A film needs a forward chain —
// each book mentions the next — with a quote saved for every hop.
//
//   node video/find-chains.mjs --check "The Goldfinch" "Franny and Zooey" "Peter Pan"
//       check a chain hop by hop: ✓ quoted · ⚠ no quote saved · ⚠ runs the other way · ✗ no mention
//   node video/find-chains.mjs --fan "Norwegian Wood"
//       a fan film: every book this one mentions, best-known first (★ quoted), and how far each fans out in turn
//   node video/find-chains.mjs [--from "Title"] [--to "Title"] [--hops 2] [--max-hops 4] [--exclude <film>] [--limit 20]
//       search for forward, fully quoted chains, best-known books first
//
// Books can be given by title (case doesn't matter) or by id ("author-slug/title-slug").
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['bookjumpr-data.js', 'bookjumpr-notes.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
const { NODES, MENTIONS } = ctx.window.BookJumprData;
const NOTES = {}; ctx.window.BookJumprNotes.NOTES.forEach(([i, n]) => { NOTES[i] = n; });

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const t = k => NODES[k] ? NODES[k][0] : k, genre = k => ((NODES[k] && NODES[k][4]) || '—').split(' ')[0].toLowerCase();
const resolve = s => {
  if (NODES[s]) return s;
  const ks = Object.keys(NODES).filter(k => NODES[k][0].toLowerCase() === s.toLowerCase());
  if (!ks.length) throw new Error('no book titled ' + JSON.stringify(s));
  if (ks.length > 1) console.log('  (' + JSON.stringify(s) + ' matches ' + ks.join(', ') + ' — using the first; pass an id to choose)');
  return ks[0];
};

// --check: walk a given chain
if (argv[0] === '--check') {
  const path = argv.slice(1).map(resolve); let ok = true;
  console.log(path.map(k => t(k) + ' (' + genre(k) + ')').join('  →  ') + '\n');
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], e = MENTIONS.findIndex(([x, y]) => x === a && y === b), r = MENTIONS.findIndex(([x, y]) => x === b && y === a);
    if (e >= 0 && NOTES[e]) console.log('✓ ' + t(a) + ' → ' + t(b) + '\n    ' + NOTES[e]);
    else { ok = false; console.log((e >= 0 ? '⚠ no quote saved: ' : r >= 0 ? '⚠ runs the other way: ' : '✗ no mention: ') + t(a) + ' → ' + t(b) + (e < 0 && r >= 0 ? '  (' + t(b) + ' mentions ' + t(a) + ')' : '')); }
  }
  console.log(ok ? '\nready for a film' : '\nnot ready: every hop needs a forward mention with a quote');
  process.exit(ok ? 0 : 1);
}

const POP = new Set(`the hobbit|the great gatsby|pride and prejudice|jane eyre|little women|wuthering heights|the catcher in the rye|nineteen eighty-four|animal farm|brave new world|fahrenheit 451|to kill a mockingbird|frankenstein|dracula|alice's adventures in wonderland|matilda|the secret garden|the lion, the witch and the wardrobe|oliver twist|great expectations|romeo and juliet|hamlet|the odyssey|moby-dick|war and peace|anna karenina|crime and punishment|the goldfinch|the secret history|norwegian wood|the book thief|the shadow of the wind|looking for alaska|the fault in our stars|the bell jar|lolita|on the road|lord of the flies|of mice and men|the grapes of wrath|the old man and the sea|treasure island|robinson crusoe|don quixote|gulliver's travels|heart of darkness|candide|the perks of being a wallflower|charlotte's web|anne of green gables|kafka on the shore|ulysses|madame bovary|les misérables|the count of monte cristo|peter pan|the wonderful wizard of oz|the lord of the rings|the divine comedy|iliad|macbeth|king lear|walden|the picture of dorian gray|beloved|the handmaid's tale|slaughterhouse-five|catch-22|the road|life of pi|the alchemist|a christmas carol|david copperfield|the metamorphosis|the stranger|sense and sensibility|emma|middlemarch|rebecca|adventures of huckleberry finn|the adventures of tom sawyer|breakfast at tiffany's|franny and zooey|the little prince|paradise lost|a tale of two cities|the storied life of a. j. fikry|84, charing cross road|mr. penumbra's 24-hour bookstore|the name of the rose|foucault's pendulum|one hundred years of solitude|white teeth|the marriage plot|mrs dalloway|to the lighthouse|a room of one's own|the sun also rises|east of eden|siddhartha|the master and margarita|the time machine|the war of the worlds|dune|american gods|possession|among others|the year of magical thinking|sapiens|the historian|the thirteenth tale|i capture the castle|daddy-long-legs|the white tiger|the night circus|educated|just kids|wild|their eyes were watching god|invisible man|giovanni's room|vanity fair|tess of the d'urbervilles|silas marner|bleak house|the three musketeers|ivanhoe|kidnapped|the jungle book|the wind in the willows|winnie-the-pooh|mary poppins|black beauty|heidi|a little princess|gone with the wind|brideshead revisited|a clockwork orange|the talented mr. ripley|and then there were none|the hound of the baskervilles|twenty thousand leagues under the seas|around the world in eighty days|the call of the wild|white fang|uncle tom's cabin|the scarlet letter|the age of innocence|the house of mirth|this side of paradise|tender is the night|leaves of grass|the canterbury tales|beowulf|the aeneid|the tempest|a midsummer night's dream|othello|the importance of being earnest|pygmalion|our town|death of a salesman|a streetcar named desire|waiting for godot`.split('|'));
const indeg = {}; MENTIONS.forEach(([, b]) => { indeg[b] = (indeg[b] || 0) + 1; });
const top = new Set(Object.keys(indeg).sort((x, y) => indeg[y] - indeg[x]).slice(0, 400));
const known = k => NODES[k] && (POP.has(t(k).toLowerCase()) || top.has(k));
const fame = k => (POP.has(t(k).toLowerCase()) ? 3 : 0) + Math.log2(1 + (indeg[k] || 0));
// a usable quote: a real line, not a reading list, an epigraph credit or an editor's summary
const bad = /reading list|epigraph|candidate|dictAuthor|\(primary subject\)|Listed among|^(discussed|named|mentioned|cited|referenced)\b/i;
const credit = /^[A-Z][\w .'-]+, [A-Z][\w :'-]+\.$/;   // "Author, Title." (case matters: any two-clause sentence would match without it)
const good = n => n && n.length >= 25 && n.length <= 200 && !bad.test(n) && !(credit.test(n) && n.split(' ').length <= 8);
const out = {}; MENTIONS.forEach(([a, b], i) => { if (NODES[a] && NODES[b] && a !== b && good(NOTES[i])) (out[a] = out[a] || []).push({ a, b, n: NOTES[i] }); });

// --fan: a book and everything it mentions, for a fan film (only the books shown with a card need a quote)
if (argv[0] === '--fan') {
  const A = resolve(argv[1]), outs = MENTIONS.map(([a, b], i) => ({ a, b, i })).filter(e => e.a === A && NODES[e.b] && e.b !== A);
  const deg = k => MENTIONS.filter(([a, b]) => a === k && NODES[b] && b !== k), q = k => deg(k).filter((e, j, arr) => good(NOTES[MENTIONS.indexOf(e)])).length;
  console.log(t(A) + ' mentions ' + outs.length + ' books (★ quote saved · then: how many books that one mentions, quoted)\n');
  outs.sort((x, y) => fame(y.b) - fame(x.b)).slice(0, +opt('limit', 30)).forEach(e => {
    const n = deg(e.b).length;
    console.log((good(NOTES[e.i]) ? '★ ' : '  ') + t(e.b) + ' (' + genre(e.b) + ')' + (n ? '  → mentions ' + n + (q(e.b) ? ', ' + q(e.b) + ' quoted' : '') : '') + '\n    ' + e.b + (good(NOTES[e.i]) ? '\n    ' + NOTES[e.i] : ''));
  });
  process.exit(0);
}

// search
const minH = +opt('hops', 2), maxH = +opt('max-hops', 4), limit = +opt('limit', 20);
const from = opt('from') ? resolve(opt('from')) : null, to = opt('to') ? resolve(opt('to')) : null;
const used = new Set();
if (opt('exclude')) { const cf = JSON.parse(fs.readFileSync('video/films/' + opt('exclude') + '.json', 'utf8')); (cf.path || []).concat(...(cf.fans || []).map(f => [f.from].concat(f.to))).forEach(k => used.add(k)); }
const res = [];
const walk = (p, es) => {
  const last = p[p.length - 1];
  if (es.length >= minH && (!to || last === to)) {
    const knownN = p.filter(known).length;
    if (from || to || knownN >= p.length - 1) res.push({ s: p.reduce((s, k) => s + fame(k), 0) / p.length + es.length * 0.6, p: p.slice(), es: es.slice() });
  }
  if (es.length >= maxH) return;
  for (const e of out[last] || []) { if (p.includes(e.b) || used.has(e.b)) continue; p.push(e.b); es.push(e); walk(p, es); p.pop(); es.pop(); }
};
for (const A of from ? [from] : Object.keys(out)) if (!used.has(A) && (from || known(A))) walk([A], []);
res.sort((x, y) => y.s - x.s);
const seen = new Set(); let n = 0;
for (const r of res) {
  const key = r.p.slice(0, 3).join('|'); if (seen.has(key)) continue; seen.add(key);
  console.log('\n' + r.p.map(k => t(k) + ' (' + genre(k) + ')').join('  →  '));
  r.es.forEach(e => console.log('    ' + t(e.a) + ': ' + e.n));
  if (++n >= limit) break;
}
if (!n) console.log('no forward chain with a quote on every hop — try --hops 2, a different --from, or fill missing quotes (see .claude/skills/bookjumpr-film)');
