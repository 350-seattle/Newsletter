// Acceptance check 7: every UTM link in the email text (and on the
// board) follows the tagging rules.
//   node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const N350 = require('../render-board.js');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sample-data.json'), 'utf8'));
const issue = N350.sanitizeIssue(sample.issue).issue;
const items = N350.sanitizeItems(sample.items).items;
const extra = [
  { id: 'q-1', team: 'Fossil Free Finance', category: 'Take action', headline: 'Has query + hash', summary: 's', blurb: 'b',
    link: 'https://example.org/page?a=1&b=two%20words&utm_source=old#section-2' },
  { id: 'row 9/x', team: 'Café & Co!', category: 'Events', headline: 'Odd id and team', summary: 's', blurb: 'b',
    link: 'https://example.org/x?q=a+b' }
];
const all = items.concat(N350.sanitizeItems(extra).items);
// Published boards are WordPress posts, with the date in the address.
const BOARD = 'https://350seattle.org/2026/12/06/dec-26-newsletter/';

function params(url) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function originalQuery(link) {
  return new URL(link).search.replace(/^\?/, '').split('&').filter((p) => p && !p.startsWith('utm_'));
}

function expectTagged(url, link, expected) {
  const u = new URL(url);
  const src = new URL(link);
  assert.equal(u.origin + u.pathname, src.origin + src.pathname, 'same page');
  assert.equal(u.hash, src.hash, 'hash kept');
  const p = params(url);
  for (const [k, v] of Object.entries(expected)) assert.equal(p[k], v, k + ' in ' + url);
  // Original query pairs survive byte-for-byte, in order, before the UTM tags.
  const rawPairs = u.search.replace(/^\?/, '').split('&');
  const kept = originalQuery(link);
  assert.deepEqual(rawPairs.slice(0, kept.length), kept, 'existing query kept as-is');
  assert.equal(rawPairs.filter((x) => x.startsWith('utm_')).length, 4, 'exactly four utm tags');
}

test('team slugs', () => {
  assert.equal(N350.slugify('Climate Justice'), 'climate-justice');
  assert.equal(N350.slugify('Café & Co!'), 'cafe-co');
  assert.equal(N350.slugify('  Civic Action Team (CAT) '), 'civic-action-team-cat');
});

test('email "Read more" links follow the rules', () => {
  const email = N350.buildEmail(issue, all, BOARD);
  assert.equal(email.links.length, all.length);
  email.links.forEach((l) => {
    const item = all.find((i) => i.id === l.id);
    expectTagged(l.url, item.link, {
      utm_source: 'everyaction',
      utm_medium: 'email',
      utm_campaign: 'dec-26-newsletter',
      utm_content: N350.slugify(item.team) + '-' + item.id
    });
  });
});

test('every URL visible in the email text and HTML is a tagged link', () => {
  const email = N350.buildEmail(issue, all, BOARD);
  const textUrls = email.text.match(/https?:\/\/\S+/g);
  assert.deepEqual(textUrls, email.links.map((l) => l.url), 'plain text shows the full tagged URLs');
  const htmlHrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.deepEqual(htmlHrefs, email.links.map((l) => l.url));
  assert.equal((email.html.match(/>Read more</g) || []).length, all.length);
  assert.ok(!/utm_source=website/.test(email.text + email.html), 'no board tags in the email');
});

test('email is grouped by category with a heading for each', () => {
  const email = N350.buildEmail(issue, items, BOARD);
  const cats = [...new Set(items.map((i) => i.category))];
  cats.forEach((c) => {
    assert.ok(email.text.includes(c.toUpperCase()), 'text heading ' + c);
    assert.ok(email.html.includes('>' + N350.escapeHtml(c) + '</h3>'), 'html heading ' + c);
  });
  items.forEach((i) => {
    assert.ok(email.text.includes(i.headline));
    assert.ok(email.text.includes(i.summary));
  });
});

test('preview image link follows the rules', () => {
  const email = N350.buildEmail(issue, items, BOARD);
  assert.equal(email.previewUrl,
    'https://350seattle.org/2026/12/06/dec-26-newsletter/?utm_source=everyaction&utm_medium=email&utm_campaign=dec-26-newsletter&utm_content=preview-image');
  const withQuery = N350.previewImageLink(issue, 'https://example.org/?p=123');
  assert.equal(withQuery, 'https://example.org/?p=123&utm_source=everyaction&utm_medium=email&utm_campaign=dec-26-newsletter&utm_content=preview-image');
});

