/*
 * render-board.js: turns an issue and its items into the news board.
 *
 * Pure functions only: no DOM, no network, no globals. It runs in the
 * browser (as window.N350) and in Node (require('./render-board.js')),
 * so the tests can check exactly what gets published.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.N350 = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TEXT_FIELDS = ['id', 'team', 'category', 'headline', 'summary', 'blurb', 'linkLabel', 'imageAlt'];
  var URL_FIELDS = ['link', 'image'];
  var KNOWN_FIELDS = TEXT_FIELDS.concat(URL_FIELDS);
  var SUMMARY_MAX = 160;
  var BLURB_MAX_WORDS = 150;
  var MIN_ITEMS = 3;

  // An email address: something@domain.tld. File names such as
  // photo@2x.png are not treated as addresses.
  var EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
  var FILE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|pdf)$/i;

  function findEmails(text) {
    var found = String(text).match(EMAIL_RE) || [];
    return found.filter(function (m) { return !FILE_EXT_RE.test(m); });
  }

  function removeEmails(text) {
    return String(text).replace(EMAIL_RE, function (m) {
      return FILE_EXT_RE.test(m) ? m : '[email removed]';
    });
  }

  function containsEmail(text) {
    if (findEmails(text).length) return true;
    var decoded;
    try { decoded = decodeURIComponent(String(text)); } catch (e) { decoded = String(text); }
    return findEmails(decoded).length > 0 || /^\s*mailto:/i.test(decoded);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      // Text like "javascript:" is harmless once escaped, but encode the
      // colon so the published HTML never contains the string at all.
      .replace(/(javascript|vbscript|data)\s*:/gi, '$1&#58;');
  }

  function slugify(value) {
    return String(value == null ? '' : value)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function parseUrl(value, base) {
    try {
      return base ? new URL(String(value), base) : new URL(String(value));
    } catch (e) {
      return null;
    }
  }

  function isHttpUrl(value, base) {
    var u = parseUrl(value, base);
    return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
  }

  function isHttpsUrl(value) {
    var u = parseUrl(value);
    return !!u && u.protocol === 'https:';
  }

  /*
   * Adds UTM parameters to a link. Keeps the link's own query string
   * exactly as it was (any old utm_* values are replaced) and its #hash.
   */
  function tagUrl(url, params) {
    var u = parseUrl(url);
    if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
    var keep = u.search.replace(/^\?/, '').split('&').filter(function (pair) {
      if (!pair) return false;
      var key = pair.split('=')[0];
      try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
      return !Object.prototype.hasOwnProperty.call(params, key);
    });
    var added = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    });
    u.search = '?' + keep.concat(added).join('&');
    return u.toString();
  }

  function utmContent(item) {
    return slugify(item.team) + '-' + item.id;
  }

  function boardLink(issue, item) {
    return tagUrl(item.link, {
      utm_source: 'website',
      utm_medium: 'newsletter-board',
      utm_campaign: issue.slug,
      utm_content: utmContent(item)
    });
  }

  function emailLink(issue, item) {
    return tagUrl(item.link, {
      utm_source: 'everyaction',
      utm_medium: 'email',
      utm_campaign: issue.slug,
      utm_content: utmContent(item)
    });
  }

  function previewImageLink(issue, boardUrl) {
    return tagUrl(boardUrl, {
      utm_source: 'everyaction',
      utm_medium: 'email',
      utm_campaign: issue.slug,
      utm_content: 'preview-image'
    });
  }

  function cleanString(value) {
    if (value == null) return '';
    if (typeof value === 'object') return '';
    return String(value).replace(/\r\n?/g, '\n').trim();
  }

  /*
   * Keeps only the known fields, as plain strings, and removes every
   * email address. Returns warnings describing anything removed.
   */
  function sanitizeIssue(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var warnings = [];
    var issue = {
      title: cleanString(raw.title),
      slug: cleanString(raw.slug),
      date: cleanString(raw.date)
    };
    Object.keys(issue).forEach(function (k) {
      if (containsEmail(issue[k])) {
        issue[k] = removeEmails(issue[k]);
        warnings.push({ id: null, field: k, message: 'An email address was removed from the issue ' + k + '.' });
      }
    });
    if (!issue.slug) issue.slug = slugify(issue.title) || 'newsletter';
    return { issue: issue, warnings: warnings };
  }

  function sanitizeItems(rawItems) {
    var warnings = [];
    var list = Array.isArray(rawItems) ? rawItems : [];
    var items = list.map(function (raw, index) {
      raw = raw && typeof raw === 'object' ? raw : {};
      var item = {};
      KNOWN_FIELDS.forEach(function (f) { item[f] = cleanString(raw[f]); });
      if (!item.id) item.id = 'item-' + (index + 1);
      var label = item.headline || item.id;

      Object.keys(raw).forEach(function (key) {
        if (KNOWN_FIELDS.indexOf(key) !== -1) return;
        var v = raw[key];
        if (/mail|contact/i.test(key) || (typeof v === 'string' && containsEmail(v))) {
          if (v != null && String(v).trim() !== '') {
            warnings.push({ id: item.id, field: key, message: 'Removed a contact/email field ("' + key + '") from "' + label + '". Email addresses are never shown or published.' });
          }
        }
      });

      TEXT_FIELDS.forEach(function (f) {
        if (containsEmail(item[f])) {
          item[f] = removeEmails(item[f]);
          warnings.push({ id: item.id, field: f, message: 'Removed an email address from the ' + f + ' of "' + label + '".' });
        }
      });
      URL_FIELDS.forEach(function (f) {
        if (item[f] && containsEmail(item[f])) {
          item[f] = '';
          warnings.push({ id: item.id, field: f, message: 'Removed a ' + f + ' from "' + label + '" because it contained an email address.' });
        }
      });
      return item;
    });
    return { items: items, warnings: warnings };
  }

  function wordCount(text) {
    var t = String(text || '').trim();
    return t ? t.split(/\s+/).length : 0;
  }

  /*
   * Checks the included items. Errors block publishing; warnings don't.
   */
  function validate(issue, items) {
    var errors = [];
    var warnings = [];
    var seen = {};
    items = items || [];

    if (!items.length) {
      errors.push({ id: null, message: 'No items are included. Include at least one item in step 2.' });
    }

    items.forEach(function (item) {
      var name = item.headline ? '"' + item.headline + '"' : 'Item ' + item.id;
      if (seen[item.id]) {
        errors.push({ id: item.id, message: 'Two items share the id "' + item.id + '". Each row in the Sheet needs its own id.' });
      }
      seen[item.id] = true;
      if (!item.headline) errors.push({ id: item.id, message: name + ' has no headline.' });
      if (!item.summary) errors.push({ id: item.id, message: name + ' has no one-sentence summary.' });
      if (!item.link) {
        errors.push({ id: item.id, message: name + ' has no link.' });
      } else if (!isHttpsUrl(item.link)) {
        errors.push({ id: item.id, message: name + ' has a link that is not a secure web address (it must start with https://): ' + item.link });
      }

      if (item.summary && item.summary.length > SUMMARY_MAX) {
        warnings.push({ id: item.id, message: name + ' has a summary of ' + item.summary.length + ' characters (aim for ' + SUMMARY_MAX + ' or fewer).' });
      }
      var words = wordCount(item.blurb);
      if (words > BLURB_MAX_WORDS) {
        warnings.push({ id: item.id, message: name + ' has a blurb of ' + words + ' words (aim for ' + BLURB_MAX_WORDS + ' or fewer).' });
      }
      if (!item.image) {
        warnings.push({ id: item.id, message: name + ' has no image, so it will show as a blue text tile.' });
      } else if (!item.imageAlt) {
        warnings.push({ id: item.id, message: name + ' has an image but no alt text (a short description for people using screen readers).' });
      }
    });

    if (items.length > 0 && items.length < MIN_ITEMS) {
      warnings.push({ id: null, message: 'Only ' + items.length + ' item' + (items.length === 1 ? ' is' : 's are') + ' included. Boards look best with at least ' + MIN_ITEMS + '.' });
    }
    return { errors: errors, warnings: warnings };
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // "2026-12-01" -> "December 1st, 2026" (no time zones involved).
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    var month = MONTHS[parseInt(m[2], 10) - 1];
    if (!month) return '';
    return month + ' ' + ordinal(parseInt(m[3], 10)) + ', ' + m[1];
  }

  /*
   * Board order: the featured item first, then the rest in the order given.
   */
  function boardOrder(items) {
    var featured = items.filter(function (i) { return i.featured; }).slice(0, 1);
    return featured.concat(items.filter(function (i) { return featured.indexOf(i) === -1; }));
  }

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map(function (p) {
      return p.trim();
    }).filter(Boolean).map(function (p) {
      return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function cssUrlSafe(base) {
    return /^[^"'()\\\s<>]*$/.test(base) ? base : '';
  }

  /*
   * Prepares styles/board.css for publishing: points the font files at
   * fontBaseUrl and drops the optional real-font blocks that are off.
   */
  function processCss(css, opts) {
    opts = opts || {};
    var realFonts = opts.realFonts || {};
    var out = String(css || '').replace(/\/\* n350:font (\w+) \*\/([\s\S]*?)\/\* n350:end \*\//g, function (all, name, body) {
      return realFonts[name] ? body.trim() : '';
    });
    var base = cssUrlSafe(opts.fontBaseUrl || '');
    if (base) {
      if (!/\/$/.test(base)) base += '/';
      out = out.replace(/url\("\.\.\/fonts\//g, 'url("' + base);
    }
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function fontFaceRules(css) {
    return (String(css).match(/@font-face\s*\{[^}]*\}/g) || []).join('\n');
  }

  function renderTile(issue, item, opts) {
    var imageUrl = item.image ? parseUrl(item.image, opts.assetBaseUrl || undefined) : null;
    var hasImage = !!imageUrl && (imageUrl.protocol === 'http:' || imageUrl.protocol === 'https:');
    var classes = ['n350-tile', hasImage ? 'n350-tile--image' : 'n350-tile--text'];
    if (item.featured) classes.push('n350-tile--featured');

    var media = hasImage
      ? '<span class="n350-media"><img src="' + escapeHtml(imageUrl.toString()) + '" alt="' +
        escapeHtml(item.imageAlt) + '" loading="lazy" decoding="async"></span>'
      : '';

    var link = isHttpUrl(item.link) ? boardLink(issue, item) : null;
    var label = item.linkLabel || 'Read more';
    var button = link
      ? '<p><a class="n350-button" href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(label) + '<span class="n350-sr"> about ' + escapeHtml(item.headline) +
        ' (opens in a new tab)</span></a></p>'
      : '';

    return (
      '<li class="' + classes.join(' ') + '">' +
        '<details class="n350-details">' +
          '<summary class="n350-summary">' +
            media +
            '<span class="n350-caption">' +
              (item.featured ? '<span class="n350-badge">Featured</span>' : '') +
              '<span class="n350-meta"><span class="n350-team">' + escapeHtml(item.team) + '</span>' +
                (item.team && item.category ? '<span class="n350-sep" aria-hidden="true">·</span>' : '') +
                '<span class="n350-category">' + escapeHtml(item.category) + '</span></span>' +
              '<span class="n350-headline">' + escapeHtml(item.headline) + '</span>' +
              '<span class="n350-toggle" aria-hidden="true"><span class="n350-toggle-open">Read the update +</span>' +
                '<span class="n350-toggle-close">Close &minus;</span></span>' +
            '</span>' +
          '</summary>' +
          '<div class="n350-body">' + paragraphs(item.blurb) + button + '</div>' +
        '</details>' +
      '</li>'
    );
  }

  /*
   * render(issue, items, opts) -> { html, css, fragment }
   *   items: the included items, in order; one may have featured: true.
   *   opts.css: the text of styles/board.css
   *   opts.fontBaseUrl: where the fonts live (absolute URL for publishing)
   *   opts.assetBaseUrl: base for relative image paths (sample data)
   *   opts.realFonts: { newKansas: bool, avantGarde: bool }
   * fragment = '<style>css</style>' + html, which is what gets published.
   */
  function render(issue, items, opts) {
    opts = opts || {};
    issue = issue || {};
    var ordered = boardOrder(items || []);
    var css = processCss(opts.css || '', opts)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/<\/style/gi, '<\\/style')
      .trim() + '\n';
    var dateText = formatDate(issue.date) || issue.title || '';
    var label = '350 Seattle Newsletter' + (issue.title ? ', ' + issue.title : '');

    var html =
      '<div class="n350-board" lang="en">' +
        '<header class="n350-masthead">' +
          '<p class="n350-org">350 Seattle</p>' +
          '<p class="n350-kicker">Newsletter</p>' +
          (dateText ? '<p class="n350-date">' + escapeHtml(dateText) + '</p>' : '') +
        '</header>' +
        '<section class="n350-section" aria-label="' + escapeHtml(label) + ' news board">' +
          '<h2 class="n350-heading">News Board</h2>' +
          '<ul class="n350-grid">' +
            ordered.map(function (item) { return renderTile(issue, item, opts); }).join('') +
          '</ul>' +
        '</section>' +
      '</div>';

    return { html: html, css: css, fragment: '<style>\n' + css + '</style>\n' + html };
  }

  /*
   * Every link on the board, for the "test each link" list.
   */
  function boardLinks(issue, items) {
    return boardOrder(items || []).map(function (item) {
      return { id: item.id, headline: item.headline, url: isHttpUrl(item.link) ? boardLink(issue, item) : null, raw: item.link };
    });
  }

  /*
   * Email summary for EveryAction, grouped by category in board order.
   * Returns { html, text, links, previewUrl }.
   */
  function buildEmail(issue, items, boardUrl) {
    var groups = [];
    var byName = {};
    boardOrder(items || []).forEach(function (item) {
      var key = item.category || 'Updates';
      if (!byName[key]) {
        byName[key] = { category: key, items: [] };
        groups.push(byName[key]);
      }
      byName[key].items.push(item);
    });

    var links = [];
    var htmlParts = [];
    var textParts = [];
    groups.forEach(function (g) {
      htmlParts.push('<h3 style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;color:#4254B0;margin:24px 0 8px;">' +
        escapeHtml(g.category) + '</h3>');
      textParts.push(g.category.toUpperCase());
      g.items.forEach(function (item) {
        var url = isHttpUrl(item.link) ? emailLink(issue, item) : null;
        if (url) links.push({ id: item.id, team: item.team, url: url });
        htmlParts.push(
          '<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#000000;margin:0 0 16px;">' +
            '<strong>' + escapeHtml(item.headline) + '</strong><br>' +
            escapeHtml(item.summary) +
            (url ? '<br><a href="' + escapeHtml(url) + '" style="color:#0068A5;">Read more</a>' : '') +
          '</p>');
        textParts.push('');
        textParts.push(item.headline);
        textParts.push(item.summary);
        if (url) textParts.push('Read more: ' + url);
      });
      textParts.push('');
      textParts.push('');
    });

    return {
      html: htmlParts.join('\n'),
      text: textParts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
      links: links,
      previewUrl: boardUrl ? previewImageLink(issue, boardUrl) : null
    };
  }

  function previewAltText(issue, items) {
    var heads = boardOrder(items || []).map(function (i) { return i.headline; }).filter(Boolean);
    return '350 Seattle news board' + (issue && issue.title ? ' for ' + issue.title : '') +
      (heads.length ? ': ' + heads.join('; ') : '') + '. Click to read the full board.';
  }

  return {
    render: render,
    processCss: processCss,
    fontFaceRules: fontFaceRules,
    sanitizeIssue: sanitizeIssue,
    sanitizeItems: sanitizeItems,
    validate: validate,
    tagUrl: tagUrl,
    slugify: slugify,
    escapeHtml: escapeHtml,
    isHttpUrl: isHttpUrl,
    isHttpsUrl: isHttpsUrl,
    formatDate: formatDate,
    boardOrder: boardOrder,
    boardLinks: boardLinks,
    buildEmail: buildEmail,
    previewImageLink: previewImageLink,
    previewAltText: previewAltText,
    containsEmail: containsEmail,
    LIMITS: { SUMMARY_MAX: SUMMARY_MAX, BLURB_MAX_WORDS: BLURB_MAX_WORDS, MIN_ITEMS: MIN_ITEMS }
  };
});
