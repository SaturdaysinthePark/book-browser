// Writes the text crawlers and AI answer engines can read without running JavaScript (run from the repo root;
// `npm run bj:build` also runs it):
//   node --experimental-sqlite --no-warnings tools/build-seo.mjs [--check]
// 1. index.html — a short block inside <div id="app"> (between the seo:start / seo:end markers): what BookJumpr is,
//    when the data was last updated, the most-mentioned books, and a few real connections with their quotes. The
//    app replaces #app's contents when it renders, and a class set before first paint hides the block, so visitors
//    never see it.
// 2. llms.txt — the same as plain text for AI crawlers, plus question-and-answer pairs drawn from the data.
// 3. llms-full.txt — every book that mentions another, with what it mentions and the quote.
// 4. sitemap.xml — the homepage, about/stats/network, and every book page with something on it (a synopsis, a
//    mention, or two books mentioning it) plus their authors, each with <lastmod> from bookjumpr.db.
// 5. netlify/seo/data.js — the data the edge function (netlify/edge-functions/seo.js) renders each page's head and
//    crawler text from, including which books have their own preview card in og/ (rendered by tools/render-og.mjs).
// The social profiles below go into the site's JSON-LD (index.html) and llms.txt.
// Everything comes from bookjumpr-data.js / bookjumpr-notes.js; dates are book/mention timestamps in bookjumpr.db,
// so rebuilding unchanged data changes nothing.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { open } from './db.mjs';
import { slug } from './slug.mjs';

const SITE = 'https://bookjumpr.com';
export const PROFILES = [
  ['X', 'https://x.com/saturdaysonx'],
  ['Instagram', 'https://www.instagram.com/saturdaysinabook/'],
  ['TikTok', 'https://www.tiktok.com/@saturdaysinabook'],
];
// a few real connections to show (each must be a quoted forward mention in the data)
const EXAMPLES = [
  ['haruki-murakami/norwegian-wood', 'j-d-salinger/the-catcher-in-the-rye'],
  ['aldous-huxley/brave-new-world', 'william-shakespeare/romeo-and-juliet'],
  ['j-d-salinger/franny-and-zooey', 'j-m-barrie/peter-pan'],
  ['j-d-salinger/the-catcher-in-the-rye', 'charles-dickens/oliver-twist'],
  ['jeffrey-eugenides/the-marriage-plot', 'italo-calvino/invisible-cities'],
];
// books to answer "what books are mentioned in X?" for in llms.txt
const QA_SOURCES = ['haruki-murakami/kafka-on-the-shore', 'haruki-murakami/norwegian-wood', 'j-d-salinger/the-catcher-in-the-rye', 'james-joyce/ulysses'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// notes are stored with their own quote marks (straight or curly) — drop the outer pair; the renderers add theirs
const clean = q => q.trim().replace(/^"([^"]*)"$/, '$1').replace(/^“([^“”]*)”$/, '$1');

