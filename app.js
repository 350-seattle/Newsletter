/*
 * Newsletter Builder: the page's behavior.
 *
 * Rules this file follows:
 * - Volunteers sign in with their 350 Seattle Google account. The
 *   proof of sign-in (Google's ID token) lives only in the `credential`
 *   variable below. It is never written to this page's URL, storage,
 *   cookies, the page, or a log. The Apps Script checks it with Google.
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

  var credential = null;   // { idToken, name, domain, exp }, memory only
  var pendingSignIn = null;
  var expiryTimer = null;
  var boardCss = '';       // text of styles/board.css
  var state = emptyState();

  function emptyState() {
    return {
      version: 2,
      demo: false,
      issue: null,
      items: [],           // sanitized items, in the order they arrived
      categories: [],      // [{ name, keys: [item index, ...] }]
      excluded: {},        // { key: true } for left-out items
      featured: null,      // key of the featured item
      sourceWarnings: [],  // warnings from sanitizing (emails removed, etc.)
      weekSummary: '',     // "This week in summary", written by the volunteer
      weekSummaryEdited: false,
      step: 1,
      maxStep: 1,
      publishedUrl: null,
      publishedStatus: null  // 'publish' or 'draft', from the website's reply
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

  // The issue as it will be published, including the volunteer's summary.
  function currentIssue() {
    return Object.assign({}, state.issue, { weekSummary: state.weekSummary });
  }

  function localFontBase() {
    return new URL('fonts/', window.location.href).toString();
  }

  function publishFontBase() {
    var configured = String(CONFIG.FONT_BASE_URL || '').trim();
    return N350.isHttpUrl(configured) ? configured : localFontBase();
  }

  // The board's address is only known once WordPress sends it back
  // (post addresses include the date), so it is never guessed.
  function boardUrl() {
    return state.publishedUrl || null;
  }

  // A draft is not public: its link only works for people signed in to
  // WordPress. A reply without a status counts as published.
  function isDraft(url, status) {
    return status === 'draft' || /[?&]p=\d+/.test(String(url || ''));
  }

  function publishedLive() {
    return !!state.publishedUrl && state.publishedStatus !== 'draft';
  }

  // ------------------------------------------------------------------
  // Messages (plain English, never technical details or the sign-in)
  // ------------------------------------------------------------------
  var MSG = {
    signInNotSetUp: 'Signing in with your 350 email isn\'t set up yet. Whoever looks after the builder needs to add the Google client ID to config.js (see README). Until then you can try the sample data.',
    popupBlocked: 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then click "Sign in" again.',
    signInCancelled: 'Sign-in was cancelled. Click "Sign in" to try again.',
    signInFailed: 'Sign-in didn\'t work. Please try again.',
    signInTimeout: 'Sign-in took too long. Click "Sign in" to try again.',
    signInAgain: 'Your sign-in has expired. Please sign in with your 350 email again. Your arrangement has been kept.',
    notConnected: 'This builder isn\'t connected to the newsletter sheet yet. Whoever set it up needs to add the Apps Script web app address (APPS_SCRIPT_URL) to config.js. Until then you can try the sample data.',
    offline: 'You appear to be offline. Check your internet connection, then try again. Your arrangement has been kept.',
    unreachable: 'We couldn\'t reach the newsletter sheet. Check your internet connection and try again. Your arrangement has been kept.',
    notJson: 'The newsletter sheet sent back something unexpected. Try signing out and in again. If it keeps happening, the Apps Script address in config.js may be wrong. Your arrangement has been kept.',
    badShape: 'The newsletter sheet\'s reply was missing the information we need. Ask the person who looks after the Sheet to check it. Your arrangement has been kept.',
    wrongAccount: 'That account isn\'t a 350 Seattle email. Please sign in with your @'
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
      if (!s || s.version !== 2 || !s.issue || !Array.isArray(s.items) || !Array.isArray(s.categories)) return null;
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
      merged.step = Math.min(Math.max(parseInt(s.step, 10) || 1, 1), 5);
      merged.maxStep = Math.min(Math.max(parseInt(s.maxStep, 10) || 1, merged.step), 5);
      merged.publishedUrl = s.publishedUrl && N350.isHttpUrl(s.publishedUrl) ? s.publishedUrl : null;
      merged.publishedStatus = merged.publishedUrl ? (isDraft(merged.publishedUrl, s.publishedStatus) ? 'draft' : 'publish') : null;
      merged.weekSummary = typeof s.weekSummary === 'string' ? N350.sanitizeIssue({ weekSummary: s.weekSummary }).issue.weekSummary : '';
      merged.weekSummaryEdited = !!s.weekSummaryEdited;
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
        // The Apps Script says the sign-in is missing, expired or not
        // allowed: forget it so the next click signs in again.
        if (data.ok === false && data.reauth === true) {
          credential = null;
          updateSignInUi();
          throw new UserError(typeof data.error === 'string' && data.error.trim()
            ? 'The newsletter sheet said: "' + data.error.trim().slice(0, 300) + '". Please sign in again. Your arrangement has been kept.'
            : MSG.signInAgain);
        }
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
    // The Sheet may send a draft summary; the volunteer can rewrite it.
    next.weekSummary = cleanIssue.issue.weekSummary;

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
    next.step = 3;
    next.maxStep = Math.max(3, previous.issue && previous.issue.slug === next.issue.slug ? previous.maxStep : 3);
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
    next.publishedStatus = prev.publishedStatus;
    if (prev.weekSummaryEdited) {
      next.weekSummary = prev.weekSummary;
      next.weekSummaryEdited = true;
    }
  }

  // ------------------------------------------------------------------
  // Signing in with a 350 Seattle Google account (OpenID Connect).
  // No Google script is loaded: a sign-in window goes to Google, Google
  // sends the result to auth-callback.html on this site, and that page
  // passes it back here. This page only reads the name and checks the
  // details; the Apps Script verifies the token with Google.
  // ------------------------------------------------------------------
  function signInConfigured() {
    return !!String(CONFIG.GOOGLE_CLIENT_ID || '').trim();
  }

  function emailDomain() {
    return String(CONFIG.EMAIL_DOMAIN || '').trim().toLowerCase();
  }

  function signedIn() {
    return !!credential && credential.exp * 1000 > Date.now() + 60000;
  }

  function randomString() {
    var bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function decodeJwtPayload(jwt) {
    var parts = String(jwt).split('.');
    if (parts.length !== 3) return null;
    try {
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      var pct = Array.prototype.map.call(bin, function (c) { return '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }).join('');
      return JSON.parse(decodeURIComponent(pct));
    } catch (e) {
      return null;
    }
  }

  // Call straight from a click, so the browser allows the window.
  function signIn() {
    if (!signInConfigured()) return Promise.reject(new UserError(MSG.signInNotSetUp));
    var stateParam = randomString();
    var nonce = randomString();
    var url;
    try {
      url = new URL(String(CONFIG.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'));
    } catch (e) {
      return Promise.reject(new UserError(MSG.signInNotSetUp));
    }
    var q = url.searchParams;
    q.set('client_id', String(CONFIG.GOOGLE_CLIENT_ID).trim());
    q.set('redirect_uri', new URL('auth-callback.html', window.location.href).toString());
    q.set('response_type', 'id_token');
    q.set('scope', 'openid email profile');
    q.set('nonce', nonce);
    q.set('state', stateParam);
    q.set('prompt', 'select_account');
    if (emailDomain()) q.set('hd', emailDomain());

    var popup = window.open(url.toString(), 'n350-signin', 'popup,width=520,height=680');
    if (!popup) return Promise.reject(new UserError(MSG.popupBlocked));
    return new Promise(function (resolve, reject) {
      if (pendingSignIn) window.clearTimeout(pendingSignIn.timer);
      pendingSignIn = {
        state: stateParam,
        nonce: nonce,
        resolve: resolve,
        reject: reject,
        timer: window.setTimeout(function () { finishSignIn(new UserError(MSG.signInTimeout)); }, 5 * 60 * 1000)
      };
      updateSignInUi();
    });
  }

  function finishSignIn(error, cred) {
    var p = pendingSignIn;
    if (!p) return;
    pendingSignIn = null;
    window.clearTimeout(p.timer);
    if (error) {
      p.reject(error);
    } else {
      credential = cred;
      // When the sign-in runs out, lock the Sheet again.
      window.clearTimeout(expiryTimer);
      expiryTimer = window.setTimeout(updateSignInUi, Math.max(0, cred.exp * 1000 - Date.now() - 59000));
      p.resolve(cred);
    }
    updateSignInUi();
  }

  function onAuthMessage(data) {
    if (!pendingSignIn || !data || data.type !== 'n350-auth' || data.state !== pendingSignIn.state) return;
    if (data.error || !data.idToken) {
      finishSignIn(new UserError(data.error === 'access_denied' ? MSG.signInCancelled : MSG.signInFailed));
      return;
    }
    var claims = decodeJwtPayload(data.idToken);
    if (!claims || claims.nonce !== pendingSignIn.nonce ||
        claims.aud !== String(CONFIG.GOOGLE_CLIENT_ID).trim() ||
        !(Number(claims.exp) * 1000 > Date.now())) {
      finishSignIn(new UserError(MSG.signInFailed));
      return;
    }
    var email = String(claims.email || '').toLowerCase();
    var domain = emailDomain();
    var verified = claims.email_verified === true || claims.email_verified === 'true';
    if (!verified || (domain && email.slice(-(domain.length + 1)) !== '@' + domain)) {
      finishSignIn(new UserError(MSG.wrongAccount + (domain || '350') + ' account.'));
      return;
    }
    finishSignIn(null, {
      idToken: data.idToken,
      name: String(claims.given_name || claims.name || 'you').slice(0, 60),
      domain: email.split('@')[1] || domain,
      exp: Number(claims.exp)
    });
  }

  function listenForSignIn() {
    window.addEventListener('message', function (event) {
      if (event.origin === window.location.origin) onAuthMessage(event.data);
    });
    try {
      var channel = new BroadcastChannel('n350-auth');
      channel.onmessage = function (event) { onAuthMessage(event.data); };
    } catch (e) { /* older browser: the window message still works */ }
  }

  function signOut() {
    credential = null;
    updateSignInUi();
    announce('Signed out.');
    $('#signin-btn').focus();
  }

  function onSignInClick() {
    var btn = $('#signin-btn');
    if (btn.getAttribute('aria-disabled') === 'true') {
      showMessage('error', MSG.signInNotSetUp);
      return;
    }
    signIn().then(function () {
      announce('Signed in.');
      var next = $('#to-sheet-btn');
      (next && !$('#step-1').hidden ? next : $('#load-btn')).focus();
    }).catch(function (err) {
      showMessage('error', asUserError(err));
    });
  }

  function updateSignInUi() {
    var help = $('#signin-help');
    var status = $('#signin-status');
    var btn = $('#signin-btn');
    var out = $('#signout-btn');
    var domain = emailDomain();
    if (!signInConfigured()) {
      help.textContent = MSG.signInNotSetUp;
      btn.setAttribute('aria-disabled', 'true');
      btn.hidden = false;
      status.hidden = true;
      out.hidden = true;
    } else if (signedIn()) {
      btn.removeAttribute('aria-disabled');
      status.textContent = 'Signed in as ' + credential.name + ' (@' + credential.domain + ').';
      status.hidden = false;
      help.textContent = 'You stay signed in while this tab is open, for up to an hour. Nothing about your account is saved.';
      btn.hidden = true;
      out.hidden = false;
    } else {
      btn.removeAttribute('aria-disabled');
      status.hidden = true;
      out.hidden = true;
      btn.hidden = false;
      btn.textContent = pendingSignIn ? 'Open the sign-in window again' : 'Sign in with your 350 email';
      help.textContent = pendingSignIn
        ? 'Finish signing in in the Google window that opened.'
        : 'Use your @' + (domain || '350') + ' Google account. Nothing about your account is saved.';
    }
    var note = $('#publish-signin-note');
    if (note) note.hidden = state.demo || signedIn();
    renderSheetPanel();
  }

  function loadFromSheet() {
    var btn = $('#load-btn');
    if (btn.dataset.busy) return;
    var ready = signedIn() ? Promise.resolve() : signIn();
    ready.then(function () {
      setBusy(btn, true, 'Loading…');
      return callScript({ action: 'items', idToken: credential.idToken }).then(function (data) {
        acceptData(data, false);
        afterLoad();
      });
    }).catch(function (err) {
      showMessage('error', asUserError(err));
    }).then(function () {
      if (btn.dataset.busy) setBusy(btn, false);
      updateSignInUi();
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
    goTo(3);
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
    return N350.render(currentIssue(), includedItems(), {
      css: boardCss,
      fontBaseUrl: forPublishing ? publishFontBase() : localFontBase(),
      assetBaseUrl: window.location.href,
      realFonts: CONFIG.REAL_FONTS || {}
    });
  }

  function itemIssues() {
    var check = N350.validate(currentIssue(), includedItems());
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
    if (state.maxStep >= 4) renderCheck();
    if (state.maxStep >= 5) renderShare();
  }

  // ------------------------------------------------------------------
  // "This week in summary" (written by the volunteer)
  // ------------------------------------------------------------------
  var recapTimer = null;

  function fillRecap() {
    var ta = $('#week-summary');
    if (document.activeElement !== ta) ta.value = state.weekSummary;
    updateRecapCount();
  }

  function updateRecapCount() {
    var words = N350.wordCount(state.weekSummary);
    var max = N350.LIMITS.RECAP_MAX_WORDS;
    var count = $('#recap-count');
    count.textContent = words + ' word' + (words === 1 ? '' : 's') + '. Aim for ' + max + ' or fewer.' +
      (words > max ? ' This is a bit long.' : '');
    count.classList.toggle('is-over', words > max);
  }

  function onRecapInput() {
    var clean = N350.sanitizeIssue({ weekSummary: $('#week-summary').value }).issue.weekSummary;
    state.weekSummary = clean;
    state.weekSummaryEdited = true;
    save();
    updateRecapCount();
    window.clearTimeout(recapTimer);
    recapTimer = window.setTimeout(function () {
      renderPreview('#preview-arrange', false);
      if (state.maxStep >= 4) renderCheck();
      if (state.maxStep >= 5) renderShare();
    }, 250);
  }

  function onRecapChange() {
    var ta = $('#week-summary');
    if (N350.containsEmail(ta.value)) {
      ta.value = state.weekSummary;
      showMessage('warning', 'Email addresses can\'t go in the weekly summary, so it was removed. Point readers to an item\'s link instead.');
    }
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
    var check = N350.validate(currentIssue(), items);
    var warnings = state.sourceWarnings.map(function (w) { return w; }).concat(check.warnings);

    var summary = $('#check-summary');
    summary.textContent = '';
    if (check.errors.length) {
      summary.appendChild(el('p', { className: 'nb-msg nb-msg--error' }, [
        el('span', { text: check.errors.length + ' problem' + (check.errors.length > 1 ? 's' : '') + ' must be fixed before publishing. Fix them in the Google Sheet and load again, or leave those items out in step 3.' })
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
    return N350.buildEmail(currentIssue(), includedItems(), boardUrl());
  }

  function renderShare() {
    if (!hasData()) return;
    var items = includedItems();
    var check = N350.validate(currentIssue(), items);
    var publishBtn = $('#publish-btn');
    var note = $('#publish-note');

    if (check.errors.length) {
      publishBtn.setAttribute('aria-disabled', 'true');
      note.textContent = 'Publishing is turned off until the problems in step 4 are fixed. You can still download the HTML to look at it.';
    } else if (state.demo) {
      publishBtn.removeAttribute('aria-disabled');
      note.textContent = 'Sample mode: nothing will be sent to the website. You\'ll see what happens after a real publish.';
    } else {
      publishBtn.removeAttribute('aria-disabled');
      note.textContent = 'Sends the board to the WordPress site as the post for ' + (state.issue.title || 'this issue') + '. You\'ll be asked to confirm first.';
    }
    $('#publish-signin-note').hidden = state.demo || signedIn();

    var draft = !!state.publishedUrl && state.publishedStatus === 'draft';
    if (state.publishedUrl) {
      $('#publish-result').hidden = false;
      $('#published-url').value = state.publishedUrl;
      $('#published-label-text').textContent = draft
        ? 'Draft preview link (only works while you\'re signed in to WordPress)'
        : 'The board is published at';
      $('#draft-badge').hidden = !draft;
    } else {
      $('#publish-result').hidden = true;
      $('#published-url').value = '';
    }

    // The email's image link only exists once the board is public.
    var email = currentEmail();
    var live = publishedLive() && !!email.previewUrl;
    $('#preview-link-row').hidden = !live;
    $('#preview-link').value = live ? email.previewUrl : '';
    $('#preview-link-wait').hidden = live;
    $('#preview-link-wait').textContent = draft
      ? 'The board is only a draft on the website, so there\'s no public link for the email yet. The link appears here once the board is published.'
      : 'Publish first. The link appears here once the board is published.';
    $('#preview-alt').value = N350.previewAltText(state.issue, items);
    $('#email-text').value = email.text;
  }

  function askToPublish() {
    var btn = $('#publish-btn');
    if (btn.getAttribute('aria-disabled') === 'true') {
      if (!btn.dataset.busy) showMessage('error', 'Publishing is turned off until the problems in step 4 are fixed.');
      return;
    }
    if (!state.demo && !signedIn()) {
      signIn().then(openPublishDialog).catch(function (err) {
        showMessage('error', asUserError(err));
      });
      return;
    }
    openPublishDialog();
  }

  function openPublishDialog() {
    var dialog = $('#confirm-dialog');
    $('#confirm-body').textContent = state.demo
      ? 'This is sample mode, so nothing will actually be published. Continue to see what happens after publishing?'
      : 'This puts "' + (state.issue.title || 'this issue') + '" (' + includedItems().length + ' items) on the 350 website. If this issue was published in the last 45 days, this updates it instead of making a second one.';
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
      state.publishedUrl = sampleBoardUrl();
      state.publishedStatus = 'publish';
      save();
      renderShare();
      showMessage('success', 'Sample mode: nothing was sent. In real use, the link to the new post appears below, ready to copy.');
      $('#published-url').focus();
      return;
    }
    if (!signedIn()) {
      showMessage('error', MSG.signInAgain);
      updateSignInUi();
      return;
    }
    setBusy(btn, true, 'Publishing…');
    callScript({
      action: 'publish',
      idToken: credential.idToken,
      slug: state.issue.slug,
      title: state.issue.title,
      html: fragment
    }).then(function (data) {
      if (typeof data.url !== 'string' || !N350.isHttpUrl(data.url)) throw new UserError(MSG.badShape);
      var draft = isDraft(data.url, data.status);
      state.publishedUrl = data.url;
      state.publishedStatus = draft ? 'draft' : 'publish';
      save();
      renderShare();
      showMessage('success', draft
        ? 'Saved as a draft on the website. It isn\'t public yet, and this link only works while you\'re signed in to WordPress.'
        : 'Published! The board is live on the website. Copy its link below; the image link for the email is now ready in B.');
      $('#published-url').focus();
    }).catch(function (err) {
      showMessage('error', asUserError(err) + ' If it keeps failing, use "Download HTML" and paste the board into WordPress yourself.');
    }).then(function () {
      setBusy(btn, false);
      renderShare();
    });
  }

  // Sample mode only: a made-up address shaped like a real post's,
  // with the issue date in it.
  function sampleBoardUrl() {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(state.issue.date || ''));
    var d = m ? m[1] + '/' + m[2] + '/' + m[3] : new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    return 'https://example.org/' + d + '/' + (N350.slugify(state.issue.slug) || 'newsletter') + '/';
  }

  // File names: "dec-26-newsletter.html", or "newsletter-<slug>.html"
  // when the slug doesn't already say newsletter.
  function fileSlug() {
    var slug = N350.slugify(state.issue && state.issue.slug) || 'newsletter';
    return /(^|-)newsletter(-|$)/.test(slug) ? slug : 'newsletter-' + slug;
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
    var name = fileSlug() + '.html';
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
    // The image is only the news board itself: the rounded panel of tiles.
    // No masthead, date, "News Board" heading or "In summary…".
    $all('.n350-masthead, .n350-heading, .n350-recap', board).forEach(function (n) { n.style.display = 'none'; });
    board.style.width = PNG_WIDTH + 'px';
    board.style.maxWidth = PNG_WIDTH + 'px';
    board.style.padding = '0';
    // Capture a plain white wrapper around the panel: the image tool paints
    // its background colour onto the captured element, which would hide the
    // panel's own Foggy background. White then only shows past the panel's
    // rounded corners.
    var panel = board.querySelector('.n350-grid');
    var grid = document.createElement('div');
    grid.style.background = '#FFFFFF';
    grid.style.width = PNG_WIDTH + 'px';
    panel.parentNode.insertBefore(grid, panel);
    grid.appendChild(panel);
    var external = $all('img', board).some(function (img) {
      return new URL(img.src).origin !== window.location.origin;
    });

    Promise.resolve(document.fonts ? document.fonts.ready : null).then(function () {
      return waitForImages(grid);
    }).then(function () {
      return window.htmlToImage.toPng(grid, {
        width: PNG_WIDTH,
        height: Math.ceil(grid.getBoundingClientRect().height),
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
        var name = fileSlug() + '-preview.png';
        downloadBlob(blob, name);
        status.textContent = 'Downloaded ' + name + ' (' + png.width + ' × ' + png.height + ' pixels).' +
          (external ? ' If any photo shows as a plain blue box, that website doesn\'t allow its pictures to be copied; the published board still shows it.' : '');
      });
    }).catch(function () {
      status.textContent = 'The image couldn\'t be made. Try again, or take a screenshot of the preview in step 4 instead.';
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
      var reachable = n <= 2 || hasData();
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
    if (n > 2 && !hasData()) n = 1;
    state.step = n;
    state.maxStep = Math.max(state.maxStep, n);
    save();
    $all('.nb-step-panel').forEach(function (p) {
      p.hidden = Number(p.getAttribute('data-step')) !== n;
    });
    if (n !== 2) lockPageScroll(false);
    if (n === 1) updateSignInUi();
    if (n === 2) { updateSignInUi(); loadSheetFrame(); }
    if (n === 3) { fillRecap(); renderArrangeList(); renderPreview('#preview-arrange', false); }
    if (n === 4) renderCheck();
    if (n === 5) renderShare();
    renderSteps();
    if (opts.focus !== false) {
      var h = $('#step-' + n + '-title');
      if (h) h.focus();
      window.scrollTo(0, 0);
    }
  }

  // ------------------------------------------------------------------
  // The newsletter Google Sheet, shown in step 2. The builder never
  // reads it: Google shows it inside the frame only to people the Sheet
  // is shared with.
  // ------------------------------------------------------------------
  var SHEET_PLACEHOLDER = {
    missing: 'Once the newsletter Sheet is set up, add its address to config.js (SHEET_URL) and it will show here, so you can review and approve blurbs without leaving the builder.',
    published: 'The Sheet address in config.js is a "Publish to web" link, which makes the whole Sheet public, including submitters\' email addresses. Use the Sheet\'s normal address instead, and in Google Sheets choose File → Share → Publish to web → Stop publishing.',
    'not-a-sheet': 'The Sheet address in config.js doesn\'t look like a Google Sheets link. It should start with https://docs.google.com/spreadsheets/d/'
  };

  // Three modes: 'placeholder' (no Sheet address yet), 'locked' (signed
  // out: no frame and no link to the Sheet anywhere on the page) and
  // 'frame' (signed in). Only rebuilt when the mode changes, so the Sheet
  // doesn't reload while you work in it.
  var sheetMode = null;

  function renderSheetPanel() {
    var links = N350.sheetLinks(CONFIG.SHEET_URL);
    var mode = !links.ok ? 'placeholder' : (signedIn() ? 'frame' : 'locked');
    if (mode === sheetMode) return;
    sheetMode = mode;
    lockPageScroll(false); // the frame is being replaced or removed
    var body = $('#sheet-body');
    var link = $('#sheet-link');
    var hadFocus = body.contains(document.activeElement);
    body.textContent = '';
    if (mode === 'locked') {
      body.appendChild(el('div', { className: 'nb-sheet-placeholder', id: 'sheet-locked' }, [
        el('div', {}, [
          el('p', { className: 'nb-h3', text: 'Sign in to see the Sheet' }),
          el('p', { text: signInConfigured()
            ? 'The newsletter Sheet is only shown to volunteers signed in with their 350 email.'
            : 'The newsletter Sheet is only shown to signed-in volunteers, and signing in isn\'t set up yet (see README).' }),
          signInConfigured()
            ? el('button', { type: 'button', className: 'nb-btn', id: 'sheet-signin-btn', text: 'Sign in with your 350 email' })
            : null
        ])
      ]));
      link.href = '#step-2';
      link.textContent = 'Google Sheet (step 2)';
      link.removeAttribute('target');
      link.removeAttribute('rel');
    } else if (mode === 'frame') {
      body.appendChild(el('iframe', {
        className: 'nb-sheet-frame',
        id: 'sheet-frame',
        title: 'The newsletter Google Sheet',
        'data-src': links.embedUrl,
        referrerpolicy: 'no-referrer',
        allow: 'clipboard-read; clipboard-write'
      }));
      body.appendChild(el('p', { className: 'nb-help' }, [
        'Sheet not showing, or asking you to sign in? ',
        el('a', { href: links.openUrl, target: '_blank', rel: 'noopener noreferrer' }, [
          'Open the Google Sheet in a new tab',
          el('span', { className: 'nb-sr', text: ' (opens in a new tab)' })
        ]),
        '. Some browsers block Google sign-in inside other websites.'
      ]));
      link.href = links.openUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Google Sheet';
      link.appendChild(el('span', { className: 'nb-sr', text: ' (opens in a new tab)' }));
    } else {
      body.appendChild(el('div', { className: 'nb-sheet-placeholder', id: 'sheet-placeholder' }, [
        el('div', {}, [
          el('p', { className: 'nb-h3', text: 'The Google Sheet will appear here' }),
          el('p', { text: SHEET_PLACEHOLDER[links.reason] || SHEET_PLACEHOLDER.missing })
        ])
      ]));
      link.href = '#step-2';
      link.textContent = 'Google Sheet (step 2)';
      link.removeAttribute('target');
      link.removeAttribute('rel');
    }
    loadSheetFrame();
    if (hadFocus) $('#step-2-title').focus();
  }

  // ------------------------------------------------------------------
  // Scrolling over the Sheet scrolls the Sheet, not the page.
  // When Google's Sheet doesn't use a wheel turn (at its edges, or while
  // it loads), the browser passes it on to the page. The page can't
  // reach inside Google's frame, but it does see the pointer arrive on
  // and leave the frame, so it pauses its own scrolling in between.
  // Mouse and pen only; touch scrolling is unchanged.
  // ------------------------------------------------------------------
  var pageScrollLocked = false;

  function lockPageScroll(lock) {
    if (lock === pageScrollLocked) return;
    pageScrollLocked = lock;
    document.documentElement.classList.toggle('nb-scroll-locked', lock);
  }

  function isSheetFrame(node) {
    return !!node && node.id === 'sheet-frame';
  }

  function wireSheetScrollLock() {
    var body = $('#sheet-body');
    body.addEventListener('pointerover', function (event) {
      if (event.pointerType !== 'touch' && isSheetFrame(event.target)) lockPageScroll(true);
    });
    body.addEventListener('pointerout', function (event) {
      if (isSheetFrame(event.target)) lockPageScroll(false);
    });
    // Any pointer movement or wheel the page itself receives means the
    // pointer is not over the Sheet (those go to Google's frame).
    document.addEventListener('pointermove', function (event) {
      if (pageScrollLocked && !isSheetFrame(event.target)) lockPageScroll(false);
    }, { passive: true });
    document.addEventListener('wheel', function (event) {
      if (pageScrollLocked && !isSheetFrame(event.target)) lockPageScroll(false);
    }, { passive: true });
  }

  function onSheetSignIn(event) {
    if (!event.target.closest('#sheet-signin-btn')) return;
    signIn().then(function () {
      announce('Signed in. The Sheet is now showing.');
      $('#step-2-title').focus();
    }).catch(function (err) {
      showMessage('error', asUserError(err));
    });
  }

  // The frame only loads once step 2 is showing, and only when signed in.
  function loadSheetFrame() {
    var frame = $('#sheet-frame');
    if (frame && !frame.getAttribute('src') && !$('#step-2').hidden && signedIn()) {
      frame.setAttribute('src', frame.getAttribute('data-src'));
    }
  }

  function onSheetLink(event) {
    var link = event.currentTarget;
    if (link.getAttribute('href') !== '#step-2') return; // real Sheet link: opens a new tab
    event.preventDefault();
    goTo(2);
  }

  function renderAll() {
    renderSteps();
    if (!hasData()) return;
    renderArrangeList();
    renderPreview('#preview-arrange', false);
    if (state.maxStep >= 4) renderCheck();
    if (state.maxStep >= 5) renderShare();
  }

  function startOver() {
    if (hasData() && !window.confirm('Start over? This clears the current arrangement in this tab. Nothing on the website changes.')) return;
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    credential = null;
    state = emptyState();
    $('#week-summary').value = '';
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
    $('#load-btn').addEventListener('click', loadFromSheet);
    $('#signin-btn').addEventListener('click', onSignInClick);
    $('#signout-btn').addEventListener('click', signOut);
    $('#sheet-link').addEventListener('click', onSheetLink);
    $('#sheet-body').addEventListener('click', onSheetSignIn);
    wireSheetScrollLock();
    listenForSignIn();
    renderSheetPanel();
    updateSignInUi();
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
    $('#week-summary').addEventListener('input', onRecapInput);
    $('#week-summary').addEventListener('change', onRecapChange);
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
