// SQLite access for the BookJumpr pipeline, via Node's built-in `node:sqlite`
// (run with --experimental-sqlite; the npm scripts add the flag).
//
// `books` is the identity registry for EVERY distinct book (sources + mentioned).
// META is the projection of books where has_meta = 1. `mentions` mirrors MENTIONS.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Override with BOOKJUMPR_DB to experiment against a scratch database.
export const DB_PATH = process.env.BOOKJUMPR_DB
  ? path.resolve(process.env.BOOKJUMPR_DB)
  : path.join(ROOT, 'bookjumpr.db');
export const DATA_JS = path.join(ROOT, 'bookjumpr-data.js');
export const BOOKS_CSV = path.join(ROOT, 'data', 'books.csv');
export const MENTIONS_CSV = path.join(ROOT, 'data', 'mentions.csv');

export const DDL = `
CREATE TABLE IF NOT EXISTS books (
  slug       TEXT PRIMARY KEY,            -- slug(title) = the site's identity
  title      TEXT NOT NULL,               -- canonical display title (first-seen raw title)
  author     TEXT,                        -- '' allowed; NULL if unknown
  year       INTEGER,                     -- 0/NULL unknown; negative = BC
  synopsis   TEXT,
  genre      TEXT,                        -- explicit genre name (one of tools/genres.mjs); NULL => MISC fallback
  has_meta   INTEGER NOT NULL DEFAULT 0,  -- 1 => emit into META
  sort_order INTEGER,                     -- deterministic META emit order
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mentions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,   -- insertion order => MENTIONS emit order
  source_slug         TEXT NOT NULL REFERENCES books(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  mentioned_slug      TEXT NOT NULL REFERENCES books(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  mentioned_author    TEXT NOT NULL DEFAULT '',            -- 3rd MENTIONS field, emitted verbatim
  source_title_raw    TEXT,                                -- audit of exact string entered
  mentioned_title_raw TEXT,                                -- audit of exact string entered
  note                TEXT,                                -- optional context (NOT emitted to the site)
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_slug, mentioned_slug)
);

CREATE INDEX IF NOT EXISTS idx_mentions_mentioned ON mentions(mentioned_slug);
CREATE INDEX IF NOT EXISTS idx_books_meta ON books(has_meta);
`;

// Open the DB, enforce pragmas, and ensure the schema exists (idempotent).
export function open(dbPath = DB_PATH) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(DDL);
  // Migration: add the genre column to a DB created before genres existed (IF NOT EXISTS DDL won't alter it).
  const cols = db.prepare('PRAGMA table_info(books)').all();
  if (!cols.some((c) => c.name === 'genre')) db.exec('ALTER TABLE books ADD COLUMN genre TEXT');
  return db;
}

export function isEmpty(db) {
  const b = db.prepare('SELECT COUNT(*) AS n FROM books').get().n;
  const m = db.prepare('SELECT COUNT(*) AS n FROM mentions').get().n;
  return b === 0 && m === 0;
}

// Counts that mirror the site's Stats page (app.js st_books / st_links / st_sources).
export function counts(db) {
  return {
    books: db.prepare('SELECT COUNT(*) AS n FROM books').get().n,          // st_books (distinct slugs)
    meta: db.prepare('SELECT COUNT(*) AS n FROM books WHERE has_meta=1').get().n,
    mentions: db.prepare('SELECT COUNT(*) AS n FROM mentions').get().n,     // st_links
    sources: db.prepare('SELECT COUNT(DISTINCT source_slug) AS n FROM mentions').get().n, // st_sources
  };
}
