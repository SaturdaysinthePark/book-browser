// Shared write operations used by the CLI and the admin server: upserts, JSON
// batch import, and CSV import/export. Everything routes book identity through slug().
import fs from 'node:fs';
import { slug } from './slug.mjs';
import { BOOKS_CSV, MENTIONS_CSV } from './db.mjs';
import { parseCsvObjects, toCsv } from './csv.mjs';
import { canonicalGenre } from './genres.mjs';

function cleanStr(v) { return v == null ? '' : String(v).trim(); }
function toYear(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// Ensure an identity-only book row exists for a title (keeps first-seen title if present).
export function ensureBook(db, title) {
  const id = slug(title);
  if (!id) throw new Error(`title has no usable slug: ${JSON.stringify(title)}`);
  db.prepare('INSERT OR IGNORE INTO books (slug, title, has_meta) VALUES (?, ?, 0)').run(id, cleanStr(title));
  return id;
}

// Assign (or clear) a book's genre. Independent of metadata — works on any book,
// including identity-only "ref" rows. `genre` must be a known genre name
// (case-insensitive); '' / null clears it (→ MISC fallback on the site).
export function setGenre(db, title, genre) {
  const t = cleanStr(title);
  if (!t) throw new Error('set-genre requires a title');
  const id = ensureBook(db, t);
  const raw = genre == null ? '' : String(genre).trim();
  let value = null;
  if (raw) {
    value = canonicalGenre(raw);
    if (!value) throw new Error(`unknown genre: ${JSON.stringify(genre)} — run \`bj genres\` for the list`);
  }
  db.prepare("UPDATE books SET genre = ?, updated_at = datetime('now') WHERE slug = ?").run(value, id);
  return { slug: id, genre: value };
}

// Add/update a book's metadata (sets has_meta=1). The provided title becomes the
// canonical display title + META key for its slug. Pass `genre` to also set it.
export function upsertBook(db, { title, author = '', year = 0, synopsis = '', genre }) {
  const t = cleanStr(title);
  if (!t) throw new Error('add-book requires a non-empty --title');
  const id = slug(t);
  const before = db.prepare('SELECT has_meta FROM books WHERE slug = ?').get(id);
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM books').get().n;
  db.prepare(`
    INSERT INTO books (slug, title, author, year, synopsis, has_meta, sort_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title, author = excluded.author, year = excluded.year,
      synopsis = excluded.synopsis, has_meta = 1,
      sort_order = COALESCE(books.sort_order, excluded.sort_order),
      updated_at = datetime('now')
  `).run(id, t, cleanStr(author), toYear(year), cleanStr(synopsis), nextOrder);
  if (genre !== undefined) setGenre(db, t, genre);
  return { slug: id, createdRow: !before, wasMeta: !!(before && before.has_meta) };
}

// Add a mention (auto-creates both books as identity rows). Deduped on (source, mentioned).
export function upsertMention(db, { source, mentioned, author = '', note = null, update = false }) {
  const s = cleanStr(source), m = cleanStr(mentioned);
  if (!s || !m) throw new Error('a mention needs both --source and --mentioned');
  const sid = ensureBook(db, s);
  const mid = ensureBook(db, m);
  if (sid === mid) throw new Error(`a book cannot mention itself: ${JSON.stringify(s)}`);
  const res = db.prepare(`
    INSERT OR IGNORE INTO mentions
      (source_slug, mentioned_slug, mentioned_author, source_title_raw, mentioned_title_raw, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sid, mid, cleanStr(author), s, m, note == null ? null : cleanStr(note));
  if (res.changes === 0) {
    if (update) {
      db.prepare('UPDATE mentions SET mentioned_author = ?, note = COALESCE(?, note) WHERE source_slug = ? AND mentioned_slug = ?')
        .run(cleanStr(author), note == null ? null : cleanStr(note), sid, mid);
      return { added: false, updated: true };
    }
    return { added: false, updated: false };
  }
  return { added: true, updated: false };
}

// Import a { books:[], mentions:[] } batch in one transaction. Returns a report.
export function importBatch(db, batch) {
  if (!batch || typeof batch !== 'object') throw new Error('batch must be a JSON object');
  const books = Array.isArray(batch.books) ? batch.books : [];
  const mentions = Array.isArray(batch.mentions) ? batch.mentions : [];
  const genres = Array.isArray(batch.genres) ? batch.genres : [];
  if (!books.length && !mentions.length && !genres.length) throw new Error('batch has no books[], mentions[] or genres[]');

  const rep = { booksCreated: 0, booksMetaSet: 0, mentionsAdded: 0, mentionsDup: 0, mentionsUpdated: 0, genresSet: 0 };
  db.exec('BEGIN');
  try {
    for (const b of books) {
      const r = upsertBook(db, b);
      rep.booksMetaSet++;
      if (r.createdRow) rep.booksCreated++;
    }
    for (const mn of mentions) {
      const r = upsertMention(db, {
        source: mn.source, mentioned: mn.mentioned, author: mn.author, note: mn.note,
        update: !!mn.update,
      });
      if (r.added) rep.mentionsAdded++;
      else if (r.updated) rep.mentionsUpdated++;
      else rep.mentionsDup++;
    }
    for (const g of genres) { setGenre(db, g.title, g.genre); rep.genresSet++; }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rep;
}

export function importJsonFile(db, file) {
  const raw = fs.readFileSync(file, 'utf8');
  let batch;
  try { batch = JSON.parse(raw); } catch (e) { throw new Error(`invalid JSON in ${file}: ${e.message}`); }
  return importBatch(db, batch);
}

// data/*.csv <- DB (only has_meta books go to books.csv).
export function exportCsv(db, { booksPath = BOOKS_CSV, mentionsPath = MENTIONS_CSV } = {}) {
  const books = db.prepare(`
    SELECT title, COALESCE(author,'') AS author, COALESCE(year,0) AS year, COALESCE(synopsis,'') AS synopsis
    FROM books WHERE has_meta = 1 ORDER BY sort_order, slug
  `).all();
  const mentions = db.prepare(`
    SELECT b1.title AS source_title, b2.title AS mentioned_title, m.mentioned_author AS mentioned_author
    FROM mentions m JOIN books b1 ON b1.slug=m.source_slug JOIN books b2 ON b2.slug=m.mentioned_slug
    ORDER BY m.id
  `).all();
  fs.writeFileSync(booksPath, toCsv(['title', 'author', 'year', 'synopsis'], books));
  fs.writeFileSync(mentionsPath, toCsv(['source_title', 'mentioned_title', 'mentioned_author'], mentions));
  return { books: books.length, mentions: mentions.length };
}

// data/*.csv -> DB. Upsert by slug; with {replace:true} the CSVs are the full source of truth.
export function importCsv(db, { booksPath = BOOKS_CSV, mentionsPath = MENTIONS_CSV, replace = false } = {}) {
  const bookRows = fs.existsSync(booksPath) ? parseCsvObjects(fs.readFileSync(booksPath, 'utf8')) : [];
  const mentionRows = fs.existsSync(mentionsPath) ? parseCsvObjects(fs.readFileSync(mentionsPath, 'utf8')) : [];
  const rep = { booksMetaSet: 0, mentionsAdded: 0, mentionsDup: 0 };
  db.exec('BEGIN');
  try {
    if (replace) {
      db.exec('DELETE FROM mentions');
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'mentions'");
      db.exec('UPDATE books SET has_meta = 0, author = NULL, year = NULL, synopsis = NULL, sort_order = NULL');
    }
    for (const b of bookRows) {
      if (!cleanStr(b.title)) continue;
      upsertBook(db, { title: b.title, author: b.author, year: b.year, synopsis: b.synopsis });
      rep.booksMetaSet++;
    }
    for (const mn of mentionRows) {
      if (!cleanStr(mn.source_title) || !cleanStr(mn.mentioned_title)) continue;
      const r = upsertMention(db, { source: mn.source_title, mentioned: mn.mentioned_title, author: mn.mentioned_author });
      if (r.added) rep.mentionsAdded++; else rep.mentionsDup++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rep;
}

// Rename a book's title (and slug if it changes). Cascades to mentions via FK.
export function renameBook(db, from, to) {
  const fromId = slug(from), toId = slug(to);
  const cur = db.prepare('SELECT slug FROM books WHERE slug = ?').get(fromId);
  if (!cur) throw new Error(`no book with title/slug matching ${JSON.stringify(from)}`);
  if (fromId === toId) {
    db.prepare("UPDATE books SET title = ?, updated_at = datetime('now') WHERE slug = ?").run(cleanStr(to), fromId);
    return { slugChanged: false, slug: fromId };
  }
  const clash = db.prepare('SELECT slug FROM books WHERE slug = ?').get(toId);
  if (clash) throw new Error(`target slug "${toId}" already exists — merge manually (remove one, or re-point its mentions)`);
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE books SET slug = ?, title = ?, updated_at = datetime('now') WHERE slug = ?").run(toId, cleanStr(to), fromId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { slugChanged: true, from: fromId, slug: toId };
}

export function removeMention(db, source, mentioned) {
  const res = db.prepare('DELETE FROM mentions WHERE source_slug = ? AND mentioned_slug = ?').run(slug(source), slug(mentioned));
  return { removed: res.changes };
}

export function removeBook(db, title, { cascade = false } = {}) {
  const id = slug(title);
  const refs = db.prepare('SELECT COUNT(*) AS n FROM mentions WHERE source_slug = ? OR mentioned_slug = ?').get(id, id).n;
  if (refs && !cascade) throw new Error(`"${title}" is referenced by ${refs} mention(s). Re-run with --cascade to delete them too.`);
  db.exec('BEGIN');
  try {
    if (cascade) db.prepare('DELETE FROM mentions WHERE source_slug = ? OR mentioned_slug = ?').run(id, id);
    const res = db.prepare('DELETE FROM books WHERE slug = ?').run(id);
    db.exec('COMMIT');
    return { removed: res.changes, mentionsRemoved: refs && cascade ? refs : 0 };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
