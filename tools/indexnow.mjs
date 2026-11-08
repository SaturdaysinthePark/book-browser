// IndexNow: tell Bing (and the other IndexNow engines: Yandex, Seznam, Naver…) which pages are new or changed, so
// they recrawl them within hours instead of whenever they next visit. Google doesn't take part.
// Run after each production deploy by the Netlify plugin netlify/plugins/indexnow; the logic lives here so it can be
// tested locally:  node tools/indexnow.mjs [path/to/sitemap.xml]   (dry run: prints what would be sent)
// The key is public by design: search engines check it against https://bookjumpr.com/<key>.txt.
import fs from 'node:fs';

export const SITE = 'https://bookjumpr.com';
export const KEY = 'da5540c73f468680a81c3b26ac5ed465';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 10000;   // the protocol's limit per request

// { url: lastmod } from sitemap.xml
export function readSitemap(xml) {
  const out = {};
  for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g)) out[m[1]] = m[2] || '';
  return out;
}

// URLs that are new, or whose lastmod moved, since `sent` (the { url: lastmod } recorded at the last submission)
export function changedUrls(current, sent) {
  return Object.keys(current).filter((u) => sent[u] !== current[u]);
}

// POST the URLs in batches; returns [{ count, status }]. fetchImpl is injectable for tests.
export async function submit(urls, { fetchImpl = fetch } = {}) {
  const results = [];
  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH);
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
    });
    results.push({ count: urlList.length, status: res.status });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const urls = Object.keys(readSitemap(fs.readFileSync(process.argv[2] || 'sitemap.xml', 'utf8')));
  console.log(`dry run: would submit ${urls.length} URLs to ${ENDPOINT} with key file ${SITE}/${KEY}.txt, e.g. ${urls.slice(0, 3).join(', ')}`);
}
