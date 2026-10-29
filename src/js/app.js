/* ===========================================================================
 *  app.js — ממשק אוצר הספרים + אינטגרציה עם אוצריא (תפריט הקשר, ערכת נושא, פתיחת ספר)
 * ========================================================================= */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var hasOtz = function () { return typeof window.Otzaria !== 'undefined' && window.Otzaria.call; };
  var state = { type: 'all', selId: null, selKind: null, seq: 0, extended: false };

  /* ----- ערכת נושא מאוצריא ----- */
  function applyTheme(theme) {
    if (!theme) return;
    var cs = theme.colorScheme || {}, r = document.documentElement;
    var MAP = { '--c-primary': 'primary', '--c-on-primary': 'onPrimary', '--c-primary-container': 'primaryContainer',
      '--c-on-primary-container': 'onPrimaryContainer', '--c-surface': 'surface', '--c-on-surface': 'onSurface',
      '--c-on-surface-var': 'onSurfaceVariant', '--c-sc-low': 'surfaceContainerLow', '--c-sc': 'surfaceContainer',
      '--c-sc-high': 'surfaceContainerHigh', '--c-outline': 'outline', '--c-outline-var': 'outlineVariant', '--c-error': 'error' };
    Object.keys(MAP).forEach(function (k) {
      var v = cs[MAP[k]];
      if (v) r.style.setProperty(k, v); else r.style.removeProperty(k);
    });
    var f = theme.typography && theme.typography.uiFontFamily;
    if (f) r.style.setProperty('--font', "'" + f + "',system-ui,-apple-system,'Segoe UI',sans-serif");
  }

  /* ----- עזרים ----- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2500);
  }
  function srcName(id) { return (CAT.sources && CAT.sources[id]) || id; }

  function svg(inner, w, extra) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', w || 20); s.setAttribute('height', w || 20);
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    if (extra) s.setAttribute('class', extra);
    s.innerHTML = inner; return s;
  }
  function chev() { return svg('<path d="M15 6l-6 6 6 6"/>', 20, 'chev'); }
  function avatar(name, kind) {
    var ch = String(name || '').replace(/^[^א-תA-Za-z0-9]+/, '').charAt(0) || '·';
    return el('div', 'av' + (kind === 'author' ? ' author' : ''), ch);
  }
  var SUGGEST = ['משנה תורה', 'שולחן ערוך', 'רמב"ם', 'ספר החינוך', 'רש"י', 'מסילת ישרים'];
  function homeBox() {
    var h = el('div', 'home-box');
    var s = el('div', 'sug'); s.appendChild(el('h3', null, 'נסו לחפש'));
    var row = el('div', 'sug-row');
    SUGGEST.forEach(function (t) {
      var b = el('button', 'sug-btn'); b.type = 'button';
      b.appendChild(svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 16));
      b.appendChild(document.createTextNode(t));
      b.onclick = function () { var q = $('q'); q.value = t; $('clearBtn').hidden = false; state.extended = false; runSearch(t); q.focus(); };
      row.appendChild(b);
    });
    s.appendChild(row); h.appendChild(s);
    return h;
  }

  /* ----- רשימת תוצאות ----- */
  function renderList(res, query) {
    var box = $('listPane'); box.textContent = '';
    document.body.classList.toggle('home', !query);
    if (!query) { box.appendChild(homeBox()); return; }
    if (!res.books.length && !res.authors.length) { box.appendChild(el('div', 'empty', 'לא נמצאו תוצאות')); return; }
    function group(title, rows, kind) {
      if (!rows.length) return;
      box.appendChild(el('div', 'group', title + ' (' + rows.length + ')'));
      rows.slice(0, 100).forEach(function (o, i) {
        var r = o.row, b = el('button', 'item'); b.type = 'button';
        b.style.animationDelay = Math.min(i, 12) * 25 + 'ms';
        b.dataset.id = String(r[0]); b.dataset.kind = kind;
        if (String(state.selId) === String(r[0]) && state.selKind === kind) b.classList.add('sel');
        b.appendChild(avatar(r[1], kind));
        var tx = el('div', 'txt');
        tx.appendChild(el('div', 't', r[1]));
        tx.appendChild(el('div', 's', kind === 'book' ? [r[2], r[3]].filter(Boolean).join(' · ') : (r[4] || '') + (r[3] ? '  ·  ' + r[3] + ' ספרים' : '')));
        b.appendChild(tx); b.appendChild(chev());
        b.onclick = function () { openEntry(kind, r[0]); };
        box.appendChild(b);
      });
    }
    group('ספרים', res.books, 'book');
    group('מחברים', res.authors, 'author');
    if (res.partial && state.type !== 'authors') {
      var more = el('button', 'btn alt', 'חיפוש מורחב בכל הקטלוג (מילים מתוך הכותר)'); more.type = 'button';
      more.onclick = function () { state.extended = true; more.textContent = 'מחפש…'; more.disabled = true; runSearch($('q').value); };
      var w = el('div', 'group more'); w.appendChild(more); box.appendChild(w);
    }
    if (res.error) box.appendChild(el('div', 'empty', 'שגיאה בטעינת חלק מהנתונים'));
  }

  function runSearch(q) {
    var my = ++state.seq;
    var p = CAT.search(q, { type: state.type === 'all' ? null : state.type, all: state.extended });
    return p.then(function (res) {
      if (my === state.seq) renderList(res, q.trim());
      return res;
    });
  }

  /* ----- כרטיסי פרטים ----- */
  function showDetail(node) {
    var d = $('detailPane'); d.textContent = ''; d.appendChild(node); d.hidden = false;
    document.body.classList.add('show-detail'); d.scrollTop = 0;
  }
  function backBtn() {
    var b = el('button', 'btn alt back'); b.type = 'button';
    b.appendChild(svg('<path d="M9 6l6 6-6 6"/>', 18)); b.appendChild(document.createTextNode('חזרה לתוצאות'));
    b.onclick = function () { document.body.classList.remove('show-detail'); $('detailPane').hidden = true; };
    return b;
  }
  function kv(dl, k, v) { if (v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); } }
  function sourcesBlock(srcs) {
    var f = document.createDocumentFragment();
    if (!srcs || !srcs.length) return f;
    f.appendChild(el('div', 'sec', 'מקורות הנתון'));
    var t = el('div', 'tags');
    srcs.forEach(function (s) { t.appendChild(el('span', 'tag', srcName(s.src) + (s.ref ? ': ' + s.ref : ''))); });
    f.appendChild(t); return f;
  }

  function openEntry(kind, id) {
    state.selId = id; state.selKind = kind;
    [].forEach.call(document.querySelectorAll('.item'), function (b) {
      b.classList.toggle('sel', b.dataset.id === String(id) && b.dataset.kind === kind);
    });
    return (kind === 'book' ? CAT.getBook(id) : CAT.getAuthor(id)).then(function (rec) {
      if (!rec) { showDetail(el('div', 'empty', 'הרשומה לא נמצאה (שבר נתונים חסר)')); return; }
      showDetail(kind === 'book' ? bookCard(rec) : authorCard(rec));
    });
  }

  /* "היכן הספר נמצא": ספרייה/בית כנסת/ישיבה מקובצים לפי עיר; תקליטורים בקטע נפרד */
  function holdingsBlock(c, hold) {
    var soft = [], phys = [];
    hold.forEach(function (h) { (h.kind === 'תקליטור/תוכנה' || h.kind === 'שירות' ? soft : phys).push(h); });
    if (phys.length) {
      c.appendChild(el('div', 'sec', 'היכן הספר נמצא'));
      var order = [], by = {};
      phys.forEach(function (h) { var k = h.city || 'מקום לא צוין'; if (!by[k]) { by[k] = []; order.push(k); } by[k].push(h); });
      order.forEach(function (city) {
        var g = el('div', 'loc-group'); g.appendChild(el('div', 'loc-city', city));
        by[city].forEach(function (h) {
          var row = el('div', 'loc'); row.appendChild(el('div', 'loc-name', h.name));
          var meta = [h.kind, h.area ? 'שכונת ' + h.area : '', h.address].filter(Boolean).join(' · ');
          row.appendChild(el('div', 'loc-meta', meta));
          if (h.shelf) row.appendChild(el('div', 'loc-meta', 'מדף/סיווג: ' + h.shelf));
          if (!h.address) row.appendChild(el('div', 'loc-none', 'כתובת: לא מופיעה בקטלוג'));
          if (h.phone) row.appendChild(el('div', 'loc-meta', 'טלפון: ' + h.phone));
          if (h.hours) row.appendChild(el('div', 'loc-meta', 'שעות: ' + h.hours));
          g.appendChild(row);
        });
        c.appendChild(g);
      });
    }
    if (soft.length) {
      c.appendChild(el('div', 'sec', 'זמין גם בתוכנה'));
      var ht = el('div', 'tags');
      soft.forEach(function (h) { ht.appendChild(el('span', 'tag', h.name)); });
      c.appendChild(ht);
    }
  }

  function bookCard(b) {
    var c = el('div'); c.appendChild(backBtn());
    var hd = el('div', 'hd'); hd.appendChild(avatar(b.title, 'book'));
    var ht0 = el('div'); ht0.appendChild(el('h2', null, b.title));
    if (b.subtitle) ht0.appendChild(el('div', 'sub', b.subtitle));
    hd.appendChild(ht0); c.appendChild(hd);
    var dl = el('dl', 'kv');
    var a = el('dd');
    (b.authors || []).forEach(function (aid, i) {
      if (i) a.appendChild(document.createTextNode(', '));
      var l = el('button', 'link', CAT.authorName(aid) || String(aid)); l.type = 'button';
      l.onclick = function () { openEntry('author', aid); };
      a.appendChild(l);
    });
    if ((b.authors || []).length) { dl.appendChild(el('dt', null, 'מחבר')); dl.appendChild(a); }
    kv(dl, 'כותרים נוספים', (b.alt || []).join(' · '));
    kv(dl, 'אישים נוספים', b.otherPersons); kv(dl, 'מתרגם', b.translators);
    kv(dl, 'סדרה', b.series); kv(dl, 'שפה', b.lang); kv(dl, 'נושאים', (b.subjects || []).join(' · '));
    c.appendChild(dl);
    var eds = b.editions || [];
    if (eds.length) {
      c.appendChild(el('div', 'sec', eds.length > 1 ? 'מהדורות (' + eds.length + ')' : 'מהדורה'));
      eds.forEach(function (e) {
        var yr = e.y && e.g && String(e.y) !== String(e.g) ? e.y + ' (' + e.g + ')' : (e.y || e.g || '');
        var line = el('div', 'ed', [e.p, yr, e.u, e.e, e.pg].filter(Boolean).join(' · '));
        c.appendChild(line);
      });
    }
    if (b.holdings && b.holdings.length) holdingsBlock(c, b.holdings);
    if (b.approbations && b.approbations.length) {
      c.appendChild(el('div', 'sec', 'הסכמות'));
      b.approbations.forEach(function (h) {
        c.appendChild(el('div', null, typeof h === 'string' ? h : [h.name, h.place, h.year].filter(Boolean).join(' · ')));
      });
    }
    if (b.notes) { c.appendChild(el('div', 'sec', 'הערות')); c.appendChild(el('div', null, b.notes)); }
    var act = el('div', 'sec'); c.appendChild(act);
    addLibraryButton(act, b);
    return c;
  }

  function authorCard(a) {
    var c = el('div'); c.appendChild(backBtn());
    var hd = el('div', 'hd'); hd.appendChild(avatar(a.name, 'author'));
    hd.appendChild(el('h2', null, a.name)); c.appendChild(hd);
    var dl = el('dl', 'kv');
    kv(dl, 'שמות נוספים', (a.altNames || []).join(' · '));
    kv(dl, 'שנות חיים', [a.birth, a.death].filter(Boolean).join(' - '));
    c.appendChild(dl);
    if (a.books && a.books.length) {
      c.appendChild(el('div', 'sec', 'ספרים בקטלוג (' + (a.bookCount || a.books.length) + (a.bookCount > a.books.length ? ', מוצגים ' + a.books.length : '') + ')'));
      a.books.forEach(function (bk) {
        var b = el('button', 'item'); b.type = 'button';
        var tx = el('div', 'txt');
        tx.appendChild(el('div', 't', bk[1])); if (bk[2]) tx.appendChild(el('div', 's', bk[2]));
        b.appendChild(tx); b.appendChild(chev());
        b.onclick = function () { openEntry('book', bk[0]); };
        c.appendChild(b);
      });
    }
    return c;
  }

  /* ----- פתיחה בספריית אוצריא: זיהוי הספר הנכון (library.findBooks + מחברים לפי data/lib-authors.js) ----- */
  var MAXC = 10;
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { s.remove(); ok(); };
      s.onerror = function () { s.remove(); bad(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function tn(s) { return CAT.norm(s).replace(/\s/g, ''); }
  function libKey(t) { return String(t || '').replace(/[^א-ת]/g, ''); }
  /* אינדקס הספרייה: מפתח אותיות -> מחברים, ורשימת כותרים. נטען עצלנית (כשנפתח כרטיס ספר); כשל = בלי נתוני מחבר */
  var libP = null;
  function loadLib() {
    if (!libP) libP = (window.LIB_AUTHORS ? Promise.resolve() : loadScript('data/lib-authors.js')).then(function () {
      var raw = window.LIB_AUTHORS || {}, byKey = {}, list = [];
      Object.keys(raw).forEach(function (t) {
        var au = (raw[t] || []).filter(Boolean), k = libKey(t);
        if (!k) return;
        list.push({ t: t, k: tn(t), au: au });
        var cur = byKey[k] || (byKey[k] = []);
        au.forEach(function (a) { if (cur.indexOf(a) < 0) cur.push(a); });
      });
      return { byKey: byKey, list: list };
    }).catch(function () { return { byKey: {}, list: [] }; });
    return libP;
  }
  var NT = { 'ר': 1, 'רבי': 1, 'הרב': 1, 'רבינו': 1, 'רבנו': 1, 'מהר': 1, 'מוהר': 1, 'הגאון': 1, 'הצדיק': 1 };
  function brackets(s) {
    var out = [], re = /[\[(]([^\])]+)[\])]/g, m;
    while ((m = re.exec(String(s || '')))) out.push(m[1]);
    return out;
  }
  function stripBr(s) { return String(s || '').replace(/[\[(][^\])]*[\])]/g, ' '); }
  function nameToks(s, keepSon) {   // טוקנים בלי תארים; בלי "בן/בר + שם אב" אלא אם keepSon
    var t = CAT.norm(s).split(' ').filter(Boolean), out = [];
    for (var i = 0; i < t.length; i++) {
      var w = t[i];
      if (!keepSon && (w === 'בנ' || w === 'בר')) { i++; continue; }
      if (NT[w]) continue;
      out.push(w === 'וילנא' ? 'וילנה' : w);
    }
    return out;
  }
  function wholeKey(s) { return nameToks(s, true).join(''); }
  function profileOf(name, alts) {
    var al = {}, toks = {};
    [name].concat(alts || []).forEach(function (x) {
      brackets(x).forEach(function (b) { al[wholeKey(b)] = 1; });
      al[wholeKey(stripBr(x))] = 1;
    });
    nameToks(stripBr(name)).forEach(function (w) { toks[w] = 1; });
    delete al[''];
    return { al: al, toks: toks, n: Object.keys(toks).length };
  }
  function oneMatch(authors, P) {
    return authors.some(function (a) {
      var forms = [stripBr(a)].concat(brackets(a));
      return forms.some(function (f) {
        var t = nameToks(f);
        if (!t.length) return false;
        if (P.al[wholeKey(f)]) return true;
        var common = t.filter(function (w) { return P.toks[w]; }).length;
        return common >= 2;
      });
    });
  }
  function authorMatches(authors, profs) { return profs.some(function (P) { return oneMatch(authors, P); }); }

  /* זהות ספר לקריאות API: עדיפות ל-bookUid, אחר כך id, ולבסוף bookId */
  function bookIdent(b) {
    if (b.bookUid) return { bookUid: b.bookUid };
    if (b.id != null) return { id: b.id };
    return { bookId: b.bookId };
  }
  function bookKey(b) { return b.bookUid || (b.id != null ? 'id:' + b.id : 'b:' + b.bookId); }
  function pool(tasks, n) {
    var i = 0, out = [];
    function w() { return i >= tasks.length ? Promise.resolve() : tasks[i++]().then(function (r) { out.push(r); return w(); }); }
    var ws = []; for (var k = 0; k < n; k++) ws.push(w());
    return Promise.all(ws).then(function () { return out; });
  }
  function findBooks(q) {
    return window.Otzaria.call('library.findBooks', { query: q, limit: 12 }).then(function (r) {
      return (r && r.success !== false && Array.isArray(r.data)) ? r.data : [];
    }).catch(function () { return []; });
  }

  var resolveCache = {};
  /* אוסף מועמדים לרשומת ספר ומחליט אם יש ספר חד-משמעי. -> {cands (ממוינים), direct (או null)} */
  function resolveBook(b) {
    var ck = b.id != null ? 'b' + b.id : b.title;
    if (resolveCache[ck]) return resolveCache[ck];
    var ids = (b.authors || []).slice(0, 4);
    resolveCache[ck] = Promise.all([loadLib(), Promise.all(ids.map(function (id) {
      return CAT.getAuthor(id).catch(function () { return null; });
    }))]).then(function (rs) {
      var lib = rs[0], profs = [];
      rs[1].forEach(function (a, i) {
        var nm = a ? a.name : CAT.authorName(ids[i]);
        if (nm) profs.push(profileOf(nm, a ? a.altNames : []));
      });
      var raw = [b.title].concat((b.alt || []).slice(0, 5), [b.subtitle]).filter(Boolean), seenF = {}, forms = [], core = [];
      raw.forEach(function (x) { var c0 = String(x).split(/\s+[-–—]+\s+|\s*[(\[]/)[0].trim(); if (c0 && c0 !== String(x).trim()) core.push(c0); });
      raw = raw.concat(core);
      raw.forEach(function (x) { var n = tn(x); if (n && !seenF[n]) { seenF[n] = 1; forms.push({ n: n, q: String(x).trim() }); } });
      var mine = [], isPerson = profs.some(function (P) { return raw.some(function (x) { return P.al[wholeKey(x)]; }); });
      var queries = [], seenQ = {};
      function addQ(q) { if (q && !seenQ[q]) { seenQ[q] = 1; queries.push(q); } }
      forms.forEach(function (f) { addQ(f.q); addQ(f.q.replace(/["'׳״]/g, '')); });
      var tasks = queries.map(function (q) { return function () { return findBooks(q); }; });
      if (isPerson) {
        mine = lib.list.filter(function (x) { return x.au.length && authorMatches(x.au, profs); }).slice(0, 250);
        var textAll = forms.map(function (f) { return f.n; }).join('|');
        mine.forEach(function (x) { x.rel = x.k.length >= 4 && textAll.indexOf(x.k) >= 0 ? 0 : 1; });
        mine.sort(function (a, c) { return (a.rel - c.rel) || (a.k.length - c.k.length); });
        mine.filter(function (x) { return x.rel === 0; }).slice(0, 10).forEach(function (x) {
          tasks.push(function () {
            return findBooks(x.t).then(function (r) { return r.filter(function (y) { return y && tn(y.title) === x.k; }).map(function (y) { y.__viaAuthor = 1; return y; }); });
          });
        });
      }
      return pool(tasks, 4).then(function (res) {
        var seen = {}, cands = [];
        res.forEach(function (list) {
          list.forEach(function (x) {
            if (!x || x.title == null) return;
            var k = bookKey(x);
            if (seen[k]) return;
            var nt = tn(x.title), s = 0;
            forms.forEach(function (f) {
              var v = 0;
              if (nt === f.n) v = 100;
              else if (nt.indexOf(f.n) === 0) v = 60;
              else if (nt.indexOf(f.n) >= 0) v = 40;
              else if (nt.length >= 4 && f.n.indexOf(nt) >= 0) v = 30;
              if (v > s) s = v;
            });
            if (!s && x.__viaAuthor) s = 20;
            if (!s) return;
            seen[k] = 1;
            var au = lib.byKey[libKey(x.title)] || [];
            var match = (au.length && profs.length) ? authorMatches(au, profs) : null;
            cands.push({ b: x, s: s, exact: s === 100, title: String(x.title), categoryPath: x.categoryPath || '', authors: au, match: match,
              rank: match === true ? 0 : (match === false ? 2 : 1) });
          });
        });
        cands.sort(function (a, c) { return (a.rank - c.rank) || (c.s - a.s) || (a.title.length - c.title.length); });
        var direct = null, good = cands.filter(function (c) { return c.exact && c.match === true; });
        if (good.length === 1) direct = good[0];
        else if (!good.length) {
          var ok = cands.filter(function (c) { return c.exact && c.match !== false; });
          if (ok.length === 1 && !cands.some(function (c) { return c.match === true; })) direct = ok[0];
        }
        var hint = forms.map(function (f) { return f.n; }).concat([tn(b.notes), tn(b.series)]).concat((b.editions || []).map(function (e) { return tn([e.p, e.e, e.u].join(' ')); })).join('|');
        var items = [], byK = {};
        mine.forEach(function (x) {
          var it = { title: x.t, k: x.k, authors: x.au, match: true, rank: 0, c: null };
          items.push(it); byK[x.k] = it;
        });
        cands.forEach(function (c) {
          var it = byK[tn(c.title)];
          if (it) { it.c = c; return; }
          items.push({ title: c.title, k: tn(c.title), authors: c.authors, match: c.match, rank: c.rank, c: c });
        });
        return { cands: cands.slice(0, MAXC), direct: direct, items: items, hint: hint };
      });
    }).catch(function () { delete resolveCache[ck]; return { cands: [], direct: null, items: [], hint: '' }; });
    return resolveCache[ck];
  }

  function doOpen(c) {
    var p = bookIdent(c.b); p.index = 0;
    return window.Otzaria.call('reader.openBook', p).then(function (ok) {
      if (ok && (ok.data === false || ok.success === false)) toast('לא ניתן לפתוח את הספר');
    }).catch(function () { toast('לא ניתן לפתוח את הספר'); });
  }
  function pathText(p) { return String(p || '').replace(/^[\/\\]+/, '').split(/[\/\\]+/).filter(Boolean).join(' › '); }
  function addPaths(cands) {
    return pool(cands.map(function (c) {
      return function () {
        if (c.categoryPath) return Promise.resolve();
        return window.Otzaria.call('library.getBookMetadata', bookIdent(c.b)).then(function (r) {
          if (r && r.success && r.data) c.categoryPath = r.data.categoryPath || '';
        }).catch(function () {});
      };
    }), 3);
  }

  /* ----- חלונית בחירת הספר: שורות, קבוצות מקופלות לפי קידומת הכותר (עד הפסיק), וחיפוש מהיר ----- */
  var dlg = null;
  function closeDlg() {
    if (!dlg) return;
    var d = dlg; dlg = null;
    document.removeEventListener('keydown', d.key, true);
    d.ov.remove();
    if (d.prev && d.prev.focus && document.contains(d.prev)) { try { d.prev.focus(); } catch (e) { /* ללא */ } }
  }
  /* פתיחת פריט: אם כבר יש ספר מזוהה — פותחים; אחרת מחפשים לפי הכותר המדויק (בלי ניחוש) */
  function openItem(it) {
    if (it.c) return doOpen(it.c);
    return findBooks(it.title).then(function (r) {
      var hits = r.filter(function (y) { return y && tn(y.title) === it.k; });
      if (!hits.length) { toast('הספר לא נמצא בספריית אוצריא'); return; }
      return doOpen({ b: hits[0] });
    });
  }
  function groupItems(items, hint) {
    var map = {}, order = [];
    items.forEach(function (it) {
      var pre = it.title.split(/\s*[,:]\s*/)[0].trim(), gk = tn(pre) || it.k;
      if (!map[gk]) { map[gk] = { pre: pre, gk: gk, parts: [] }; order.push(map[gk]); }
      map[gk].parts.push(it);
    });
    order.forEach(function (g) {
      g.multi = g.parts.length >= 3;
      g.rel = (g.gk.length >= 4 && hint.indexOf(g.gk) >= 0) || (g.gk === 'משנהתורה' && /פרנקל|פרדס|יחזקה/.test(hint)) ? 0 : 1;
      g.top = Math.min.apply(null, g.parts.map(function (p) { return p.rank; }));
    });
    order.sort(function (a, c) {
      return (a.rel - c.rel) || ((c.multi ? 1 : 0) - (a.multi ? 1 : 0)) || (a.top - c.top) || (c.parts.length - a.parts.length);
    });
    return order;
  }
  function showChooser(title, items, hint) {
    closeDlg();
    var ov = el('div', 'cd-ov'), box = el('div', 'cd-dlg');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.tabIndex = -1;
    var hd = el('div', 'cd-h'); hd.appendChild(el('div', 'cd-t', 'בחרו את הספר הנכון'));
    var x = el('button', 'cd-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'סגור'); x.onclick = closeDlg;
    hd.appendChild(x); box.appendChild(hd);
    var body = el('div', 'cd-body');
    body.appendChild(el('div', 'cd-q', title));
    var anyMatch = items.some(function (c) { return c.match === true; });
    var bad = items.filter(function (c) { return c.match === false; })[0];
    if (!anyMatch && bad) body.appendChild(el('div', 'cd-warn', 'בספרייה יש ספרים בשם דומה של ' + bad.authors.slice(0, 2).join(', ') + ' - ייתכן שאינם הספר שחיפשת.'));
    body.appendChild(el('div', 'cd-note', 'ההתאמה לפי שם הספר והמחבר בלבד - בדקו שזה הספר הנכון.'));
    var groups = groupItems(items, hint || ''), open = {}, search = null;
    if (items.length > 6) {
      search = el('input', 'cd-search'); search.type = 'search'; search.placeholder = 'סינון הרשימה…'; search.setAttribute('aria-label', 'סינון הרשימה');
      body.appendChild(search);
    }
    var ul = el('ul', 'cd-list'); body.appendChild(ul);
    function row(it, sub) {
      var li = el('li'), btn = el('button', 'cd-c' + (it.match === true ? ' is-match' : '') + (sub ? ' cd-sub' : '')); btn.type = 'button';
      btn.appendChild(el('span', 'cd-bt', it.title));
      if (!sub && it.authors.length) btn.appendChild(el('span', 'cd-au', (it.match === true ? 'מחבר: ' : 'המחבר לפי הספרייה: ') + it.authors.slice(0, 2).join(', ')));
      var pt = pathText(it.c && it.c.categoryPath);
      if (!sub && pt) btn.appendChild(el('span', 'cd-bp', pt));
      if (!sub && it.match === true) btn.appendChild(el('span', 'cd-badge', 'תואם את המחבר'));
      btn.onclick = function () { closeDlg(); openItem(it); };
      li.appendChild(btn); return li;
    }
    function render() {
      var q = search ? tn(search.value) : '';
      ul.textContent = '';
      var shown = 0;
      groups.forEach(function (g) {
        var parts = q ? g.parts.filter(function (p) { return p.k.indexOf(q) >= 0; }) : g.parts;
        if (!parts.length) return;
        shown++;
        if (!g.multi) { parts.forEach(function (p) { ul.appendChild(row(p, false)); }); return; }
        var li = el('li'), isOpen = !!q || !!open[g.gk];
        var hb = el('button', 'cd-c cd-grp' + (g.rel === 0 ? ' is-match' : '')); hb.type = 'button';
        hb.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        hb.appendChild(el('span', 'cd-bt', g.pre + ' (' + (q ? parts.length + ' מתוך ' + g.parts.length : g.parts.length) + ' חלקים)'));
        var au = g.parts[0].authors;
        if (au.length) hb.appendChild(el('span', 'cd-au', 'מחבר: ' + au.slice(0, 2).join(', ')));
        hb.appendChild(el('span', 'cd-chev', isOpen ? '▴' : '▾'));
        hb.onclick = function () { open[g.gk] = !open[g.gk]; render(); };
        li.appendChild(hb);
        if (isOpen) {
          var sl = el('ul', 'cd-list cd-parts');
          parts.forEach(function (p) { sl.appendChild(row(p, true)); });
          li.appendChild(sl);
        }
        ul.appendChild(li);
      });
      if (!shown) ul.appendChild(el('li', 'cd-note', 'לא נמצאו ספרים תואמים'));
    }
    if (search) search.addEventListener('input', render);
    render();
    box.appendChild(body);
    var ft = el('div', 'cd-f'), cancel = el('button', 'btn cd-cancel', 'ביטול'); cancel.type = 'button'; cancel.onclick = closeDlg;
    ft.appendChild(cancel); box.appendChild(ft); ov.appendChild(box);
    var d = { ov: ov, prev: document.activeElement };
    d.key = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDlg(); return; }
      if (e.key === 'Tab') {
        var f = [].slice.call(box.querySelectorAll('button,input'));
        if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', d.key, true);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeDlg(); });
    document.body.appendChild(ov); dlg = d;
    (search || box.querySelector('.cd-c') || x).focus();
  }

  function addLibraryButton(host, b) {
    if (!hasOtz()) return;
    resolveBook(b).then(function (r) {
      if (!host.isConnected || !r.items.length) return;
      if (r.direct) {
        var bt = el('button', 'btn', 'פתח באוצריא: ' + r.direct.title); bt.type = 'button';
        bt.onclick = function () { doOpen(r.direct); };
        host.appendChild(bt);
        addPreview(host, r.direct.b);   // תצוגה מקדימה רק לספר שנקבע חד-משמעית
      } else {
        var ch = el('button', 'btn', 'פתח באוצריא (בחירת ספר)'); ch.type = 'button';
        ch.onclick = function () { addPaths(r.cands).then(function () { showChooser(b.title, r.items, r.hint); }); };
        host.appendChild(ch);
      }
    });
  }

  /* ----- תצוגה מקדימה של טקסט הספר (library.getBookContent, עד 5000 תווים בקריאה) ----- */
  var PV_STEP = 3000;
  function plainText(t) {
    return String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(h\d|p|div)>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
  }
  function addPreview(host, hit) {
    var wrap = el('div', 'pv');
    var btn = el('button', 'btn', 'תצוגה מקדימה'); btn.type = 'button';
    wrap.appendChild(btn);
    var box = null, acts = null, offset = 0, busy = false;
    function load() {
      if (busy) return; busy = true;
      window.Otzaria.call('library.getBookContent', Object.assign(bookIdent(hit), { offset: offset, limit: PV_STEP })).then(function (r) {
        busy = false;
        var raw = r && r.data;
        if (typeof raw !== 'string' || !raw) {
          if (!offset) { box.textContent = 'אין תצוגה מקדימה זמינה לספר זה.'; }
          more.hidden = true; return;
        }
        offset += raw.length;
        box.textContent += (box.textContent ? '\n' : '') + plainText(raw);
        more.hidden = raw.length < PV_STEP;
      }).catch(function () { busy = false; toast('לא ניתן לטעון את התצוגה המקדימה'); });
    }
    var more = el('button', 'btn', 'טען עוד'); more.type = 'button'; more.hidden = true; more.onclick = load;
    btn.onclick = function () {
      if (box) { box.hidden = !box.hidden; acts.hidden = box.hidden; btn.textContent = box.hidden ? 'תצוגה מקדימה' : 'הסתר תצוגה מקדימה'; return; }
      box = el('div', 'pv-box'); box.setAttribute('dir', 'rtl');
      acts = el('div', 'pv-acts'); acts.appendChild(more);
      wrap.appendChild(box); wrap.appendChild(acts);
      wrap.appendChild(el('div', 'pv-note', 'תחילת הספר כטקסט בלבד, בלי הערות ופירושים. לתצוגה מלאה פתחו באוצריא.'));
      btn.textContent = 'הסתר תצוגה מקדימה';
      load();
    };
    host.appendChild(wrap);
  }

  /* ----- חיפוש לפי טקסט מסומן (תפריט הקשר) ----- */
  function handleSelection(raw) {
    var text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) { toast('לא נבחר טקסט'); return Promise.resolve(); }
    var words = text.split(' ').slice(0, 8);
    state.extended = false;
    function attempt(n) {
      var query = words.slice(0, n).join(' ');
      return CAT.search(query, {}).then(function (res) {
        if ((res.books.length || res.authors.length) || n <= 1) return { query: query, res: res };
        return attempt(n - 1);   // אם אין תוצאות — מקצרים מהסוף מילה אחר מילה
      });
    }
    return attempt(words.length).then(function (o) {
      var query = o.query, res = o.res;
      state.seq++;
      $('q').value = query; $('clearBtn').hidden = false;
      state.type = 'all'; syncChips();
      var ban = $('selBanner'); ban.textContent = ''; ban.hidden = false;
      var msg = el('span'); msg.appendChild(document.createTextNode('תוצאות עבור הטקסט המסומן: '));
      msg.appendChild(el('b', null, '"' + text.slice(0, 60) + (text.length > 60 ? '…' : '') + '"'));
      ban.appendChild(msg);
      var x = el('button', 'clearbtn', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'סגור');
      x.onclick = function () { ban.hidden = true; }; ban.appendChild(x);
      renderList(res, query);
      var all = res.books.map(function (o) { return { k: 'book', o: o }; }).concat(res.authors.map(function (o) { return { k: 'author', o: o }; }));
      all.sort(function (a, b) { return b.o.score - a.o.score; });
      // התאמה חד-משמעית (יחידה, או בולטת מהשנייה) נפתחת ישר ככרטיס
      if (all.length && (all.length === 1 || all[0].o.score >= all[1].o.score * 1.5)) openEntry(all[0].k, all[0].o.row[0]);
    });
  }

  function onMenuClick(d) {
    var t = d && (d.selectedText || (d.selection && d.selection.text));
    if (t) return handleSelection(t);
    // גיבוי: קריאת הבחירה הנוכחית (ייתכן שכבר אינה זמינה כשהדף נטען)
    window.Otzaria.call('reader.getSelection').then(function (r) {
      handleSelection(r && r.data && r.data.text);
    }).catch(function () { handleSelection(''); });
  }

  /* ----- אתחול ----- */
  function syncChips() {
    [].forEach.call(document.querySelectorAll('.chip'), function (c) { c.classList.toggle('on', c.dataset.type === state.type); });
  }
  function init() {
    $('demoNote').hidden = !(CAT.index && CAT.index.demo);
    var q = $('q');
    q.addEventListener('input', function () { $('clearBtn').hidden = !q.value; state.extended = false; runSearch(q.value); });
    $('clearBtn').onclick = function () { q.value = ''; $('clearBtn').hidden = true; state.extended = false; runSearch(''); q.focus(); };
    [].forEach.call(document.querySelectorAll('.chip'), function (c) {
      c.onclick = function () { state.type = c.dataset.type; state.extended = false; syncChips(); runSearch(q.value); };
    });
    var m = /[?&]q=([^&]*)/.exec(location.search);
    var q0 = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    if (q0) { q.value = q0; $('clearBtn').hidden = false; }
    runSearch(q0).then(function (res) {
      var mo = /[?&]open=(\d+)/.exec(location.search);
      if (mo && res && res.books.length) openEntry('book', res.books[0].row[0]);
      var ma = /[?&]openauthor=1/.test(location.search);
      if (ma && res && res.authors.length) openEntry('author', res.authors[0].row[0]);
    });
  }

  // נרשם סינכרונית כדי לא לפספס את האירוע שממתין לסיום ה-boot
  if (hasOtz() && window.Otzaria.on) {
    window.Otzaria.on('reader.context_menu_item_clicked', function (d) {
      if (!d || (d.itemId && d.itemId !== 'catalog-lookup')) return;
      onMenuClick(d);
    });
    window.Otzaria.on('plugin.boot', function (p) { if (p && p.theme) applyTheme(p.theme); });
    window.Otzaria.on('theme.changed', applyTheme);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
