/* ===========================================================================
 *  catalog-data.js — שכבת נתונים: נרמול עברי, חיפוש, טעינה עצלה של שברים ומחיצות אינדקס.
 *
 *  מבנה הנתונים (נוצר ע"י tools/build_catalog.py):
 *    data/cat-index.js          window.CAT_INDEX: מחברים (שורות חיפוש), טבלאות עזר
 *    data/shards/cat-b<n>.js    רשומות ספרים מלאות   -> CAT_REGISTER_SHARD("b<n>", {start, recs:[...]})
 *    data/shards/cat-a<n>.js    רשומות מחברים מלאות  -> CAT_REGISTER_SHARD("a<n>", {start, recs:[...]})
 *    data/shards/cat-p<n>.js    מחיצת אינדקס ספרים (לפי תחילית המילה המשמעותית הראשונה בכותר)
 *                               -> CAT_REGISTER_PART(n, [[id, title, firstAuthorId, year], ...])
 *  מזהים הם מספרים סדרתיים; השבר של מזהה נמצא בחיפוש בינארי בטבלאות bstart/astart.
 *
 *  ממשק ציבורי (window.CAT):
 *    CAT.search(query, {type, all}) -> Promise<{books, authors, partial}>   (שורות: {row, score})
 *       שורת ספר: [id, title, authorName, year]; שורת מחבר: [id, name, '', bookCount, lifeText]
 *       partial=true: חיפוש ספרים נעשה רק במחיצות שמתאימות לתחילת הכותר; opts.all=true סורק את כל הקטלוג.
 *    CAT.getBook(id) / CAT.getAuthor(id) -> Promise<רשומה מורחבת | null>
 *    CAT.authorName(id), CAT.norm(str), CAT.sources, CAT.holdings, CAT.index
 * ========================================================================= */
