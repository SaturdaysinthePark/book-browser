// PDF -> <slug>.body.txt, stripping front/back matter so only the authored narrative
// reaches the detector (enforces BookJumpr's narrative-only mentions policy mechanically).
// Uses the project's existing `unpdf` dependency (per-page extraction). Node 22.5+.
//
// Usage: node --no-warnings tools/extract-body.mjs "<pdf path>" "<Book Title>" [--out <dir>]
// Prints a JSON summary (slug, pages, body range, chars). Writes <out>/<slug>.body.txt
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from './slug.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const pdfPath = args[0];
const title = args[1];
let outDir = path.join(REPO, 'inbox/pending');
const oi = args.indexOf('--out');
if (oi >= 0) outDir = args[oi + 1];
if (!pdfPath || !title) { console.error('usage: extract-body.mjs <pdf> <title> [--out dir]'); process.exit(1); }

// Front-matter boilerplate that NEVER appears in authored narrative — used only to skip the
// LEADING run of copyright/title pages. Deliberately minimal: front-stripping is coarse noise
// reduction, and over-cropping loses real opening narrative (a book's richest mentions passage
// often IS its opening). The verify agent is the real filter for forewords/prefaces/apparatus.
const FRONT_BOILER = /(all rights reserved|copyright\s*©|©\s*\d{4}|\bisbn\b|library of congress|this is a work of fiction|ebook isbn|first published|first .* edition|penguin (books|random)|a division of|cover design|jacket design|table of contents)/i;
// A page whose first non-blank line looks like back-matter / apparatus (end of the body).
// Back-stripping matters most for non-fiction (endnotes/bibliography/index are title-dense).
const BACK = /^\s*(acknowledg|author.?s?\s+note\b|a\s+note\s+(on|about)\b|about\s+the\s+author|afterword\b|endnotes\b|notes\b|bibliograph|references\b|reading\s+group|discussion\s+questions|index\b|works\s+cited|further\s+reading|appendix\b|glossary\b|permissions\b|credits\b|also\s+by\b|about\s+the\s+type)/i;

const firstLine = (t) => (t || '').split('\n').map((s) => s.trim()).find((s) => s.length) || '';
// A page is front-matter only if it's tiny (title/blank/divider) or hard copyright boilerplate.
const isFront = (t) => { const s = (t || '').trim(); return s.length < 200 || FRONT_BOILER.test(s.slice(0, 800)); };

const data = new Uint8Array(fs.readFileSync(pdfPath));
const { extractText, getDocumentProxy } = await import('unpdf');
const pdf = await getDocumentProxy(data);
const res = await extractText(pdf, { mergePages: false });
const pages = Array.isArray(res.text) ? res.text : [res.text];
const n = pages.length;

// bodyStart: first substantial prose page after the leading boilerplate run (capped at 25%).
let bodyStart = 0;
const frontCap = Math.max(3, Math.floor(n * 0.25));
for (let i = 0; i < Math.min(frontCap, n); i++) {
  if (!isFront(pages[i])) { bodyStart = i; break; }
}
// bodyEnd: first back-matter page in the last 40%.
// A real section heading is a short standalone line ("Index", "Notes", "Acknowledgments") —
// require brevity so a full sentence that merely STARTS with one of those words (e.g. "Notes
// may sound bitter, but...") isn't mistaken for a heading and doesn't truncate real narrative.
let bodyEnd = n;
for (let i = Math.max(Math.floor(n * 0.6), bodyStart + 1); i < n; i++) {
  const fl = firstLine(pages[i]);
  if (fl.length <= 40 && BACK.test(fl)) { bodyEnd = i; break; }
}

const body = pages.slice(bodyStart, bodyEnd).join('\n');
const s = slug(title);
const outPath = path.join(outDir, `${s}.body.txt`);
fs.writeFileSync(outPath, body);
console.log(JSON.stringify({
  slug: s, title, pages: n, bodyStart, bodyEnd, bodyChars: body.length,
  startHead: firstLine(pages[bodyStart]).slice(0, 60),
  endHead: bodyEnd < n ? firstLine(pages[bodyEnd]).slice(0, 60) : '(EOF)',
  out: outPath,
}));
