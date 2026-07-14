// Shared write operations used by the CLI and the admin server: upserts, JSON
// batch import, and CSV import/export.
//
// Book identity is (title + canonical author), materialized as the `books.slug` PK in
// author-first form "<authorSlug>/<titleSlug>" (e.g. "ralph-waldo-emerson/essays"). Author
// leads, so (author, title) is inherently unique — no collision suffix. A book with no known
// author uses the "anonymous" author segment. `resolveKey` is the single place that decision
// is made (matching on title-slug + sameAuthor, upgrading anonymous stubs).
import fs from 'node:fs';
import { slug } from './slug.mjs';
import { bookKey, titleSlug } from './bookkey.mjs';
import { canonicalAuthor, sameAuthor, authorKey } from './authors.mjs';
import { BOOKS_CSV, MENTIONS_CSV } from './db.mjs';
import { parseCsvObjects, toCsv } from './csv.mjs';
import { canonicalGenre } from './genres.mjs';

function cleanStr(v) { return v == null ? '' : String(v).trim(); }
function toYear(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// The identity key "<authorSlug>/<titleSlug>" for (title, canonical author). Author-first,
// so the key is inherently unique per (author, title). Merge rules against books sharing the
// title-slug: same canonical author -> reuse; an anonymous/blank stub of the same title gets
// UPGRADED (re-keyed, cascades to mentions) to the newly-known author; otherwise mint a new
// key. Blank incoming author -> "anonymous" segment.
function resolveKey(db, title, canon) {
  const ts = titleSlug(title);
  if (!ts) throw new Error(`title has no usable slug: ${JSON.stringify(title)}`);
  const fam = db.prepare('SELECT slug, author FROM books WHERE slug = ? OR slug GLOB ?').all(ts, '*/' + ts);
  const isAnon = (a) => { const c = canonicalAuthor(a); return !c || c === 'Anonymous'; };
  if (canon) {
    const hit = fam.find((r) => r.author && sameAuthor(r.author, canon));
    if (hit) return hit.slug;
    const anon = fam.find((r) => isAnon(r.author));
    if (anon) {
      const nk = bookKey(title, canon);
      if (nk !== anon.slug && !db.prepare('SELECT 1 FROM books WHERE slug = ?').get(nk)) {
        db.prepare("UPDATE books SET slug = ?, author = ?, updated_at = datetime('now') WHERE slug = ?").run(nk, canon, anon.slug);
        return nk;
      }
      return anon.slug;
    }
    return bookKey(title, canon);
  }
  if (fam.length) return (fam.find((r) => isAnon(r.author)) || fam[0]).slug;
  return bookKey(title, 'Anonymous');
}

// Ensure a book row exists for (title, author); returns its key. Backfills a blank author.
export function ensureBook(db, title, author = '') {
  const t = cleanStr(title);
  const canon = canonicalAuthor(author);
  const key = resolveKey(db, t, canon);
  const existing = db.prepare('SELECT author FROM books WHERE slug = ?').get(key);
  if (!existing) {
    db.prepare('INSERT INTO books (slug, title, author, has_meta) VALUES (?, ?, ?, 0)').run(key, t, canon || 'Anonymous');
  } else if (canon) {
    // backfill a blank author, or prefer the fuller spelling ("Emerson" -> "Ralph Waldo Emerson")
    const cur = canonicalAuthor(existing.author);
    const fuller = !cur || authorKey(canon).split(' ').length > authorKey(cur).split(' ').length;
    if (fuller) db.prepare("UPDATE books SET author = ?, updated_at = datetime('now') WHERE slug = ?").run(canon, key);
  }
  return key;
}

function setGenreOnKey(db, key, genre) {
  const raw = genre == null ? '' : String(genre).trim();
  let value = null;
  if (raw) {
    value = canonicalGenre(raw);
    if (!value) throw new Error(`unknown genre: ${JSON.stringify(genre)} — run \`bj genres\` for the list`);
  }
  db.prepare("UPDATE books SET genre = ?, updated_at = datetime('now') WHERE slug = ?").run(value, key);
  return value;
}

// Assign (or clear) a book's genre by title (author optional to disambiguate a collision).
export function setGenre(db, title, genre, author = '') {
  const t = cleanStr(title);
  if (!t) throw new Error('set-genre requires a title');
  const key = ensureBook(db, t, author);
  return { slug: key, genre: setGenreOnKey(db, key, genre) };
}

// Add/update a book's metadata (sets has_meta=1). Author is canonicalized and participates
// in identity. Pass `genre` to also set it.
export function upsertBook(db, { title, author = '', year = 0, synopsis = '', genre }) {
  const t = cleanStr(title);
  if (!t) throw new Error('add-book requires a non-empty --title');
  const canon = canonicalAuthor(author);
  const key = resolveKey(db, t, canon);
  const before = db.prepare('SELECT has_meta FROM books WHERE slug = ?').get(key);
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM books').get().n;
  // Every book gets a non-empty author segment; a blank incoming author becomes "Anonymous".
  // On conflict, a blank/Anonymous incoming author must NOT clobber an already-known author.
  db.prepare(`
    INSERT INTO books (slug, title, author, year, synopsis, has_meta, sort_order)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      author = CASE WHEN excluded.author = 'Anonymous' THEN COALESCE(books.author, 'Anonymous')
                    ELSE excluded.author END,
      year = excluded.year, synopsis = excluded.synopsis, has_meta = 1,
      sort_order = COALESCE(books.sort_order, excluded.sort_order),
      updated_at = datetime('now')
  `).run(key, t, canon || 'Anonymous', toYear(year), cleanStr(synopsis), nextOrder);
  if (genre !== undefined) setGenreOnKey(db, key, genre);
  return { slug: key, createdRow: !before, wasMeta: !!(before && before.has_meta) };
}

// Add a mention (auto-creates both books). `author` = mentioned book's author (used for its
// identity); `sourceAuthor` disambiguates the source if needed. Deduped on (source, mentioned).
export function upsertMention(db, { source, mentioned, author = '', sourceAuthor = '', note = null, update = false }) {
  const s = cleanStr(source), m = cleanStr(mentioned);
  if (!s || !m) throw new Error('a mention needs both --source and --mentioned');
  const canonM = canonicalAuthor(author);
  const sid = ensureBook(db, s, sourceAuthor);
  const mid = ensureBook(db, m, author);
  if (sid === mid) throw new Error(`a book cannot mention itself: ${JSON.stringify(s)}`);
  const res = db.prepare(`
    INSERT OR IGNORE INTO mentions
      (source_slug, mentioned_slug, mentioned_author, source_title_raw, mentioned_title_raw, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sid, mid, canonM, s, m, note == null ? null : cleanStr(note));
  if (res.changes === 0) {
    if (update) {
      db.prepare('UPDATE mentions SET mentioned_author = ?, note = COALESCE(?, note) WHERE source_slug = ? AND mentioned_slug = ?')
        .run(canonM, note == null ? null : cleanStr(note), sid, mid);
      return { added: false, updated: true };
    }
    return { added: false, updated: false };
  }
  return { added: true, updated: false };
}

// Import a { books:[], mentions:[], genres:[] } batch in one transaction. Returns a report.
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
        source: mn.source, mentioned: mn.mentioned, author: mn.author, sourceAuthor: mn.sourceAuthor,
        note: mn.note, update: !!mn.update,
      });
      if (r.added) rep.mentionsAdded++;
      else if (r.updated) rep.mentionsUpdated++;
      else rep.mentionsDup++;
    }
    for (const g of genres) { setGenre(db, g.title, g.genre, g.author); rep.genresSet++; }
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

// data/*.csv <- DB (only has_meta books go to books.csv). mentions.csv carries source_author
// too, so identity (title + author) survives the round-trip.
export function exportCsv(db, { booksPath = BOOKS_CSV, mentionsPath = MENTIONS_CSV } = {}) {
  const books = db.prepare(`
    SELECT title, COALESCE(author,'') AS author, COALESCE(year,0) AS year, COALESCE(synopsis,'') AS synopsis
    FROM books WHERE has_meta = 1 ORDER BY sort_order, slug
  `).all();
  const mentions = db.prepare(`
    SELECT b1.title AS source_title, COALESCE(b1.author,'') AS source_author,
           b2.title AS mentioned_title, m.mentioned_author AS mentioned_author
    FROM mentions m JOIN books b1 ON b1.slug=m.source_slug JOIN books b2 ON b2.slug=m.mentioned_slug
    ORDER BY m.id
  `).all();
  fs.writeFileSync(booksPath, toCsv(['title', 'author', 'year', 'synopsis'], books));
  fs.writeFileSync(mentionsPath, toCsv(['source_title', 'source_author', 'mentioned_title', 'mentioned_author'], mentions));
  return { books: books.length, mentions: mentions.length };
}

// data/*.csv -> DB. Upsert by identity; with {replace:true} the CSVs are the source of truth.
export function importCsv(db, { booksPath = BOOKS_CSV, mentionsPath = MENTIONS_CSV, replace = false } = {}) {
  const bookRows = fs.existsSync(booksPath) ? parseCsvObjects(fs.readFileSync(booksPath, 'utf8')) : [];
  const mentionRows = fs.existsSync(mentionsPath) ? parseCsvObjects(fs.readFileSync(mentionsPath, 'utf8')) : [];
  const rep = { booksMetaSet: 0, mentionsAdded: 0, mentionsDup: 0 };
  db.exec('BEGIN');
  try {
    if (replace) {
      db.exec('DELETE FROM mentions');
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'mentions'");
      db.exec('DELETE FROM books');
    }
    for (const b of bookRows) {
      if (!cleanStr(b.title)) continue;
      upsertBook(db, { title: b.title, author: b.author, year: b.year, synopsis: b.synopsis });
      rep.booksMetaSet++;
    }
    for (const mn of mentionRows) {
      if (!cleanStr(mn.source_title) || !cleanStr(mn.mentioned_title)) continue;
      const r = upsertMention(db, {
        source: mn.source_title, sourceAuthor: mn.source_author,
        mentioned: mn.mentioned_title, author: mn.mentioned_author,
      });
      if (r.added) rep.mentionsAdded++; else rep.mentionsDup++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rep;
}

// Rename a book's title (and key if the title-slug changes). Resolves `from` by its existing
// key (title-only; pass a colliding book's exact key if needed). Cascades to mentions via FK.
export function renameBook(db, from, to) {
  const fromId = db.prepare('SELECT slug FROM books WHERE slug = ?').get(from)
    ? from : resolveKey(db, from, '');
  const row = db.prepare('SELECT slug, author FROM books WHERE slug = ?').get(fromId);
  if (!row) throw new Error(`no book with title/key matching ${JSON.stringify(from)}`);
  const toId = resolveKey(db, to, canonicalAuthor(row.author));
  if (fromId === toId) {
    db.prepare("UPDATE books SET title = ?, updated_at = datetime('now') WHERE slug = ?").run(cleanStr(to), fromId);
    return { slugChanged: false, slug: fromId };
  }
  const clash = db.prepare('SELECT slug FROM books WHERE slug = ?').get(toId);
  if (clash) throw new Error(`target key "${toId}" already exists — merge manually (remove one, or re-point its mentions)`);
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE books SET slug = ?, title = ?, updated_at = datetime('now') WHERE slug = ?").run(toId, cleanStr(to), fromId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { slugChanged: true, from: fromId, slug: toId };
}

// Resolve a book to an existing key by title (+ optional author to disambiguate a collision).
function existingKey(db, title, author = '') {
  const canon = canonicalAuthor(author);
  const key = resolveKey(db, title, canon);
  return db.prepare('SELECT slug FROM books WHERE slug = ?').get(key) ? key : null;
}

export function removeMention(db, source, mentioned, { sourceAuthor = '', mentionedAuthor = '' } = {}) {
  const sid = existingKey(db, source, sourceAuthor), mid = existingKey(db, mentioned, mentionedAuthor);
  if (!sid || !mid) return { removed: 0 };
  const res = db.prepare('DELETE FROM mentions WHERE source_slug = ? AND mentioned_slug = ?').run(sid, mid);
  return { removed: res.changes };
}

export function removeBook(db, title, { cascade = false, author = '' } = {}) {
  const id = existingKey(db, title, author);
  if (!id) return { removed: 0, mentionsRemoved: 0 };
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

// Exposed for the migration + doctor.
export { resolveKey };
