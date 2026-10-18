// DB -> bookjumpr-data.js. Reproduces the site's output contract (NODES, MENTIONS, ALIASES).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_JS, ROOT } from './db.mjs';

// Mention notes (quotes / context) ship in their own file so the home page doesn't pay for
// them — app.js lazy-loads it on the first book page. Indexed by MENTIONS position.
export const NOTES_JS = path.join(ROOT, 'bookjumpr-notes.js');
const NOTE_MAX = 340;

// Pull the site-shaped structures out of the DB. Identity is the book KEY (books.slug),
// which is (title + author)-aware, so the data file carries explicit node keys and the
// site consumes them (no re-deriving identity from title).
//   NODES:    { key: [title, author, year, synopsis, genre] }  (every book)
//   MENTIONS: [[sourceKey, mentionedKey], ...]                 (row order = mentions.id)
//   ALIASES:  { key: [other titles] }                          (books that have any)
// NODES order: metadata books first (by sort_order), then the rest by key — deterministic.
export function computeData(db) {
  const nodeRows = db.prepare(`
    SELECT slug,
           title,
           COALESCE(author, '')   AS author,
           COALESCE(year, 0)      AS year,
           COALESCE(synopsis, '') AS synopsis,
           COALESCE(genre, '')    AS genre
    FROM books
    ORDER BY (sort_order IS NULL), sort_order, slug
  `).all();
  const nodes = {};
  for (const r of nodeRows) nodes[r.slug] = [r.title, r.author, r.year, r.synopsis, r.genre];

  const mentions = db.prepare(`
    SELECT source_slug AS s, mentioned_slug AS t FROM mentions ORDER BY id
  `).all().map((r) => [r.s, r.t]);

  // ALIASES: { key: [other titles] } — only books that have any
  const aliases = {};
  for (const r of db.prepare('SELECT book_slug AS k, alias FROM aliases ORDER BY book_slug, alias').all()) (aliases[r.k] = aliases[r.k] || []).push(r.alias);

  return { nodes, mentions, aliases };
}

// NOTES: [[mentionIndex, note], ...] — only rows that carry a note, trimmed on a word boundary.
export function computeNotes(db) {
  const rows = db.prepare(`SELECT note FROM mentions ORDER BY id`).all();
  const notes = [];
  rows.forEach((r, i) => {
    let n = (r.note || '').replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (n.length > NOTE_MAX) n = n.slice(0, NOTE_MAX).replace(/\s+\S*$/, '') + '…';
    notes.push([i, n]);
  });
  return { count: rows.length, notes };
}

export function renderNotesFile({ count, notes }) {
  return `// BookJumpr mention notes — generated from bookjumpr.db (lazy-loaded by app.js on book pages).
// NOTES: [mentionIndex, note] — index into MENTIONS in bookjumpr-data.js (COUNT guards drift).
window.BookJumprNotes = { COUNT: ${count}, NOTES: ${JSON.stringify(notes)} };
`;
}

// The bytes app.js expects. JSON.stringify (no spaces); unicode passes through unescaped.
export function renderFile({ nodes, mentions, aliases = {} }) {
  return `// BookJumpr data — generated from the book graph (bookjumpr.db).
// NODES: key -> [title, author, year, synopsis, genre]
const NODES = ${JSON.stringify(nodes)};
// MENTIONS: [sourceKey, mentionedKey]
const MENTIONS = ${JSON.stringify(mentions)};
// ALIASES: key -> [other titles the book is known by]
const ALIASES = ${JSON.stringify(aliases)};

window.BookJumprData = { NODES: NODES, MENTIONS: MENTIONS, ALIASES: ALIASES };
`;
}

// Build the file text from the DB.
export function buildText(db) {
  return renderFile(computeData(db));
}

// Write bookjumpr-data.js (or, with {check:true}, only report whether it would change).
export function writeBuild(db, { check = false, out = DATA_JS, notesOut = NOTES_JS } = {}) {
  const next = buildText(db);
  const prev = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  const nextNotes = renderNotesFile(computeNotes(db));
  const prevNotes = fs.existsSync(notesOut) ? fs.readFileSync(notesOut, 'utf8') : null;
  const changed = next !== prev || nextNotes !== prevNotes;
  if (!check) { fs.writeFileSync(out, next); fs.writeFileSync(notesOut, nextNotes); }
  return { changed, bytes: Buffer.byteLength(next), notesBytes: Buffer.byteLength(nextNotes), identical: prev != null && prevNotes != null && !changed };
}
