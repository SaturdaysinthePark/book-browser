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
  if (url.pathname === '/') return;                            // the homepage passes through
  const res = await context.next();
  const isHtml = (res.headers.get('content-type') || '').includes('text/html');
  // A missing file (/ai-catalog.json, /foo.txt …) would otherwise get the app page with a 200 (netlify.toml's
  // catch-all rewrite): answer 404 instead. Real files never come back as HTML, except index.html itself.
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return isHtml && url.pathname !== '/index.html' ? new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }) : res;
  }
  if (!isHtml) return res;
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
  // the site's own scripts, images and fonts skip the function (they exist, and they're on every page's critical
  // path); other file paths still run it, so a missing one gets a 404
  excludedPath: ['/*.js', '/*.png', '/*.svg', '/*.woff2', '/vendor/*', '/og/*', '/fonts/*'],
  onError: 'bypass',
};
