// Dataset validation. Errors block `build` (unless --force); warnings/notes are advisory.
import fs from 'node:fs';
import path from 'node:path';
import { slug } from './slug.mjs';
import { counts, ROOT } from './db.mjs';
import { genreNames } from './genres.mjs';
import { canonicalAuthor } from './authors.mjs';
import { bookKey } from './bookkey.mjs';

export function doctor(db, { fix = false } = {}) {
  const errors = [], warnings = [], notes = [];
  let fixed = 0;

  // --- errors (block build) ---
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) errors.push(`${fk.length} foreign-key violation(s): a mention points at a missing book.`);

  const selfMentions = db.prepare('SELECT COUNT(*) AS n FROM mentions WHERE source_slug = mentioned_slug').get().n;
  if (selfMentions) errors.push(`${selfMentions} self-mention(s): a book listed as mentioning itself.`);

  // Identity integrity: a book's key must be its author-first form slug(author)/slug(title)
  // (author defaults to "anonymous" when blank). Anything else is drift.
  const drift = db.prepare('SELECT slug, title, author FROM books').all()
    .filter((r) => r.slug !== bookKey(r.title, canonicalAuthor(r.author) || 'Anonymous'));
  if (drift.length) errors.push(`${drift.length} book(s) whose key isn't slug(author)/slug(title) — identity drift. e.g. ${JSON.stringify(drift[0].title)} (${drift[0].slug}).`);

  // genre parity: tools/genres.mjs names must match app.js GEN3 names
  try {
    const appjs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const block = appjs.match(/P\.GEN3\s*=\s*\[([\s\S]*?)\];/);
    const appNames = block ? [...block[1].matchAll(/name:\s*'([^']*)'/g)].map((x) => x[1]) : [];
    if (appNames.join('|') !== genreNames().join('|')) {
      errors.push(`genre list drift: tools/genres.mjs (${genreNames().length}) does not match app.js GEN3 (${appNames.length}).`);
    }
  } catch (e) { warnings.push('could not verify genre parity vs app.js: ' + e.message); }

  const validGenres = new Set(genreNames());
  const badGenre = db.prepare("SELECT title, genre FROM books WHERE genre IS NOT NULL AND genre <> ''").all().filter((r) => !validGenres.has(r.genre));
  if (badGenre.length) errors.push(`${badGenre.length} book(s) have an unknown genre. e.g. "${badGenre[0].title}": ${JSON.stringify(badGenre[0].genre)}.`);

  // --- warnings ---
  const noSynopsis = db.prepare("SELECT COUNT(*) AS n FROM books WHERE has_meta = 1 AND COALESCE(synopsis,'') = ''").get().n;
  if (noSynopsis) warnings.push(`${noSynopsis} book(s) have metadata but an empty synopsis.`);

  const backlog = db.prepare(`
    SELECT b.title, COUNT(*) AS inn
    FROM mentions m JOIN books b ON b.slug = m.mentioned_slug
    WHERE b.has_meta = 0
    GROUP BY b.slug ORDER BY inn DESC, b.title LIMIT 12
  `).all();
  const backlogTotal = db.prepare(`
    SELECT COUNT(*) AS n FROM books b
    WHERE b.has_meta = 0 AND EXISTS (SELECT 1 FROM mentions WHERE mentioned_slug = b.slug)
  `).get().n;
  if (backlogTotal) warnings.push(`${backlogTotal} mentioned book(s) have no metadata yet (waiting for a synopsis).`);

  // Author conflicts, compared on the CANONICAL form (so mere spelling variants — e.g.
  // "Sir Walter Scott" vs "Walter Scott" — don't count; only genuinely different authors do).
  // A node cited under >1 canonical author is a title-collision to disambiguate.
  const authRows = db.prepare(`
    SELECT b.slug, b.title, m.mentioned_author AS a
    FROM mentions m JOIN books b ON b.slug = m.mentioned_slug
    WHERE m.mentioned_author IS NOT NULL AND length(m.mentioned_author) > 0
  `).all();
  const bySlug = new Map();
  for (const r of authRows) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, { title: r.title, canon: new Set() });
    const c = canonicalAuthor(r.a); if (c) bySlug.get(r.slug).canon.add(c);
  }
  const collisions = [...bySlug.values()].filter((v) => v.canon.size > 1).map((v) => ({ title: v.title, canon: [...v.canon] }));
  if (collisions.length) {
    warnings.push(`${collisions.length} node(s) cited under >1 canonical author (title-collision — needs a composite key). e.g. "${collisions[0].title}": ${collisions[0].canon.join(' | ')}.`);
  }

  const orphans = db.prepare(`
    SELECT title FROM books b
    WHERE NOT EXISTS (SELECT 1 FROM mentions WHERE source_slug = b.slug)
      AND NOT EXISTS (SELECT 1 FROM mentions WHERE mentioned_slug = b.slug)
  `).all();
  if (orphans.length) warnings.push(`${orphans.length} orphan book(s) in no mention at all (won't appear on the site): ${orphans.slice(0, 5).map((o) => JSON.stringify(o.title)).join(', ')}${orphans.length > 5 ? ' …' : ''}.`);

  const futureYear = db.prepare('SELECT COUNT(*) AS n FROM books WHERE year > 2026').get().n;
  if (futureYear) warnings.push(`${futureYear} book(s) with a year in the future.`);

  const whitespace = db.prepare("SELECT slug, title FROM books WHERE title <> trim(title) OR title LIKE '%  %'").all();
  if (whitespace.length) warnings.push(`${whitespace.length} book title(s) with leading/trailing or doubled whitespace.`);

  // --- notes ---
  const variants = db.prepare(`
    SELECT b.title AS canonical, m.mentioned_title_raw AS raw FROM mentions m JOIN books b ON b.slug = m.mentioned_slug
    WHERE m.mentioned_title_raw IS NOT NULL AND m.mentioned_title_raw <> b.title
    UNION
    SELECT b.title, m.source_title_raw FROM mentions m JOIN books b ON b.slug = m.source_slug
    WHERE m.source_title_raw IS NOT NULL AND m.source_title_raw <> b.title
  `).all();
  if (variants.length) notes.push(`${variants.length} variant spelling(s) normalized to a canonical title (e.g. ${JSON.stringify(variants[0].raw)} → ${JSON.stringify(variants[0].canonical)}).`);

  // --- optional safe fixes (never touch a title/slug) ---
  if (fix) {
    const trimmed = db.prepare("UPDATE books SET author = trim(author) WHERE author IS NOT NULL AND author <> trim(author)").run().changes
      + db.prepare("UPDATE books SET synopsis = trim(synopsis) WHERE synopsis IS NOT NULL AND synopsis <> trim(synopsis)").run().changes;
    fixed += trimmed;
  }

  return { errors, warnings, notes, backlog, fixed, counts: counts(db) };
}

// exit code: 0 clean, 1 warnings only, 2 errors present
export function printReport(r) {
  for (const e of r.errors) console.log('  ✗ ERROR   ' + e);
  for (const w of r.warnings) console.log('  ! warning ' + w);
  for (const n of r.notes) console.log('  · note    ' + n);
  if (r.backlog.length) {
    console.log('\n  Synopsis backlog (most-mentioned books still missing metadata):');
    for (const b of r.backlog) console.log(`    ×${String(b.inn).padStart(2)}  ${b.title}`);
  }
  if (r.fixed) console.log(`\n  fixed ${r.fixed} field(s).`);
  if (!r.errors.length && !r.warnings.length) console.log('  ✓ clean — no problems found.');
  return r.errors.length ? 2 : r.warnings.length ? 1 : 0;
}
