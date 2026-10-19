// Browser test of the app's routing on real URLs (/<author>/<title> instead of #/…): every kind of page loads
// without errors, clicks navigate in place (no reload), back/forward work, old #/ links are rewritten, and
// ⌘/Ctrl-click opens a new tab. Needs Playwright + Chromium (run from the repo root):
//   node tools/test-site.mjs [baseURL]      (default http://localhost:8917 — run `npm run serve` first)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';

const BASE = (process.argv[2] || 'http://localhost:8917').replace(/\/+$/, '');
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); if (!cond) failed++; };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errors = [];
const open = async (path) => {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${path}: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/(nobody|favicon)/.test(r.url())) errors.push(`${path}: ${r.status()} ${r.url()}`); });
  await page.goto(BASE + path);
  await page.waitForTimeout(1500);
  return page;
};
const path = (page) => new URL(page.url()).pathname;
const h1 = (page) => page.evaluate(() => [...document.querySelectorAll('h1')].filter((e) => e.offsetParent).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '));
const seoHidden = (page) => page.evaluate(() => !document.querySelector('.bj-seo') || getComputedStyle(document.querySelector('.bj-seo')).display === 'none');
const mark = (page) => page.evaluate(() => { window.__noReload = 1; });
const noReload = (page) => page.evaluate(() => window.__noReload === 1);

console.log(`Testing ${BASE}\n\nEvery kind of page loads`);
for (const [p, want] of [
  ['/', /Every book is a door/], ['/haruki-murakami/norwegian-wood', /Norwegian Wood/], ['/haruki-murakami', /Haruki Murakami/],
  ['/about', /Books talk about books/], ['/stats', /most name-dropped/], ['/search/kafka', /kafka/], ['/?home=a', /./],
]) {
  const page = await open(p);
  const t = await h1(page);
  ok(want.test(t) && (await seoHidden(page)), `${p} → "${t.slice(0, 60)}"${(await seoHidden(page)) ? '' : ' (crawler text VISIBLE)'}`);
  await page.close();
}
for (const p of ['/network', '/network/haruki-murakami/norwegian-wood', '/network?net=v2', '/network/haruki-murakami/norwegian-wood?net=v3', '/network?net=v4']) {
  const page = await open(p);
  await page.waitForTimeout(1500);
  const drawn = await page.evaluate(() => !!document.querySelector('canvas, .bjx-page, .bjx-entry, .atlas'));
  ok(drawn && path(page) === p.split('?')[0], `${p} draws the network`);
  await page.close();
}
{
  const page = await open('/nobody/nothing-at-all');
  ok(/isn.t in the network/i.test(await page.evaluate(() => document.body.innerText)), '/nobody/nothing-at-all shows "That book isn’t in the network yet"');
  await page.close();
}

console.log('\nOld #/ links still work');
for (const [p, want, wantPath] of [['/#/haruki-murakami/norwegian-wood', /Norwegian Wood/, '/haruki-murakami/norwegian-wood'], ['/#/about', /Books talk/, '/about'], ['/#/', /Every book/, '/']]) {
  const page = await open(p);
  ok(want.test(await h1(page)) && path(page) === wantPath && !page.url().includes('#'), `${p} → ${page.url().replace(BASE, '')}`);
  await page.close();
}

console.log('\nClicking around a book page');
{
  const page = await open('/haruki-murakami/norwegian-wood');
  await mark(page);
  ok(/No War and Peace, no Kenzaburo Oe/.test(await page.evaluate(() => document.body.innerText)), 'the mention quotes load (lazy notes file)');
  const card = page.locator('a.bkn-t', { hasText: 'The Catcher in the Rye' }).first();
  ok((await card.getAttribute('href')) === '/j-d-salinger/the-catcher-in-the-rye', 'mention card is a real link: ' + (await card.getAttribute('href')));
  await card.click(); await page.waitForTimeout(1200);
  ok(path(page) === '/j-d-salinger/the-catcher-in-the-rye' && /Catcher in the Rye/.test(await h1(page)) && (await noReload(page)), `click → ${path(page)}, no reload`);
  ok((await page.evaluate(() => document.title)) === 'The Catcher in the Rye — BookJumpr', 'tab title follows');
  ok((await page.evaluate(() => document.querySelector('link[rel=canonical]').href)) === 'https://bookjumpr.com/j-d-salinger/the-catcher-in-the-rye', 'canonical follows');
  await page.goBack(); await page.waitForTimeout(1000);
  ok(path(page) === '/haruki-murakami/norwegian-wood' && /Norwegian Wood/.test(await h1(page)) && (await noReload(page)), `back → ${path(page)}`);
  await page.goForward(); await page.waitForTimeout(1000);
  ok(path(page) === '/j-d-salinger/the-catcher-in-the-rye' && /Catcher/.test(await h1(page)), `forward → ${path(page)}`);
  const cover = page.locator('a.bkn-cv').first();
  const href = await cover.getAttribute('href');
  await cover.click(); await page.waitForTimeout(1200);
  ok(path(page) === href && (await noReload(page)), `cover click → ${href}`);
  await page.locator('.bjx-hmeta a.au-lnk, .bkp-meta a.au-lnk, .bjx-hmeta a.lnk, .bkp-meta a.lnk').first().click(); await page.waitForTimeout(1200);
  ok(/^\/[a-z0-9-]+$/.test(path(page)) && (await noReload(page)), `author link → ${path(page)} "${await h1(page)}"`);
  const authorBook = page.locator('a[data-tilt]').first();
  const ab = await authorBook.getAttribute('href');
  await authorBook.click(); await page.waitForTimeout(1200);
  ok(path(page) === ab && (await noReload(page)), `author page book → ${ab}`);
  // ⌘/Ctrl-click opens the book in a new tab and leaves this one where it is
  await page.goto(BASE + '/haruki-murakami/norwegian-wood'); await page.waitForTimeout(1500);
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.locator('a.bkn-t').first().click({ modifiers: ['ControlOrMeta'] })]);
  await tab.waitForLoadState(); await tab.waitForTimeout(1500);
  ok(path(page) === '/haruki-murakami/norwegian-wood' && path(tab) !== path(page) && (await h1(tab)).length > 0, `ctrl/⌘-click → new tab at ${path(tab)}`);
  await tab.close(); await page.close();
}

