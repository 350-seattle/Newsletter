// Browser acceptance checks for the Newsletter Builder.
//
//   cd tests/e2e
//   npm install          (once; dev-only tools)
//   node run.mjs
//
// Uses the Chrome already installed on this computer (set CHROME_PATH to
// override). Starts its own local web server and fakes the Apps Script
// web app, so nothing leaves this computer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { snapshot, navigation } from 'lighthouse';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const out = path.join(here, 'output');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find((p) => fs.existsSync(p));

const FAKE_SCRIPT = 'https://script.google.com/macros/s/TEST-DEPLOYMENT/exec';
const TOKEN = 'TOKEN-7f3a9c-do-not-leak';
const results = [];
function record(n, name, pass, detail) {
  results.push({ n, name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${n}. ${name}${detail ? ' :: ' + detail : ''}\n`);
}

// ---------------------------------------------------------------- server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (url.pathname.startsWith('/__e2e/')) file = path.join(out, url.pathname.slice(7));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate']
});

// --------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage({ width = 1280, height = 900, mock = null, downloads = null } = {}) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await context.newPage();
  await page.setViewport({ width, height });
  page.consoleLog = [];
  page.on('console', (m) => page.consoleLog.push(m.text()));
  page.on('pageerror', (e) => page.consoleLog.push('PAGEERROR ' + e.message));
  page.requests = [];
  if (downloads) {
    fs.mkdirSync(downloads, { recursive: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, browserContextId: context.id });
  }
  if (mock) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const u = req.url();
      if (u.startsWith(ORIGIN + '/config.js')) {
        const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8')
          .replace(/APPS_SCRIPT_URL: '[^']*'/, `APPS_SCRIPT_URL: '${FAKE_SCRIPT}'`);
        return req.respond({ status: 200, contentType: 'text/javascript', body: cfg });
      }
      if (u.startsWith(FAKE_SCRIPT)) {
        page.requests.push({ url: u, method: req.method(), headers: req.headers(), body: req.postData() });
        const reply = mock(JSON.parse(req.postData() || '{}'));
        if (reply === 'abort') return req.abort('internetdisconnected');
        return req.respond(Object.assign({ status: 200, contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' } }, reply));
      }
      return req.continue();
    });
  }
  return page;
}

async function waitStep(page, n) {
  await page.waitForFunction((n) => {
    const s = document.getElementById('step-' + n);
    return s && !s.hidden;
  }, { timeout: 15000 }, n);
}

async function waitForFile(dir, re, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = fs.existsSync(dir) && fs.readdirSync(dir).find((x) => re.test(x) && !x.endsWith('.crdownload'));
    if (f) { await sleep(300); return path.join(dir, f); }
    await sleep(200);
  }
  return null;
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// Describes the focused element, looking inside shadow roots, and
// whether a focus indicator is visible on it.
async function focusInfo(page) {
  return page.evaluate(() => {
    let a = document.activeElement;
    let shadow = false;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) { a = a.shadowRoot.activeElement; shadow = true; }
    if (!a || a === document.body) return { tag: 'BODY' };
    const cs = getComputedStyle(a);
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
    const ring = cs.boxShadow && cs.boxShadow !== 'none';
    const rect = a.getBoundingClientRect();
    return {
      tag: a.tagName, id: a.id, cls: a.className && String(a.className), shadow,
      text: (a.textContent || a.value || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      visibleRing: outline || ring, focusVisible: a.matches(':focus-visible'),
      onScreen: rect.width > 0 && rect.height > 0
    };
  });
}

const focusProblems = [];
async function tabTo(page, predicate, label, max = 250) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const f = await focusInfo(page);
    if (f.tag !== 'BODY' && (!f.visibleRing || !f.onScreen)) {
      focusProblems.push(`${label}: ${f.tag}#${f.id}.${f.cls} "${f.text}" ring=${f.visibleRing} onScreen=${f.onScreen}`);
    }
    if (predicate(f)) return f;
  }
  throw new Error('Could not reach ' + label + ' with Tab');
}

