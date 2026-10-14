// Renders each book's own link-preview card (1200×630) to og/<author>/<title>.png — for every book that mentions
// another: the book's title, author and mention count on the left, and its fan (it, above up to five of the books
// it mentions) on the right. Same drawing as the site card (tools/social-preview.html with &book=1).
// Run from the repo root after `npm run bj:build` (it reads bookjumpr-data.js), then re-run bj:build so the edge
// function's data picks up the new images:
//   node tools/render-og.mjs [--force] [key …]      (npm run bj:og)
// Only cards whose content changed are re-rendered (og/manifest.json records what each one shows). Each PNG is then
// reduced to a 256-colour palette with Python's Pillow (~23KB instead of ~58KB, no visible difference).
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2), FORCE = args.includes('--force'), ONLY = args.filter((a) => !a.startsWith('--'));
// bump when the drawing in tools/social-preview.html changes, so every card is re-rendered
const CARD_VERSION = 2;
const root = path.resolve('.'), OUT = path.join(root, 'og'), MANIFEST = path.join(OUT, 'manifest.json');

const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('bookjumpr-data.js', 'utf8'), ctx);
const { NODES, MENTIONS } = ctx.window.BookJumprData;
const indeg = {}, outs = {};
for (const [a, b] of MENTIONS) {
  if (a === b || !NODES[a] || !NODES[b]) continue;
  indeg[b] = (indeg[b] || 0) + 1;
  if (!(outs[a] = outs[a] || []).includes(b)) outs[a].push(b);
}
// the row: up to five of the books it mentions, the best known (most mentioned) in the middle, flanked by the next
const rowFor = (k) => {
  const top = outs[k].slice().sort((x, y) => (indeg[y] || 0) - (indeg[x] || 0) || x.localeCompare(y)).slice(0, 5);
  const order = [3, 1, 0, 2, 4].filter((i) => i < top.length);
  return order.map((i) => top[i]);
};
const jobs = Object.keys(outs).filter((k) => !ONLY.length || ONLY.includes(k)).sort().map((k) => {
  const row = rowFor(k), n = outs[k].length;
  const sig = JSON.stringify([CARD_VERSION, NODES[k].slice(0, 3), NODES[k][4], n, row.map((r) => [NODES[r][0], NODES[r][4]])]);
  return { k, query: `book=1&n=${n}&root=${encodeURIComponent(k)}&row=${row.map(encodeURIComponent).join(',')}`, sig };
});
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
const todo = jobs.filter((j) => FORCE || manifest[j.k] !== j.sig || !fs.existsSync(path.join(OUT, j.k + '.png')));
// drop cards for books that no longer mention anything
if (!ONLY.length) for (const k of Object.keys(manifest)) if (!outs[k]) { fs.rmSync(path.join(OUT, k + '.png'), { force: true }); delete manifest[k]; }
console.log(`${jobs.length} book cards, ${todo.length} to render`);

if (todo.length) {
  const srv = http.createServer((req, res) => {
    const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
  }).listen(0);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  let errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  let done = 0;
  for (const j of todo) {
    errs = [];
    await page.goto(`http://localhost:${srv.address().port}/tools/social-preview.html?${j.query}`);
    await page.waitForFunction(() => window.ready || false, null, { timeout: 20000 });
    if (errs.length) { console.log('✗', j.k, errs); continue; }
    fs.mkdirSync(path.dirname(path.join(OUT, j.k)), { recursive: true });
    await page.screenshot({ path: path.join(OUT, j.k + '.png'), type: 'png' });
    manifest[j.k] = j.sig;
    if (++done % 50 === 0) { console.log(`  ${done}/${todo.length}`); fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 0)); }
  }
  await browser.close(); srv.close();
  console.log(`rendered ${done}`);
  // 256-colour palette PNGs: the cards are flat colour, so this keeps them sharp at less than half the size
  const files = todo.map((j) => path.join(OUT, j.k + '.png')).filter((f) => fs.existsSync(f));
  for (let i = 0; i < files.length; i += 200) {
    execFileSync('python3', ['-c', `import sys
from PIL import Image
for f in sys.argv[1:]:
    Image.open(f).convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)`, ...files.slice(i, i + 200)]);
  }
  console.log(`compressed ${files.length}`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 0));
