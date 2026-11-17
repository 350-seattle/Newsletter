/*
 * Newsletter Builder: the page's behavior.
 *
 * Rules this file follows:
 * - The access token lives only in the `token` variable below. It is
 *   never written to the URL, storage, cookies, the page, or a log.
 * - The arrangement (items, order, choices) is kept in sessionStorage
 *   so a refresh doesn't lose it. Failures never clear it.
 * - Nothing is ever logged.
 */
(function () {
  'use strict';

  var CONFIG = window.N350_CONFIG || {};
  var N350 = window.N350;
  var STORE_KEY = 'n350-arrangement';
  var PNG_WIDTH = 600;
  var PNG_RATIO = 2;
  var PLACEHOLDER_IMG = 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="10"><rect width="8" height="10" fill="#4254B0"/></svg>');

  var token = '';          // memory only
  var boardCss = '';       // text of styles/board.css
  var state = emptyState();

  function emptyState() {
    return {
      version: 1,
      demo: false,
      issue: null,
      items: [],           // sanitized items, in the order they arrived
      categories: [],      // [{ name, keys: [item index, ...] }]
      excluded: {},        // { key: true } for left-out items
      featured: null,      // key of the featured item
      sourceWarnings: [],  // warnings from sanitizing (emails removed, etc.)
      step: 1,
      maxStep: 1,
      publishedUrl: null
    };
  }

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'className') node.className = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function hasData() {
    return !!state.issue && state.items.length > 0;
  }

  function localFontBase() {
    return new URL('fonts/', window.location.href).toString();
  }

  function publishFontBase() {
    var configured = String(CONFIG.FONT_BASE_URL || '').trim();
    return N350.isHttpUrl(configured) ? configured : localFontBase();
  }

  function boardUrl() {
    if (state.publishedUrl) return state.publishedUrl;
    var base = String(CONFIG.BOARD_BASE_URL || '').trim();
    if (!N350.isHttpUrl(base) || !state.issue) return null;
    if (!/\/$/.test(base)) base += '/';
    return base + encodeURIComponent(state.issue.slug) + '/';
  }

  // ------------------------------------------------------------------
  // Messages (plain English, never technical details or the token)
  // ------------------------------------------------------------------
  var MSG = {
    notConnected: 'This builder isn\'t connected to the newsletter sheet yet. Whoever set it up needs to add the Apps Script web app address (APPS_SCRIPT_URL) to config.js. Until then you can try the sample data.',
    offline: 'You appear to be offline. Check your internet connection, then try again. Your arrangement has been kept.',
    unreachable: 'We couldn\'t reach the newsletter sheet. Check your internet connection and try again. Your arrangement has been kept.',
    notJson: 'The newsletter sheet sent back something unexpected. This usually means the access token is wrong or has expired. Check it and try again. Your arrangement has been kept.',
    badShape: 'The newsletter sheet\'s reply was missing the information we need. Ask the person who looks after the Sheet to check it. Your arrangement has been kept.',
    noToken: 'Please paste the access token first.'
  };

  function UserError(message) { this.message = message; }

  function showMessage(kind, text, opts) {
    opts = opts || {};
    var box = $('#messages');
    if (opts.replace !== false) box.textContent = '';
    var msg = el('div', { className: 'nb-msg nb-msg--' + kind, role: kind === 'error' ? 'alert' : 'status' }, [
      el('p', { text: text }),
      el('button', { type: 'button', className: 'nb-msg-close', text: 'Dismiss' })
    ]);
    msg.querySelector('button').addEventListener('click', function () {
      msg.remove();
      var h = $('#step-' + state.step + '-title');
      if (h) h.focus();
    });
    box.appendChild(msg);
    return msg;
  }

  function clearMessages() {
    $('#messages').textContent = '';
  }

  // ------------------------------------------------------------------
  // Saving and restoring the arrangement (never the token)
  // ------------------------------------------------------------------
  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full or blocked: the tool still works, just no refresh safety */
    }
  }

  function restore() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.issue || !Array.isArray(s.items) || !Array.isArray(s.categories)) return null;
      // Re-sanitize in case the stored copy was tampered with.
      var items = N350.sanitizeItems(s.items).items;
      var issue = N350.sanitizeIssue(s.issue).issue;
      var merged = emptyState();
      merged.demo = !!s.demo;
      merged.issue = issue;
      merged.items = items;
      merged.categories = s.categories.filter(function (c) {
        return c && typeof c.name === 'string' && Array.isArray(c.keys);
      }).map(function (c) {
        return { name: c.name, keys: c.keys.filter(function (k) { return typeof k === 'number' && items[k]; }) };
      });
      merged.excluded = s.excluded && typeof s.excluded === 'object' ? s.excluded : {};
      merged.featured = typeof s.featured === 'number' && items[s.featured] ? s.featured : null;
      merged.sourceWarnings = Array.isArray(s.sourceWarnings) ? s.sourceWarnings.filter(function (w) { return w && typeof w.message === 'string'; }) : [];
      merged.step = Math.min(Math.max(parseInt(s.step, 10) || 1, 1), 4);
      merged.maxStep = Math.min(Math.max(parseInt(s.maxStep, 10) || 1, merged.step), 4);
      merged.publishedUrl = s.publishedUrl && N350.isHttpUrl(s.publishedUrl) ? s.publishedUrl : null;
      return merged;
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Talking to the Apps Script web app
  // ------------------------------------------------------------------
  function callScript(payload) {
    var url = String(CONFIG.APPS_SCRIPT_URL || '').trim();
    if (!N350.isHttpsUrl(url)) return Promise.reject(new UserError(MSG.notConnected));
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    }).catch(function () {
      throw new UserError(navigator.onLine === false ? MSG.offline : MSG.unreachable);
    }).then(function (res) {
      if (!res.ok) {
        throw new UserError('The newsletter sheet had a problem (error ' + res.status + '). Wait a minute and try again. Your arrangement has been kept.');
      }
      return res.text().catch(function () {
        throw new UserError(navigator.onLine === false ? MSG.offline : MSG.unreachable);
      });
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { throw new UserError(MSG.notJson); }
      if (!data || typeof data !== 'object') throw new UserError(MSG.notJson);
      if (data.ok !== true) {
        if (data.ok === false && typeof data.error === 'string' && data.error.trim()) {
          throw new UserError('The newsletter sheet said: "' + data.error.trim().slice(0, 300) + '". Your arrangement has been kept.');
        }
        throw new UserError(MSG.badShape);
      }
      return data;
    });
  }

  function asUserError(err) {
    return err instanceof UserError ? err.message : 'Something went wrong. Please try again. Your arrangement has been kept.';
  }

  // ------------------------------------------------------------------
  // Loading data (from the Sheet or the sample file)
  // ------------------------------------------------------------------
  function acceptData(data, isDemo) {
    if (!data || typeof data !== 'object' || !data.issue || typeof data.issue !== 'object' || !Array.isArray(data.items)) {
      throw new UserError(MSG.badShape);
    }
    var cleanIssue = N350.sanitizeIssue(data.issue);
    var cleanItems = N350.sanitizeItems(data.items);
    var previous = state;
    var next = emptyState();
    next.demo = isDemo;
    next.issue = cleanIssue.issue;
    next.items = cleanItems.items;
    next.sourceWarnings = cleanIssue.warnings.concat(cleanItems.warnings);

    // Group by category in the order they first appear.
    var byName = {};
    next.items.forEach(function (item, key) {
      var name = item.category || 'Updates';
      if (!byName[name]) {
        byName[name] = { name: name, keys: [] };
        next.categories.push(byName[name]);
      }
      byName[name].keys.push(key);
    });

    // Reloading the same issue keeps the volunteer's choices.
    if (previous.issue && previous.issue.slug === next.issue.slug && previous.demo === isDemo) {
      carryOver(previous, next);
    }
    next.step = 2;
    next.maxStep = Math.max(2, previous.issue && previous.issue.slug === next.issue.slug ? previous.maxStep : 2);
    state = next;
    save();
  }

  function carryOver(prev, next) {
    var keyById = {};
    next.items.forEach(function (item, key) { keyById[item.id] = key; });
    function idOf(s, key) { return s.items[key] && s.items[key].id; }

    // Category order, then item order within categories.
    var catOrder = prev.categories.map(function (c) { return c.name; });
    next.categories.sort(function (a, b) {
      var ia = catOrder.indexOf(a.name), ib = catOrder.indexOf(b.name);
      return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
    });
    var prevPos = {};
    prev.categories.forEach(function (c) {
      c.keys.forEach(function (k, i) { prevPos[idOf(prev, k)] = i; });
    });
    next.categories.forEach(function (c) {
      c.keys.sort(function (a, b) {
        var pa = prevPos[next.items[a].id], pb = prevPos[next.items[b].id];
        return (pa == null ? 1e6 : pa) - (pb == null ? 1e6 : pb);
      });
    });
    Object.keys(prev.excluded).forEach(function (k) {
      var id = idOf(prev, Number(k));
      if (prev.excluded[k] && id != null && keyById[id] != null) next.excluded[keyById[id]] = true;
    });
    var fid = prev.featured != null ? idOf(prev, prev.featured) : null;
    if (fid != null && keyById[fid] != null) next.featured = keyById[fid];
    next.publishedUrl = prev.publishedUrl;
  }

  function loadFromSheet(event) {
    event.preventDefault();
    var input = $('#token');
    var typed = input.value.trim();
    if (typed) token = typed;
    if (!token) {
      showMessage('error', MSG.noToken);
      input.focus();
      return;
    }
    var btn = $('#load-btn');
    setBusy(btn, true, 'Loading…');
    callScript({ action: 'items', token: token }).then(function (data) {
      acceptData(data, false);
      input.value = '';
      afterLoad();
    }).catch(function (err) {
      showMessage('error', asUserError(err));
    }).then(function () {
      setBusy(btn, false);
      updateTokenUi();
    });
  }

  function loadSample() {
    return fetch('sample-data.json', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new UserError('The sample data file couldn\'t be loaded.');
      return res.json();
    }).then(function (data) {
      acceptData(data, true);
      afterLoad();
    }).catch(function (err) {
      showMessage('error', err instanceof UserError ? err.message : 'The sample data file couldn\'t be loaded. Open the builder from a web address (see README), not by double-clicking the file.');
    });
  }

  function afterLoad() {
    clearMessages();
    var count = state.items.length;
    showMessage('success', 'Loaded ' + count + ' approved item' + (count === 1 ? '' : 's') + ' for ' + (state.issue.title || 'this issue') + '.');
    state.sourceWarnings.forEach(function (w) {
      showMessage('warning', w.message, { replace: false });
    });
    renderAll();
    goTo(2);
  }

  function setBusy(btn, busy, label) {
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label;
      btn.setAttribute('aria-disabled', 'true');
      btn.dataset.busy = '1';
    } else {
      if (btn.dataset.label) btn.textContent = btn.dataset.label;
      btn.removeAttribute('aria-disabled');
      delete btn.dataset.busy;
    }
  }

  // ------------------------------------------------------------------
  // The arrangement
  // ------------------------------------------------------------------
  function includedItems() {
    var out = [];
    state.categories.forEach(function (c) {
      c.keys.forEach(function (k) {
        if (state.excluded[k]) return;
        var item = Object.assign({}, state.items[k]);
        item.featured = state.featured === k;
        out.push(item);
      });
    });
    return out;
  }

  function renderBoard(forPublishing) {
    return N350.render(state.issue, includedItems(), {
      css: boardCss,
      fontBaseUrl: forPublishing ? publishFontBase() : localFontBase(),
      assetBaseUrl: window.location.href,
      realFonts: CONFIG.REAL_FONTS || {}
    });
  }

  function itemIssues() {
    var check = N350.validate(state.issue, includedItems());
    var byId = {};
    function add(list, kind) {
      list.forEach(function (p) {
        if (p.id == null) return;
        byId[p.id] = byId[p.id] || { errors: 0, warnings: 0 };
        byId[p.id][kind] += 1;
      });
    }
    add(check.errors, 'errors');
    add(check.warnings, 'warnings');
    return { check: check, byId: byId };
  }

  function moveButton(id, label, enabled) {
    return el('button', {
      type: 'button',
      className: 'nb-btn nb-btn--secondary nb-btn--small',
      id: id,
      'aria-label': label,
      'aria-disabled': enabled ? null : 'true'
    }, [id.indexOf('up-') !== -1 ? '↑ Up' : '↓ Down']);
  }

  function renderArrangeList() {
    var root = $('#arrange-list');
    var focusedId = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null;
    root.textContent = '';
    var issues = itemIssues();

    root.appendChild(el('p', { className: 'nb-help nb-feature-note', id: 'feature-note' },
      ['Tick "Featured" on one item to make it the big first tile. Only one item can be featured.']));

    state.categories.forEach(function (cat, ci) {
      var hid = 'cat-h-' + ci;
      var section = el('section', { className: 'nb-cat', 'aria-labelledby': hid });
      var head = el('div', { className: 'nb-cat-head' }, [
        el('h2', { className: 'nb-h3', id: hid, text: cat.name }),
        el('div', { className: 'nb-move' }, [
          moveButton('cat-up-' + ci, 'Move the ' + cat.name + ' group up', ci > 0),
          moveButton('cat-down-' + ci, 'Move the ' + cat.name + ' group down', ci < state.categories.length - 1)
        ])
      ]);
      section.appendChild(head);

      var list = el('ol', { className: 'nb-items' });
      cat.keys.forEach(function (key, pos) {
        var item = state.items[key];
        var excluded = !!state.excluded[key];
        var featured = state.featured === key;
        var flags = issues.byId[item.id] || { errors: 0, warnings: 0 };
        var headline = item.headline || '(no headline)';
        var li = el('li', {
          className: 'nb-item' + (excluded ? ' is-excluded' : '') + (featured ? ' is-featured' : ''),
          id: 'row-' + key
        }, [
          el('span', { className: 'nb-item-headline', id: 'head-' + key, text: headline }),
          el('span', { className: 'nb-item-team', text: item.team }),
          (!excluded && (flags.errors || flags.warnings)) ? el('span', { className: 'nb-item-flags' }, [
            flags.errors ? el('span', { className: 'nb-flag nb-flag--error', text: flags.errors + ' problem' + (flags.errors > 1 ? 's' : '') }) : null,
            flags.warnings ? el('span', { className: 'nb-flag nb-flag--warning', text: flags.warnings + ' warning' + (flags.warnings > 1 ? 's' : '') }) : null
          ]) : null,
          el('div', { className: 'nb-item-controls' }, [
            el('label', { className: 'nb-check' }, [
              el('input', { type: 'checkbox', id: 'inc-' + key, checked: !excluded, 'aria-describedby': 'head-' + key }),
              'Include'
            ]),
            el('label', { className: 'nb-check' }, [
              el('input', { type: 'checkbox', id: 'feat-' + key, checked: featured, disabled: excluded, 'aria-describedby': 'head-' + key + ' feature-note' }),
              'Featured'
            ]),
            el('div', { className: 'nb-move' }, [
              moveButton('up-' + key, 'Move "' + headline + '" up', pos > 0),
              moveButton('down-' + key, 'Move "' + headline + '" down', pos < cat.keys.length - 1)
            ])
          ])
        ]);
        list.appendChild(li);
      });
      section.appendChild(list);
      root.appendChild(section);
    });

    if (focusedId) {
      var again = document.getElementById(focusedId);
      if (again) again.focus();
    }
  }

  function onArrangeClick(event) {
    var btn = event.target.closest('button');
    if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
    var m = /^(cat-)?(up|down)-(\d+)$/.exec(btn.id);
    if (!m) return;
    var dir = m[2] === 'up' ? -1 : 1;
    var n = Number(m[3]);
    var focusId = btn.id;
    if (m[1]) {
      var to = n + dir;
      if (to < 0 || to >= state.categories.length) return;
      var moved = state.categories.splice(n, 1)[0];
      state.categories.splice(to, 0, moved);
      focusId = 'cat-' + m[2] + '-' + to;
      announce('Moved the ' + moved.name + ' group ' + m[2] + '.');
    } else {
      state.categories.some(function (cat) {
        var i = cat.keys.indexOf(n);
        if (i === -1) return false;
        var j = i + dir;
        if (j < 0 || j >= cat.keys.length) return true;
        cat.keys.splice(i, 1);
        cat.keys.splice(j, 0, n);
        announce('Moved "' + (state.items[n].headline || 'item') + '" ' + m[2] + ' to position ' + (j + 1) + ' of ' + cat.keys.length + '.');
        return true;
      });
    }
    changed();
    var target = document.getElementById(focusId);
    if (target && target.getAttribute('aria-disabled') === 'true') {
      target = document.getElementById(focusId.replace(m[2], m[2] === 'up' ? 'down' : 'up'));
    }
    if (target) target.focus();
  }

  function onArrangeChange(event) {
    var input = event.target;
    var m = /^(inc|feat)-(\d+)$/.exec(input.id);
    if (!m) return;
    var key = Number(m[2]);
    if (m[1] === 'inc') {
      if (input.checked) delete state.excluded[key];
      else {
        state.excluded[key] = true;
        if (state.featured === key) state.featured = null;
      }
    } else {
      state.featured = input.checked ? key : (state.featured === key ? null : state.featured);
    }
    changed();
    var again = document.getElementById(input.id);
    if (again) again.focus();
  }

  var liveRegion;
  function announce(text) {
    if (!liveRegion) {
      liveRegion = el('div', { className: 'nb-sr', 'aria-live': 'polite', role: 'status' });
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = '';
    window.setTimeout(function () { liveRegion.textContent = text; }, 30);
  }

  function changed() {
    save();
    renderArrangeList();
    renderPreview('#preview-arrange', false);
    if (state.maxStep >= 3) renderCheck();
    if (state.maxStep >= 4) renderShare();
  }

  // ------------------------------------------------------------------
  // Previews (inside a shadow root so the builder's CSS can't leak in)
  // ------------------------------------------------------------------
  function renderPreview(selector, forPublishing) {
    var host = $(selector);
    if (!host || !hasData()) return;
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    root.innerHTML = renderBoard(forPublishing).fragment;
  }

  function installFontFaces() {
    // @font-face inside a shadow root is ignored by some browsers, so the
    // board's fonts are also declared once on the page itself.
    var css = N350.processCss(boardCss, { fontBaseUrl: localFontBase(), realFonts: CONFIG.REAL_FONTS || {} });
    $('#n350-fonts').textContent = N350.fontFaceRules(css);
  }

  // ------------------------------------------------------------------
  // Step 3: final check
  // ------------------------------------------------------------------
  function renderCheck() {
    if (!hasData()) return;
    var items = includedItems();
    var check = N350.validate(state.issue, items);
    var warnings = state.sourceWarnings.map(function (w) { return w; }).concat(check.warnings);

    var summary = $('#check-summary');
    summary.textContent = '';
    if (check.errors.length) {
      summary.appendChild(el('p', { className: 'nb-msg nb-msg--error' }, [
        el('span', { text: check.errors.length + ' problem' + (check.errors.length > 1 ? 's' : '') + ' must be fixed before publishing. Fix them in the Google Sheet and load again, or leave those items out in step 2.' })
      ]));
    } else {
      summary.appendChild(el('p', { className: 'nb-msg nb-msg--success' }, [
        el('span', { text: 'Ready to publish: ' + items.length + ' item' + (items.length === 1 ? '' : 's') + (warnings.length ? ', with ' + warnings.length + ' warning' + (warnings.length > 1 ? 's' : '') + ' to look over.' : ' and no warnings.') })
      ]));
    }

    function listCard(id, title, list, emptyText, cls) {
      var card = $(id);
      card.textContent = '';
      card.appendChild(el('h2', { className: 'nb-h2', text: title + ' (' + list.length + ')' }));
      if (!list.length) {
        card.appendChild(el('p', { text: emptyText }));
        return;
      }
      var ul = el('ul', { className: 'nb-list ' + cls });
      list.forEach(function (p) { ul.appendChild(el('li', { text: p.message })); });
      card.appendChild(ul);
    }
    listCard('#check-errors', 'Problems that block publishing', check.errors, 'None. Nice work.', 'nb-list--errors');
    listCard('#check-warnings', 'Warnings (you can still publish)', warnings, 'None.', 'nb-list--warnings');

    var linksCard = $('#check-links');
    linksCard.textContent = '';
    linksCard.appendChild(el('h2', { className: 'nb-h2', text: 'Test every link' }));
    linksCard.appendChild(el('p', { className: 'nb-help', text: 'Each link opens in a new tab, exactly as readers will get it (with tracking tags added).' }));
    var table = el('table', { className: 'nb-links-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Item' }), el('th', { scope: 'col', text: 'Link' })])])
    ]);
    var tbody = el('tbody');
    N350.boardLinks(state.issue, items).forEach(function (l) {
      var cell = l.url
        ? el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: l.url })
        : el('span', { text: l.raw ? 'Not a web link: ' + l.raw : 'No link' });
      tbody.appendChild(el('tr', {}, [el('td', { text: l.headline || l.id }), el('td', {}, [cell])]));
    });
    table.appendChild(tbody);
    linksCard.appendChild(table);

    renderPreview('#preview-final', true);
  }

  // ------------------------------------------------------------------
  // Step 4: publish and share
  // ------------------------------------------------------------------
  function currentEmail() {
    return N350.buildEmail(state.issue, includedItems(), boardUrl());
  }

  function renderShare() {
    if (!hasData()) return;
    var items = includedItems();
    var check = N350.validate(state.issue, items);
    var publishBtn = $('#publish-btn');
    var note = $('#publish-note');

    if (check.errors.length) {
      publishBtn.setAttribute('aria-disabled', 'true');
      note.textContent = 'Publishing is turned off until the problems in step 3 are fixed. You can still download the HTML to look at it.';
    } else if (state.demo) {
      publishBtn.removeAttribute('aria-disabled');
      note.textContent = 'Sample mode: nothing will be sent to the website. You\'ll see what happens after a real publish.';
    } else {
      publishBtn.removeAttribute('aria-disabled');
      note.textContent = 'Sends the board to the WordPress site as the post for ' + (state.issue.title || 'this issue') + '. You\'ll be asked to confirm first.';
    }
    $('#publish-token-wrap').hidden = state.demo || !!token;

    if (state.publishedUrl) {
      $('#publish-result').hidden = false;
      $('#published-url').value = state.publishedUrl;
    } else {
      $('#publish-result').hidden = true;
    }

    var email = currentEmail();
    $('#preview-link').value = email.previewUrl || 'Set BOARD_BASE_URL in config.js';
    $('#preview-alt').value = N350.previewAltText(state.issue, items);
    $('#email-text').value = email.text;
  }

  function askToPublish() {
    var btn = $('#publish-btn');
    if (btn.getAttribute('aria-disabled') === 'true') {
      if (!btn.dataset.busy) showMessage('error', 'Publishing is turned off until the problems in step 3 are fixed.');
      return;
    }
    if (!state.demo && !token) {
      var typed = $('#publish-token').value.trim();
      if (!typed) {
        showMessage('error', MSG.noToken);
        $('#publish-token').focus();
        return;
      }
      token = typed;
      $('#publish-token').value = '';
    }
    var dialog = $('#confirm-dialog');
    $('#confirm-body').textContent = state.demo
      ? 'This is sample mode, so nothing will actually be published. Continue to see what happens after publishing?'
      : 'This puts "' + (state.issue.title || 'this issue') + '" (' + includedItems().length + ' items) on the 350 website. If this issue was published before, the website decides whether to update it.';
    dialog.returnValue = '';
    dialog.showModal();
    $('#confirm-yes').focus();
  }

  function onDialogClose() {
    var dialog = $('#confirm-dialog');
    if (dialog.returnValue === 'publish') publish();
    else $('#publish-btn').focus();
  }

  function publish() {
    var btn = $('#publish-btn');
    var fragment = renderBoard(true).fragment;
    if (state.demo) {
      state.publishedUrl = boardUrl() || 'https://example.org/newsletter/' + encodeURIComponent(state.issue.slug) + '/';
      save();
      renderShare();
      showMessage('success', 'Sample mode: nothing was sent. In real use, the link to the new post appears below, ready to copy.');
      $('#published-url').focus();
      return;
    }
    setBusy(btn, true, 'Publishing…');
    callScript({
      action: 'publish',
      token: token,
      slug: state.issue.slug,
      title: state.issue.title,
      html: fragment
    }).then(function (data) {
      if (typeof data.url !== 'string' || !N350.isHttpUrl(data.url)) throw new UserError(MSG.badShape);
      state.publishedUrl = data.url;
      save();
      renderShare();
      showMessage('success', 'Published! The board is live. Copy the link below for the email.');
      $('#published-url').focus();
    }).catch(function (err) {
      showMessage('error', asUserError(err) + ' If it keeps failing, use "Download HTML" and paste the board into WordPress yourself.');
    }).then(function () {
      setBusy(btn, false);
      renderShare();
    });
  }

  function fileSlug() {
    return N350.slugify(state.issue && state.issue.slug) || 'newsletter';
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: name });
    a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function downloadHtml() {
    var fragment = renderBoard(true).fragment;
    var name = 'newsletter-' + fileSlug() + '.html';
    downloadBlob(new Blob([fragment], { type: 'text/html;charset=utf-8' }), name);
    $('#html-status').textContent = 'Downloaded ' + name + '.';
  }

  function waitForImages(root) {
    return Promise.all($all('img', root).map(function (img) {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        window.setTimeout(resolve, 8000);
      });
    }));
  }

  function makePng() {
    var btn = $('#png-btn');
    var status = $('#png-status');
    if (btn.dataset.busy) return;
    if (!window.htmlToImage) {
      status.textContent = 'The image tool didn\'t load. Refresh the page and try again.';
      return;
    }
    setBusy(btn, true, 'Making the image…');
    status.textContent = 'Making the image…';
    var stage = $('#png-stage');
    stage.setAttribute('inert', '');
    stage.innerHTML = renderBoard(false).fragment.replace(/ loading="lazy"/g, '');
    var board = stage.querySelector('.n350-board');
    board.style.width = PNG_WIDTH + 'px';
    board.style.maxWidth = PNG_WIDTH + 'px';
    var external = $all('img', board).some(function (img) {
      return new URL(img.src).origin !== window.location.origin;
    });

    Promise.resolve(document.fonts ? document.fonts.ready : null).then(function () {
      return waitForImages(board);
    }).then(function () {
      return window.htmlToImage.toPng(board, {
        width: PNG_WIDTH,
        height: Math.ceil(board.getBoundingClientRect().height),
        pixelRatio: PNG_RATIO,
        backgroundColor: '#FFFFFF',
        cacheBust: false,
        imagePlaceholder: PLACEHOLDER_IMG
      });
    }).then(function (dataUrl) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve({ dataUrl: dataUrl, width: img.naturalWidth, height: img.naturalHeight }); };
        img.onerror = reject;
        img.src = dataUrl;
      });
    }).then(function (png) {
      if (png.width !== PNG_WIDTH * PNG_RATIO) throw new Error('size');
      return fetch(png.dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
        var name = 'newsletter-' + fileSlug() + '-preview.png';
        downloadBlob(blob, name);
        status.textContent = 'Downloaded ' + name + ' (' + png.width + ' × ' + png.height + ' pixels).' +
          (external ? ' If any photo shows as a plain blue box, that website doesn\'t allow its pictures to be copied; the published board still shows it.' : '');
      });
    }).catch(function () {
      status.textContent = 'The image couldn\'t be made. Try again, or take a screenshot of the preview in step 3 instead.';
    }).then(function () {
      stage.textContent = '';
      stage.removeAttribute('inert');
      setBusy(btn, false);
    });
  }

  function copyRich(html, text) {
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
      return navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]).catch(function () { return copyRichFallback(html); });
    }
    return copyRichFallback(html);
  }

  function copyRichFallback(html) {
    return new Promise(function (resolve, reject) {
      var holder = el('div', { contenteditable: 'true', 'aria-hidden': 'true' });
      holder.style.position = 'fixed';
      holder.style.left = '-10000px';
      holder.innerHTML = html; // our own escaped output from buildEmail
      document.body.appendChild(holder);
      var range = document.createRange();
      range.selectNodeContents(holder);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      sel.removeAllRanges();
      holder.remove();
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  function copyPlain(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return copyPlainFallback(text); });
    }
    return copyPlainFallback(text);
  }

  function copyPlainFallback(text) {
    return new Promise(function (resolve, reject) {
      var ta = el('textarea', { 'aria-hidden': 'true' });
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-10000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  function copyEmail() {
    var email = currentEmail();
    var status = $('#email-status');
    var btn = $('#email-btn');
    copyRich(email.html, email.text).then(function () {
      status.textContent = 'Copied! Paste it into the EveryAction email. Links keep their formatting.';
    }).catch(function () {
      status.textContent = 'Your browser blocked copying. Select the text in the box below and copy it yourself (Ctrl+C or Cmd+C).';
      $('#email-text').focus();
      $('#email-text').select();
    }).then(function () { btn.focus(); });
  }

  function onCopyField(event) {
    var btn = event.target.closest('[data-copy]');
    if (!btn) return;
    var field = document.getElementById(btn.getAttribute('data-copy'));
    if (!field || !field.value) return;
    var original = btn.dataset.original || btn.textContent;
    btn.dataset.original = original;
    copyPlain(field.value).then(function () {
      btn.textContent = 'Copied!';
      announce('Copied to the clipboard.');
    }).catch(function () {
      btn.textContent = 'Select and copy';
      field.focus();
      field.select();
    }).then(function () {
      window.setTimeout(function () { btn.textContent = original; }, 2500);
    });
  }

  // ------------------------------------------------------------------
  // Steps
  // ------------------------------------------------------------------
  function renderSteps() {
    $all('.nb-step').forEach(function (btn) {
      var n = Number(btn.getAttribute('data-step'));
      var reachable = n === 1 || hasData();
      if (n === state.step) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
      if (reachable) btn.removeAttribute('aria-disabled');
      else btn.setAttribute('aria-disabled', 'true');
      btn.classList.toggle('is-done', n < state.step);
    });
    $('#sample-badge').hidden = !state.demo;
  }

  function goTo(n, opts) {
    opts = opts || {};
    if (n > 1 && !hasData()) n = 1;
    state.step = n;
    state.maxStep = Math.max(state.maxStep, n);
    save();
    $all('.nb-step-panel').forEach(function (p) {
      p.hidden = Number(p.getAttribute('data-step')) !== n;
    });
    if (n === 2) { renderArrangeList(); renderPreview('#preview-arrange', false); }
    if (n === 3) renderCheck();
    if (n === 4) renderShare();
    if (n === 1) updateTokenUi();
    renderSteps();
    if (opts.focus !== false) {
      var h = $('#step-' + n + '-title');
      if (h) h.focus();
      window.scrollTo(0, 0);
    }
  }

  function updateTokenUi() {
    $('#token-held').hidden = !token;
  }

  function renderAll() {
    renderSteps();
    if (!hasData()) return;
    renderArrangeList();
    renderPreview('#preview-arrange', false);
    if (state.maxStep >= 3) renderCheck();
    if (state.maxStep >= 4) renderShare();
  }

  function startOver() {
    if (hasData() && !window.confirm('Start over? This clears the current arrangement in this tab. Nothing on the website changes.')) return;
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    token = '';
    state = emptyState();
    ['#preview-arrange', '#preview-final'].forEach(function (s) {
      var host = $(s);
      if (host.shadowRoot) host.shadowRoot.innerHTML = '';
    });
    clearMessages();
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    goTo(1);
  }

  function onDemoLink(event) {
    event.preventDefault();
    if (hasData() && !state.demo && !window.confirm('Replace the blurbs you loaded with the sample data?')) return;
    window.history.replaceState(null, '', '?demo=1');
    loadSample();
  }

  // ------------------------------------------------------------------
  // Start up
  // ------------------------------------------------------------------
  function wire() {
    $('#load-form').addEventListener('submit', loadFromSheet);
    $('#demo-link').addEventListener('click', onDemoLink);
    $('#start-over').addEventListener('click', startOver);
    $all('.nb-step').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-disabled') === 'true') return;
        goTo(Number(btn.getAttribute('data-step')));
      });
    });
    $all('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { goTo(Number(btn.getAttribute('data-goto'))); });
    });
    $('#arrange-list').addEventListener('click', onArrangeClick);
    $('#arrange-list').addEventListener('change', onArrangeChange);
    $('#publish-btn').addEventListener('click', askToPublish);
    $('#confirm-dialog').addEventListener('close', onDialogClose);
    $('#png-btn').addEventListener('click', makePng);
    $('#email-btn').addEventListener('click', copyEmail);
    $('#html-btn').addEventListener('click', downloadHtml);
    document.addEventListener('click', onCopyField);
  }

  function start() {
    wire();
    fetch('styles/board.css', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('css');
      return res.text();
    }).then(function (css) {
      boardCss = css;
      installFontFaces();
    }).catch(function () {
      showMessage('error', 'The board styles couldn\'t be loaded. Open the builder from a web address (see README), not by double-clicking the file.');
    }).then(function () {
      var wantsDemo = /(?:^|[?&])demo=1(?:&|$)/.test(window.location.search);
      var saved = restore();
      if (saved) {
        state = saved;
        renderAll();
        goTo(state.step, { focus: false });
        if (wantsDemo && !saved.demo) {
          showMessage('info', 'You have an issue in progress, so the sample data wasn\'t loaded. Use "Start over" first if you want to try the sample.');
        }
      } else if (wantsDemo) {
        loadSample();
      } else {
        goTo(1, { focus: false });
      }
    });
  }

  start();
})();