function shadowCount(page, host, sel) {
  return page.evaluate((h, s) => {
    const el = document.querySelector(h);
    return el && el.shadowRoot ? el.shadowRoot.querySelectorAll(s).length : -1;
  }, host, sel);
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    ok: document.documentElement.scrollWidth <= window.innerWidth
  }));
}

const sample = JSON.parse(fs.readFileSync(path.join(root, 'sample-data.json'), 'utf8'));
let fragmentFile = null;
let pngFile = null;

// ========================================================== CHECK 1 + 6
try {
  const dl = path.join(out, 'downloads-demo');
  const page = await newPage({ downloads: dl });
  await page.goto(ORIGIN + '/index.html?demo=1', { waitUntil: 'networkidle0' });
  await waitStep(page, 2);
  const tiles0 = await shadowCount(page, '#preview-arrange', '.n350-tile');
  // arrange: leave one out, feature one, move one, move a category
  const ids = await page.$$eval('#arrange-list input[id^="inc-"]', (els) => els.map((e) => e.id));
  await page.click('#' + ids[1]);
  await page.click('#feat-4');
  await page.click('#down-0');
  await page.click('#cat-down-0');
  const tiles1 = await shadowCount(page, '#preview-arrange', '.n350-tile');
  const featuredFirst = await page.evaluate(() => {
    const first = document.querySelector('#preview-arrange').shadowRoot.querySelector('.n350-tile');
    return first.classList.contains('n350-tile--featured');
  });
  // refresh keeps the arrangement
  const before = await page.evaluate(() => sessionStorage.getItem('n350-arrangement'));
  await page.reload({ waitUntil: 'networkidle0' });
  await waitStep(page, 2);
  const after = await page.evaluate(() => sessionStorage.getItem('n350-arrangement'));
  const keptAfterRefresh = JSON.parse(before).categories[0].name === JSON.parse(after).categories[0].name &&
    JSON.stringify(JSON.parse(before).excluded) === JSON.stringify(JSON.parse(after).excluded);

  await page.click('#step-2 [data-goto="3"]');
  await waitStep(page, 3);
  const finalTiles = await shadowCount(page, '#preview-final', '.n350-tile');
  const linkRows = await page.$$eval('#check-links tbody tr', (r) => r.length);
  const opened = await page.evaluate(() => {
    const s = document.querySelector('#preview-final').shadowRoot.querySelector('summary');
    s.click();
    return s.parentElement.open;
  });
  await page.screenshot({ path: path.join(out, 'step3-1280.png'), fullPage: true });

  await page.click('#step-3 [data-goto="4"]');
  await waitStep(page, 4);
  await page.click('#html-btn');
  fragmentFile = await waitForFile(dl, /^newsletter-.*\.html$/);
  await page.click('#png-btn');
  pngFile = await waitForFile(dl, /\.png$/, 40000);
  await page.click('#email-btn');
  await page.waitForFunction(() => document.getElementById('email-status').textContent.length > 0, { timeout: 10000 });
  const emailStatus = await page.$eval('#email-status', (e) => e.textContent);
  const clip = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      const types = items[0].types;
      const html = types.includes('text/html') ? await (await items[0].getType('text/html')).text() : '';
      const text = types.includes('text/plain') ? await (await items[0].getType('text/plain')).text() : '';
      return { types, html, text };
    } catch (e) { return { error: String(e) }; }
  });
  const emailText = await page.$eval('#email-text', (e) => e.value);
  fs.writeFileSync(path.join(out, 'email-text.txt'), emailText);
  fs.writeFileSync(path.join(out, 'email-clipboard.json'), JSON.stringify(clip, null, 2));

  // publish in sample mode (simulated)
  await page.click('#publish-btn');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('#confirm-yes');
  await page.waitForFunction(() => !document.getElementById('publish-result').hidden);
  const pubUrl = await page.$eval('#published-url', (e) => e.value);

  const checks = {
    loaded: tiles0 === sample.items.length,
    leftOut: tiles1 === sample.items.length - 1,
    featuredFirst, keptAfterRefresh,
    finalTiles: finalTiles === sample.items.length - 1,
    linkRows: linkRows === sample.items.length - 1,
    tileOpens: opened,
    html: !!fragmentFile,
    png: !!pngFile,
    emailCopied: /Copied!/.test(emailStatus),
    clipboardHasHtmlAndText: !!(clip.types && clip.types.includes('text/html') && clip.types.includes('text/plain') && /utm_source=everyaction/.test(clip.html)),
    emailTextShowsUrls: /Read more: https:\/\/example\.org\/.*utm_source=everyaction/.test(emailText),
    samplePublishShowsUrl: /^https:\/\/.*2026-12\/$/.test(pubUrl),
    noPageErrors: !page.consoleLog.some((l) => l.startsWith('PAGEERROR'))
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  record(1, 'Demo works end to end with no backend', failed.length === 0, failed.length ? 'failed: ' + failed.join(', ') + (clip.error ? ' clipboard: ' + clip.error : '') : `${tiles0} items; html, png, email copied (${clip.types && clip.types.join(' + ')})`);

  if (pngFile) {
    const size = pngSize(pngFile);
    fs.copyFileSync(pngFile, path.join(out, 'preview.png'));
    record(6, 'PNG is 1200 px wide', size && size.width === 1200, size ? `${size.width} × ${size.height}px (600 CSS px at 2x); saved tests/e2e/output/preview.png` : 'not a PNG');
  } else {
    record(6, 'PNG is 1200 px wide', false, 'no PNG downloaded');
  }
  await page.browserContext().close();
} catch (e) {
  record(1, 'Demo works end to end with no backend', false, String(e && e.stack || e));
}

