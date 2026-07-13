// BookJumpr mention detector — Stage 1 of the "PDF -> mentions" pipeline.
//
// Turns a source book (PDF or plain .txt) into a small, ranked shortlist of *candidate*
// book references, so a human/LLM can verify only that shortlist instead of reading the
// whole book. It emits ZERO tokens: everything here is mechanical string work.
//
//   Signals a real book reference tends to leave in prose:
//     • quoted title            "The Metamorphosis"      (strong)
//     • known title (dictionary) matches tools/dict/titles.json   (strong, + author)
//     • trigger word nearby     read / novel / wrote / library …  (medium)
//     • Title-Case run          The Trial                (weak on its own)
//     • list adjacency          "X, and Y, 'Z'"          (medium — enumerated titles)
//
// A candidate is kept only when its combined score clears a threshold, which drops the
// sentence-initial "The House was cold" noise while keeping genuine references.
//
// Usage:
//   npm run bj:detect -- inbox/pending/Book.pdf [--title "Book Title"] [--top 200]
//   npm run bj:detect -- some.txt                 (plain text also accepted, for testing)
//   npm run bj:detect -- Book.pdf --full          (skip scoring; dump cleaned text for a full read)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './slug.mjs';
import { normTitle, stripArticle, STOPWORD_TITLES } from './normtitle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING = path.join(ROOT, 'inbox', 'pending');
const TITLES_JSON = path.join(ROOT, 'tools', 'dict', 'titles.json');

// Words whose presence near a phrase suggests it's a work being referenced. Matched as
// stems (word-boundary + prefix), so "read" also fires on "reads/reading/reread".
const TRIGGERS = [
  'read', 'reread', 'book', 'novel', 'novella', 'wrote', 'writ', 'author', 'poem',
  'poet', 'play', 'story', 'stories', 'copy', 'librar', 'shelf', 'shelv', 'publish',
  'edition', 'volume', 'paperback', 'hardcover', 'bookstore', 'bookshop', 'memoir',
  'essay', 'verse', 'translat', 'reader', 'chapter', 'title', 'page',
];
const TRIGGER_RE = new RegExp(`\\b(?:${TRIGGERS.join('|')})[a-z]*\\b`, 'gi');

// A STRONG reading cue immediately governing the title ("read Ulysses", "a copy of X",
// "the novel Beloved"). Anchored to the end of the text just before a candidate — much
// tighter than TRIGGER proximity, which is why single-word titles require this (or a
// quote / byline) to survive. Optional article/possessive may sit between the cue and title.
const STRONG_BEFORE = /\b(?:read|reads|reading|rereads?|rereading|wrote|writes|written|finished|studied|studying|perused|opened|published|titled|entitled|novel|novella|poems?|play|book|volume|copy of|copies of|author of|edition of|translation of|reprint of)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|my\s+|your\s+|their\s+|our\s+|that\s+|this\s+)?$/i;

// Interior words allowed inside a Title-Case run without breaking it.
const FUNC = new Set(['the', 'of', 'and', 'a', 'an', 'in', 'on', 'to', 'for', 'or',
  'de', 'la', 'le', 'du', 'von', 'van', 'des', 'del']);

const TRIGGER_WINDOW = 64;   // chars between a trigger and a candidate to count as "nearby"
const LIST_GAP = 8;          // chars between two candidates to count as an enumeration

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const t = argv[i];
  if (t.startsWith('--')) {
    const k = t.slice(2), n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) opts[k] = true; else { opts[k] = n; i++; }
  } else opts._.push(t);
}
const input = opts._[0];
if (!input) { console.error('usage: npm run bj:detect -- <file.pdf|file.txt> [--title T] [--top N] [--full]'); process.exit(1); }
const inputPath = path.resolve(input);
if (!fs.existsSync(inputPath)) { console.error('✗ no such file: ' + inputPath); process.exit(1); }

const sourceTitle = (typeof opts.title === 'string' && opts.title.trim())
  || path.basename(inputPath).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
const topN = Number.isFinite(+opts.top) ? +opts.top : 200;

