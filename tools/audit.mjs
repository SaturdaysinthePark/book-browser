// Mentions audit: build a scannable HTML report of every source book's outbound mentions,
// with the triggering quote + confidence, so the dataset can be reviewed by eye. Quotes come
// from inbox/pending/<slug>.mentions.json (the verification record) — the DB drops notes on
// `seed --reset`. Outbound counts are taken live from the DB (post dedup/merge).
//
// Run: node --experimental-sqlite tools/audit.mjs   ->   inbox/pending/mentions-audit.html
import fs from 'node:fs';
import path from 'node:path';
import { open, ROOT } from './db.mjs';
import { slug } from './slug.mjs';

const PEND = path.join(ROOT, 'inbox', 'pending');

// Curated scholarly-edition suspects: the Gutenberg file bundles an editor's introduction /
// footnotes that name many works, inflating the source book's count. slug -> reason.
const FLAGGED = {
  'volpone': "Mermaid ed.: editor's Jonson-career essay names many other plays",
  'the-alchemist': "Mermaid ed.: shares the same Jonson-career essay",
  'the-jew-of-malta': "Dyce's annotated Marlowe: footnote citations",
  'tamburlaine-the-great': "Dyce's annotated Marlowe: footnote citations",
  'the-duchess-of-malfi': "Mermaid ed.: editorial introduction citations",
  'the-antiquary': "Waverley ed.: author intro + chapter epigraphs",
  'old-mortality': "Waverley ed.: author intro + chapter epigraphs",
  'kenilworth': "Waverley ed.: author intro + chapter epigraphs",
  'quentin-durward': "Waverley ed.: author intro + chapter epigraphs",
  'guy-mannering': "Waverley ed.: author intro + chapter epigraphs",
  'the-talisman': "Waverley ed.: author intro + chapter epigraphs",
  'the-book-of-the-courtier': "translator's introduction + footnote citations",
  'perpetual-peace': "translator's introduction + footnote citations",
  'the-art-of-public-speaking': "textbook: quotes many works as teaching examples",
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const db = open();
// live outbound count per source slug
const outCount = new Map();
for (const r of db.prepare('SELECT source_slug s, COUNT(*) n FROM mentions GROUP BY source_slug').all()) outCount.set(r.s, r.n);

// year lookup by title-slug (for the chronology / anachronism check). A source can't name a
// work published AFTER it, so mentioned.year > source.year => the mention is from editorial
// apparatus (intro/footnotes), not the text. Only fires where BOTH years are known in the DB.
const yearByTitleSlug = new Map();
for (const r of db.prepare("SELECT slug, title, year FROM books WHERE year IS NOT NULL AND year <> 0").all()) {
  const ts = slug(r.title);
  if (!yearByTitleSlug.has(ts)) yearByTitleSlug.set(ts, r.year); // first wins; good enough for flagging
}
const yearOf = (title) => yearByTitleSlug.get(slug(title));

// gather verification records from the JSON files
const files = fs.readdirSync(PEND).filter((f) => f.endsWith('.mentions.json'));
const books = []; // { slug, title, author, mentions:[{mentioned,author,note,confidence}] }
let emptyCount = 0;
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(PEND, f), 'utf8')); } catch { continue; }
  const ms = Array.isArray(j.mentions) ? j.mentions : [];
  if (!ms.length) { emptyCount++; continue; }
  const bslug = f.replace(/\.mentions\.json$/, '');
  const title = ms[0].source || bslug;
  // author: look up the DB book row (author segment resolves display author)
  const row = db.prepare('SELECT author FROM books WHERE slug GLOB ?').get('*/' + slug(title));
  books.push({ slug: bslug, title, author: row ? row.author : '', year: yearOf(title), mentions: ms });
}
db.close();

// count each book by its live DB outbound where possible, else JSON length
function liveCount(b) {
  // find the book's real key by title-slug
  const key = [...outCount.keys()].find((k) => k.endsWith('/' + slug(b.title)));
  return key != null ? outCount.get(key) : b.mentions.length;
}
books.sort((a, b) => liveCount(b) - liveCount(a) || a.title.localeCompare(b.title));

const flagged = books.filter((b) => FLAGGED[b.slug]);
const totalMentions = books.reduce((n, b) => n + b.mentions.length, 0);
const totalAna = books.reduce((n, b) => n + anaCount(b), 0);

const confColor = { high: '#2e8156', medium: '#8c6d24', low: '#c04a70' };
const yLabel = (y) => (y < 0 ? 'c. ' + (-y) + ' BC' : String(y));
// a mention is anachronistic when the mentioned work postdates the source (both years known)
function anachro(b, m) {
  const my = yearOf(m.mentioned);
  return (b.year && my && my > b.year) ? my : null;
}
function mentionRows(b) {
  return b.mentions.map((m) => {
    const c = (m.confidence || '').toLowerCase();
    const dot = confColor[c] ? `<span style="color:${confColor[c]}">●</span>` : '<span style="opacity:.3">●</span>';
    const my = anachro(b, m);
    const anaBadge = my ? ` <span class="ana">⚠ anachronism — pub. ${esc(yLabel(my))} &gt; ${esc(yLabel(b.year))}</span>` : '';
    return `<div class="m${my ? ' isana' : ''}">${dot} <b>${esc(m.mentioned)}</b>${m.author ? ' <span class="au">— ' + esc(m.author) + '</span>' : ''}${anaBadge}`
      + (m.note ? `<div class="q">“${esc(m.note)}”</div>` : '') + `</div>`;
  }).join('');
}
function anaCount(b) { return b.mentions.filter((m) => anachro(b, m)).length; }