// ============================================================== CHECK 2
// Fragment safety is covered by tests/render.test.js; here we re-check
// the file the builder actually downloaded.
if (fragmentFile) {
  const f = fs.readFileSync(fragmentFile, 'utf8');
  const bad = [];
  if (/<script/i.test(f)) bad.push('<script>');
  if (/<[^>]*\son[a-z]+\s*=/i.test(f)) bad.push('on* attribute');
  if (/javascript:/i.test(f)) bad.push('javascript:');
  if (/[A-Z0-9._%+-]+@[A-Z0-9-]+\.[A-Z]{2,}/i.test(f.replace(/@(font-face|container|media|supports)/g, ''))) bad.push('email');
  if (!/^<style>/.test(f) || /<(html|head|body)\b/i.test(f)) bad.push('not a bare fragment');
  record(2, 'Downloaded fragment: no script, on*, javascript:, email', bad.length === 0, bad.join(', ') || 'also covered by tests/render.test.js');
  const page = await newPage();
  const doc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Published board</title></head><body style="margin:0">' + f + '</body></html>';
  fs.writeFileSync(path.join(out, 'board-page.html'), doc);
  await page.browserContext().close();
} else {
  record(2, 'Downloaded fragment: no script, on*, javascript:, email', false, 'no fragment downloaded');
}

// ============================================================== CHECK 3
try {
  const page = await newPage({ width: 1280 });
  await page.setJavaScriptEnabled(false);
  await page.goto(ORIGIN + '/__e2e/board-page.html', { waitUntil: 'networkidle0' });
  const count = await page.$$eval('summary', (s) => s.length);
  let toggled = 0;
  const problems = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    let f = await focusInfo(page);
    while (f.tag === 'A') { await page.keyboard.press('Tab'); f = await focusInfo(page); }
    if (f.tag !== 'SUMMARY') { problems.push('tab ' + i + ' reached ' + f.tag); break; }
    if (!f.visibleRing) problems.push('no focus ring on tile ' + i);
    await page.keyboard.press('Enter');
    const openA = await page.evaluate(() => document.activeElement.parentElement.open);
    const blurbShown = await page.evaluate(() => {
      const b = document.activeElement.parentElement.querySelector('.n350-body');
      return b.getBoundingClientRect().height > 0;
    });
    if (i === 0) await page.screenshot({ path: path.join(out, 'js-off-open-tile.png'), fullPage: true });
    await page.keyboard.press('Space');
    const openB = await page.evaluate(() => document.activeElement.parentElement.open);
    if (openA && blurbShown && !openB) toggled++;
    else problems.push(`tile ${i}: enter→${openA}, blurb ${blurbShown}, space→${openB}`);
  }
  const jsOff = await page.evaluate(() => typeof window.N350 === 'undefined' && document.scripts.length === 0);
  record(3, 'With JavaScript off, every tile expands and collapses', toggled === count && count > 0 && jsOff,
    `${toggled}/${count} tiles toggled by Enter/Space with JS disabled` + (problems.length ? '; ' + problems.join('; ') : ''));
  await page.browserContext().close();
} catch (e) {
  record(3, 'With JavaScript off, every tile expands and collapses', false, String(e));
}