(function () {
  'use strict';
  var IDX = window.CAT_INDEX || { authors: [], sources: {}, holdings: [], bstart: [], astart: [], parts: [] };
  var shards = {};          // "b0" -> {start, recs}
  var partData = {};        // n -> rows (מנורמלים)
  var loading = {};         // key -> Promise
  var rawParts = {};

  window.CAT_REGISTER_SHARD = function (key, data) { shards[key] = data; };
  window.CAT_REGISTER_PART = function (n, rows) { rawParts[n] = rows; };

  /* ----- נרמול עברי (זהה לנרמול בסקריפט הבנייה) ----- */
  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[֑-ׇ]/g, '')
      .replace(/[׳״"'`‘’“”]/g, '')
      .replace(/[־\-–—_.,;:!?()\[\]{}<>\/\|]/g, ' ')
      .replace(/[ךםןףץ]/g, function (c) { return FINALS[c]; })
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  /* שלד כתיב: מסיר ו/י שאינן בתחילת מילה (חסר/מלא) */
  function skel(n) {
    return n.split(' ').map(function (w) { return w.charAt(0) + w.slice(1).replace(/[וי]/g, ''); }).join(' ');
  }
  function stripPrefix(w) { return (w.length > 3 && /^[הו]/.test(w)) ? w.slice(1) : w; }

  /* ----- מחברים: אינדקס בזיכרון (נבנה פעם אחת) ----- */
  var authorName = new Map();
  var authorRows = (IDX.authors || []).map(function (r) {
    authorName.set(r[0], r[1]);
    var t = norm(r[1] + ' ' + (r[4] || ''));
    return { r: r, n: t, s: skel(t), title: norm(r[1]) };
  });

  function scoreRow(o, toks) {
    var score = 0;
    var words = o.n.split(' '), swords = o.s.split(' ');
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], tn = t.n, ts = t.s, alt = t.alt, altS = t.altS, best = 0;
      for (var j = 0; j < words.length && best < 10; j++) {
        if (words[j] === tn || words[j] === alt) best = Math.max(best, 10);
        else if (words[j].indexOf(tn) === 0 || (alt && words[j].indexOf(alt) === 0)) best = Math.max(best, 7);
        else if (swords[j] === ts || swords[j] === altS) best = Math.max(best, 6);
        else if (swords[j].indexOf(ts) === 0 || (altS && swords[j].indexOf(altS) === 0)) best = Math.max(best, 4);
      }
      if (!best && (o.n.indexOf(tn) !== -1 || o.s.indexOf(ts) !== -1)) best = 2;
      if (!best) return 0;
      score += best;
    }
    if (o.title === toks.map(function (x) { return x.n; }).join(' ')) score += 20;
    /* מחברים: שובר שוויון לפי מספר הספרים (מחבר בולט, כמו הרמב"ם, לפני בעלי שם דומה); שורת ספר: r[2] מחרוזת */
    if (typeof o.r[2] === 'number' && o.r[2] > 1) score += Math.min(6, Math.floor(Math.log(o.r[2])));
    return score;
  }

  /* ----- טעינת סקריפטים ----- */
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { s.remove(); ok(); };
      s.onerror = function () { s.remove(); bad(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function url(kind, n) {
    var v = '';   /* הגרסה כבר בשם הקובץ (בלי ?v=) */
    return (IDX.shardPath || 'data/shards/cat-') + kind + n + (IDX.shardExt || '.js') + v;
  }
  function once(key, fn) {
    if (!loading[key]) loading[key] = fn().catch(function (e) { delete loading[key]; throw e; });
    return loading[key];
  }
  function loadShard(kind, n) {
    var key = kind + n;
    if (shards[key]) return Promise.resolve(shards[key]);
    return once(key, function () { return loadScript(url(kind, n)).then(function () { return shards[key] || { start: 0, recs: [] }; }); });
  }
  function loadPart(n) {
    if (partData[n]) return Promise.resolve(partData[n]);
    return once('p' + n, function () {
      return loadScript(url('p', n)).then(function () {
        var rows = (rawParts[n] || []).map(function (r) {
          var nm = authorName.get(r[2]) || '';
          var t = norm(r[1] + ' ' + nm);
          return { r: [r[0], r[1], nm, r[3]], n: t, s: skel(t), title: norm(r[1]) };
        });
        delete rawParts[n];
        partData[n] = rows;
        return rows;
      });
    });
  }

  /* ----- איתור שבר לפי מזהה (חיפוש בינארי בטבלת התחלות) ----- */
  function shardFor(starts, id) {
    var lo = 0, hi = starts.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (starts[mid] <= id) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
  function fetchRec(kind, starts, id) {
    id = Number(id);
    var n = shardFor(starts || [], id);
    if (n < 0) return Promise.resolve(null);
    return loadShard(kind, n).then(function (s) { return (s.recs && s.recs[id - s.start]) || null; }).catch(function () { return null; });
  }
  function srcList(arr) { return (arr || []).map(function (c) { return { src: c }; }); }

  function getBook(id) {
    return fetchRec('b', IDX.bstart, id).then(function (b) {
      if (!b) return null;
      /* b.h: [libIndex | [libIndex, shelf], ...] מסודר לפי חשיבות; IDX.libs: [name, kind, city, area, address, phone, hours] */
      var hold = (b.h || []).map(function (x) {
        var i = Array.isArray(x) ? x[0] : x, l = (IDX.libs || [])[i];
        if (!l) return null;
        return { name: l[0], kind: l[1], city: l[2] || '', area: l[3] || '', address: l[4] || '', phone: l[5] || '',
                 hours: l[6] || '', shelf: Array.isArray(x) ? x[1] : '' };
      }).filter(Boolean);
      return {
        id: Number(id), title: b.t, subtitle: b.st || '', alt: b.alt || [], authors: b.au || [], otherPersons: b.aa || '',
        translators: b.tr || '', series: b.se || '', approbations: b.ap || [], notes: b.n || '', lang: b.lg || '',
        subjects: b.sb || [], editions: b.eds || [], sources: (b.s || []).map(function (x) { return { src: x[0], ref: x[1] }; }),
        holdings: hold, recordCount: b.sc || 1
      };
    });
  }
  function getAuthor(id) {
    return fetchRec('a', IDX.astart, id).then(function (a) {
      if (!a) return null;
      return { id: Number(id), name: a.n, altNames: a.al || [], birth: a.b || '', death: a.d || '', books: a.bk || [],
               bookCount: a.c || (a.bk || []).length, sources: srcList(a.s) };
    });
  }

  /* ----- חיפוש ----- */
  function tokensOf(q) {
    return q.split(' ').map(function (w) {
      var a = stripPrefix(w);
      return { n: w, s: skel(w), alt: a !== w ? a : '', altS: a !== w ? skel(a) : '' };
    });
  }
  function partsFor(q, all) {
    var pr = IDX.parts || [], out = [], i;
    if (all) { for (i = 0; i < pr.length; i++) out.push(i); return out; }
    var keys = [];
    q.split(' ').forEach(function (w) {
      keys.push(w);
      if (/^[הו]/.test(w) && w.length > 1) keys.push(w.slice(1));
    });
    for (i = 0; i < pr.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        var p = pr[i], t = keys[k];
        if (p.indexOf(t) === 0 || t.indexOf(p) === 0) { out.push(i); break; }
      }
    }
    return out;
  }
  function run(list, toks, limit) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var sc = scoreRow(list[i], toks);
      if (sc) out.push({ row: list[i].r, score: sc });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, limit);
  }
  function search(query, opts) {
    opts = opts || {};
    var limit = opts.limit || 200;
    var q = norm(query);
    if (!q) return Promise.resolve({ books: [], authors: [], partial: false });
    var toks = tokensOf(q);
    var authors = [];
    if (opts.type !== 'books') {
      authors = run(authorRows, toks, limit).map(function (o) {
        var r = o.row; return { row: [r[0], r[1], '', r[2], r[3]], score: o.score };
      });
    }
    if (opts.type === 'authors') return Promise.resolve({ books: [], authors: authors, partial: false });
    var ps = partsFor(q, !!opts.all);
    return Promise.all(ps.map(loadPart)).then(function (lists) {
      var all = [];
      lists.forEach(function (l) { for (var i = 0; i < l.length; i++) all.push(l[i]); });
      return { books: run(all, toks, limit), authors: authors, partial: !opts.all };
    }).catch(function () { return { books: [], authors: authors, partial: true, error: true }; });
  }

  window.CAT = {
    ready: Promise.resolve(),
    index: IDX,
    sources: IDX.sources || {},
    holdings: IDX.libs || [],
    libs: IDX.libs || [],
    norm: norm,
    search: search,
    authorName: function (id) { return authorName.get(id) || ''; },
    getBook: getBook,
    getAuthor: getAuthor
  };
})();