function load() {
  const ctx = { window: {} }; vm.createContext(ctx);
  for (const f of ['bookjumpr-data.js', 'bookjumpr-notes.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
  const { NODES, MENTIONS, ALIASES = {} } = ctx.window.BookJumprData, NOTES = {};
  ctx.window.BookJumprNotes.NOTES.forEach(([i, n]) => { NOTES[i] = n; });
  return { NODES, MENTIONS, NOTES, ALIASES };
}

// newest book/mention timestamp in the DB, as YYYY-MM-DD
export function lastUpdated(db) {
  const r = db.prepare(`SELECT MAX(t) AS t FROM (SELECT MAX(COALESCE(updated_at, created_at)) AS t FROM books
                                               UNION ALL SELECT MAX(created_at) FROM mentions)`).get();
  return String(r.t || '').slice(0, 10);
}

const by = (NODES, k) => `${NODES[k][0]} by ${NODES[k][1] || 'an unknown author'}`;
const yearLabel = y => (!y ? '' : y < 0 ? 'c. ' + -y + ' BC' : String(y));
const authorSlug = a => slug(a || '') || 'anonymous';   // mirrors P.authorSlug in app.js
const listOf = (names, max) => names.length <= max ? names.join('; ') : names.slice(0, max).join('; ') + `; and ${names.length - max} more`;

export function seoContent(updated) {
  const { NODES, MENTIONS, NOTES, ALIASES } = load();
  const indeg = {}; MENTIONS.forEach(([a, b]) => { if (a !== b && NODES[b]) indeg[b] = (indeg[b] || 0) + 1; });
  const top = Object.keys(indeg).sort((x, y) => indeg[y] - indeg[x] || NODES[x][0].localeCompare(NODES[y][0])).slice(0, 30);
  const examples = EXAMPLES.map(([a, b]) => {
    const i = MENTIONS.findIndex(([x, y]) => x === a && y === b);
    if (i < 0 || !NOTES[i]) throw new Error('example is not a quoted mention: ' + a + ' → ' + b);
    return { a: NODES[a], b: NODES[b], q: clean(NOTES[i]) };
  });
  // every source book, with what it mentions (and the quote where there is one)
  const outs = {};
  MENTIONS.forEach(([a, b], i) => { if (a !== b && NODES[a] && NODES[b]) (outs[a] = outs[a] || []).push({ k: b, q: NOTES[i] ? clean(NOTES[i]) : '' }); });
  const mentioners = k => MENTIONS.filter(([a, b]) => b === k && a !== k && NODES[a]).map(([a]) => a);
  const qa = [
    { q: 'What is BookJumpr?', a: `BookJumpr (${SITE}) is a free website that maps the books mentioned inside other books: when a character reads one, quotes one, or name-drops one. It covers ${Object.keys(NODES).length.toLocaleString('en-US')} books and ${MENTIONS.length.toLocaleString('en-US')} mentions, most with the line where the mention happens.` },
    { q: 'What is the most mentioned book in other books?', a: `In BookJumpr's data, ${by(NODES, top[0])} is the book most often named inside other books (${indeg[top[0]]} books), followed by ${by(NODES, top[1])} (${indeg[top[1]]}) and ${by(NODES, top[2])} (${indeg[top[2]]}).` },
    ...top.slice(0, 3).map(k => ({ q: `Which books mention ${NODES[k][0]}?`, a: `${indeg[k]} books in BookJumpr mention ${by(NODES, k)}, including ${listOf(mentioners(k).map(m => by(NODES, m)), 8)}. Full list: ${SITE}/${k}` })),
    ...QA_SOURCES.filter(k => NODES[k] && outs[k]).map(k => ({ q: `What books are mentioned in ${NODES[k][0]}?`, a: `${by(NODES, k)} mentions ${outs[k].length} books: ${listOf(outs[k].map(o => by(NODES, o.k)), 12)}. With quotes: ${SITE}/${k}` })),
  ];
  const full = Object.keys(outs).sort((x, y) => NODES[x][0].localeCompare(NODES[y][0]) || x.localeCompare(y))
    .map(k => ({ k, head: by(NODES, k) + (NODES[k][2] ? ` (${yearLabel(NODES[k][2])})` : ''), outs: outs[k] }));
  // the edge function's data (see netlify/seo/render.js for the shape); G: books with their own preview card, with a
  // short hash of the image so a re-rendered card gets a fresh URL (link previews are cached by URL)
  const edge = { B: {}, O: {}, I: {}, A: {}, G: {}, L: ALIASES };   // L: a book's other titles
  for (const k of Object.keys(NODES)) {
    const f = `og/${k}.png`;
    if (fs.existsSync(f)) edge.G[k] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
  }
  for (const k of Object.keys(NODES)) {
    const [t, a, y, syn] = NODES[k], as = authorSlug(a);
    edge.B[k] = [t, a, y, syn, as];
    (edge.A[as] = edge.A[as] || [a || 'Anonymous', []])[1].push(k);
  }
  MENTIONS.forEach(([a, b], i) => {
    if (a === b || !NODES[a] || !NODES[b]) return;
    if (!(edge.O[a] = edge.O[a] || []).some(([m]) => m === b)) edge.O[a].push([b, NOTES[i] ? clean(NOTES[i]) : '']);
    if (!(edge.I[b] = edge.I[b] || []).includes(a)) edge.I[b].push(a);
  });
  // pages worth listing in the sitemap: a synopsis, at least one mention, or mentioned by two or more
  const pages = Object.keys(NODES).filter(k => NODES[k][3] || edge.O[k] || (edge.I[k] || []).length >= 2);
  return { updated, books: Object.keys(NODES).length, mentions: MENTIONS.length, top: top.map(k => ({ k, t: NODES[k][0], a: NODES[k][1], n: indeg[k] })),
    examples: examples.map((e, i) => ({ ...e, ka: EXAMPLES[i][0], kb: EXAMPLES[i][1] })), qa, full, NODES, edge, pages };
}

export function renderHtml(s) {
  return [
    '<!-- seo:start — generated by tools/build-seo.mjs; hidden once the app runs -->',
    '<div class="bj-seo">',
    '<h1>BookJumpr: books mentioned inside other books</h1>',
    `<p><time datetime="${s.updated}">Updated ${prettyDate(s.updated)}</time> · ${s.books.toLocaleString('en-US')} books · ${s.mentions.toLocaleString('en-US')} mentions</p>`,
    `<p>BookJumpr maps the books mentioned inside other books: when a character reads one, quotes one, or name-drops one. It covers ${s.books.toLocaleString('en-US')} books and ${s.mentions.toLocaleString('en-US')} mentions, most with the line where it happens. Pick a book, see every book it mentions and every book that mentions it, and jump from one to the next.</p>`,
    '<h2>A few connections</h2>',
    '<ul>',
    ...s.examples.map(e => `<li><a href="/${e.ka}"><cite>${esc(e.a[0])}</cite></a> (${esc(e.a[1])}) mentions <a href="/${e.kb}"><cite>${esc(e.b[0])}</cite></a>: “${esc(e.q)}”</li>`),
    '</ul>',
    '<h2>The most-mentioned books</h2>',
    '<ol>',
    ...s.top.map(b => `<li><a href="/${b.k}"><cite>${esc(b.t)}</cite></a> by ${esc(b.a)}, mentioned in ${b.n} books</li>`),
    '</ol>',
    '<p><a href="/stats">All the most-mentioned books</a> · <a href="/about">About BookJumpr</a></p>',
    '</div>',
    '<!-- seo:end -->',
  ].join('\n');
}

const prettyDate = d => { const [y, m, day] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${day}, ${y}`; };

export function renderLlms(s) {
  return [
    '# BookJumpr',
    '',
    `Last updated: ${s.updated}. Updated whenever books are added.`,
    '',
    `> BookJumpr (${SITE}) maps the books mentioned inside other books: when a character reads one, quotes one, or name-drops one. ${s.books.toLocaleString('en-US')} books, ${s.mentions.toLocaleString('en-US')} mentions.`,
    '',
    'Each mention links a book to a book it names, usually with the line from the text where it happens. On the site you pick a book, see every book it mentions and every book that mentions it, and jump between them.',
    '',
    `A book's page is at ${SITE}/<author-slug>/<title-slug>, e.g. ${SITE}/haruki-murakami/norwegian-wood. An author's page is at ${SITE}/<author-slug>. The most-mentioned books are at ${SITE}/stats.`,
    '',
    '## Links',
    '',
    `- [Home](${SITE}/): pick a book and jump`,
    `- [Most-mentioned books](${SITE}/stats)`,
    `- [About](${SITE}/about)`,
    `- [Full index for LLMs](${SITE}/llms-full.txt)`,
    `- [Sitemap](${SITE}/sitemap.xml)`,
    '',
    '## Example connections',
    '',
    ...s.examples.map(e => `- ${e.a[0]} (${e.a[1]}) mentions ${e.b[0]}: "${e.q}"`),
    '',
    '## The most-mentioned books',
    '',
    ...s.top.map(b => `- ${b.t} by ${b.a}: mentioned in ${b.n} books`),
    '',
    '## Questions BookJumpr answers',
    '',
    ...s.qa.flatMap(x => [`Q: ${x.q}`, `A: ${x.a}`, '']),
    `For every book and what it mentions, with quotes, see ${SITE}/llms-full.txt`,
    '',
    '## Elsewhere',
    '',
    ...PROFILES.map(([name, url]) => `- ${name}: ${url}`),
    '',
  ].join('\n');
}

export function renderLlmsFull(s) {
  return [
    '# BookJumpr: every book and the books it mentions',
    '',
    `> Generated from BookJumpr (${SITE}). Last updated: ${s.updated}. ${s.full.length.toLocaleString('en-US')} books that mention other books, ${s.mentions.toLocaleString('en-US')} mentions in all. Where a mention has a note, it is usually the line from the book where the mention happens.`,
    '',
    ...s.full.flatMap(b => [
      `## ${b.head}`,
      `${SITE}/${b.k}`,
      ...b.outs.map(o => `- ${by(s.NODES, o.k)}${o.q ? `: "${o.q}"` : ''}`),
      '',
    ]),
  ].join('\n');
}

