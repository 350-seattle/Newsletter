// Acceptance check 2: the board fragment has no scripts, no event
// handlers, no javascript: URLs and no email addresses. Plus escaping,
// link safety and CSS scoping.
//   node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const N350 = require('../render-board.js');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles', 'board.css'), 'utf8');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'sample-data.json'), 'utf8'));
const OPTS = { css, fontBaseUrl: 'https://fonts.example.org/fonts/', assetBaseUrl: 'https://builder.example.org/' };

// Hostile data: every trick we could think of.
const hostileRaw = [
  {
    id: 'x1', team: '<script>alert(1)</script>', category: 'Take action',
    headline: '<img src=x onerror=alert(1)>Headline', summary: 'Write to jane.doe@example.org today',
    blurb: 'Para one "quoted" & <b>bold</b>\n\nContact: bob@example.com or <a href="javascript:alert(1)">click</a>',
    link: 'javascript:alert(1)', linkLabel: '" onmouseover="alert(1)', image: 'javascript:alert(2)', imageAlt: '"><script>x</script>',
    email: 'lead@example.org', contactEmail: 'someone@example.org'
  },
  {
    id: 'x2', team: 'Team', category: 'Events', headline: 'Data URL', summary: 's',
    blurb: 'b', link: 'data:text/html,<script>alert(1)</script>', image: 'data:image/svg+xml,<svg onload=alert(1)>'
  },
  {
    id: 'x3', team: 'Team', category: 'Events', headline: 'Mailto link', summary: 's', blurb: 'b',
    link: 'mailto:organizer@example.org', image: 'https://example.org/photo@2x.png', imageAlt: '"><script>x</script>'
  },
  {
    id: 'x4', team: 'Team', category: 'Events', headline: 'Email in URL', summary: 's', blurb: 'b',
    link: 'https://example.org/form?who=someone%40example.org', image: 'samples/bus.svg', imageAlt: 'Bus'
  },
  { id: 'x5', team: 'Team', category: 'Events', headline: 'VBScript', summary: 's', blurb: 'b', link: ' JaVaScRiPt:alert(1)' },
  { id: 'x6', team: 'Team', category: 'Events', headline: 'Normal', summary: 's', blurb: 'Say "javascript:" out loud',
    link: 'https://example.org/ok', linkLabel: '<b>Go</b>', image: 'http://example.org/old.jpg', imageAlt: 'ok' }
];

function renderAll(raw) {
  const issue = N350.sanitizeIssue({ title: 'Test issue', slug: 'test', date: '2026-12-01' }).issue;
  const clean = N350.sanitizeItems(raw);
  const items = clean.items.map((it, i) => Object.assign({}, it, { featured: i === 0 }));
  return { out: N350.render(issue, items, OPTS), warnings: clean.warnings, items };
}

