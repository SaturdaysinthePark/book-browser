// DB -> bookjumpr-data.js. Reproduces the site's exact 7-line output contract.
import fs from 'node:fs';
import { DATA_JS } from './db.mjs';

// Pull the two site-shaped structures out of the DB.
//   MENTIONS: [[source, mentioned, author], ...]  (row order = mentions.id)
//   META:     { title: [author, year, synopsis] } (only has_meta=1 rows)
// Titles come from the registry so META[title] always resolves at runtime, and
// COALESCE reproduces app.js's `|| ''` / `|| 0` fallbacks.
export function computeData(db) {
  const mentions = db.prepare(`
    SELECT b1.title AS s, b2.title AS t, m.mentioned_author AS a
    FROM mentions m
    JOIN books b1 ON b1.slug = m.source_slug
    JOIN books b2 ON b2.slug = m.mentioned_slug
    ORDER BY m.id
  `).all().map((r) => [r.s, r.t, r.a]);

  const metaRows = db.prepare(`
    SELECT title,
           COALESCE(author, '')   AS author,
           COALESCE(year, 0)      AS year,
           COALESCE(synopsis, '') AS synopsis
    FROM books
    WHERE has_meta = 1
    ORDER BY sort_order, slug
  `).all();
  const meta = {};
  for (const r of metaRows) meta[r.title] = [r.author, r.year, r.synopsis];

  return { mentions, meta };
}

// The exact bytes app.js expects. JSON.stringify (no spaces) matches the original
// hand-authored formatting; unicode passes through unescaped.
export function renderFile({ mentions, meta }) {
  return `// BookJumpr data — generated from mentions CSV + book metadata.
// MENTIONS: [sourceTitle, mentionedTitle, mentionedAuthor]
const MENTIONS = ${JSON.stringify(mentions)};
// META: title -> [author, year, synopsis]  (the "books" CSV)
const META = ${JSON.stringify(meta)};

window.BookJumprData = { MENTIONS: MENTIONS, META: META };
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
