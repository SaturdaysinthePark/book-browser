// Renders video/flow.html to frames and an MP4 (run from the repo root):
//   node video/render.mjs [--w 1920 --h 1080] [--fps 60] [--stills 0,4,9.5,...] [--out video/out]
// --stills renders PNGs at those beat numbers only (for checking timing); without it, the whole film.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 1920), H = +arg('h', 1080), FPS = +arg('fps', 60), OUT = arg('out', 'video/out'), STILLS = arg('stills', null), BPM = +arg('bpm', 120);
const tag = W + 'x' + H;
fs.mkdirSync(OUT, { recursive: true });

// serve video/ so the page can load film-data.js and the fonts
const root = path.resolve('video');
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:${port}/flow.html?w=${W}&h=${H}&bpm=${BPM}&t=0`);
await page.evaluate(() => window.filmReady);
const meta = await page.evaluate(() => window.FILM_META);
const shot = async (t, file) => { await page.evaluate(t => window.seek(t), t); await page.screenshot({ path: file, type: 'png' }); };

if (STILLS) {
  for (const b of STILLS.split(',').map(Number)) await shot(b * meta.BEAT, path.join(OUT, `still-${tag}-b${String(b).padStart(4, '0')}.png`));
  console.log('stills', STILLS, errs.length ? errs : 'ok');
} else {
  const dir = path.join(OUT, 'frames-' + tag); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const N = Math.round(meta.DUR * FPS);
  for (let f = 0; f < N; f++) { await shot(f / FPS, path.join(dir, String(f).padStart(5, '0') + '.png')); if (f % 120 === 0) console.log('frame', f, '/', N); }
  const mp4 = path.join(OUT, `bookjumpr-flow-${tag}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  console.log('wrote', mp4, errs.length ? errs : 'no page errors');
}
await browser.close(); srv.close();