function assertSafeFragment(fragment) {
  const lower = fragment.toLowerCase();
  assert.ok(!/<script/i.test(fragment), 'no <script> tags');
  assert.ok(!/<\/?(iframe|object|embed|form|input|button|meta|link|base)\b/i.test(fragment), 'no other active elements');
  // Any attribute whose name starts with "on", e.g. onerror= / onclick=
  assert.ok(!/<[^>]*\son[a-z]+\s*=/i.test(fragment), 'no on* attributes');
  assert.ok(!lower.includes('javascript:'), 'no javascript: URLs');
  assert.ok(!lower.includes('vbscript:'), 'no vbscript: URLs');
  assert.ok(!/(href|src)\s*=\s*"\s*data:/i.test(fragment), 'no data: URLs in links or images');
  const emails = fragment.match(/[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi) || [];
  assert.deepEqual(emails.filter((e) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(e)), [], 'no email addresses');
  assert.ok(!/%40[a-z0-9-]+\.[a-z]{2,}/i.test(fragment), 'no URL-encoded email addresses');
}

test('sample data board fragment is safe', () => {
  const issue = N350.sanitizeIssue(sample.issue).issue;
  const items = N350.sanitizeItems(sample.items).items;
  const { fragment } = N350.render(issue, items, OPTS);
  assertSafeFragment(fragment);
});

test('hostile data board fragment is safe', () => {
  const { out } = renderAll(hostileRaw);
  assertSafeFragment(out.fragment);
  assertSafeFragment(out.html);
});

test('fragment is one <style> block followed by the board div, no page wrapper', () => {
  const { out } = renderAll(hostileRaw);
  assert.match(out.fragment, /^<style>\n[\s\S]*<\/style>\n<div class="n350-board"/);
  assert.equal((out.fragment.match(/<style/g) || []).length, 1, 'exactly one <style>');
  assert.ok(!/<(html|head|body)\b/i.test(out.fragment), 'no html/head/body');
  assert.ok(out.fragment.trim().endsWith('</div>'));
});

test('email addresses are removed and reported', () => {
  const { warnings, items } = renderAll(hostileRaw);
  const json = JSON.stringify(items);
  assert.ok(!json.includes('jane.doe@example.org'));
  assert.ok(!json.includes('bob@example.com'));
  assert.ok(!json.includes('lead@example.org'), 'unknown email field dropped');
  assert.ok(!json.includes('someone@example.org'));
  assert.ok(!('email' in items[0]) && !('contactEmail' in items[0]));
  assert.equal(items[2].link, '', 'mailto link removed');
  assert.equal(items[3].link, '', 'link containing an encoded email removed');
  assert.equal(items[2].image, 'https://example.org/photo@2x.png', 'file names with @ are not emails');
  const fields = warnings.map((w) => w.id + ':' + w.field);
  for (const f of ['x1:summary', 'x1:blurb', 'x1:email', 'x1:contactEmail', 'x3:link', 'x4:link']) {
    assert.ok(fields.includes(f), 'warning for ' + f);
  }
  assert.ok(!JSON.stringify(warnings).match(/@example\.(org|com)/), 'warnings never repeat the address');
});

test('text is escaped, not interpreted', () => {
  const { out } = renderAll(hostileRaw);
  assert.ok(out.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(out.html.includes('&lt;img src=x onerror=alert(1)&gt;Headline'));
  assert.ok(out.html.includes('&quot;quoted&quot; &amp; &lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(out.html.includes('alt="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
});

test('only http(s) links and images are rendered; external links are safe', () => {
  const { out } = renderAll(hostileRaw);
  const hrefs = [...out.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  const srcs = [...out.html.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);
  for (const u of hrefs.concat(srcs)) assert.match(u, /^https?:\/\//, u);
  const anchors = out.html.match(/<a\b[^>]*>/g) || [];
  assert.ok(anchors.length > 0);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
  assert.ok(srcs.includes('https://builder.example.org/samples/bus.svg'), 'relative sample images become absolute');
});

test('tiles use <details>/<summary> with the required content', () => {
  const issue = N350.sanitizeIssue(sample.issue).issue;
  const items = N350.sanitizeItems(sample.items).items;
  const { html } = N350.render(issue, items, OPTS);
  const tiles = html.match(/<li class="n350-tile[\s\S]*?<\/li>/g);
  assert.equal(tiles.length, items.length);
  tiles.forEach((tile) => {
    assert.match(tile, /<details class="n350-details"><summary class="n350-summary">[\s\S]*<\/summary>/);
    assert.match(tile, /class="n350-team"/);
    assert.match(tile, /class="n350-category"/);
    assert.match(tile, /class="n350-headline"/);
    assert.match(tile, /<div class="n350-body"><p>/);
    assert.match(tile, /class="n350-button"/);
  });
  assert.equal((html.match(/n350-tile--text/g) || []).length, 1, 'one tile without an image');
  assert.ok(html.includes('December 1st, 2026'));
});

test('featured item comes first', () => {
  const issue = { title: 'T', slug: 't', date: '2026-12-01' };
  const items = N350.sanitizeItems(sample.items).items;
  items[5].featured = true;
  const { html } = N350.render(issue, items, OPTS);
  const first = html.match(/<li class="([^"]*)"[\s\S]*?n350-headline">([^<]*)/);
  assert.match(first[1], /n350-tile--featured/);
  assert.equal(first[2], N350.escapeHtml(items[5].headline));
});

// Minimal CSS walker: yields every selector list, descending into
// @media / @container / @supports blocks.
function selectors(cssText) {
  const out = [];
  const src = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  function walk(s) {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open === -1) break;
      const prelude = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (/^@(media|container|supports)/.test(prelude)) walk(body);
      else if (/^@font-face/.test(prelude)) { /* not a selector */ }
      else out.push(prelude);
      i = j;
    }
  }
  walk(src);
  return out;
}

test('every CSS selector is scoped to .n350-board', () => {
  const processed = N350.processCss(css, { realFonts: { newKansas: true, avantGarde: true } });
  const list = selectors(processed);
  assert.ok(list.length > 30);
  for (const sel of list) {
    for (const part of sel.split(',')) {
      assert.match(part.trim(), /^\.n350-board(?![\w-])/, 'unscoped selector: ' + part.trim());
    }
  }
});

test('CSS brand variables sit at the top of board.css', () => {
  const firstRule = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  assert.match(firstRule, /^\.n350-board \{\s*--n350-clean-air: #0081CC;/);
  for (const v of ['--n350-no-more-coal: #000000', '--n350-clean-ocean: #4254B0', '--n350-foggy-seattle: #E8E6E0', '--n350-lichen: #D6E4DA', '--n350-font-header', '--n350-font-accent', '--n350-font-body']) {
    assert.ok(css.includes(v), v);
  }
});

test('font URLs point at FONT_BASE_URL and optional fonts are off by default', () => {
  const p = N350.processCss(css, { fontBaseUrl: 'https://fonts.example.org/fonts/' });
  assert.ok(p.includes('url("https://fonts.example.org/fonts/cal-sans-latin-400-normal.woff2")'));
  assert.ok(!p.includes('../fonts/'));
  assert.ok(!p.includes('new-kansas'), 'New Kansas block removed when off');
  const on = N350.processCss(css, { fontBaseUrl: 'https://f.example/', realFonts: { newKansas: true } });
  assert.ok(on.includes('https://f.example/new-kansas-extraswash.woff2'));
});

test('validate: errors and warnings', () => {
  const base = { id: 'a', team: 'T', category: 'C', headline: 'H', summary: 'S', blurb: 'B', link: 'https://e.org', image: 'https://e.org/i.jpg', imageAlt: 'alt' };
  const v = N350.validate({ slug: 's' }, [
    Object.assign({}, base),
    Object.assign({}, base, { headline: '', link: 'http://e.org' }),
    Object.assign({}, base, { id: 'c', summary: 'x'.repeat(161), blurb: Array(151).fill('w').join(' '), image: '', imageAlt: '' }),
    Object.assign({}, base, { id: 'd', imageAlt: '', summary: '', link: '' })
  ]);
  const errs = v.errors.map((e) => e.message).join('\n');
  assert.match(errs, /share the id "a"/);
  assert.match(errs, /no headline/);
  assert.match(errs, /not a secure web address/);
  assert.match(errs, /no one-sentence summary/);
  assert.match(errs, /no link/);
  const warns = v.warnings.map((w) => w.message).join('\n');
  assert.match(warns, /161 characters/);
  assert.match(warns, /151 words/);
  assert.match(warns, /no image/);
  assert.match(warns, /no alt text/);
  const few = N350.validate({}, [base]);
  assert.match(few.warnings.map((w) => w.message).join(), /Only 1 item is included/);
});
