// The A–Z author index (/authors, /authors/<letter>): which authors fall under which letter, by surname.
// Shared by the edge function / dev server (render.js) and the sitemap (tools/build-seo.mjs); the app builds the
// same grouping in P.authorIndex (app.js), so keep surname() and letterOf() in step with it.

const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?$/i;
const plain = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// last word of the name, ignoring suffixes ("Martin Luther King Jr." → "King")
export function surname(name) {
  const t = String(name || '').replace(/[,()]/g, ' ').split(/\s+/).filter(Boolean);
  while (t.length > 1 && SUFFIX.test(t[t.length - 1])) t.pop();
  return t[t.length - 1] || '';
}

// 'A'…'Z', or '#' for names that don't start with a Latin letter
export function letterOf(name) {
  const c = plain(surname(name)).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

// URL segment for a letter: 'a'…'z', or 'other'
export const letterSlug = (l) => (l === '#' ? 'other' : l.toLowerCase());
export const letterFromSlug = (s) => (s === 'other' ? '#' : /^[a-z]$/.test(s) ? s.toUpperCase() : null);

// { letters: [{ l, slug, authors: [{ slug, name, books, mentioned }] }], top: [authors most mentioned] }
// D is the data from netlify/seo/data.js; anonymous works have no author page, so they aren't listed.
const cache = new WeakMap();   // keyed by D, so nothing is added to the data that build-seo writes out
export function authorIndex(D) {
  if (cache.has(D)) return cache.get(D);
  const by = {};
  let all = [];
  for (const [slug, [name, keys]] of Object.entries(D.A)) {
    if (slug === 'anonymous' || !keys.length) continue;
    const a = { slug, name, books: keys.length, mentioned: keys.reduce((n, k) => n + (D.I[k] || []).length, 0) };
    all.push(a);
    (by[letterOf(name)] = by[letterOf(name)] || []).push(a);
  }
  const key = (a) => plain(surname(a.name)).toLowerCase() + ' ' + plain(a.name).toLowerCase();
  const order = (x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0);
  const letters = Object.keys(by).sort((x, y) => (x === '#') - (y === '#') || (x < y ? -1 : 1))
    .map((l) => ({ l, slug: letterSlug(l), authors: by[l].sort(order) }));
  const top = all.slice().sort((x, y) => y.mentioned - x.mentioned || order(x, y)).slice(0, 30);
  const idx = { letters, top, total: all.length };
  cache.set(D, idx);
  return idx;
}