// ============================================================== CHECK 4
try {
  const notes = [];
  let ok = true;
  for (const width of [375, 768, 1280]) {
    const page = await newPage({ width, height: 900 });
    await page.goto(ORIGIN + '/index.html?demo=1', { waitUntil: 'networkidle0' });
    await waitStep(page, 2);
    for (const step of [2, 3, 4, 1]) {
      await page.click(`.nb-step[data-step="${step}"]`);
      await waitStep(page, step);
      await sleep(150);
      const s = await noHorizontalScroll(page);
      if (!s.ok) { ok = false; notes.push(`${width}px step ${step}: scrollWidth ${s.scrollWidth}`); }
      if (step === 2 || step === 3) await page.screenshot({ path: path.join(out, `step${step}-${width}.png`), fullPage: true });
    }
    await page.click('.nb-step[data-step="3"]');
    await waitStep(page, 3);
    const cols = await page.evaluate(() => {
      const g = document.querySelector('#preview-final').shadowRoot.querySelector('.n350-grid');
      return getComputedStyle(g).gridTemplateColumns.split(' ').length;
    });
    const want = width === 375 ? 1 : 3;
    if (cols !== want) { ok = false; notes.push(`${width}px: ${cols} board columns (expected ${want})`); }
    else notes.push(`${width}px: ${cols} col`);
    // the published board on its own page
    const board = await newPage({ width, height: 900 });
    await board.goto(ORIGIN + '/__e2e/board-page.html', { waitUntil: 'networkidle0' });
    const bs = await noHorizontalScroll(board);
    if (!bs.ok) { ok = false; notes.push(`board page ${width}px: scrollWidth ${bs.scrollWidth}`); }
    await board.screenshot({ path: path.join(out, `board-${width}.png`), fullPage: true });
    await board.browserContext().close();
    await page.browserContext().close();
  }
  record(4, 'Layout at 375/768/1280 with no horizontal scroll', ok, notes.join('; ') + '; screenshots in tests/e2e/output');
} catch (e) {
  record(4, 'Layout at 375/768/1280 with no horizontal scroll', false, String(e));
}

// ============================================================== CHECK 5
try {
  const dl = path.join(out, 'downloads-keyboard');
  const page = await newPage({ downloads: dl });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'networkidle0' });
  await tabTo(page, (f) => f.id === 'demo-link', 'sample data link');
  await page.keyboard.press('Enter');
  await waitStep(page, 2);
  await tabTo(page, (f) => f.id === 'inc-2', 'include checkbox');
  await page.keyboard.press('Space');
  await tabTo(page, (f) => f.id === 'feat-3', 'featured checkbox');
  await page.keyboard.press('Space');
  await tabTo(page, (f) => f.id === 'down-3', 'move down button');
  await page.keyboard.press('Enter');
  const afterMove = await focusInfo(page);
  const arranged = await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('n350-arrangement'));
    return s.excluded['2'] === true && s.featured === 3;
  });
  await tabTo(page, (f) => f.text === 'Next: Final check', 'next to final check');
  await page.keyboard.press('Enter');
  await waitStep(page, 3);
  await tabTo(page, (f) => f.tag === 'SUMMARY' && f.shadow, 'first tile in final preview');
  await page.keyboard.press('Enter');
  const tileOpen = await page.evaluate(() => document.querySelector('#preview-final').shadowRoot.querySelector('details').open);
  await tabTo(page, (f) => f.text === 'Next: Publish and share', 'next to publish');
  await page.keyboard.press('Enter');
  await waitStep(page, 4);
  await tabTo(page, (f) => f.id === 'publish-btn', 'publish button');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#confirm-dialog[open]');
  const dialogFocus = await focusInfo(page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.getElementById('publish-result').hidden);
  await tabTo(page, (f) => f.id === 'png-btn', 'png button');
  await page.keyboard.press('Enter');
  const png = await waitForFile(dl, /\.png$/, 40000);
  await tabTo(page, (f) => f.id === 'email-btn', 'email button');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Copied/.test(document.getElementById('email-status').textContent), { timeout: 10000 });
  await tabTo(page, (f) => f.id === 'html-btn', 'html button');
  await page.keyboard.press('Enter');
  const html = await waitForFile(dl, /\.html$/);
  const done = arranged && tileOpen && dialogFocus.id === 'confirm-yes' && png && html && afterMove.id && afterMove.id.includes('-3');
  record(5, 'Keyboard only: all four steps, focus always visible', done && focusProblems.length === 0,
    (done ? 'completed load → arrange → check → publish/png/email/html with Tab/Enter/Space' : `incomplete (arranged ${arranged}, tileOpen ${tileOpen}, dialog ${dialogFocus.id}, png ${!!png}, html ${!!html}, focus after move ${afterMove.id})`) +
    (focusProblems.length ? '; focus not visible on: ' + focusProblems.slice(0, 6).join(' | ') : '; focus ring visible on every stop'));
  await page.browserContext().close();
} catch (e) {
  record(5, 'Keyboard only: all four steps, focus always visible', false, String(e) + (focusProblems.length ? '; ' + focusProblems.slice(0, 5).join(' | ') : ''));
}

