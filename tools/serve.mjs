// Local dev server that behaves like the Netlify deploy (run from the repo root):
//   node tools/serve.mjs [port]        (npm run serve — default port 8917)
// Files are served as they are; any other path gets index.html, passed through the same per-page renderer the
// Netlify edge function uses (netlify/seo/render.js) — so /haruki-murakami/norwegian-wood comes back with that
// book's title, description, canonical URL and crawler text, unknown books/authors get a 404, and /book/<key>
// redirects, just as on the live site. Text responses are gzipped when the browser accepts it, as Netlify does, so
// download sizes (and throttled timings) look like the live site's.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import D from '../netlify/seo/data.js';
import { renderPage } from '../netlify/seo/render.js';

const ROOT = path.resolve('.'), PORT = Number(process.argv[2]) || 8917;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.mp4': 'video/mp4' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file;
  try { file = path.join(ROOT, decodeURIComponent(url.pathname)); } catch (e) { file = ROOT; }
  if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    if (/^(text\/|application\/(json|xml)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', vary: 'accept-encoding' });
      return fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    }
    res.writeHead(200, { 'content-type': type });
    return fs.createReadStream(file).pipe(res);
  }
  // everything else is the app (netlify.toml's rewrite), with the edge function's per-page head
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = /\.[a-z0-9]+$/i.test(url.pathname) ? null : renderPage(html, url.pathname, D);
  if (out && out.location) { res.writeHead(out.status, { location: out.location + url.search }); return res.end(); }
  res.writeHead(out ? out.status : 200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(out ? out.html : html);
}).listen(PORT, () => console.log(`BookJumpr on http://localhost:${PORT}/`));
