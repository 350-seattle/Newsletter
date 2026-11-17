#!/usr/bin/env node
/*
 * Writes dist/board.css (for WordPress "Additional CSS") and
 * dist/sample-board.html (the sample issue's published fragment).
 *
 *   node tools/build-dist.js
 *
 * Font addresses come from FONT_BASE_URL in config.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const N350 = require('../render-board.js');

const root = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), sandbox);
const config = sandbox.window.N350_CONFIG || {};

const css = fs.readFileSync(path.join(root, 'styles', 'board.css'), 'utf8');
const opts = { css, fontBaseUrl: config.FONT_BASE_URL, realFonts: config.REAL_FONTS || {} };

const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'board.css'), N350.processCss(css, opts));

const sample = JSON.parse(fs.readFileSync(path.join(root, 'sample-data.json'), 'utf8'));
const issue = N350.sanitizeIssue(sample.issue).issue;
const items = N350.sanitizeItems(sample.items).items;
const pagesBase = String(config.FONT_BASE_URL || '').replace(/fonts\/?$/, '') || 'https://example.org/';
const out = N350.render(issue, items, Object.assign({ assetBaseUrl: pagesBase }, opts));
fs.writeFileSync(path.join(dist, 'sample-board.html'), out.fragment);

process.stdout.write('Wrote dist/board.css and dist/sample-board.html\n');
