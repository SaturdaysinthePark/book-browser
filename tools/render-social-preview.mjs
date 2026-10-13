// Renders the link-preview card (tools/social-preview.html) to a PNG (run from the repo root):
//   node tools/render-social-preview.mjs [out.png]      (default: social-preview.png, the og:image)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const OUT = process.argv[2] || 'social-preview.png';
const root = path.resolve('.');
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${srv.address().port}/tools/social-preview.html`);
await page.waitForFunction(() => window.ready || false, null, { timeout: 20000 }).catch(() => {});
await page.screenshot({ path: OUT, type: 'png' });
console.log('wrote', OUT, errs.length ? errs : 'no page errors');
await browser.close(); srv.close();
