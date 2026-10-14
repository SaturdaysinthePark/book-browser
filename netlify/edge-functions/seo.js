// Netlify edge function: gives each app route (/<author>/<title>, /<author>, /about, /stats, …) its own title,
// description, canonical URL, share-preview tags, JSON-LD and crawler text, and the right status (404 for books or
// authors that don't exist, 301 for the legacy /book/<key> alias). The page itself is the same index.html the app
// always loads (netlify.toml rewrites every path to it); this only rewrites its <head> and the hidden seo block.
// The work is done by netlify/seo/render.js, which the local dev server (tools/serve.mjs) shares.
// If anything here throws, Netlify serves the untouched page (onError: 'bypass').
import D from '../seo/data.js';
import { renderPage } from '../seo/render.js';

export default async (request, context) => {
  const url = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(url.pathname) || url.pathname === '/') return;   // files, and the homepage, pass through
  const res = await context.next();
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  const html = await res.text(), out = renderPage(html, url.pathname, D);
  if (!out) return new Response(html, { status: res.status, headers: res.headers });
  if (out.location) return new Response(null, { status: out.status, headers: { location: out.location + url.search } });
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(out.html, { status: out.status, headers });
};

export const config = {
  path: '/*',
  excludedPath: ['/*.js', '/*.css', '/*.png', '/*.svg', '/*.json', '/*.txt', '/*.xml', '/*.ico', '/*.html', '/*.mp4', '/vendor/*'],
  onError: 'bypass',
};
