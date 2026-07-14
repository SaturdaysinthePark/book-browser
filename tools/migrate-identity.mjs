// One-shot migration to author-first identity keys. Idempotent.
//   1. Canonicalize every stored author string (books.author + mentions.mentioned_author).
//   2. Backfill each author-less book from its inbound mentions' most-common canonical
//      mentioned_author; anything still unknown becomes "Anonymous". So EVERY book ends up
//      with a non-empty author.
//   3. Re-key every book from its old key to "<authorSlug>/<titleSlug>". Old keys have no
//      "/" and new keys always do, so the two namespaces are disjoint — a plain per-row
//      `UPDATE books SET slug = …` cascades to mentions (FK ON UPDATE CASCADE) with no
//      intermediate PK clash. A genuine (author, title) duplicate is reported, not merged.
// Run: node --experimental-sqlite tools/migrate-identity.mjs   (honors BOOKJUMPR_DB)
import { open } from './db.mjs';
import { canonicalAuthor } from './authors.mjs';
import { bookKey } from './bookkey.mjs';

export function migrate(db) {
  const rep = {
    authorsCanon: 0, mentionAuthorsCanon: 0, authorsBackfilled: 0, rekeyed: 0,
    clashes: [], nodesBefore: db.prepare('SELECT COUNT(*) n FROM books').get().n,
  };

  // 1. canonicalize stored authors (idempotent).
  for (const r of db.prepare("SELECT slug, author FROM books WHERE author IS NOT NULL AND length(author) > 0").all()) {
    const c = canonicalAuthor(r.author);
    if (c && c !== r.author) { db.prepare("UPDATE books SET author = ? WHERE slug = ?").run(c, r.slug); rep.authorsCanon++; }
  }
  for (const r of db.prepare("SELECT id, mentioned_author FROM mentions WHERE mentioned_author IS NOT NULL AND length(mentioned_author) > 0").all()) {
    const c = canonicalAuthor(r.mentioned_author);
    if (c && c !== r.mentioned_author) { db.prepare("UPDATE mentions SET mentioned_author = ? WHERE id = ?").run(c, r.id); rep.mentionAuthorsCanon++; }
  }

  // 2. backfill author-less books from their inbound mentions (most common canonical author).
  const blanks = db.prepare("SELECT slug, title FROM books WHERE author IS NULL OR length(trim(author)) = 0").all();
  for (const b of blanks) {
    const rows = db.prepare(
      "SELECT mentioned_author AS a FROM mentions WHERE mentioned_slug = ? AND length(trim(COALESCE(mentioned_author,''))) > 0"
    ).all(b.slug);
    const tally = new Map();
    for (const r of rows) {
      const c = canonicalAuthor(r.a);
      if (c && c !== 'Anonymous') tally.set(c, (tally.get(c) || 0) + 1);
    }
    let best = 'Anonymous', bestN = 0;
    for (const [c, n] of tally) if (n > bestN) { best = c; bestN = n; }
    db.prepare("UPDATE books SET author = ? WHERE slug = ?").run(best, b.slug);
    rep.authorsBackfilled++;
  }

  // 3. re-key every book to author/title. Old keys (no "/") and new keys (with "/") are
  //    disjoint, so ordering can't clash; a true (author, title) collision is reported.
  for (const b of db.prepare('SELECT slug, title, author FROM books').all()) {
    const nk = bookKey(b.title, canonicalAuthor(b.author) || 'Anonymous');
    if (nk === b.slug) continue;
    if (db.prepare('SELECT 1 FROM books WHERE slug = ?').get(nk)) { rep.clashes.push([b.slug, nk]); continue; }
    db.prepare("UPDATE books SET slug = ?, updated_at = datetime('now') WHERE slug = ?").run(nk, b.slug);
    rep.rekeyed++;
  }

  rep.nodesAfter = db.prepare('SELECT COUNT(*) n FROM books').get().n;
  rep.authorless = db.prepare("SELECT COUNT(*) n FROM books WHERE author IS NULL OR length(trim(author)) = 0").get().n;
  rep.badKeys = db.prepare("SELECT COUNT(*) n FROM books WHERE slug NOT GLOB '*/*'").get().n;
  return rep;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const db = open();
  db.exec('BEGIN');
  try {
    const rep = migrate(db);
    db.exec('COMMIT');
    console.log('✓ migrated:', JSON.stringify(rep));
    if (rep.clashes.length) console.log('⚠ unresolved (author,title) clashes:', JSON.stringify(rep.clashes));
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('✗ migration failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
  db.close();
}
