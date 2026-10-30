// Which book and author pages BookJumpr puts forward to search engines. A page below the bar still works for
// visitors, but it's served with <meta name="robots" content="noindex, follow"> (netlify/seo/render.js) and left
// out of sitemap.xml (tools/build-seo.mjs), so search engines judge the site on its substantial pages only.
// The bar is re-checked on every build: a page that gains a synopsis or more mentions comes back by itself.
//
// D is the edge data (netlify/seo/data.js): B (books), O (what a book mentions, with notes), I (what mentions it),
// A (authors).

// A book page needs a synopsis, plus at least BOOK_MIN_LINKS books it mentions or is mentioned by, or at least
// BOOK_MIN_QUOTES of those mentions with a quoted line.
export const BOOK_MIN_LINKS = 3, BOOK_MIN_QUOTES = 2;
// An author page needs at least AUTHOR_MIN_LINKS mentions to or from their books, in total.
export const AUTHOR_MIN_LINKS = 5;

export function bookStats(D, k) {
  const out = D.O[k] || [], inn = D.I[k] || [];
  const quoted = out.filter(([, note]) => note).length +
    inn.filter((m) => ((D.O[m] || []).find(([x]) => x === k) || [])[1]).length;
  return { synopsis: !!(D.B[k] && D.B[k][3]), links: out.length + inn.length, quotes: quoted };
}

export function indexableBook(D, k) {
  if (!D.B[k]) return false;
  const s = bookStats(D, k);
  return s.synopsis && (s.links >= BOOK_MIN_LINKS || s.quotes >= BOOK_MIN_QUOTES);
}

export function indexableAuthor(D, slug) {
  if (!D.A[slug] || slug === 'anonymous') return false;
  const links = D.A[slug][1].reduce((t, k) => t + (D.O[k] || []).length + (D.I[k] || []).length, 0);
  return links >= AUTHOR_MIN_LINKS;
}
