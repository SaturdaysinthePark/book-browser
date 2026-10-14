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

console.log('\nMissing pages and old links');
for (const path of ['/nobody/nothing-at-all', '/nobody-at-all']) {
  const { status, html } = await get(path);
  ok(status === 404 && /noindex/.test(robots(html) || ''), `${path}: 404 + noindex (got ${status})`);
}
{
  const { status, location } = await get('/book/haruki-murakami/norwegian-wood');
  ok(status === 301 && location === '/haruki-murakami/norwegian-wood', `/book/<key> → 301 to ${location}`);
}

console.log('\nPage speed');
{
  const { html } = await get('/haruki-murakami/norwegian-wood');
  ok(!/fonts\.googleapis|fonts\.gstatic/.test(html), 'fonts are served from the site (no Google Fonts request)');
  const notes = tag(html, /<script>window\.BookJumprPageNotes=([\s\S]*?);<\/script>/);
  let n = null; try { n = JSON.parse(notes); } catch (e) {}
  ok(n && n.k === 'haruki-murakami/norwegian-wood' && Object.keys(n.n).length >= 9, `the book's quotes come with the page (${n ? Object.keys(n.n).length : 0} notes)`);
  for (const f of ['/fonts/instrument-serif-400-latin.woff2', '/fonts/cabin-latin.woff2', '/fonts/ibm-plex-mono-400-latin.woff2']) {
    const r = await fetch(BASE + f); await r.arrayBuffer();
    ok(r.status === 200, `${f}: ${r.status}`);
  }
}

console.log('\nMissing files are 404s, not the app page');
for (const f of ['/ai-catalog.json', '/nothing-here.txt', '/old-page.html']) {
  const r = await fetch(BASE + f, { redirect: 'manual' }); const body = await r.text();
  ok(r.status === 404 && !/<!DOCTYPE html>/i.test(body), `${f}: ${r.status}`);
}

console.log('\nllms.txt');
{
  const t = await (await fetch(BASE + '/llms.txt')).text();
  ok(/^# BookJumpr\n\n> /.test(t), 'starts with a title and a blockquote summary');
  ok(/## Key pages\n\n- \[Home\]\(https:\/\/bookjumpr\.com\/\)/.test(t) && /## Optional\n\n- \[/.test(t), 'has "Key pages" and "Optional" link lists');
}

console.log('\nFiles');
for (const path of ['/app.js?v=7', '/bookjumpr-data.js?v=2', '/vendor/react.production.min.js', '/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap.xml']) {
  const r = await fetch(BASE + path);
  const body = await r.text();
  ok(r.status === 200 && !/^<!DOCTYPE html>/i.test(body), `${path}: ${r.status}, ${body.length.toLocaleString('en-US')} bytes, not the HTML page`);
}
{
  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  const n = (sm.match(/<url>/g) || []).length;
  ok(n > 1000 && sm.includes(`<loc>${SITE}/haruki-murakami/norwegian-wood</loc>`), `sitemap lists ${n} pages, including book pages`);
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ all checks passed');
process.exitCode = failed ? 1 : 0;
