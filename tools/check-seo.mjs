// Checks what search engines and link previews get from the server, with no browser and no JavaScript —
// status codes, titles, canonical URLs, descriptions, structured data and crawler text for each kind of page.
// Works against the local dev server or any deploy (a Netlify deploy preview, or the live site):
//   node tools/check-seo.mjs                                   (default http://localhost:8917 — run `npm run serve` first)
//   node tools/check-seo.mjs https://deploy-preview-8--<site>.netlify.app
// Exits non-zero if any check fails.
const BASE = (process.argv[2] || 'http://localhost:8917').replace(/\/+$/, '');
const SITE = 'https://bookjumpr.com';
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };
const get = async (path) => {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  return { status: r.status, location: r.headers.get('location'), html: await r.text() };
};
const tag = (html, re) => (html.match(re) || [])[1];
const title = (h) => tag(h, /<title>([^<]*)<\/title>/);
const canonical = (h) => tag(h, /<link rel="canonical" href="([^"]*)"/);
const desc = (h) => tag(h, /<meta name="description" content="([^"]*)"/);
const ogUrl = (h) => tag(h, /<meta property="og:url" content="([^"]*)"/);
const block = (h) => tag(h, /<!-- seo:start[\s\S]*?(<div class="bj-seo">[\s\S]*?)<!-- seo:end -->/) || '';
const ld = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const robots = (h) => tag(h, /<meta name="robots" content="([^"]*)"/);
const ogImage = (h) => tag(h, /<meta property="og:image" content="([^"]*)"/);

console.log(`Checking ${BASE}\n`);

console.log('Homepage /');
{
  const { status, html } = await get('/');
  ok(status === 200, `status 200 (got ${status})`);
  ok(title(html) === 'BookJumpr: Books Mentioned Inside Other Books', `title: ${title(html)}`);
  ok(canonical(html) === `${SITE}/`, `canonical: ${canonical(html)}`);
  ok(/href="\/miguel-de-cervantes\/don-quixote"/.test(block(html)), 'crawler text links to book pages');
  const org = ld(html).flatMap((x) => x['@graph'] || [x]).find((x) => x['@type'] === 'Organization');
  ok(org && org.sameAs && org.sameAs.length === 3, `Organization lists its profiles: ${(org && org.sameAs || []).join(', ')}`);
  ok(ogImage(html) === `${SITE}/social-preview.png?v=2`, `share image: the site card`);
}

console.log('\nBook page /haruki-murakami/norwegian-wood');
{
  const { status, html } = await get('/haruki-murakami/norwegian-wood');
  ok(status === 200, `status 200 (got ${status})`);
  ok(/^Norwegian Wood by Haruki Murakami/.test(title(html) || ''), `title: ${title(html)}`);
  ok(canonical(html) === `${SITE}/haruki-murakami/norwegian-wood`, `canonical: ${canonical(html)}`);
  ok(ogUrl(html) === `${SITE}/haruki-murakami/norwegian-wood`, `og:url: ${ogUrl(html)}`);
  ok(/mentions 9 books/.test(desc(html) || ''), `description: ${desc(html)}`);
  ok(/<h1>Norwegian Wood<\/h1>/.test(block(html)), 'crawler text has the book’s heading');
  ok(/href="\/j-d-salinger\/the-catcher-in-the-rye"/.test(block(html)), 'crawler text links to the books it mentions');
  ok(/No War and Peace, no Kenzaburo Oe/.test(block(html)), 'crawler text has the quotes');
  const book = ld(html).flatMap((x) => x['@graph'] || [x]).find((x) => x['@type'] === 'Book');
  ok(book && book.name === 'Norwegian Wood' && book.mentions && book.mentions.length === 9, 'JSON-LD Book with its 9 mentions');
  ok(/<h2>Norwegian Wood and other books<\/h2>/.test(block(html)) && /mentions 9 books/.test(block(html)), 'book pages carry the "… and other books" write-up');
  ok(!robots(html), 'indexable (no robots noindex)');
  const img = ogImage(html) || '';
  ok(/^https:\/\/bookjumpr\.com\/og\/haruki-murakami\/norwegian-wood\.png\?v=[0-9a-f]{8}$/.test(img), `share image is the book's own card: ${img}`);
  const r = await fetch(BASE + img.replace(SITE, ''));
  ok(r.status === 200 && /image\/png/.test(r.headers.get('content-type') || ''), `…and it loads: ${r.status} ${r.headers.get('content-type')}`);
  await r.arrayBuffer();
}

console.log('\nAuthor page /haruki-murakami');
{
  const { status, html } = await get('/haruki-murakami');
  ok(status === 200, `status 200 (got ${status})`);
  ok(/^Haruki Murakami/.test(title(html) || ''), `title: ${title(html)}`);
  ok(canonical(html) === `${SITE}/haruki-murakami`, `canonical: ${canonical(html)}`);
  ok(/href="\/haruki-murakami\/kafka-on-the-shore"/.test(block(html)), 'crawler text lists their books');
}

