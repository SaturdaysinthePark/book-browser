// Load bookjumpr-data.js into the DB (disaster-recovery / round-trip check). Identity is
// the explicit node KEY carried in the data file, so this restores books and edges verbatim
// — no re-deriving identity from title. `--verify` asserts buildText(db) === the source file.
import fs from 'node:fs';
import vm from 'node:vm';
import { DATA_JS, counts } from './db.mjs';
import { buildText } from './build.mjs';

// Read window.BookJumprData out of the generated JS by running it in a sandbox.
export function loadDataJs(file = DATA_JS) {
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  const data = sandbox.window.BookJumprData;
  if (!data || typeof data.NODES !== 'object' || data.NODES == null || !Array.isArray(data.MENTIONS)) {
    throw new Error('Could not read window.BookJumprData { NODES, MENTIONS } from ' + file);
  }
  return data;
}

export function seed(db, { reset = false, verify = false, file = DATA_JS } = {}) {
  const c0 = counts(db);
  if ((c0.books || c0.mentions) && !reset) {
    throw new Error(`DB is not empty (books=${c0.books}, mentions=${c0.mentions}). Re-run with --reset to overwrite.`);
  }

  const { NODES, MENTIONS } = loadDataJs(file);
  const insBook = db.prepare(
    `INSERT INTO books (slug, title, author, year, synopsis, genre, has_meta, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insMention = db.prepare(
    `INSERT OR IGNORE INTO mentions (source_slug, mentioned_slug, mentioned_author, source_title_raw, mentioned_title_raw)
     VALUES (?, ?, ?, ?, ?)`
  );

  let dupes = 0; const dupeExamples = [];
  db.exec('BEGIN');
  try {
    if (reset) {
      db.exec('DELETE FROM mentions');
      db.exec('DELETE FROM books');
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'mentions'");
    }
    // NODES preserve emit order; sort_order = position reproduces the build's ordering.
    let i = 0;
    for (const key of Object.keys(NODES)) {
      const [title, author, year, synopsis, genre] = NODES[key];
      const hasMeta = (year && year !== 0) || (synopsis && synopsis !== '') ? 1 : 0;
      insBook.run(key, title, author || null, year || 0, synopsis || null, genre || null, hasMeta, i);
      i++;
    }
    for (const [s, t] of MENTIONS) {
      const mentAuthor = (NODES[t] && NODES[t][1]) || '';
      const st = (NODES[s] && NODES[s][0]) || s, mt = (NODES[t] && NODES[t][0]) || t;
      const res = insMention.run(s, t, mentAuthor, st, mt);
      if (res.changes === 0) { dupes++; if (dupeExamples.length < 5) dupeExamples.push([s, t]); }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const c = counts(db);
  const report = {
    books: c.books, meta: c.meta, mentions: c.mentions, sources: c.sources,
    nodeKeys: Object.keys(NODES).length, rawMentionRows: MENTIONS.length, dupes, dupeExamples,
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