test('links inside the board follow the rules', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board.css'), 'utf8');
  const { html } = N350.render(issue, all, { css });
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(hrefs.length, all.length);
  const ordered = N350.boardOrder(all);
  hrefs.forEach((href, i) => {
    const item = ordered[i];
    expectTagged(href, item.link, {
      utm_source: 'website',
      utm_medium: 'newsletter-board',
      utm_campaign: 'dec-26-newsletter',
      utm_content: N350.slugify(item.team) + '-' + item.id
    });
  });
  const links = N350.boardLinks(issue, all);
  assert.deepEqual(links.map((l) => l.url), hrefs);
});

test('existing query string and hash are kept exactly', () => {
  const out = N350.tagUrl('https://example.org/page?a=1&b=two%20words&utm_source=old#section-2', {
    utm_source: 'everyaction', utm_medium: 'email', utm_campaign: 'c', utm_content: 'x'
  });
  assert.equal(out, 'https://example.org/page?a=1&b=two%20words&utm_source=everyaction&utm_medium=email&utm_campaign=c&utm_content=x#section-2');
  assert.equal(N350.tagUrl('javascript:alert(1)', { a: 'b' }), null);
});

test('weekly summary sits at the top of the email and adds no links', () => {
  const withRecap = Object.assign({}, issue, { weekSummary: 'Lots happening.\n\nSee you there.' });
  const email = N350.buildEmail(withRecap, items, BOARD);
  assert.ok(email.text.startsWith('IN SUMMARY…\n\nLots happening.\n\nSee you there.\n\n'));
  assert.ok(email.html.startsWith('<h3'));
  assert.ok(email.html.indexOf('Lots happening.') < email.html.indexOf(N350.escapeHtml(items[0].category)));
  assert.equal(email.links.length, items.length, 'no extra links');
  assert.deepEqual(email.text.match(/https?:\/\/\S+/g), email.links.map((l) => l.url));
});

test('before publishing there is no board link: nothing is guessed', () => {
  const email = N350.buildEmail(issue, items, null);
  assert.equal(email.previewUrl, null);
  const boardish = /350seattle\.org\/(newsletter|\d{4}\/)|utm_content=preview-image/;
  assert.ok(!boardish.test(email.text), 'no board link in the email text');
  assert.ok(!boardish.test(email.html), 'no board link in the email HTML');
  assert.equal(issue.slug, 'dec-26-newsletter', 'sample slug follows the month-year-newsletter style');
});

test('whole EveryAction email: image, item and button links follow the rules', () => {
  const withRecap = Object.assign({}, issue, { weekSummary: 'Lots happening this week. See you there.' });
  const r = N350.buildEmailHtml(withRecap, all, { boardUrl: BOARD, imageUrl: 'https://example.org/uploads/board.png' });
  assert.deepEqual(r.missing, []);
  const tags = (content) => ({ utm_source: 'everyaction', utm_medium: 'email', utm_campaign: 'dec-26-newsletter', utm_content: content });
  expectTagged(r.links.image, BOARD, tags('preview-image'));
  expectTagged(r.links.button, BOARD, tags('newsletter-button'));
  assert.deepEqual(r.links.items, N350.buildEmail(withRecap, all, BOARD).links.map((l) => ({ id: l.id, url: l.url })),
    'the same "Read more" links as the email text');
  // Every link in the email is one of those, and nothing else.
  const hrefs = [...r.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const allowed = new Set([r.links.image, r.links.button].concat(r.links.items.map((l) => l.url)));
  assert.equal(hrefs.length, 2 + all.length);
  hrefs.forEach((h) => assert.ok(allowed.has(h), 'unexpected link ' + h));
  // The image is the link to the board; the button is last.
  assert.match(r.html, /<a href="[^"]*utm_content=preview-image" target="_blank"[^>]*><img src="https:\/\/example\.org\/uploads\/board\.png"/);
  assert.ok(r.html.lastIndexOf('newsletter-button') > r.html.lastIndexOf('Read more'));
});

test('whole EveryAction email: nothing is made up before publishing or without an image', () => {
  const before = N350.buildEmailHtml(issue, items, { boardUrl: null, imageUrl: 'https://example.org/b.png' });
  assert.deepEqual(before.missing, ['boardUrl']);
  assert.equal(before.links.image, null);
  assert.equal(before.links.button, null);
  assert.ok(!/350seattle\.org\/(newsletter|\d{4}\/)|preview-image|newsletter-button/.test(before.html));
  for (const bad of ['', 'http://example.org/b.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://example.org/a@b.org.png?x=jane@example.org']) {
    const r = N350.buildEmailHtml(issue, items, { boardUrl: BOARD, imageUrl: bad });
    assert.deepEqual(r.missing, ['imageUrl'], bad);
    assert.ok(!/<img /.test(r.html), 'no image tag for ' + bad);
  }
});
