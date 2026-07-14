// DB -> bookjumpr-data.js. Reproduces the site's exact 7-line output contract.
import fs from 'node:fs';
import { DATA_JS } from './db.mjs';

// Pull the site-shaped structures out of the DB. Identity is the book KEY (books.slug),
// which is (title + author)-aware, so the data file carries explicit node keys and the
// site consumes them (no re-deriving identity from title).
//   NODES:    { key: [title, author, year, synopsis, genre] }  (every book)
//   MENTIONS: [[sourceKey, mentionedKey], ...]                 (row order = mentions.id)
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

  return { nodes, mentions };
}

// The bytes app.js expects. JSON.stringify (no spaces); unicode passes through unescaped.
export function renderFile({ nodes, mentions }) {
  return `// BookJumpr data — generated from the book graph (bookjumpr.db).
// NODES: key -> [title, author, year, synopsis, genre]
const NODES = ${JSON.stringify(nodes)};
// MENTIONS: [sourceKey, mentionedKey]
const MENTIONS = ${JSON.stringify(mentions)};

window.BookJumprData = { NODES: NODES, MENTIONS: MENTIONS };
`;
}

// Build the file text from the DB.
export function buildText(db) {
  return renderFile(computeData(db));
}

// Write bookjumpr-data.js (or, with {check:true}, only report whether it would change).
export function writeBuild(db, { check = false, out = DATA_JS } = {}) {
  const next = buildText(db);
  const prev = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  const changed = next !== prev;
  if (!check) fs.writeFileSync(out, next);
  return { changed, bytes: Buffer.byteLength(next), identical: prev != null && !changed };
}