// ---- text extraction ------------------------------------------------------
async function extractText(file) {
  if (/\.txt$/i.test(file)) return fs.readFileSync(file, 'utf8');
  if (!/\.pdf$/i.test(file)) throw new Error('input must be a .pdf or .txt file');
  const { extractText: xt, getDocumentProxy } = await import('unpdf');
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await getDocumentProxy(data);
  const { text } = await xt(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : text;
}

// Strip Project Gutenberg's license header/footer so its boilerplate (the "Foundation",
// disclaimers, volunteer names) doesn't pollute the candidate list. Harmless on non-PG text.
function stripGutenberg(raw) {
  let t = String(raw);
  const start = t.search(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*\*\*/i);
  if (start !== -1) t = t.slice(start).replace(/^[^\n]*\n/, '');   // drop everything up to & incl. the marker line
  const end = t.search(/(?:\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG|End of (?:the |this )?Project Gutenberg)/i);
  if (end !== -1) t = t.slice(0, end);
  return t;
}

// Join hyphen-broken line wraps, flatten newlines, normalize spaces & odd unicode spaces.
function clean(raw) {
  return String(raw)
    .replace(/(\w)[­-]\n(\w)/g, '$1$2')   // "meta-\nphor" -> "metaphor"
    .replace(/[   ]/g, ' ')      // non-breaking spaces
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---- dictionary -----------------------------------------------------------
function loadDict() {
  if (!fs.existsSync(TITLES_JSON)) {
    console.warn('⚠ tools/dict/titles.json missing — run `npm run bj:dict` for dictionary signals. Continuing without it.');
    return {};
  }
  return JSON.parse(fs.readFileSync(TITLES_JSON, 'utf8')).titles || {};
}
// Look a normalized phrase up under its full form and its article-less form. Entries are
// [author, famousFlag]; returns { author, famous } or undefined. `famous` = curated tier
// (goodbooks-10k / DB) vs the noisier Gutenberg catalog.
function dictLookup(dict, norm) {
  let v = dict[norm];
  if (v === undefined) { const s = stripArticle(norm); if (s) v = dict[s]; }
  if (v === undefined) return undefined;
  return { author: v[0] || '', famous: !!v[1] };
}

// ---- candidate matchers ---------------------------------------------------
// Each returns [{ surface, start, end, kind }].

// Quoted spans that look like a TITLE, not dialogue: “…” / "…" / ‘…’, 1..6 words, every
// non-function word capitalized, and no interior sentence punctuation. This is what keeps
// a novel's wall of dialogue ("Kind of strange.") out of the candidate list.
function matchQuoted(T, dict) {
  const out = [];
  const res = [/[“]([^“”\n]{1,80}?)[”]/g, /"([^"\n]{1,80}?)"/g, /[‘]([^‘’\n]{1,80}?)[’]/g];
  for (const re of res) {
    let m;
    while ((m = re.exec(T))) {
      const inner = m[1].replace(/^[\s'".,;:]+|[\s'".,;:!?]+$/g, ''); // trim edge punctuation
      if (!titleLike(inner)) continue;
      // A LONE quoted word is almost always dialogue ("So," "Thanks") — keep it only if
      // it's a known title. Multi-word quoted spans are kept as-is.
      const single = !/\s/.test(inner);
      if (single) {
        const norm = normTitle(inner);
        if (inner.length < 4 || STOPWORD_TITLES.has(norm) || dictLookup(dict, norm) === undefined) continue;
      }
      const start = m.index + m[0].indexOf(inner);
      out.push({ surface: inner, start, end: start + inner.length, kind: 'quoted', single });
    }
  }
  return out;
}

// A phrase reads as a title if it's 1..6 words, has no interior . ! ? and every
// content (non-function) word is capitalized. "In the Penal Colony" ✓  "my name" ✗
function titleLike(s) {
  if (!s || /[.!?]/.test(s.slice(0, -1))) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6) return false;
  let content = 0;
  for (const w of words) {
    if (FUNC.has(w.toLowerCase())) continue;
    content++;
    if (!/^[A-Z0-9]/.test(w)) return false;               // a lowercase content word => prose
  }
  return content >= 1;
}

// Title-Case runs of 2..6 tokens. A capitalized article/preposition ("The", "In") counts
// as part of the run; a *lowercase* function word ("the", "of") is allowed only in the
// interior. Runs break on ANY non-space between tokens (comma, quote, dash, sentence end),
// so "The Castle, and The Trial" segments into two clean titles rather than one blob.
function matchTitleCase(T) {
  const tok = [];
  const RE = /[A-Za-z0-9][A-Za-z0-9'’]*/g;
  let m;
  while ((m = RE.exec(T))) tok.push({ w: m[0], i: m.index, end: m.index + m[0].length });
  const isCap = (w) => /^[A-Z0-9]/.test(w);
  const isLowerFunc = (w) => /^[a-z]/.test(w) && FUNC.has(w);
  const out = [];
  for (let i = 0; i < tok.length; i++) {
    if (!isCap(tok[i].w)) continue;                       // start on a capitalized word (incl. "The")
    let j = i, last = i;
    while (j + 1 < tok.length) {
      const nx = tok[j + 1];
      // span words separated by a space or a single hyphen ("Nineteen Eighty-Four", "Catch-22")
      if (!/^(\s+|\s*-\s*)$/.test(T.slice(tok[j].end, nx.i))) break;
      if (isCap(nx.w)) { j++; last = j; continue; }
      if (isLowerFunc(nx.w)) { j++; continue; }           // absorb interior "the/of/and"; don't end on it
      break;
    }
    // Trim a leading author possessive so "Sophocles' Oedipus Rex" -> "Oedipus Rex" (and the
    // dropped "Sophocles' " becomes a byline signal during scoring). Trim to after the last
    // possessive token in the run, as long as a title remains.
    let s = i;
    for (let k = i; k < last; k++) if (/['’]s?$/.test(tok[k].w)) s = k + 1;
    const len = last - s + 1;
    if (len >= 2 && len <= 6) {
      const surface = T.slice(tok[s].i, tok[last].end);
      out.push({ surface, start: tok[s].i, end: tok[last].end, kind: 'titlecase' });
    }
    i = last; // don't restart inside the run we just consumed
  }
  return out;
}

// Single capitalized words that are known titles (Hamlet, Ulysses, Dracula). Emitted only
// as *candidates needing corroboration*: kept later only if BOTH dict and a trigger fire,
// which keeps "read Ulysses" while dropping every bare capitalized word.
function matchSingles(T, dict) {
  const out = [];
  const RE = /[A-Za-z][A-Za-z'’]*/g;
  let m;
  while ((m = RE.exec(T))) {
    const w = m[0];
    if (!/^[A-Z]/.test(w) || w.length < 4) continue;
    const norm = normTitle(w);
    if (STOPWORD_TITLES.has(norm) || dictLookup(dict, norm) === undefined) continue;
    out.push({ surface: w, start: m.index, end: m.index + w.length, kind: 'titlecase', single: true });
  }
  return out;
}

// ---- context --------------------------------------------------------------
function context(T, start, end) {
  const before = T.slice(Math.max(0, start - 180), start);
  const after = T.slice(end, Math.min(T.length, end + 180));
  const left = before.replace(/^.*[.!?]\s+/s, '');        // trim to the sentence start
  const right = after.replace(/([.!?])\s+.*$/s, '$1');    // trim to the sentence end
  return (left + T.slice(start, end) + right).trim().replace(/\s+/g, ' ');
}

// ---- main -----------------------------------------------------------------
const dict = loadDict();
const T = clean(stripGutenberg(await extractText(inputPath)));
if (!T) { console.error('✗ no text extracted (scanned/image PDF?). Try a text-based PDF or --full.'); process.exit(1); }

const outSlug = slug(sourceTitle);
fs.mkdirSync(PENDING, { recursive: true });

if (opts.full) {
  const p = path.join(PENDING, `${outSlug}.fulltext.txt`);
  fs.writeFileSync(p, T);
  console.log(`✓ wrote ${path.relative(ROOT, p)} (${T.length} chars). Read it in windows to detect mentions directly.`);
  process.exit(0);
}

// Gather structural candidates (quoted titles + Title-Case runs). The dictionary is NOT
// used to introduce candidates — matching 65k titles as substrings floods the list with
// common phrases ("The House", "The Road") — but it boosts and auto-authors the ones we
// find. A real title in prose is essentially always capitalized or quoted, so this loses
// almost nothing while cutting the noise the false-positive guard is meant to prevent.
let raw = [...matchQuoted(T, dict), ...matchTitleCase(T), ...matchSingles(T, dict)]
  .filter((c) => c.surface && c.surface.length >= 2 && !/^\d+$/.test(c.surface));

// Drop single-word candidates that sit inside a multi-word one ("Peace" ⊂ "War and Peace").
const multi = raw.filter((c) => /\s/.test(c.surface));
raw = raw.filter((c) => !(c.single && multi.some((mw) => c.start >= mw.start && c.end <= mw.end && mw !== c)));

// Trigger positions (for proximity).
const triggers = [];
{ let m; TRIGGER_RE.lastIndex = 0; while ((m = TRIGGER_RE.exec(T))) triggers.push([m.index, m.index + m[0].length]); }
const nearTrigger = (s, e) => triggers.some(([ts, te]) => Math.max(0, Math.max(ts - e, s - te)) <= TRIGGER_WINDOW);

// Sort by position for list-adjacency, then score each candidate.
raw.sort((a, b) => a.start - b.start);
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  const norm = normTitle(c.surface);
  const d = dictLookup(dict, norm);
  const sig = new Set();
  if (c.kind === 'quoted') sig.add('quoted');
  if (c.kind === 'titlecase') sig.add('titlecase');
  if (d !== undefined) { sig.add('dict'); if (d.famous) sig.add('famous'); }
  if (nearTrigger(c.start, c.end)) sig.add('trigger');
  // list adjacency: a neighboring candidate separated only by ", and " / "; " / a quote
  for (const nb of [raw[i - 1], raw[i + 1]]) {
    if (!nb) continue;
    const gap = nb.start > c.end ? T.slice(c.end, nb.start) : T.slice(nb.end, c.start);
    if (gap.length <= LIST_GAP && /[,;]|\band\b|\bor\b|["’”‘“]/.test(gap)) { sig.add('list'); break; }
  }
  // author byline: "Sophocles' Oedipus Rex", "Tanizaki's translation of …", "…, by Sophocles".
  // A capitalized possessive (or a trailing "by <Name>") is a strong "this is a WORK" cue,
  // and catches titles that sit far from any reading verb.
  const pre = T.slice(Math.max(0, c.start - 40), c.start);
  const post = T.slice(c.end, c.end + 16);
  if (/[A-Z][A-Za-z.]+['’]s?\s+(?:(?:translation|version|edition)\s+of\s+)?$/.test(pre)
      || /^,?\s+by\s+[A-Z]/.test(post)) sig.add('byline');
  if (STRONG_BEFORE.test(pre)) sig.add('reads');       // a reading verb directly governs it
  const score = (sig.has('quoted') ? 3 : 0) + (sig.has('dict') ? 3 : 0) + (sig.has('byline') ? 3 : 0)
    + (sig.has('trigger') ? 2 : 0) + (sig.has('list') ? 2 : 0) + (sig.has('famous') ? 1 : 0) + (sig.has('titlecase') ? 1 : 0);
  c.norm = norm; c.score = score; c.signals = [...sig];
  if (d && d.author) c.dictAuthor = d.author;
}

// Keep score>=3, dedupe by normalized surface (merge signals, sum counts, keep best context).
const KEEP = 3;
const byNorm = new Map();
for (const c of raw) {
  if (c.score < KEEP || !c.norm) continue;
  // single-word titles are noisy in real prose (a 76k dict has a book named after nearly
  // every place & common word), so a lone word needs a STRONG signal: quoted-as-a-title,
  // an author byline, or a reading verb directly governing it ("read Ulysses"). Mere
  // trigger-proximity or famous-tier membership is NOT enough on its own.
  if (c.single && !(c.signals.includes('quoted') || c.signals.includes('byline') || c.signals.includes('reads'))) continue;
  const prev = byNorm.get(c.norm);
  if (!prev) {
    byNorm.set(c.norm, {
      surface: c.surface, norm: c.norm, score: c.score, count: 1,
      signals: c.signals, dictAuthor: c.dictAuthor || '', context: context(T, c.start, c.end),
    });
  } else {
    prev.count++;
    prev.signals = [...new Set([...prev.signals, ...c.signals])];
    if (c.score > prev.score) { prev.score = c.score; prev.surface = c.surface; prev.context = context(T, c.start, c.end); }
    if (!prev.dictAuthor && c.dictAuthor) prev.dictAuthor = c.dictAuthor;
  }
}

const candidates = [...byNorm.values()]
  .sort((a, b) => b.score - a.score || b.count - a.count || a.surface.localeCompare(b.surface))
  .slice(0, topN);

const outPath = path.join(PENDING, `${outSlug}.candidates.json`);
fs.writeFileSync(outPath, JSON.stringify({
  source: sourceTitle,
  sourceFile: path.basename(inputPath),
  generated: 'detect.mjs',
  textChars: T.length,
  totalCandidates: byNorm.size,
  kept: candidates.length,
  candidates,
}, null, 2));

console.log(`✓ ${path.relative(ROOT, outPath)}`);
console.log(`  source: "${sourceTitle}"  •  text: ${T.length} chars  •  candidates: ${candidates.length} kept of ${byNorm.size} scored`);
console.log('  Next: an LLM verifies these into inbox/pending/' + outSlug + '.batch.json, then `npm run bj -- import`.');