const flaggedTable = flagged.map((b) =>
  `<tr><td><a href="#${esc(b.slug)}">${esc(b.title)}</a></td><td class="au">${esc(b.author)}</td>`
  + `<td class="num">${liveCount(b)}</td><td class="rz">${esc(FLAGGED[b.slug])}</td></tr>`).join('');

const bookSections = books.map((b) => {
  const flag = FLAGGED[b.slug] ? ' <span class="badge">⚠ review</span>' : '';
  const na = anaCount(b);
  const anaB = na ? ` <span class="badge anaB">${na} anachronism${na > 1 ? 's' : ''}</span>` : '';
  const openIt = FLAGGED[b.slug] || na > 0;
  return `<details id="${esc(b.slug)}"${openIt ? ' open' : ''}>
    <summary><span class="cnt">${liveCount(b)}</span> <b>${esc(b.title)}</b> <span class="au">— ${esc(b.author)}${b.year ? ' (' + esc(yLabel(b.year)) + ')' : ''}</span>${flag}${anaB}</summary>
    <div class="ms">${mentionRows(b)}</div>
  </details>`;
}).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BookJumpr — mentions audit</title>
<style>
  body{font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif;margin:0;background:#f7f5f0;color:#141414;}
  .wrap{max-width:940px;margin:0 auto;padding:28px 20px 80px;}
  h1{font-size:26px;margin:0 0 4px;} .sub{opacity:.6;font-size:13px;margin-bottom:22px;}
  h2{font-size:16px;letter-spacing:.04em;text-transform:uppercase;opacity:.7;margin:34px 0 10px;border-bottom:1.5px solid #141414;padding-bottom:6px;}
  table{border-collapse:collapse;width:100%;font-size:14px;} td{padding:5px 8px;border-bottom:1px solid rgba(20,20,20,.12);vertical-align:top;}
  .num,.cnt{font-variant-numeric:tabular-nums;font-weight:700;} td.num{text-align:right;width:44px;} .rz{opacity:.7;font-size:12.5px;}
  .au{opacity:.6;font-size:.92em;font-weight:400;}
  details{border-bottom:1px solid rgba(20,20,20,.1);padding:4px 0;}
  summary{cursor:pointer;padding:6px 4px;list-style:none;} summary::-webkit-details-marker{display:none;}
  summary:hover{background:#fff;} .cnt{display:inline-block;min-width:34px;text-align:right;margin-right:12px;color:#9c3d22;}
  .badge{background:#c33d2e;color:#fff;font-size:10px;padding:2px 7px;border-radius:99px;letter-spacing:.05em;margin-left:8px;vertical-align:1px;}
  .ms{padding:6px 4px 12px 50px;} .m{padding:5px 0;border-top:1px dotted rgba(20,20,20,.12);}
  .m.isana{background:rgba(195,61,46,.07);margin:0 -6px;padding:5px 6px;}
  .q{opacity:.7;font-size:13px;font-style:italic;margin:2px 0 0 16px;} a{color:#9c3d22;}
  .ana{color:#c33d2e;font-size:11px;font-weight:700;white-space:nowrap;}
  .badge.anaB{background:#8a5a3a;}
  .legend{font-size:12.5px;opacity:.7;margin:6px 0 0;} .legend b{opacity:1;}
</style></head><body><div class="wrap">
<h1>BookJumpr — mentions audit</h1>
<div class="sub">${books.length} source books with mentions · ${totalMentions} verified mentions · ${emptyCount} source books had none · ${flagged.length} flagged · <b style="color:#c33d2e">${totalAna} anachronisms</b></div>
<p class="legend"><b>Principle:</b> the network should reflect only a book's <b>authored text</b> — mentions coming from an edition's introduction, preface, footnotes, endnotes, or translator/reference notes don't belong and will be dropped.<br>
<b>Chronology catch:</b> a red <span class="ana">⚠ anachronism</span> flags a mention of a work published <i>after</i> the source — impossible in-text, so it must be from the apparatus (e.g. Meditations, c.180 AD, can't reference The Imitation of Christ, c.1420). This only fires where both publication years are known here; the trim also re-reads each flagged source's text to catch apparatus mentions that aren't anachronistic.<br>
Confidence: <span style="color:#2e8156">●</span> high · <span style="color:#8c6d24">●</span> medium · <span style="color:#c04a70">●</span> low.</p>
<h2>⚠ Flagged for review — likely editorial inflation</h2>
<table><tr><th style="text-align:left">Book</th><th style="text-align:left">Author</th><th class="num">n</th><th style="text-align:left">Why</th></tr>${flaggedTable}</table>
<h2>All source books — by outbound count</h2>
${bookSections}
</div></body></html>`;

const out = path.join(PEND, 'mentions-audit.html');
fs.writeFileSync(out, html);
console.log(`wrote ${out}`);
console.log(`books: ${books.length}  mentions: ${totalMentions}  flagged: ${flagged.length}  empty: ${emptyCount}`);