// ============================================================== CHECK 7
// UTM rules are covered by tests/utm.test.js; also check what the page shows.
try {
  const text = fs.readFileSync(path.join(out, 'email-text.txt'), 'utf8');
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const bad = urls.filter((u) => {
    const p = new URL(u).searchParams;
    return p.get('utm_source') !== 'everyaction' || p.get('utm_medium') !== 'email' || p.get('utm_campaign') !== '2026-12' ||
      !/^[a-z0-9-]+-row-\d+$/.test(p.get('utm_content') || '');
  });
  record(7, 'Email text UTM links follow the rules', urls.length >= 7 && bad.length === 0,
    `${urls.length} links checked on the page` + (bad.length ? '; bad: ' + bad.join(' ') : '; also covered by tests/utm.test.js'));
} catch (e) {
  record(7, 'Email text UTM links follow the rules', false, String(e));
}

// ======================================================== CHECKS 8 + 9
try {
  const dl = path.join(out, 'downloads-real');
  let mode = 'ok';
  const itemsReply = JSON.parse(JSON.stringify(sample));
  itemsReply.issue.title = 'December 2026';
  itemsReply.items[0].email = 'team.lead@example.org';
  itemsReply.items[1].blurb += ' Questions? Write to organizer@example.org.';
  const page = await newPage({
    downloads: dl,
    mock: (body) => {
      if (mode === 'offline') return 'abort';
      if (body.action === 'items') {
        if (mode === 'items-500') return { status: 500, contentType: 'text/html', body: '<h1>Error</h1>' };
        return { body: JSON.stringify(itemsReply) };
      }
      if (body.action === 'publish') {
        if (mode === 'publish-500') return { status: 500, contentType: 'text/html', body: '<h1>Server error</h1>' };
        if (mode === 'publish-html') return { status: 200, contentType: 'text/html', body: '<!doctype html><title>Sign in</title>' };
        if (mode === 'publish-fail') return { body: JSON.stringify({ ok: false, error: 'WordPress rejected the post.' }) };
        return { body: JSON.stringify({ ok: true, url: 'https://350seattle.org/newsletter/2026-12/', postId: 123 }) };
      }
      return { body: JSON.stringify({ ok: false, error: 'unknown' }) };
    }
  });
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'networkidle0' });
  await page.type('#token', TOKEN);
  await page.keyboard.press('Enter');
  await waitStep(page, 2);
  const emailWarnings = await page.$$eval('#messages .nb-msg--warning', (m) => m.map((x) => x.textContent));
  const emailLeak = await page.evaluate(() => /team\.lead@|organizer@/.test(document.documentElement.outerHTML + sessionStorage.getItem('n350-arrangement')));

  // arrange something distinctive
  await page.click('#down-0');
  await page.click('#feat-5');
  await page.click('#inc-6');
  const arrangement = await page.evaluate(() => sessionStorage.getItem('n350-arrangement'));
  const orderOf = () => page.$$eval('#arrange-list .nb-item-headline', (e) => e.map((x) => x.textContent).join('|'));
  const order0 = await orderOf();

  const scenarios = [];
  async function tryPublish(m, expect) {
    mode = m;
    await page.click('.nb-step[data-step="4"]').catch(() => {});
    if (!(await page.$eval('#step-4', (s) => !s.hidden))) {
      await page.click('.nb-step[data-step="3"]');
      await waitStep(page, 3);
      await page.click('#step-3 [data-goto="4"]');
    }
    await waitStep(page, 4);
    await page.click('#publish-btn');
    await page.waitForSelector('#confirm-dialog[open]');
    await page.click('#confirm-yes');
    await page.waitForFunction(() => document.querySelector('#messages .nb-msg--error'), { timeout: 10000 });
    const msg = await page.$eval('#messages .nb-msg--error', (e) => e.textContent);
    const same = (await page.evaluate(() => sessionStorage.getItem('n350-arrangement'))) === arrangement;
    await page.click('.nb-step[data-step="2"]');
    await waitStep(page, 2);
    const sameOrder = (await orderOf()) === order0;
    scenarios.push({ m, ok: expect.test(msg) && same && sameOrder, msg: msg.replace('Dismiss', '').trim() });
  }
  await tryPublish('publish-500', /error 500/);
  await tryPublish('publish-html', /something unexpected/);
  await tryPublish('publish-fail', /WordPress rejected the post/);
  await page.setOfflineMode(true);
  await tryPublish('offline', /offline|couldn't reach/i);
  // reloading the blurbs while offline also keeps everything
  await page.click('.nb-step[data-step="1"]');
  await waitStep(page, 1);
  await page.click('#load-btn');
  await page.waitForFunction(() => document.querySelector('#messages .nb-msg--error'), { timeout: 10000 });
  const offlineLoadMsg = await page.$eval('#messages .nb-msg--error', (e) => e.textContent);
  const sameAfterLoad = (await page.evaluate(() => sessionStorage.getItem('n350-arrangement'))) === arrangement;
  scenarios.push({ m: 'offline load', ok: /offline/i.test(offlineLoadMsg) && sameAfterLoad, msg: offlineLoadMsg.replace('Dismiss', '').trim() });
  await page.setOfflineMode(false);
  mode = 'items-500';
  await page.click('#load-btn');
  await page.waitForFunction(() => /error 500/.test(document.querySelector('#messages').textContent), { timeout: 10000 });
  scenarios.push({ m: 'load 500', ok: (await page.evaluate(() => sessionStorage.getItem('n350-arrangement'))) === arrangement, msg: 'error 500 on load' });

  const failed9 = scenarios.filter((s) => !s.ok);
  record(9, 'Server error or offline: plain message, arrangement kept', failed9.length === 0,
    scenarios.map((s) => `${s.m} → "${s.msg.slice(0, 70)}…"`).join(' | '));

  // successful publish, then look for the token everywhere
  mode = 'ok';
  await page.click('.nb-step[data-step="4"]');
  await waitStep(page, 4);
  await page.click('#publish-btn');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('#confirm-yes');
  await page.waitForFunction(() => !document.getElementById('publish-result').hidden, { timeout: 10000 });
  const publishedUrl = await page.$eval('#published-url', (e) => e.value);
  await page.click('#html-btn');
  const html = await waitForFile(dl, /\.html$/);
  const where = await page.evaluate(() => {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const ss = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); }
    const inputs = Array.from(document.querySelectorAll('input, textarea')).map((i) => i.value).join('\n');
    return { url: location.href, localStorage: JSON.stringify(ls), sessionStorage: JSON.stringify(ss), cookie: document.cookie,
      dom: document.documentElement.outerHTML, inputs, history: history.length };
  });
  const leaks = [];
  if (page.url().includes(TOKEN) || where.url.includes(TOKEN)) leaks.push('URL');
  if (where.localStorage.includes(TOKEN)) leaks.push('localStorage');
  if (where.sessionStorage.includes(TOKEN)) leaks.push('sessionStorage');
  if (where.cookie.includes(TOKEN)) leaks.push('cookie');
  if (where.dom.includes(TOKEN) || where.inputs.includes(TOKEN)) leaks.push('page');
  if (page.consoleLog.join('\n').includes(TOKEN)) leaks.push('console');
  if (html && fs.readFileSync(html, 'utf8').includes(TOKEN)) leaks.push('downloaded HTML');
  const sentInBody = page.requests.every((r) => r.method === 'POST' && JSON.parse(r.body).token === TOKEN && !r.url.includes(TOKEN));
  const plain = page.requests.every((r) => /^text\/plain/.test(r.headers['content-type'] || ''));
  // after a refresh the token is gone but the arrangement stays
  await page.reload({ waitUntil: 'networkidle0' });
  await waitStep(page, 4);
  const afterRefresh = await page.evaluate(() => ({
    tokenFieldShown: !document.getElementById('publish-token-wrap').hidden,
    kept: !!sessionStorage.getItem('n350-arrangement')
  }));
  record(8, 'Token never in URL, localStorage or console', leaks.length === 0 && sentInBody && plain && afterRefresh.tokenFieldShown && afterRefresh.kept,
    (leaks.length ? 'LEAKED to: ' + leaks.join(', ') : 'not found in URL, localStorage, sessionStorage, cookies, page, console or downloads') +
    `; ${page.requests.length} requests sent it only in a text/plain POST body` +
    `; after refresh token gone (asks again: ${afterRefresh.tokenFieldShown}), arrangement kept (${afterRefresh.kept})` +
    `; published URL ${publishedUrl}` +
    `; email handling: ${emailWarnings.length} warnings shown, address leaked: ${emailLeak}`);
  await page.browserContext().close();
} catch (e) {
  record(8, 'Token never in URL, localStorage or console', false, String(e && e.stack || e));
  if (!results.find((r) => r.n === 9)) record(9, 'Server error or offline: plain message, arrangement kept', false, 'not run');
}