// newest timestamp touching each book (the book row, or a mention from or to it), as YYYY-MM-DD
export function bookDates(db) {
  const d = {};
  const bump = (k, t) => { t = String(t || '').slice(0, 10); if (k && t && !(d[k] >= t)) d[k] = t; };
  for (const r of db.prepare('SELECT slug, COALESCE(updated_at, created_at) AS t FROM books').all()) bump(r.slug, r.t);
  for (const r of db.prepare('SELECT source_slug AS a, mentioned_slug AS b, created_at AS t FROM mentions').all()) { bump(r.a, r.t); bump(r.b, r.t); }
  return d;
}

export function renderSitemap(s, dates) {
  const url = (loc, lastmod) => `  <url><loc>${SITE}${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
  const authors = {};
  for (const k of s.pages) { const as = s.edge.B[k][4], t = dates[k] || s.updated; if (as !== 'anonymous' && !(authors[as] >= t)) authors[as] = t; }
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/', s.updated), url('/about', s.updated), url('/stats', s.updated), url('/network', s.updated),
    ...s.pages.slice().sort().map(k => url('/' + k, dates[k] || s.updated)),
    ...Object.keys(authors).sort().map(a => url('/' + a, authors[a])),
    '</urlset>', ''].join('\n');
}

export function renderEdgeData(s) {
  return '// Generated by tools/build-seo.mjs from bookjumpr-data.js / bookjumpr-notes.js — do not edit.\n' +
    '// Shape: see netlify/seo/render.js. Used by the edge function netlify/edge-functions/seo.js.\n' +
    'export default ' + JSON.stringify(s.edge) + ';\n';
}

// returns true if anything changed (or, with check, would change)
export function writeSeo(db, { check = false } = {}) {
  const s = seoContent(lastUpdated(db));
  const html = fs.readFileSync('index.html', 'utf8');
  const re = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;
  if (!re.test(html)) throw new Error('index.html: no seo:start / seo:end markers');
  const files = { 'index.html': html.replace(re, renderHtml(s)), 'llms.txt': renderLlms(s), 'llms-full.txt': renderLlmsFull(s),
    'sitemap.xml': renderSitemap(s, bookDates(db)), 'netlify/seo/data.js': renderEdgeData(s) };
  const stale = Object.keys(files).filter(f => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== files[f]);
  if (!check) stale.forEach(f => fs.writeFileSync(f, files[f]));
  return stale.length > 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), db = open(), changed = writeSeo(db, { check });
  db.close();
  console.log(check ? (changed ? '! seo text WOULD change' : '✓ seo text up to date') : (changed ? '✓ wrote the seo block in index.html, llms.txt, llms-full.txt, sitemap.xml, netlify/seo/data.js' : '✓ seo text — no change'));
  if (check && changed) process.exitCode = 1;
}