console.log('\nOther pages');
for (const [path, re] of [['/about', /^About BookJumpr/], ['/stats', /most name-dropped/], ['/network', /network/i]]) {
  const { status, html } = await get(path);
  ok(status === 200 && re.test(title(html) || '') && canonical(html) === SITE + path, `${path}: ${status}, "${title(html)}", canonical ${canonical(html)}`);
}
{
  const { status, html } = await get('/search/kafka');
  ok(status === 200 && /noindex/.test(robots(html) || '') && !canonical(html), `/search/kafka: ${status}, noindex, no canonical`);
  const n = await get('/network/haruki-murakami/norwegian-wood');
  ok(n.status === 200 && /noindex/.test(robots(n.html) || '') && canonical(n.html) === `${SITE}/network`, `/network/<book>: ${n.status}, noindex, canonical /network`);
}

console.log('\nAuthors A–Z');
{
  const o = await get('/authors');
  ok(o.status === 200 && /^Authors A–Z/.test(title(o.html) || '') && canonical(o.html) === `${SITE}/authors`, `/authors: ${o.status}, "${title(o.html)}", canonical ${canonical(o.html)}`);
  ok(/href="\/authors\/m"/.test(block(o.html)) && /href="\/william-shakespeare"/.test(block(o.html)), '/authors links to every letter and to the most-mentioned authors');
  const m = await get('/authors/m');
  ok(m.status === 200 && /^Authors starting with M/.test(title(m.html) || '') && canonical(m.html) === `${SITE}/authors/m`, `/authors/m: ${m.status}, "${title(m.html)}", canonical ${canonical(m.html)}`);
  ok((block(m.html).match(/<li><a href="\/[^"]+">/g) || []).length > 100 && /href="\/niccolo-machiavelli"/.test(block(m.html)), '/authors/m lists its authors as links');
  ok(ld(m.html).some((g) => (g['@graph'] || []).some((n) => n['@type'] === 'CollectionPage')), '/authors/m has CollectionPage JSON-LD');
  const a = await get('/haruki-murakami');
  ok(/href="\/authors"/.test(block(a.html)), 'author pages link back to /authors');
  const ws = await get('/william-shakespeare');
  ok(/<h2>Shakespeare and other books<\/h2>/.test(block(ws.html)) && /more than \d+ books/.test(block(ws.html)) && /<table>/.test(block(ws.html)), 'author pages carry the "… and other books" write-up (/william-shakespeare)');
  const bad = await get('/authors/zz');
  ok(bad.status === 404 && /noindex/.test(robots(bad.html) || ''), `/authors/zz: 404 + noindex (got ${bad.status})`);
}

console.log('\nThin pages (netlify/seo/quality.js)');
{
  const thin = await get('/spike-hawkins/the-lost-fire-brigade'), thinA = await get('/markus-zusak');
  ok(thin.status === 200 && /noindex, follow/.test(robots(thin.html) || '') && /The Lost Fire Brigade/.test(block(thin.html)),
    'a thin book page still works for visitors but is noindex, follow');
  ok(thinA.status === 200 && /noindex, follow/.test(robots(thinA.html) || ''), 'a thin author page is noindex, follow');
  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  ok(!sm.includes(`<loc>${SITE}/spike-hawkins/the-lost-fire-brigade</loc>`) && sm.includes(`<loc>${SITE}/voltaire/candide</loc>`),
    'the sitemap leaves thin pages out and keeps strong ones');
}

console.log('\nMissing pages and old links');
for (const path of ['/nobody/nothing-at-all', '/nobody-at-all']) {
  const { status, html } = await get(path);
  ok(status === 404 && /noindex/.test(robots(html) || ''), `${path}: 404 + noindex (got ${status})`);
}
{
  const { status, location } = await get('/book/haruki-murakami/norwegian-wood');
  ok(status === 301 && location === '/haruki-murakami/norwegian-wood', `/book/<key> → 301 to ${location}`);
}
{
  const a = await get('/adolph-hitler'), b = await get('/adolph-hitler/mein-kampf');
  ok(a.status === 301 && a.location === '/adolf-hitler' && b.status === 301 && b.location === '/adolf-hitler/mein-kampf',
    `old author spelling → 301 (/adolph-hitler → ${a.location}, its book → ${b.location})`);
}

console.log('\nFiles');
for (const path of ['/app.js?v=6', '/bookjumpr-data.js?v=2', '/vendor/react.production.min.js', '/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap.xml']) {
  const r = await fetch(BASE + path);
  const body = await r.text();
  ok(r.status === 200 && !/^<!DOCTYPE html>/i.test(body), `${path}: ${r.status}, ${body.length.toLocaleString('en-US')} bytes, not the HTML page`);
}
{
  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  const n = (sm.match(/<url>/g) || []).length;
  ok(n > 1000 && sm.includes(`<loc>${SITE}/haruki-murakami/norwegian-wood</loc>`), `sitemap lists ${n} pages, including book pages`);
  ok(sm.includes(`<loc>${SITE}/authors</loc>`) && sm.includes(`<loc>${SITE}/authors/m</loc>`), 'sitemap lists the A–Z author index');
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ all checks passed');
process.exitCode = failed ? 1 : 0;
