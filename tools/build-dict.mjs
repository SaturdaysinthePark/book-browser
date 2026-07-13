// Builds tools/dict/titles.json — the known-titles dictionary the detector uses to
// recognize book references the plain heuristics would miss, and to auto-fill authors.
// Every entry carries a TIER so the detector can trust the clean list more than the noisy:
//
//   Source 1 (catalog, tier 0): Project Gutenberg (~68k works) — broad but noisy; it lists
//                               common words like "Japan"/"Sound" as obscure public-domain titles.
//   Source 2 (famous,  tier 1): goodbooks-10k — the 10k most-popular Goodreads books, modern
//                               AND classic, clean authors. Fills what Gutenberg lacks (1984, Beloved).
//   Source 3 (famous,  tier 1): every title already in bookjumpr.db.
//
// Because tier-1 is clean, the detector keeps a bare single-word match from it (e.g. "Macbeth")
// without other corroboration; a tier-0-only single word ("Japan") still needs a nearby signal.
//
// titles.json value shape: normalizedTitle -> [author, famousFlag].
// Raw *.csv/*.json dumps are regenerable (gitignored); titles.json IS committed.
// Run: `npm run bj:dict` (adds --experimental-sqlite for the DB read).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.mjs';
import { normTitle, formatAuthor, firstAuthor, stripSeries, STOPWORD_TITLES } from './normtitle.mjs';
import { open } from './db.mjs';

const DICT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'dict');
const CATALOG_CSV = path.join(DICT_DIR, 'pg_catalog.csv');            // official Project Gutenberg format
const CATALOG_JSON = path.join(DICT_DIR, 'gutenberg-metadata.json');  // community mirror (id -> {title:[],author:[]})
const GOODBOOKS_CSV = path.join(DICT_DIR, 'goodbooks.csv');           // goodbooks-10k books.csv
const TITLES_JSON = path.join(DICT_DIR, 'titles.json');
// gutenberg.org is often unreachable from CI/sandboxes; these GitHub mirrors carry the data.
const CATALOG_JSON_URL = 'https://raw.githubusercontent.com/hugovk/gutenberg-metadata/main/gutenberg-metadata.json';
const GOODBOOKS_URL = 'https://raw.githubusercontent.com/zygmuntz/goodbooks-10k/master/books.csv';

// Keep a normalized title only if it's a plausible book reference: not empty, not a bare
// stopword ("It", "Life"), and long enough that matching it in prose means something.
function keepTitle(norm) {
  if (!norm) return false;
  if (STOPWORD_TITLES.has(norm)) return false;
  const words = norm.split(' ');
  if (words.length === 1 && norm.length < 5) return false; // single short word => too noisy
  return true;
}

// Add/upgrade an entry. `famous` upgrades a catalog entry's tier and its author; a catalog
// source never overwrites a famous entry, and only fills a missing author.
function addEntry(dict, norm, author, famous) {
  const cur = dict.get(norm);
  if (!cur) { dict.set(norm, { a: author || '', f: famous ? 1 : 0 }); return true; }
  if (famous) { if (!cur.f) cur.f = 1; if (author) cur.a = author; return false; }
  if (!cur.a && author) cur.a = author;                    // catalog: fill only a blank author
  return false;
}

// ---- catalog (Project Gutenberg) ------------------------------------------
async function loadCatalog() {
  if (fs.existsSync(CATALOG_CSV)) return { kind: 'csv', text: fs.readFileSync(CATALOG_CSV, 'utf8') };
  if (fs.existsSync(CATALOG_JSON)) return { kind: 'json', text: fs.readFileSync(CATALOG_JSON, 'utf8') };
  process.stdout.write('• Gutenberg catalog not found locally — downloading the mirror … ');
  const text = await download(CATALOG_JSON_URL, CATALOG_JSON);
  return { kind: 'json', text };
}