console.log('\nThe classic book page (?v=classic)');
{
  const page = await open('/haruki-murakami/norwegian-wood?v=classic');
  await mark(page);
  const card = page.locator('a.mc-t').first();
  const href = await card.getAttribute('href');
  await card.click(); await page.waitForTimeout(1200);
  ok(path(page) === href && page.url().includes('v=classic') && (await noReload(page)), `classic mention card → ${href}, keeps ?v=classic`);
  await page.locator('.bk a.lnk').first().click(); await page.waitForTimeout(1200);
  ok(/^\/[a-z0-9-]+$/.test(path(page)) && (await noReload(page)), `classic author link → ${path(page)}`);
  await page.close();
}

console.log('\nHeader, search, stats and about');
{
  const page = await open('/haruki-murakami/norwegian-wood');
  await mark(page);
  for (const [label, want] of [['Stats', '/stats'], ['About', '/about'], ['Network', '/network']]) {
    await page.locator(`.bj-hdr button[aria-label="${label}"], .bj-hdr button:has-text("${label}")`).first().click(); await page.waitForTimeout(1200);
    ok(path(page) === want && (await noReload(page)), `header ${label} → ${path(page)}`);
  }
  await page.goto(BASE + '/stats'); await page.waitForTimeout(1200); await mark(page);
  const top = page.locator('a[href="/miguel-de-cervantes/don-quixote"]').first();
  await top.click(); await page.waitForTimeout(1200);
  ok(path(page) === '/miguel-de-cervantes/don-quixote' && (await noReload(page)), `stats row → ${path(page)}`);
  await page.goto(BASE + '/about'); await page.waitForTimeout(1200); await mark(page);
  await page.locator('a.ob-door').first().click(); await page.waitForTimeout(1200);
  ok(path(page) === '/anonymous/a-thousand-and-one-nights' && (await noReload(page)), `about page book link → ${path(page)}`);
  await page.goto(BASE + '/'); await page.waitForTimeout(1500); await mark(page);
  const box = page.locator('input[placeholder^="Search"]').first();
  await box.fill('kafka'); await box.press('Enter'); await page.waitForTimeout(1200);
  ok(/^\/(search\/kafka|franz-kafka\/.+|haruki-murakami\/kafka-on-the-shore)$/.test(path(page)) && (await noReload(page)), `search "kafka" + Enter → ${path(page)}`);
  await page.goto(BASE + '/search/kafka'); await page.waitForTimeout(1500); await mark(page);
  const row = page.locator('a[href="/haruki-murakami/kafka-on-the-shore"]').first();
  await row.click(); await page.waitForTimeout(1200);
  ok(path(page) === '/haruki-murakami/kafka-on-the-shore' && (await noReload(page)), `search results row → ${path(page)}`);
  await page.goto(BASE + '/'); await page.waitForTimeout(1500); await mark(page);
  const chip = page.locator('button', { hasText: /^(Treasure Island|The Brothers Karamazov|Uncle Tom|Robinson Crusoe)/ }).first();
  if (await chip.count()) { await chip.click(); await page.waitForTimeout(1200); ok(path(page).split('/').length === 3 && (await noReload(page)), `home suggestion → ${path(page)}`); }
  await page.close();
}

console.log('\nNetwork views');
{
  const page = await open('/network?net=v2');
  await page.waitForTimeout(1500);
  await page.goto(BASE + '/network/haruki-murakami/norwegian-wood?net=v2'); await page.waitForTimeout(2000); await mark(page);
  const back = page.locator('.bjx-back');
  if (await back.count()) { await back.click(); await page.waitForTimeout(1000); ok(path(page) === '/network' && page.url().includes('net=v2') && (await noReload(page)), `explorer "All starting points" → ${page.url().replace(BASE, '')}`); }
  await page.close();
}

console.log(errors.length ? `\nPage errors / failed requests:\n  ${errors.join('\n  ')}` : '\nNo page errors or failed requests');
if (errors.length) failed++;
await browser.close();
console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ all checks passed');
process.exitCode = failed ? 1 : 0;