// ============================================================= CHECK 10
try {
  const flags = { onlyCategories: ['accessibility'], output: 'json', logLevel: 'error' };
  const config = { extends: 'lighthouse:default', settings: { onlyCategories: ['accessibility'] } };
  const page = await newPage({ width: 1280 });
  await page.goto(ORIGIN + '/index.html?demo=1', { waitUntil: 'networkidle0' });
  await waitStep(page, 2);
  await page.click('.nb-step[data-step="3"]');
  await waitStep(page, 3);
  const snap = await snapshot(page, { config, flags });
  const snapScore = Math.round(snap.lhr.categories.accessibility.score * 100);
  const snapFails = Object.values(snap.lhr.audits).filter((a) => a.score === 0 && a.scoreDisplayMode === 'binary').map((a) => a.id);
  fs.writeFileSync(path.join(out, 'lighthouse-step3.json'), JSON.stringify(snap.lhr, null, 1));
  await page.browserContext().close();

  const page2 = await newPage({ width: 1280 });
  const nav = await navigation(page2, ORIGIN + '/__e2e/board-page.html', { config, flags });
  const navScore = Math.round(nav.lhr.categories.accessibility.score * 100);
  const navFails = Object.values(nav.lhr.audits).filter((a) => a.score === 0 && a.scoreDisplayMode === 'binary').map((a) => a.id);
  fs.writeFileSync(path.join(out, 'lighthouse-board.json'), JSON.stringify(nav.lhr, null, 1));
  await page2.browserContext().close();
  record(10, 'Lighthouse accessibility ≥ 95 on the preview', snapScore >= 95 && navScore >= 95,
    `final-check preview page ${snapScore}${snapFails.length ? ' (failing: ' + snapFails.join(', ') + ')' : ''}; published board ${navScore}${navFails.length ? ' (failing: ' + navFails.join(', ') + ')' : ''}`);
} catch (e) {
  record(10, 'Lighthouse accessibility ≥ 95 on the preview', false, String(e && e.stack || e));
}

await browser.close();
server.close();
results.sort((a, b) => a.n - b.n);
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
process.stdout.write(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed\n`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