function fromCsv(csvText, dict) {              // official pg_catalog.csv: Type / Title / Authors
  const rows = parseCsv(csvText);
  if (!rows.length) return 0;
  const h = rows[0].map((c) => c.trim());
  const iType = h.indexOf('Type'), iTitle = h.indexOf('Title'), iAuthors = h.indexOf('Authors');
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    if (iType >= 0 && rows[r][iType] !== 'Text') continue;
    const norm = normTitle(rows[r][iTitle]);
    if (keepTitle(norm) && addEntry(dict, norm, formatAuthor(rows[r][iAuthors]), false)) n++;
  }
  return n;
}

function fromJson(jsonText, dict) {            // community mirror { id: { title:[], author:[] } }
  const cat = JSON.parse(jsonText);
  let n = 0;
  for (const id in cat) {
    const e = cat[id];
    const norm = normTitle(e.title && e.title[0]);
    if (keepTitle(norm) && addEntry(dict, norm, formatAuthor((e.author || []).join('; ')), false)) n++;
  }
  return n;
}

// ---- famous (goodbooks-10k) -----------------------------------------------
async function loadGoodbooks() {
  if (fs.existsSync(GOODBOOKS_CSV)) return fs.readFileSync(GOODBOOKS_CSV, 'utf8');
  process.stdout.write('• goodbooks-10k not found locally — downloading … ');
  return download(GOODBOOKS_URL, GOODBOOKS_CSV);
}

function fromGoodbooks(csvText, dict) {
  const rows = parseCsv(csvText);
  if (!rows.length) return 0;
  const h = rows[0].map((c) => c.trim());
  const iAuth = h.indexOf('authors'), iOrig = h.indexOf('original_title'), iTitle = h.indexOf('title');
  let n = 0;
  for (let r = 1; r < rows.length; r++) {
    const author = firstAuthor(rows[r][iAuth]);
    // Index both the original title and the series-stripped display title, e.g. row 13 has
    // original_title "Nineteen Eighty-Four" and title "1984" — a reader may name either.
    for (const raw of [rows[r][iOrig], stripSeries(rows[r][iTitle])]) {
      const norm = normTitle(raw);
      if (keepTitle(norm) && addEntry(dict, norm, author, true)) n++;
    }
  }
  return n;
}

// ---- db -------------------------------------------------------------------
function fromDb(dict) {
  const db = open();
  try {
    let n = 0;
    for (const { title, author } of db.prepare('SELECT title, COALESCE(author, \'\') AS author FROM books').all()) {
      const norm = normTitle(title);
      if (norm && !STOPWORD_TITLES.has(norm) && addEntry(dict, norm, author, true)) n++;
    }
    return n;
  } finally { db.close(); }
}

async function download(url, dest) {
  let res;
  try { res = await fetch(url); } catch (e) {
    throw new Error(`download failed (${e.message}).\n  Fetch it manually:\n    curl -L -o "${dest}" "${url}"`);
  }
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}. Save it manually to ${dest}.`);
  const text = await res.text();
  fs.writeFileSync(dest, text);
  console.log(`ok (${(text.length / 1e6).toFixed(1)} MB)`);
  return text;
}

// ---- build ----------------------------------------------------------------
const dict = new Map();
const catalog = await loadCatalog();
const nCatalog = catalog.kind === 'csv' ? fromCsv(catalog.text, dict) : fromJson(catalog.text, dict);
const nFamous = fromGoodbooks(await loadGoodbooks(), dict);
const nDb = fromDb(dict);
const famousTotal = [...dict.values()].filter((v) => v.f).length;

fs.mkdirSync(DICT_DIR, { recursive: true });
const titles = {};
for (const norm of [...dict.keys()].sort()) { const v = dict.get(norm); titles[norm] = [v.a, v.f]; }
fs.writeFileSync(TITLES_JSON, JSON.stringify({ _version: 2, _generated: 'bj:dict', count: dict.size, famous: famousTotal, titles }));
console.log(`✓ wrote ${path.relative(process.cwd(), TITLES_JSON)} — ${dict.size} titles `
  + `(${famousTotal} famous). sources: catalog +${nCatalog}, goodbooks +${nFamous}, db +${nDb}.`);
