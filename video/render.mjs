// Renders video/flow.html to frames and an MP4 (run from the repo root):
//   node video/render.mjs [--film jane-eyre-to-gatsby] [--layout stage|chain] [--w 1920 --h 1080] [--fps 60]
//                         [--stills 0,4,9.5,...] [--out video/out]
// --stills renders PNGs at those beat numbers only (for checking timing); without it, the whole film
// is piped straight into ffmpeg as video/out/bookjumpr-<w>x<h>.mp4.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = +arg('w', 1920), H = +arg('h', 1080), FPS = +arg('fps', 60), OUT = arg('out', 'video/out'), STILLS = arg('stills', null), BPM = +arg('bpm', 120);
const FILM = arg('film', 'jane-eyre-to-gatsby'), LAYOUT = arg('layout', '');
const tag = FILM + (LAYOUT ? '-' + LAYOUT : '') + '-' + W + 'x' + H;
fs.mkdirSync(OUT, { recursive: true });

// serve video/ so the page can load the film's data
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
await page.goto(`http://localhost:${port}/flow.html?film=${FILM}${LAYOUT ? '&layout=' + LAYOUT : ''}&w=${W}&h=${H}&bpm=${BPM}&t=0`);
await page.evaluate(() => window.filmReady);
const meta = await page.evaluate(() => window.FILM_META);
const shot = async (t, file) => { await page.evaluate(t => window.seek(t), t); await page.screenshot({ path: file, type: 'png' }); };

if (STILLS) {
  for (const b of STILLS.split(',').map(Number)) await shot(b * meta.BEAT, path.join(OUT, `still-${tag}-b${String(b).padStart(4, '0')}.png`));
  console.log('stills', STILLS, errs.length ? errs : 'ok');
} else {
  // frames go straight into ffmpeg (no PNGs on disk): H.264, yuv420p, CRF 18, faststart
  const N = Math.round(meta.DUR * FPS), mp4 = path.join(OUT, `${tag}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', String(FPS), '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', code => code ? rej(new Error('ffmpeg exited ' + code)) : res()));
  for (let f = 0; f < N; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 120 === 0) console.log(tag, 'frame', f, '/', N);
  }
  ff.stdin.end(); await done;
  console.log('wrote', mp4, errs.length ? errs : 'no page errors');
}
await browser.close(); srv.close();
