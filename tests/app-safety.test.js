// Static checks on the builder code (part of acceptance check 8 and the
// "no AI, no CDN" constraints). The browser test in tests/e2e checks the
// running page.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const app = read('app.js');
const render = read('render-board.js');
const index = read('index.html');

test('no console output in the builder code', () => {
  for (const [name, src] of [['app.js', app], ['render-board.js', render]]) {
    assert.ok(!/\bconsole\s*\./.test(src), name + ' uses console');
  }
});

test('nothing is written to localStorage or cookies', () => {
  assert.ok(!/localStorage/.test(app), 'app.js must not use localStorage');
  assert.ok(!/document\.cookie/.test(app), 'app.js must not use cookies');
});

test('the token is never put in storage, the URL or the page', () => {
  const lines = app.split('\n');
  lines.forEach((line, i) => {
    if (/sessionStorage\.setItem|history\.(push|replace)State|location\.(href|search)\s*=|\.innerHTML\s*=|textContent\s*=|setAttribute\(/.test(line)) {
      assert.ok(!/\btoken\b/.test(line), 'line ' + (i + 1) + ' mixes the token into storage/URL/DOM: ' + line.trim());
    }
  });
  // The saved state object has no token field.
  const emptyState = app.slice(app.indexOf('function emptyState'), app.indexOf('// Small helpers'));
  assert.ok(!/token/i.test(emptyState));
});

test('the load form cannot leak the token into the URL', () => {
  assert.match(index, /<form id="load-form"[^>]*method="post"/);
});

test('requests use text/plain and send the token in the body', () => {
  assert.match(app, /'Content-Type': 'text\/plain'/);
  assert.match(app, /action: 'items', token: token/);
  assert.match(app, /action: 'publish',\s*token: token/);
});

test('no remote scripts, stylesheets or AI services', () => {
  assert.ok(!/<script[^>]+src="https?:/i.test(index), 'no CDN scripts');
  assert.ok(!/<link[^>]+href="https?:/i.test(index), 'no CDN stylesheets');
  for (const src of [app, render, index]) {
    assert.ok(!/openai|anthropic|claude|gemini|generativelanguage/i.test(src), 'no AI calls');
  }
});
