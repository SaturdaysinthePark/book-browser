// Local admin server (node:http, zero deps). Serves the static site + admin.html
// and a small JSON API over the DB. Localhost only. Start with: npm run admin
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { open, counts, ROOT } from './db.mjs';
import {
  upsertBook, upsertMention, importBatch, exportCsv,
  renameBook, removeMention, removeBook, setGenre,
} from './importer.mjs';
import { writeBuild } from './build.mjs';
import { doctor } from './doctor.mjs';
import { GENRES } from './genres.mjs';

const PORT = Number(process.env.PORT) || 8918;
const db = open(); // single synchronous connection for the server's lifetime

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8'); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('invalid JSON body')); } });
    req.on('error', reject);
  });
}

function booksList() {
  return db.prepare(`
    SELECT slug, title, COALESCE(author,'') AS author, COALESCE(year,0) AS year,
           COALESCE(synopsis,'') AS synopsis, COALESCE(genre,'') AS genre, has_meta,
           (SELECT COUNT(*) FROM mentions WHERE source_slug = books.slug) AS out,
           (SELECT COUNT(*) FROM mentions WHERE mentioned_slug = books.slug) AS inn
    FROM books ORDER BY title
  `).all();
}
function mentionsList() {
  return db.prepare(`
    SELECT m.id, b1.title AS source, b2.title AS mentioned, m.mentioned_author AS author
    FROM mentions m JOIN books b1 ON b1.slug = m.source_slug JOIN books b2 ON b2.slug = m.mentioned_slug
    ORDER BY m.id DESC
  `).all();
}
// One book plus both directions of its mentions (includes note, which the global list omits).
function bookDetail(slug) {
  const book = db.prepare(`
    SELECT slug, title, COALESCE(author,'') AS author, COALESCE(year,0) AS year,
           COALESCE(synopsis,'') AS synopsis, COALESCE(genre,'') AS genre, has_meta,
           (SELECT COUNT(*) FROM mentions WHERE source_slug = books.slug) AS out,
           (SELECT COUNT(*) FROM mentions WHERE mentioned_slug = books.slug) AS inn
    FROM books WHERE slug = ?
  `).get(slug);
  if (!book) return null;
  const mentions = db.prepare(`
    SELECT b.title AS mentioned, COALESCE(m.mentioned_author,'') AS author, m.note AS note
    FROM mentions m JOIN books b ON b.slug = m.mentioned_slug
    WHERE m.source_slug = ? ORDER BY b.title
  `).all(slug);
  const mentionedBy = db.prepare(`
    SELECT b.title AS source, COALESCE(m.mentioned_author,'') AS author, m.note AS note
    FROM mentions m JOIN books b ON b.slug = m.source_slug
    WHERE m.mentioned_slug = ? ORDER BY b.title
  `).all(slug);
  return { book, mentions, mentionedBy };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---- API ----
    if (p.startsWith('/api/')) {
      if (req.method === 'GET' && p === '/api/stats') return json(res, 200, counts(db));
      if (req.method === 'GET' && p === '/api/books') return json(res, 200, booksList());
      if (req.method === 'GET' && p === '/api/mentions') return json(res, 200, mentionsList());
      if (req.method === 'GET' && p === '/api/book') {
        const detail = bookDetail(url.searchParams.get('slug') || '');
        return detail ? json(res, 200, detail) : json(res, 404, { error: 'no such book' });
      }
      if (req.method === 'GET' && p === '/api/genres') return json(res, 200, GENRES);
      if (req.method === 'GET' && p === '/api/doctor') return json(res, 200, doctor(db));

      if (req.method === 'POST') {
        const body = await readBody(req);
        switch (p) {
          case '/api/book': return json(res, 200, { ok: true, ...upsertBook(db, body) });
          case '/api/genre': return json(res, 200, { ok: true, ...setGenre(db, body.title, body.genre) });
          case '/api/mention': return json(res, 200, { ok: true, ...upsertMention(db, body) });
          case '/api/import': return json(res, 200, { ok: true, ...importBatch(db, body) });
          case '/api/rename': return json(res, 200, { ok: true, ...renameBook(db, body.from, body.to) });
          case '/api/remove-book': return json(res, 200, { ok: true, ...removeBook(db, body.title, { cascade: !!body.cascade }) });
          case '/api/remove-mention': return json(res, 200, { ok: true, ...removeMention(db, body.source, body.mentioned) });
          case '/api/build': {
            const rep = doctor(db);
            if (rep.errors.length && !body.force) return json(res, 409, { ok: false, blocked: true, errors: rep.errors });
            const r = writeBuild(db);
            exportCsv(db);
            return json(res, 200, { ok: true, bytes: r.bytes, changed: r.changed, counts: counts(db) });
          }
        }
      }
      return json(res, 404, { error: 'no such endpoint' });
    }

    // ---- static site + admin.html ----
    let rel = decodeURIComponent(p);
    if (rel === '/' ) rel = '/index.html';
    if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
    const file = path.join(ROOT, path.normalize(rel));
    if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    json(res, 400, { error: e && e.message ? e.message : String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`BookJumpr admin → http://localhost:${PORT}/admin`);
  console.log(`Live site       → http://localhost:${PORT}/`);
  console.log('Press Ctrl+C to stop.');
});
