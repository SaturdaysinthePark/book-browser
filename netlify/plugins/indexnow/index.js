// After a successful production deploy, send IndexNow the sitemap URLs that are new or changed since the last
// production deploy (tools/indexnow.mjs). What was sent is remembered in Netlify's build cache, so the first run
// sends every URL and later runs only the differences. Never fails the deploy.
import fs from 'node:fs';
import path from 'node:path';
import { readSitemap, changedUrls, submit } from '../../../tools/indexnow.mjs';

const STATE = '.indexnow-sent.json';

export const onSuccess = async ({ constants, utils }) => {
  if (process.env.CONTEXT !== 'production') return console.log('IndexNow: skipped (not a production deploy)');
  try {
    const current = readSitemap(fs.readFileSync(path.join(constants.PUBLISH_DIR, 'sitemap.xml'), 'utf8'));
    await utils.cache.restore(STATE);
    const sent = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
    const urls = changedUrls(current, sent);
    if (!urls.length) return console.log('IndexNow: nothing new or changed');
    const results = await submit(urls);
    const ok = results.every((r) => r.status === 200 || r.status === 202);
    console.log(`IndexNow: sent ${urls.length} URLs: ${results.map((r) => `${r.count} → HTTP ${r.status}`).join(', ')}`);
    if (ok) { fs.writeFileSync(STATE, JSON.stringify(current)); await utils.cache.save(STATE); }
  } catch (e) {
    console.log('IndexNow: not sent (' + e.message + '); the deploy is unaffected');
  }
};
