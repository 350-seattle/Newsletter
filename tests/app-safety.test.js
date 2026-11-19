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

test('the sign-in is never put in storage, the URL or the page', () => {
  const lines = app.split('\n');
  lines.forEach((line, i) => {
    if (/sessionStorage\.setItem|history\.(push|replace)State|location\.(href|search)\s*=|\.innerHTML\s*=|textContent\s*=|setAttribute\(/.test(line)) {
      assert.ok(!/idToken|credential\.id/.test(line), 'line ' + (i + 1) + ' mixes the sign-in into storage/URL/DOM: ' + line.trim());
    }
  });
  // The saved state object has no sign-in field.
  const emptyState = app.slice(app.indexOf('function emptyState'), app.indexOf('// Small helpers'));
  assert.ok(!/token|credential/i.test(emptyState));
  // The credential is a plain in-memory variable.
  assert.match(app, /var credential = null;/);
});

test('there is no token form that could leak into a URL', () => {
  assert.ok(!/<form id="load-form"/.test(index));
  assert.ok(!/type="password"/.test(index));
});

test('requests use text/plain and send the sign-in in the body', () => {
  assert.match(app, /'Content-Type': 'text\/plain'/);
  assert.match(app, /action: 'items', idToken: credential\.idToken/);
  assert.match(app, /action: 'publish',\s*idToken: credential\.idToken/);
  assert.ok(!/\btoken: /.test(app), 'old token field is gone');
});

test('sign-in uses Google OpenID with state, nonce and the 350 domain, and no Google script', () => {
  assert.match(app, /response_type', 'id_token'/);
  assert.match(app, /q\.set\('state'/);
  assert.match(app, /q\.set\('nonce'/);
  assert.match(app, /q\.set\('hd', emailDomain\(\)\)/);
  assert.match(app, /claims\.nonce !== pendingSignIn\.nonce/);
  assert.match(app, /claims\.aud !== /);
  assert.match(app, /event\.origin === window\.location\.origin/);
  assert.ok(!/accounts\.google\.com\/gsi/.test(index + app), 'no Google Identity Services script');
  const cb = read('auth-callback.js');
  assert.match(cb, /history\.replaceState\(null, '', window\.location\.pathname\)/, 'callback wipes its own URL');
  assert.match(cb, /postMessage\(msg, window\.location\.origin\)/, 'callback only talks to this site');
  assert.ok(!/console|localStorage|sessionStorage|cookie/.test(cb));
});

test('no remote scripts, stylesheets or AI services', () => {
  assert.ok(!/<script[^>]+src="https?:/i.test(index), 'no CDN scripts');
  assert.ok(!/<link[^>]+href="https?:/i.test(index), 'no CDN stylesheets');
  for (const src of [app, render, index]) {
    assert.ok(!/openai|anthropic|claude|gemini|generativelanguage/i.test(src), 'no AI calls');
  }
});
