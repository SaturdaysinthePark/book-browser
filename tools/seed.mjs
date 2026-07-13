// One-time migration: load the existing bookjumpr-data.js into the DB with zero
// data loss, reusing the site's slug and replaying app.js's `ensure` walk order.
import fs from 'node:fs';
import vm from 'node:vm';
import { slug } from './slug.mjs';
import { DATA_JS, counts } from './db.mjs';
import { buildText } from './build.mjs';

// Read window.BookJumprData out of the generated JS by running it in a sandbox
// (robust — no regex parsing of the giant literals).
export function loadDataJs(file = DATA_JS) {
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  const data = sandbox.window.BookJumprData;
  if (!data || !Array.isArray(data.MENTIONS) || typeof data.META !== 'object' || data.META == null) {
    throw new Error('Could not read window.BookJumprData from ' + file);
  }
  return data;
}

export function seed(db, { reset = false, verify = false, file = DATA_JS } = {}) {
  const c0 = counts(db);
  if ((c0.books || c0.mentions) && !reset) {
    throw new Error(`DB is not empty (books=${c0.books}, mentions=${c0.mentions}). Re-run with --reset to overwrite.`);
  }

  const { MENTIONS, META, GENRES = {} } = loadDataJs(file);

  const ensureBook = db.prepare(
    'INSERT OR IGNORE INTO books (slug, title, has_meta) VALUES (?, ?, 0)'
  );
  const insMention = db.prepare(
    `INSERT OR IGNORE INTO mentions (source_slug, mentioned_slug, mentioned_author, source_title_raw, mentioned_title_raw)
     VALUES (?, ?, ?, ?, ?)`
  );
  const applyMeta = db.prepare(
    `UPDATE books SET author = ?, year = ?, synopsis = ?, has_meta = 1, sort_order = ?, updated_at = datetime('now')
     WHERE slug = ?`
  );
  const applyGenre = db.prepare("UPDATE books SET genre = ? WHERE slug = ?");

  let dupes = 0;
  const dupeExamples = [];

  db.exec('BEGIN');
  try {
    if (reset) {
      db.exec('DELETE FROM mentions');
      db.exec('DELETE FROM books');
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'mentions'"); // restart ids at 1 for stable order
    }

    // 1) Replay the ensure walk in array order (source before mentioned, per row).
    for (const row of MENTIONS) {
      const s = row[0], t = row[1], a = row[2] == null ? '' : row[2];
      ensureBook.run(slug(s), s);
      ensureBook.run(slug(t), t);
      const res = insMention.run(slug(s), slug(t), a, s, t);
      if (res.changes === 0) {
        dupes++;
        if (dupeExamples.length < 5) dupeExamples.push([s, t]);
      }
    }

    // 2) Apply metadata (books.csv) in key order.
    let i = 0;
    for (const title of Object.keys(META)) {
      const [author = '', year = 0, synopsis = ''] = META[title];
      ensureBook.run(slug(title), title); // no-op if already present (keeps first-seen title)
      applyMeta.run(author, year, synopsis, i, slug(title));
      i++;
    }

    // 3) Apply explicit genres (if the data file carries a GENRES map).
    for (const title of Object.keys(GENRES)) {
      ensureBook.run(slug(title), title);
      applyGenre.run(GENRES[title], slug(title));
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const c = counts(db);
  const report = {
    books: c.books, meta: c.meta, mentions: c.mentions, sources: c.sources,
    rawMentionRows: MENTIONS.length, metaKeys: Object.keys(META).length,
    dupes, dupeExamples,
  };

  if (verify) {
    const rebuilt = buildText(db);
    const original = fs.readFileSync(file, 'utf8');
    report.identical = rebuilt === original;
    if (!report.identical) {
      let k = 0;
      while (k < rebuilt.length && k < original.length && rebuilt[k] === original[k]) k++;
      report.firstDiffAt = k;
      report.diffOriginal = JSON.stringify(original.slice(k, k + 80));
      report.diffRebuilt = JSON.stringify(rebuilt.slice(k, k + 80));
    }
  }

  return report;
}
