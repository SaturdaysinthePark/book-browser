/*
 * BookJumpr — standalone implementation of "BookJumpr v2.dc.html".
 *
 * The original was a Claude Design ".dc.html" prototype: an <x-dc> template with
 * {{ }} bindings, <sc-if>/<sc-for> control flow and style-hover pseudo-classes,
 * plus a `class Component extends DCLogic` React component. That prototype only
 * runs inside Claude Design's proprietary `support.js` runtime (which auto-loads
 * React from a CDN and interprets the template).
 *
 * This file replaces that dependency with:
 *   1. a small, self-contained template compiler (the ~150 lines below) that turns
 *      the exact original template markup — embedded verbatim in index.html as
 *      <script id="bj-template"> — into a real React element tree, and
 *   2. the design's component logic, ported essentially verbatim (data graph,
 *      procedural genre covers + icons, ego graph, force-directed network, search,
 *      routing, stats). Only `renderVals()` + `render()` are wired to the compiler
 *      instead of the DC runtime.
 *
 * Result: a genuine, dependency-free React SPA (React vendored locally) that opens
 * from file:// or any static host and faithfully reproduces the design.
 */
(function () {
  'use strict';
  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var h = React.createElement;
  var DATA = window.BookJumprData || { NODES: {}, MENTIONS: [] };

  // Home-page suggestion pool: hand-picked, widely-known popular fiction (kept short
  // so two mobile pills + the shuffle button stay on one row). Titles are resolved to
  // books by slug via bookByTitle, so punctuation/accents/case don't need to match.
  var POPULAR_FICTION = [
    'Don Quixote', 'Robinson Crusoe', 'Moby-Dick', 'The Great Gatsby', 'Frankenstein',
    'Dracula', 'Jane Eyre', 'Wuthering Heights', 'Little Women', 'Oliver Twist',
    'David Copperfield', 'Great Expectations', 'A Tale of Two Cities', 'A Christmas Carol',
    'Pride and Prejudice', 'Sense and Sensibility', 'Emma', 'War and Peace', 'Anna Karenina',
    'Crime and Punishment', 'The Brothers Karamazov', 'Les Misérables', 'The Three Musketeers',
    'Treasure Island', "Gulliver's Travels", 'The Catcher in the Rye', 'The Scarlet Letter',
    "Uncle Tom's Cabin", 'Madame Bovary', 'Vanity Fair', 'Middlemarch', 'A Farewell to Arms'
  ];

  // Books kept OFF the home screen (walls, shelf rows, suggestion chips). They stay in the data,
  // search, book pages and the network — this only governs what the front door shows unprompted.
  // Authors are matched on the key's author segment (catches future imports); books by full key.
  var HOME_HIDE = {
    authors: {
      'adolph-hitler': 1,       // hate propaganda
      'joseph-goebbels': 1,
      'marquis-de-sade': 1      // explicit erotica
    },
    books: {
      'pauline-reage/story-of-o': 1,
      'vatsyayana/kama-sutra': 1,
      'vladimir-nabokov/lolita': 1,
      'j-g-wood/the-uncivilized-races-of-men-in-all-countries-of-the-world': 1,   // dated race/eugenics texts
      'margaret-sanger/woman-and-the-new-race': 1,
      'heinrich-kramer/malleus-maleficarum': 1
    }
  };

  /* ------------------------------------------------------------------ *
   * Template compiler — a minimal, faithful re-implementation of the
   * subset of the DC runtime this template uses. Not the proprietary
   * runtime: no streaming, editor bridge, x-import, helmet or CDN loading.
   * ------------------------------------------------------------------ */

  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  var NUMBER_RE = /^-?\d+(\.\d+)?$/;

  // Resolve a template expression ({{ ... }}) against the current scope.
  function resolve(vals, src) {
    var expr = String(src).trim();
    if (!expr) return undefined;
    if (expr[0] === '(' && expr[expr.length - 1] === ')' && parensWrapWhole(expr)) {
      return resolve(vals, expr.slice(1, -1));
    }
    var eq = findTopLevelEquality(expr);
    if (eq) {
      var lv = resolve(vals, expr.slice(0, eq.index));
      var rv = resolve(vals, expr.slice(eq.index + eq.op.length));
      switch (eq.op) {
        case '===': return lv === rv;
        case '!==': return lv !== rv;
        case '==': return lv == rv;
        default: return lv != rv;
      }
    }
    if (expr[0] === '!') return !resolve(vals, expr.slice(1));
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined') return undefined;
    if (NUMBER_RE.test(expr)) return Number(expr);
    if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) {
      return expr.slice(1, -1);
    }
    return resolvePath(vals, expr);
  }
  function parensWrapWhole(expr) {
    var depth = 0;
    for (var i = 0; i < expr.length - 1; i++) {
      if (expr[i] === '(') depth++;
      else if (expr[i] === ')') { depth--; if (depth === 0) return false; }
    }
    return true;
  }
  function findTopLevelEquality(expr) {
    var depth = 0;
    for (var i = 0; i < expr.length; i++) {
      var c = expr[i];
      if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') depth--;
      else if (depth === 0 && (c === '=' || c === '!') && expr[i + 1] === '=') {
        if (i > 0 && (expr[i - 1] === '=' || expr[i - 1] === '!')) continue;
        if (!expr.slice(0, i).trim()) continue;
        var op = expr[i + 2] === '=' ? c + '==' : c + '=';
        return { index: i, op: op };
      }
    }
    return null;
  }
  function resolvePath(vals, expr) {
    var head = expr.match(IDENT_RE);
    if (!head) return undefined;
    var cur = vals == null ? undefined : vals[head[0]];
    var i = head[0].length;
    while (i < expr.length) {
      if (expr[i] === '.') {
        var m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
        if (!m) return undefined;
        cur = cur == null ? undefined : cur[m[0]];
        i += 1 + m[0].length;
      } else if (expr[i] === '[') {
        var depth = 1, j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === '[') depth++;
          else if (expr[j] === ']') { depth--; if (depth === 0) break; }
          j++;
        }
        if (depth !== 0) return undefined;
        var key = resolve(vals, expr.slice(i + 1, j));
        cur = cur == null ? undefined : cur[key];
        i = j + 1;
      } else return undefined;
    }
    return cur;
  }

  function kebabToCamel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }
  function cssToObj(css) {
    var o = {};
    String(css).split(';').forEach(function (decl) {
      var i = decl.indexOf(':');
      if (i < 0) return;
      var prop = decl.slice(0, i).trim();
      if (!prop) return;
      o[prop.indexOf('--') === 0 ? prop : kebabToCamel(prop)] = decl.slice(i + 1).trim();
    });
    return o;
  }

  // Compile an attribute value into a getter: whole {{expr}}, mixed interpolation, or literal.
  function compileAttr(raw) {
    var whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
    if (whole) { var path = whole[1]; return function (vals) { return resolve(vals, path); }; }
    if (raw.indexOf('{{') !== -1) {
      var parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
      return function (vals) {
        return parts.map(function (s, i) { return (i & 1) ? (resolve(vals, s) == null ? '' : resolve(vals, s)) : s; }).join('');
      };
    }
    return function () { return raw; };
  }

  // Hover styles (replaces DC's style-hover pseudo-class sheet). Memoized.
  var hoverClass = (function () {
    var el = null, cache = {}, n = 0;
    return function (css) {
      if (cache[css]) return cache[css];
      if (!el) { el = document.createElement('style'); document.head.appendChild(el); }
      var cls = 'bjh' + (n++).toString(36);
      try { el.sheet.insertRule('.' + cls + ':hover{' + css + '}', el.sheet.cssRules.length); } catch (e) {}
      cache[css] = cls;
      return cls;
    };
  })();

  var EVENT_MAP = {
    onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit',
    onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onkeypress: 'onKeyPress',
    onfocus: 'onFocus', onblur: 'onBlur', onmousedown: 'onMouseDown', onmouseup: 'onMouseUp',
    onmouseenter: 'onMouseEnter', onmouseleave: 'onMouseLeave', onmousemove: 'onMouseMove',
    onmouseover: 'onMouseOver', onmouseout: 'onMouseOut',
    ontouchstart: 'onTouchStart', ontouchmove: 'onTouchMove', ontouchend: 'onTouchEnd'
  };

  function compileTemplate(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var builders = walkChildren(tpl.content);
    return function (vals) { return builders.map(function (b, i) { return b(vals, i); }); };
  }
  function walkChildren(node) {
    var out = [];
    node.childNodes.forEach(function (c) { var b = walk(c); if (b != null) out.push(b); });
    return out;
  }
  function walk(node) {
    if (node.nodeType === 3) return walkText(node);            // TEXT_NODE
    if (node.nodeType !== 1) return null;                      // ELEMENT_NODE only
    var tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') return walkFor(node);
    if (tag === 'sc-if') return walkIf(node);
    if (tag === 'svg') return walkSvg(node);
    return walkElement(node);
  }
  function walkText(node) {
    var txt = node.nodeValue == null ? '' : node.nodeValue;
    if (txt.indexOf('{{') === -1) {
      if (!txt.trim() && txt.indexOf(' ') === -1) return null;
      return function () { return txt; };
    }
    var parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
    return function (vals, key) {
      return h(React.Fragment, { key: key }, parts.map(function (p, i) {
        if (!(i & 1)) return p;
        var v = resolve(vals, p);
        if (v === undefined) return null;
        if (React.isValidElement(v) || Array.isArray(v)) return h(React.Fragment, { key: i }, v);
        if (v === null || typeof v === 'boolean') return null;
        return String(v);
      }));
    };
  }
  function walkFor(el) {
    var listGet = compileAttr(el.getAttribute('list') || '');
    var asName = el.getAttribute('as') || 'item';
    var kids = walkChildren(el);
    return function (vals, key) {
      var list = listGet(vals);
      if (!Array.isArray(list)) list = [];
      return h(React.Fragment, { key: key }, list.map(function (item, i) {
        var sub = Object.assign({}, vals);
        sub[asName] = item;
        sub.$index = i;
        return h(React.Fragment, { key: i }, kids.map(function (b, j) { return b(sub, j); }));
      }));
    };
  }
  function walkIf(el) {
    var valGet = compileAttr(el.getAttribute('value') || '');
    var kids = walkChildren(el);
    return function (vals, key) {
      return valGet(vals) ? h(React.Fragment, { key: key }, kids.map(function (b, j) { return b(vals, j); })) : null;
    };
  }
  // Static inline SVG (none of the template's SVGs contain bindings): render the
  // original markup verbatim so SMIL animations behave exactly as designed.
  function walkSvg(el) {
    var attrs = collectDomProps(el);
    var inner = el.innerHTML;
    return function (vals, key) {
      var props = attrs(vals);
      props.key = key;
      props.dangerouslySetInnerHTML = { __html: inner };
      return h('svg', props);
    };
  }
  function collectDomProps(el) {
    var getters = [];
    var hoverCss = [];
    var i, a, attrs = el.attributes;
    for (i = 0; i < attrs.length; i++) {
      a = attrs[i];
      var name = a.name, value = a.value;
      if (name === 'data-dc-tpl' || name === 'sc-name' || name.indexOf('hint-') === 0) continue;
      if (name.indexOf('style-') === 0) {           // style-hover (and any style-<pseudo>)
        if (name.slice(6) === 'hover') hoverCss.push(value);
        continue;
      }
      var key = name;
      if (key === 'class') key = 'className';
      else if (key === 'for') key = 'htmlFor';
      else if (key.indexOf('on') === 0 && EVENT_MAP[key]) key = EVENT_MAP[key];
      getters.push([key, compileAttr(value)]);
    }
    return function (vals) {
      var props = {};
      for (var k = 0; k < getters.length; k++) {
        var pk = getters[k][0], v = getters[k][1](vals);
        if (pk === 'style' && typeof v === 'string') v = cssToObj(v);
        if ((pk === 'value' || pk === 'checked') && v === undefined) v = pk === 'checked' ? false : '';
        props[pk] = v;
      }
      if (hoverCss.length) {
        var cls = hoverCss.map(hoverClass).join(' ');
        props.className = [props.className, cls].filter(Boolean).join(' ');
      }
      return props;
    };
  }
  function walkElement(el) {
    var tag = el.tagName.toLowerCase();
    var attrs = collectDomProps(el);
    var kids = walkChildren(el);
    return function (vals, key) {
      var props = attrs(vals);
      props.key = key;
      var children = kids.map(function (b, j) { return b(vals, j); });
      return h.apply(null, [tag, props].concat(children));
    };
  }

  /* ------------------------------------------------------------------ *
   * BookJumpr component — logic ported verbatim from the design's
   * `class Component extends DCLogic`, with render() wired to the compiler.
   * ------------------------------------------------------------------ */

  var BookJumpr = function (props) {
    React.Component.call(this, props);
    this.state = { route: { page: 'home' }, q: '', suggestFor: null, ready: false, vw: 0, chipSeed: 0, hxCompact: false, hxEngaged: false, hxTyping: false,
      xHover: null, xAll: null, xQ: '', xPathOpen: false, xPathQ: '', xPathTo: null };
    // Data is available synchronously via the vendored global, so build it up front.
    this.buildData(DATA.NODES || {}, DATA.MENTIONS || []);
    this.state.ready = true;
    this.state.vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    if (typeof location !== 'undefined' && (this._legacyHash(), this._routePath())) {
      this.state.route = this._routeFromHash();
      this._pushTrail(this.state.route);
    }
  };
  BookJumpr.prototype = Object.create(React.Component.prototype);
  BookJumpr.prototype.constructor = BookJumpr;
  var P = BookJumpr.prototype;
  // Lazily loaded modules (explorer.js) extend the component through this handle.
  window.__BJ = { P: P, h: h };

  // The search box that ⌘F should focus on this page: map searches first, then any visible
  // "Search…"/"Find…" input on the page, the header's last.
  P._searchBox = function () {
    var vis = function (el) { if (!el || el.disabled) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    var pri = ['.bjx-fbar .atlas-input', '.atlas-bar .atlas-input', '#search', '.bjx-entry .bjx-input'];
    for (var i = 0; i < pri.length; i++) { var el = document.querySelector(pri[i]); if (vis(el)) return el; }
    var all = [].filter.call(document.querySelectorAll('input'), function (x) { return /^(search|find)/i.test(x.placeholder || x.getAttribute('aria-label') || '') && vis(x); });
    var hdr = document.querySelector('.bj-hdr');
    all.sort(function (a, b) { return (hdr && hdr.contains(a) ? 1 : 0) - (hdr && hdr.contains(b) ? 1 : 0); });
    return all[0] || null;
  };
  P.componentDidMount = function () {
    var self = this;
    // Back/forward between app URLs, and old-style '#/…' links followed within the page.
    this._onPop = function () { self.applyHash(); };
    window.addEventListener('popstate', this._onPop);
    this._onHash = function () { if (self._legacyHash()) self.applyHash(); };
    window.addEventListener('hashchange', this._onHash);
    // Plain links to app routes (<a href="/author/title">) navigate in place, like the app's own buttons;
    // modified clicks (new tab, etc.) and links with a query string (?home=…) load normally.
    this._onLinkClick = function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target || a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (!/^\/(?!\/)/.test(href) || /[?#]/.test(href) || /\.[a-z0-9]+$/i.test(href)) return;
      e.preventDefault();
      self._setHash('#' + href);
    };
    document.addEventListener('click', this._onLinkClick);
    this._onResize = function () { self.setState({ vw: window.innerWidth }); };
    window.addEventListener('resize', this._onResize);
    // ⌘F / Ctrl+F jumps to the page's own search box (the map's "Search by book or author…", the home or header
    // search, the classic map's search). Pages without one keep the browser's find.
    this._onFindKey = function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key || '').toLowerCase() !== 'f') return;
      var el = self._searchBox();
      if (!el) return;
      e.preventDefault();
      el.focus(); if (el.select) el.select();
    };
    window.addEventListener('keydown', this._onFindKey);
    if (this._routePath()) this.applyHash();
    this._startWallPulse();
    this._startTilt();
    this._startHeaderAutohide();
    this._startToTop();
    this._settleSmil();
    if (this.state.route.page === 'book') this._loadNotes();
  };
  P.componentWillUnmount = function () {
    window.removeEventListener('popstate', this._onPop);
    window.removeEventListener('hashchange', this._onHash);
    document.removeEventListener('click', this._onLinkClick);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onFindKey);
    clearTimeout(this._pulseTimer);
    clearTimeout(this._flipCleanup);
    this._teardownStatsReveal();
  };

  // ---------- shuffle FLIP ----------
  // A shuffle reorders/swaps the wall (see shuffleChips). To make the kept covers physically GLIDE
  // to their new positions we use FLIP: snapshot each cover's screen box just before React commits
  // the new order, then in componentDidUpdate invert (jump each cover back to its old box) and play
  // (transition to its new box). New books (no prior box) scale + fade in. Being JS-driven, this
  // re-runs on every shuffle — unlike the old CSS approach that only fired once.
  P.getSnapshotBeforeUpdate = function (prevProps, prevState) {
    if (this.state.route.page !== 'home' || this.state.chipSeed === prevState.chipSeed) return null;
    var map = {};
    var cells = document.querySelectorAll('[data-wall] > *');
    for (var i = 0; i < cells.length; i++) {
      var bk = cells[i].getAttribute('data-bk');
      if (bk) map[bk] = cells[i].getBoundingClientRect();
    }
    return map;
  };
  P.componentDidUpdate = function (prevProps, prevState, snapshot) {
    if (this._toTopCheck && prevState.route !== this.state.route) this._toTopCheck();
    // Stats page reveal: arm scroll-triggered count-up + bar-grow on entry, tear it down on exit.
    var nowStats = this.state.route.page === 'stats', wasStats = prevState.route.page === 'stats';
    if (nowStats && !wasStats) this._setupStatsReveal();
    else if (!nowStats && wasStats) this._teardownStatsReveal();
    if (this.state.route.page === 'book') this._loadNotes();
    if (prevState.route !== this.state.route) { this._settleSmil(); var hd = document.querySelector('.bj-hdr'); if (hd) hd.classList.remove('hdr-hide'); }
    // Network deep link (#/network/<book>): focus that book once the engine is up.
    var cst = this._constellation, fk = this.state.route.page === 'network' && this.state.route.focus;
    if (cst && fk && this._cstFocused !== fk && cst.focusKey) { this._cstFocused = fk; cst.focusKey(fk); }
    // Atlas: keep the map's focus in step with the route (search, path chips, back button).
    var at = this._atlas;
    if (at && this.state.route.page === 'network') {
      var af = this.state.route.focus || null, cur = at.focus >= 0 ? at.keys[at.focus] : null;
      if (af !== cur) at.setFocus(af);
    }
    if (this._xStarSync) this._xStarSync();   // Explorer+ mini-map follows the hops
    if (!snapshot) return;
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var self = this;
    var wall = document.querySelector('[data-wall]');
    if (!wall) return;
    var cells = [].slice.call(wall.children);
    var bases = cells.map(function (el) { return el.style.transform || ''; });

    // INVERT — jump each cover to where its book was (or shrink new books), with no transition.
    cells.forEach(function (el, i) {
      var old = snapshot[el.getAttribute('data-bk')];
      var r = el.getBoundingClientRect();
      var inner = el.querySelector('[data-hb]');
      el.style.transition = 'none';
      el.style.zIndex = '40';
      if (old) {
        var dx = old.left - r.left, dy = old.top - r.top;
        el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) ' + bases[i];
      } else {
        el.style.transform = 'scale(.35) ' + bases[i];
        if (inner) inner.style.opacity = '0';
      }
    });

    void wall.offsetWidth; // force reflow so the inverted state is committed before we play

    // PLAY — transition each cover to its real position (staggered), fading new books in.
    cells.forEach(function (el, i) {
      var d = (self.hash('fx' + i) % 24) * 8; // 0–184ms stagger
      var inner = el.querySelector('[data-hb]');
      el.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1) ' + d + 'ms';
      el.style.transform = bases[i];
      if (inner) { inner.style.transition = 'opacity .4s ease ' + d + 'ms'; inner.style.opacity = ''; }
    });

    // CLEANUP — strip the inline props we set via raw .style (React never managed them, so it won't
    // clear them; a leftover inline zIndex/opacity/transition would break the hover pop + idle pulse).
    clearTimeout(this._flipCleanup);
    this._flipCleanup = setTimeout(function () {
      cells.forEach(function (el) {
        el.style.transition = ''; el.style.zIndex = '';
        var inner = el.querySelector('[data-hb]');
        if (inner) inner.style.transition = '';
      });
    }, 1000);
  };

  // Stats screen reveal. Each stat number counts up from 0 and each "most mentioned books" bar
  // grows out — but only as the element scrolls into view, via IntersectionObserver, so items
  // below the fold animate when you reach them (not all at once on page entry). Mirrors the FLIP
  // idiom's mechanics (reflow + CSS transition + reduced-motion guard). On setup every target is
  // pre-emptied (number→0, bar→0 width) and its final value stashed on the element, so nothing
  // flashes its real value before it's revealed; each element animates once, then is unobserved.
  P._setupStatsReveal = function () {
    var self = this;
    this._teardownStatsReveal();
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Stash each final value on a JS expando (_statTarget), NOT a data-* attribute — React strips
    // unknown attributes on re-render, which would wipe a not-yet-revealed item's target; it never
    // touches expando properties.
    var els = [].slice.call(document.querySelectorAll('[data-statnum],[data-statbar]'));
    els.forEach(function (el) {
      if (el.hasAttribute('data-statnum')) {
        var t = parseInt(el.textContent, 10);
        if (isFinite(t)) { el._statTarget = t; el.textContent = '0'; }
      } else {
        el._statTarget = el.style.width || '0%';
        el.style.transition = 'none';
        el.style.width = '0%';
      }
    });

    // No IntersectionObserver (old browser) → just reveal everything now.
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(function (el) { self._revealStat(el); });
      return;
    }
    var io = this._statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        self._revealStat(entry.target);
      });
    }, { threshold: 0.35 });
    els.forEach(function (el) { io.observe(el); });
  };

  P._revealStat = function (el) {
    var self = this;
    if (el.hasAttribute('data-statnum')) {                 // count-up
      var target = el._statTarget;
      if (!isFinite(target)) return;
      var start = null, DUR = 900;
      var step = function (t) {
        if (start === null) start = t;
        var p = Math.min((t - start) / DUR, 1);
        el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3)))); // easeOutCubic
        if (p < 1) self._statsRafs.push(requestAnimationFrame(step));
        else el.textContent = String(target);
      };
      self._statsRafs.push(requestAnimationFrame(step));
    } else {                                                // bar grow
      var w = el._statTarget || '0%';
      void el.offsetWidth; // force reflow so the 0-width start is committed before we play
      el.style.transition = 'width .7s cubic-bezier(.2,.7,.2,1)';
      el.style.width = w;
      self._statsTimeouts.push(setTimeout(function () { el.style.transition = ''; }, 900));
    }
  };

  P._teardownStatsReveal = function () {
    if (this._statsObserver) { this._statsObserver.disconnect(); this._statsObserver = null; }
    (this._statsRafs || []).forEach(function (id) { cancelAnimationFrame(id); });
    (this._statsTimeouts || []).forEach(clearTimeout);
    this._statsRafs = [];
    this._statsTimeouts = [];
  };

  // Idle home-wall spotlight: every ~8s, colour + bounce one random cover (an automatic
  // replay of the hover state) so the wall feels alive. Driven imperatively via a CSS class
  // (not React state) so it never triggers re-renders and costs nothing off the home page.
  P._startWallPulse = function () {
    var self = this;
    var reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    var tick = function () {
      self._pulseTimer = setTimeout(tick, 5000);
      // Skip while off-home, backgrounded, or when the user is actively hovering the wall
      // (hover always wins — don't pulse on top of what they're exploring).
      if (self.state.route.page !== 'home') return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (document.querySelector('[data-wall] [data-hb]:hover')) return;
      var wraps = document.querySelectorAll('[data-wall] > *');
      if (!wraps.length) return;
      // Only covers with a genre colour can "turn colour on"; skip MISC (no --bandc).
      var pick = [];
      for (var i = 0; i < wraps.length; i++) {
        if (wraps[i].querySelector('.cv[style]')) pick.push(wraps[i]);
      }
      if (!pick.length) return;
      var el = pick[Math.floor(Math.random() * pick.length)];
      var innerEl = el.querySelector('[data-hb]');
      el.setAttribute('data-pulse', '1');
      var clear = function () { el.removeAttribute('data-pulse'); clearTimeout(safety); if (innerEl) innerEl.removeEventListener('animationend', clear); };
      var safety = setTimeout(clear, 2000);
      if (innerEl) innerEl.addEventListener('animationend', clear);
    };
    this._pulseTimer = setTimeout(tick, 5000);
  };

  // Cover tilt: one delegated pointer listener drives a small 3D tilt + moving sheen on whichever
  // [data-tilt] card is under a fine pointer (writes --rx/--ry/--mx; CSS does the rest). Touch and
  // reduced-motion users get the plain card.
  P._startTilt = function () {
    if (typeof matchMedia === 'undefined' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cur = null, raf = 0, ev = null;
    var reset = function (el) { el.classList.remove('is-tilting'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.style.removeProperty('--mx'); };
    var apply = function () {
      raf = 0;
      var el = ev && ev.target && ev.target.closest ? ev.target.closest('[data-tilt]') : null;
      if (cur && cur !== el) reset(cur);
      cur = el;
      if (!el) return;
      var cv = el.querySelector('.cv'); if (!cv) return;
      var r = cv.getBoundingClientRect();
      var px = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), py = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      el.classList.add('is-tilting');
      el.style.setProperty('--ry', ((px - 0.5) * 12).toFixed(2));
      el.style.setProperty('--rx', ((0.5 - py) * 9).toFixed(2));
      el.style.setProperty('--mx', (px * 140 - 20).toFixed(1) + '%');
    };
    document.addEventListener('pointermove', function (e) { ev = e; if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
    document.addEventListener('pointerleave', function () { if (cur) reset(cur); cur = null; });
  };

  // Sticky header hides while you scroll down a long page and returns on any scroll up — on a
  // phone it's two rows tall, so this gives the content most of the screen back.
  // --hdr-vis is how much of the header is on screen (its real height, or 0 while hidden), so sticky
  // bits such as the mention tabs ride just under it and take the top of the screen when it's gone.
  P._startHeaderAutohide = function () {
    var last = window.scrollY, acc = 0, vis = null, root = document.documentElement;
    var setVis = function (hdr) {
      if (!hdr) return;
      var v = hdr.classList.contains('hdr-hide') ? 0 : hdr.offsetHeight;
      if (v !== vis) { vis = v; root.style.setProperty('--hdr-vis', v + 'px'); }
    };
    window.addEventListener('scroll', function () {
      var y = window.scrollY, d = y - last; last = y;
      var hdr = document.querySelector('.bj-hdr');
      if (!hdr) return;
      acc = (d > 0) === (acc > 0) ? acc + d : d;
      if (y < 90 || acc < -24) hdr.classList.remove('hdr-hide');
      else if (acc > 36 && !hdr.contains(document.activeElement)) hdr.classList.add('hdr-hide');
      setVis(hdr);
    }, { passive: true });
    window.addEventListener('resize', function () { vis = null; setVis(document.querySelector('.bj-hdr')); });
    setVis(document.querySelector('.bj-hdr'));
  };
  // Long pages (a book's mention list, stats, search): once you're about a screen and a half down, a
  // round ↑ button bottom-right takes you all the way back up. Not on home or the full-screen network.
  P._startToTop = function () {
    var self = this, btn = document.createElement('button'), on = false;
    btn.className = 'to-top'; btn.type = 'button'; btn.title = 'Back to top'; btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.tabIndex = -1;
    btn.addEventListener('click', function () {
      var still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
      btn.blur();
    });
    document.body.appendChild(btn);
    var check = function () {
      var pg = self.state.route.page, show = pg !== 'home' && pg !== 'network' && window.scrollY > window.innerHeight * 1.5;
      if (show === on) return;
      on = show; btn.classList.toggle('is-on', on); btn.tabIndex = on ? 0 : -1;
    };
    window.addEventListener('scroll', check, { passive: true });
    this._toTopCheck = check;
  };
  // SMIL (the logo / hero jump-arc) ignores prefers-reduced-motion, so under reduced motion jump
  // every SVG timeline to its drawn end state and freeze it.
  P._settleSmil = function () {
    if (typeof matchMedia === 'undefined' || !matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      var sv = svgs[i];
      if (sv.pauseAnimations && sv.querySelector('animate,animateMotion') && !sv._settled) { sv._settled = true; try { sv.setCurrentTime(3.45); sv.pauseAnimations(); } catch (e) {} }
    }
  };

  P.slug = function (t) {
    return String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };
  P.hash = function (s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // NODES: { key: [title, author, year, synopsis, genre] }; MENTIONS: [[srcKey, mentKey]].
  // Identity is the explicit key from the data file — no slug(title) derivation here.
  P.buildData = function (NODES, MENTIONS) {
    NODES = NODES || {};
    var books = {};
    var ids = Object.keys(NODES);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], n = NODES[id];
      books[id] = {
        id: id, title: n[0], author: n[1] || '', year: n[2] || 0,
        synopsis: n[3] || '', genre: n[4] || null,
        out: [], in: [], isSource: false
      };
    }
    for (var k = 0; k < MENTIONS.length; k++) {
      var s = MENTIONS[k][0], t = MENTIONS[k][1];
      var sb = books[s], tb = books[t];
      if (!sb || !tb) continue;
      sb.isSource = true;
      if (sb.out.indexOf(t) === -1) sb.out.push(t);
      if (tb.in.indexOf(s) === -1) tb.in.push(s);
    }
    this.books = books;
    this.all = ids.map(function (id) { return books[id]; });
    this.totalLinks = MENTIONS.length;
    this._covers = {};
  };

  P.yearLabel = function (y) { if (!y) return ''; return y < 0 ? 'c. ' + (-y) + ' BC' : String(y); };

  // ---------- genre system ----------
  P.GEN3 = [
    { name: 'FICTION', mark: 'book', color: '#c4682e' },
    { name: 'POETRY & EPICS', mark: 'lyre', color: '#a34a9c' },
    { name: 'DRAMA & PLAYS', mark: 'masks', color: '#c33d2e' },
    { name: 'CRIME & MYSTERY', mark: 'magnifier', color: '#2e8156' },
    { name: 'SCI-FI', mark: 'saucer2', color: '#3d6fb0' },
    { name: 'FANTASY', mark: 'dragon2', color: '#7b5bb5' },
    { name: 'HORROR', mark: 'bat', color: '#4a3b52' },
    { name: 'ADVENTURE & TRAVEL', mark: 'sword', color: '#c04a70' },
    { name: 'HISTORY', mark: 'column', color: '#8a5a3a' },
    { name: 'BIOGRAPHY & MEMOIR', mark: 'clock', color: '#2f5590' },
    { name: 'PHILOSOPHY', mark: 'owl2', color: '#3f7d7d' },
    { name: 'PSYCHOLOGY', mark: 'butterfly', color: '#7ba03c' },
    { name: 'POLITICS & WORLD', mark: 'globe', color: '#6e6e6e' },
    { name: 'BUSINESS & ECONOMICS', mark: 'briefcase', color: '#8c6d24' },
    { name: 'ESSAYS & JOURNALISM', mark: 'pen', color: '#7d4a66' },
    { name: 'HUMOR & COMEDY', mark: 'jester', color: '#d9a62b' },
    { name: 'FOOD & COOKING', mark: 'pan', color: '#a04a2a' },
    { name: 'MISC', mark: 'diamond', color: '#141414' }
  ];
  P.genreByName = function (name) {
    var key = String(name).trim().toUpperCase();
    for (var i = 0; i < this.GEN3.length; i++) if (this.GEN3[i].name === key) return this.GEN3[i];
    return null;
  };
  P.genreOf = function (b) {
    if (b && b.genre) { var g = this.genreByName(b.genre); if (g) return g; }
    return this.GEN3[17]; // MISC fallback (unset or unknown genre)
  };

  // ---------- home-wall book selection ----------
  // Deliberate, curated pick for the cover wall: popular + connected books, ~80/20 fiction, with
  // genre + author variety. Only which ids populate the wall — the FLIP glide, idle pulse, and
  // click-to-open all operate on whatever _wallIds holds.
  //
  // Fiction/non-fiction mirrors tools/build-book-graph.mjs: these 8 genres are non-fiction, and
  // everything else (incl. MISC/unknown) is fiction.
  P._NONFIC = { 'HISTORY': 1, 'BIOGRAPHY & MEMOIR': 1, 'PHILOSOPHY': 1, 'PSYCHOLOGY': 1, 'POLITICS & WORLD': 1, 'BUSINESS & ECONOMICS': 1, 'ESSAYS & JOURNALISM': 1, 'FOOD & COOKING': 1 };
  P._isFiction = function (genre) { return !this._NONFIC[String(genre || '').trim().toUpperCase()]; };

  // Scored candidate pool (cached). Eligible = mentions others (out>0) OR very-popular mentioned-only
  // (in>=3). Score is popularity-led (inbound citations), with a both-sided tier bonus and a boost
  // for the curated POPULAR_FICTION titles. Sorted best-first.
  P._homeOk = function (id) {
    return !!id && !HOME_HIDE.books[id] && !HOME_HIDE.authors[String(id).split('/')[0]];
  };
  P._ensureWallPool = function () {
    if (this._wallPool) return this._wallPool;
    var self = this;
    var popSet = {};
    for (var p = 0; p < POPULAR_FICTION.length; p++) { var pb = this.bookByTitle(POPULAR_FICTION[p]); if (pb) popSet[pb.id] = 1; }
    var log2 = function (x) { return Math.log(x) / Math.LN2; };
    var pool = (this.all || []).filter(function (b) { return (b.out.length > 0 || b.in.length >= 3) && self._homeOk(b.id); }).map(function (b) {
      var both = b.out.length > 0 && b.in.length > 0;
      var score = 3 * log2(1 + b.in.length) + log2(1 + b.out.length) + (both ? 2 : 1) + (popSet[b.id] ? 2 : 0);
      return { id: b.id, fic: self._isFiction(b.genre), genre: self.genreOf(b).name, author: b.author || '', score: score };
    });
    pool.sort(function (a, b) { return b.score - a.score || (a.id < b.id ? -1 : 1); });
    this._wallPool = pool;
    return pool;
  };

  // Build a full wall of up to `wallTarget` ids honouring GLOBAL caps: an 80/20 fiction quota, a
  // plain-FICTION-genre cap (variety) and an author cap (<=3). `keepIds` are retained up front (their
  // covers glide on shuffle) and seed the running counts so the caps span the whole wall, not just the
  // fill. `excludeIds` are additionally skipped (e.g. the just-removed books, so a shuffle brings in
  // genuinely new titles). `randomize` jitters order for shuffle freshness (score order otherwise, so
  // first paint leads with the most popular/connected books). Relax passes guarantee we reach target.
  P._selectWall = function (wallTarget, keepIds, excludeIds, randomize) {
    var pool = this._ensureWallPool();
    var byId = this._wallPoolById || (this._wallPoolById = pool.reduce(function (m, c) { m[c.id] = c; return m; }, {}));
    var fT = Math.round(wallTarget * 0.8), nT = wallTarget - fT;
    var authorCap = 3, ficGenreCap = Math.round(fT * 0.55);
    var authorKey = function (a) { return (a && a !== 'Anonymous') ? a : null; };
    var picks = [], chosen = {}, authors = {}, ficN = 0, nfN = 0, plainFic = 0;
    var bump = function (c) {
      var ak = authorKey(c.author); if (ak) authors[ak] = (authors[ak] || 0) + 1;
      if (c.fic) { ficN++; if (c.genre === 'FICTION') plainFic++; } else nfN++;
    };
    // Seed with the kept books so the running counts (and thus the caps) cover the whole wall.
    (keepIds || []).forEach(function (id) { var c = byId[id]; if (!c || chosen[id]) return; picks.push(id); chosen[id] = 1; bump(c); });
    if (excludeIds) excludeIds.forEach(function (id) { if (!chosen[id]) chosen[id] = 1; });
    var ordered = pool;
    if (randomize) {
      ordered = pool.map(function (c) { return c; });
      ordered.sort(function (a, b) { return (b.score + Math.random() * 4) - (a.score + Math.random() * 4); });
    }
    var i, c, ak;
    // Pass 1 — full quotas + caps.
    for (i = 0; i < ordered.length && picks.length < wallTarget; i++) {
      c = ordered[i]; if (chosen[c.id]) continue;
      ak = authorKey(c.author); if (ak && (authors[ak] || 0) >= authorCap) continue;
      if (c.fic) { if (ficN >= fT) continue; if (c.genre === 'FICTION' && plainFic >= ficGenreCap) continue; }
      else { if (nfN >= nT) continue; }
      picks.push(c.id); chosen[c.id] = 1; bump(c);
    }
    // Pass 2 — relax genre/author caps, keep the fiction/non-fiction quota.
    for (i = 0; i < ordered.length && picks.length < wallTarget; i++) {
      c = ordered[i]; if (chosen[c.id]) continue;
      if (c.fic) { if (ficN >= fT) continue; } else { if (nfN >= nT) continue; }
      picks.push(c.id); chosen[c.id] = 1; if (c.fic) ficN++; else nfN++;
    }
    // Pass 3 — relax everything to reach target.
    for (i = 0; i < ordered.length && picks.length < wallTarget; i++) {
      c = ordered[i]; if (chosen[c.id]) continue;
      picks.push(c.id); chosen[c.id] = 1;
    }
    return picks;
  };

  // Genre icons as SVG markup strings (48×48 box). `ink` paints the glyph, `hole` its cut-outs —
  // covers pass hole='currentColor' so the cut-outs track the live band colour (see .cv-bot in CSS).
  P.mark2 = function (name, size, ink, hole) {
    var kids = [];
    var esc = function (v) { return String(v).replace(/"/g, '&quot;'); };
    var R = function (tag, a) {
      var s = '<' + tag;
      for (var k in a) if (a[k] != null && k !== 'key') s += ' ' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }) + '="' + esc(a[k]) + '"';
      return s + '/>';
    };
    var P_ = function (d, f) { kids.push(R('path', { d: d, fill: f || ink })); };
    var S = function (d, w, col) { kids.push(R('path', { d: d, fill: 'none', stroke: col || ink, strokeWidth: w, strokeLinecap: 'round' })); };
    var C = function (cx, cy, r, f) { kids.push(R('circle', { cx: cx, cy: cy, r: r, fill: f || ink })); };
    var E = function (cx, cy, rx, ry, f) { kids.push(R('ellipse', { cx: cx, cy: cy, rx: rx, ry: ry, fill: f || ink })); };
    var RT = function (x, y, w, ht, f, rx) { kids.push(R('rect', { x: x, y: y, width: w, height: ht, fill: f || ink, rx: rx || 0 })); };
    if (name === 'book') {
      P_('M24 15.5 C20 10.8 12.2 9 5.5 10.6 L5.5 34.5 C12.2 33 20 34.8 24 39.5 C28 34.8 35.8 33 42.5 34.5 L42.5 10.6 C35.8 9 28 10.8 24 15.5 Z');
      RT(23.05, 14.6, 1.9, 23, hole);
      S('M9.5 16.2 C13.5 15.6 17.5 16.6 20 18.4', 1.5, hole);
      S('M9.5 21.2 C13.5 20.6 17.5 21.6 20 23.4', 1.5, hole);
      S('M38.5 16.2 C34.5 15.6 30.5 16.6 28 18.4', 1.5, hole);
      S('M38.5 21.2 C34.5 20.6 30.5 21.6 28 23.4', 1.5, hole);
    }
    if (name === 'lyre') {
      RT(16.5, 40, 15, 2.8, ink, 1.4);
      RT(22.4, 34.5, 3.2, 6);
      P_('M11 25.5 A13 10.5 0 0 0 37 25.5 Z');
      P_('M13.5 26.5 C5.5 21.5 5 11 11 4.5 C12.8 3 15.2 4.4 14.2 6.6 C10.6 12.4 11.6 19.6 16.8 23.8 Z');
      P_('M34.5 26.5 C42.5 21.5 43 11 37 4.5 C35.2 3 32.8 4.4 33.8 6.6 C37.4 12.4 36.4 19.6 31.2 23.8 Z');
      RT(12, 7.6, 24, 3, ink, 1.5);
      C(18, 6.2, 1.2); C(24, 5.6, 1.2); C(30, 6.2, 1.2);
      RT(18.6, 10.6, 1.15, 16); RT(23.4, 10.6, 1.15, 17.5); RT(28.2, 10.6, 1.15, 16);
    }
    if (name === 'masks') {
      P_('M23.5 15 C23 26.5 26 34.5 33.5 36.5 C41 35.5 44.5 27 44 16.5 C37 13.5 29.5 13.5 23.5 15 Z');
      C(30.5, 21.5, 1.9, hole); C(38.5, 21.5, 1.9, hole);
      S('M29.5 30.8 C31.5 27.8 36 27.6 38.5 30.4', 2.2, hole);
      S('M5.5 12 C5.5 24 9 32 16.5 33.5 C22.5 32.5 25.5 24 25 13.5 C18.5 10.5 11.5 10 5.5 12 Z', 3, hole);
      P_('M5.5 12 C5.5 24 9 32 16.5 33.5 C22.5 32.5 25.5 24 25 13.5 C18.5 10.5 11.5 10 5.5 12 Z');
      C(11, 18.5, 1.9, hole); C(19, 18.5, 1.9, hole);
      S('M10.5 24.5 C12.5 27.6 17 27.8 19.5 25', 2.2, hole);
    }
    if (name === 'magnifier') {
      C(20, 18, 12.5);
      C(20, 18, 9.2, hole);
      S('M13.2 14.2 C14.4 12.2 16.4 10.8 18.8 10.5', 1.8);
      P_('M27.6 28.6 L36.8 37.8 C38 39 40 39 41.2 37.8 C42.4 36.6 42.4 34.6 41.2 33.4 L32 24.2 Z');
    }
    if (name === 'saucer2') {
      C(24, 12.4, 1.5); RT(23.3, 13.2, 1.4, 4);
      P_('M14.5 25.5 A9.5 8.8 0 0 1 33.5 25.5 Z');
      E(24, 28, 19, 6.4);
      C(12.5, 28, 1.8, hole); C(24, 29.4, 1.8, hole); C(35.5, 28, 1.8, hole);
      kids.push(R('path', { d: 'M19 34.5 L29 34.5 L33.5 44 L14.5 44 Z', fill: ink, opacity: 0.3 }));
    }
    if (name === 'dragon2') {
      kids.push(R('path', { d: 'M33.2 9.0 L36.6 12.2 L36.9 11.9 L37.2 12.5 L41.1 13.6 L43.8 16.8 L44.7 17.4 L45.2 16.9 L45.5 17.5 L45.2 19.1 L42.7 18.2 L44.1 19.1 L43.6 19.6 L42.9 19.6 L40.5 17.8 L37.9 16.6 L36.6 16.3 L36.2 16.9 L36.2 19.4 L38.5 25.9 L38.5 28.8 L37.7 30.8 L36.2 32.6 L34.6 33.4 L34.9 32.5 L34.9 31.9 L34.6 32.2 L34.0 35.0 L34.0 37.8 L35.2 38.4 L34.8 39.0 L33.3 39.0 L32.6 38.4 L31.6 36.4 L31.0 32.5 L31.0 34.4 L30.2 34.5 L24.2 34.2 L23.2 33.9 L23.4 33.3 L22.0 35.0 L21.0 37.5 L21.0 38.3 L22.3 38.6 L22.6 39.0 L20.4 39.0 L19.3 36.9 L19.2 33.0 L18.5 33.6 L14.8 32.5 L10.6 30.2 L9.0 28.6 L6.4 23.8 L5.5 20.7 L5.3 18.6 L3.1 17.5 L2.5 15.4 L2.7 14.9 L3.3 15.4 L3.7 15.2 L3.9 13.8 L4.8 11.8 L5.8 12.5 L6.9 14.9 L8.0 14.4 L8.0 17.2 L6.4 18.2 L6.6 19.6 L7.5 21.7 L10.8 25.6 L15.0 28.3 L17.1 28.9 L19.9 28.9 L28.1 26.9 L30.5 28.1 L29.3 26.9 L26.6 25.8 L22.6 25.6 L21.8 25.9 L21.4 23.0 L20.1 22.1 L18.9 21.9 L19.2 21.0 L18.9 19.2 L15.9 18.0 L18.1 17.8 L21.2 18.3 L27.0 20.5 L28.2 22.1 L28.8 24.5 L29.9 26.7 L30.4 27.0 L30.4 26.7 L32.3 26.3 L33.0 25.5 L33.5 24.1 L32.7 16.6 L34.0 14.0 L34.8 13.3 L35.2 13.5 L33.2 9.1Z M38.3 14.3 L39.0 15.0 L39.6 15.0 L39.6 14.1 L38.3 14.1Z', fill: ink, fillRule: 'evenodd' }));
    }
    if (name === 'bat') {
      P_('M17.6 12.4 L15.2 4.6 L21.4 9.6 Z'); P_('M30.4 12.4 L32.8 4.6 L26.6 9.6 Z');
      P_('M21.5 16.2 C14.5 12.2 6.2 12.6 1.8 18.8 C6.4 18.2 9.2 20 10 23.6 C13 21.6 15.8 22.6 17 26 C18.8 24.2 20.6 24.6 22.2 27 Z');
      P_('M26.5 16.2 C33.5 12.2 41.8 12.6 46.2 18.8 C41.6 18.2 38.8 20 38 23.6 C35 21.6 32.2 22.6 31 26 C29.2 24.2 27.4 24.6 25.8 27 Z');
      C(24, 13.8, 5.4);
      E(24, 22, 5, 7.8);
      C(21.6, 12.6, 1, hole); C(26.4, 12.6, 1, hole);
    }
    if (name === 'sword') {
      P_('M24 2.5 L27.4 8 L27.4 26.8 L20.6 26.8 L20.6 8 Z');
      RT(23.15, 8.8, 1.7, 15.5, hole, 0.85);
      RT(14, 26.8, 20, 3.6, ink, 1.8);
      C(14.8, 28.6, 1.9); C(33.2, 28.6, 1.9);
      RT(21.6, 30.4, 4.8, 9.4, ink, 2.2);
      RT(21.6, 33.2, 4.8, 1.3, hole); RT(21.6, 36.2, 4.8, 1.3, hole);
      C(24, 42.6, 2.7); C(24, 42.6, 0.9, hole);
    }
    if (name === 'column') {
      RT(13, 8.5, 22, 3.6, ink, 0.8); RT(15.5, 12.1, 17, 2.6);
      RT(16.5, 14.7, 15, 23.5);
      RT(19.2, 15.6, 1.5, 21.7, hole, 0.75); RT(23.25, 15.6, 1.5, 21.7, hole, 0.75); RT(27.3, 15.6, 1.5, 21.7, hole, 0.75);
      RT(15.5, 38.2, 17, 2.6); RT(13, 40.8, 22, 3.6, ink, 0.8);
    }
    if (name === 'clock') {
      C(24, 5.2, 1.9);
      RT(21.9, 6.4, 4.2, 3.2, ink, 1.2);
      C(24, 25, 15.2);
      C(24, 25, 12, hole);
      RT(23.4, 13.6, 1.2, 2.6); RT(23.4, 33.8, 1.2, 2.6); RT(33.4, 24.4, 2.6, 1.2); RT(12, 24.4, 2.6, 1.2);
      RT(23.25, 17.4, 1.5, 8.6, ink, 0.75);
      RT(24, 24.25, 7.2, 1.5, ink, 0.75);
      C(24, 25, 1.6);
    }
    if (name === 'owl2') {
      P_('M13 5 C15.5 7.5 18.5 9 21.5 9.3 C23 9 25 9 26.5 9.3 C29.5 9 32.5 7.5 35 5 C35.5 9 34.8 12 33.5 14.2 C36 17.8 37.2 22.5 37.2 27.5 C37.2 35.5 31.5 41 24 41 C16.5 41 10.8 35.5 10.8 27.5 C10.8 22.5 12 17.8 14.5 14.2 C13.2 12 12.5 9 13 5 Z');
      C(18.8, 19, 4.6, hole); C(29.2, 19, 4.6, hole);
      C(18.8, 19, 1.9); C(29.2, 19, 1.9);
      P_('M24 22.5 L26.3 26.5 L21.7 26.5 Z', hole);
      RT(17.5, 40.5, 2.2, 3); RT(28.3, 40.5, 2.2, 3);
      RT(11, 42.5, 26, 2.4, ink, 1.2);
    }
    if (name === 'butterfly') {
      P_('M22.3 19.5 C17 11.5 7 8.5 4 13.5 C1.8 17.5 6.5 23 14.5 25.2 C7.5 25.8 3.5 29.5 5 33.5 C6.5 37.5 13 38 17.5 34.5 C20.5 32.2 22 29.5 22.3 26.5 Z');
      P_('M25.7 19.5 C31 11.5 41 8.5 44 13.5 C46.2 17.5 41.5 23 33.5 25.2 C40.5 25.8 44.5 29.5 43 33.5 C41.5 37.5 35 38 30.5 34.5 C27.5 32.2 26 29.5 25.7 26.5 Z');
      E(24, 26.5, 2.3, 9.5);
      C(24, 15.8, 2.2);
      S('M22.8 14.5 C21 11.5 18.5 9.5 15.8 9', 1.5); C(15.3, 8.8, 1.3);
      S('M25.2 14.5 C27 11.5 29.5 9.5 32.2 9', 1.5); C(32.7, 8.8, 1.3);
      C(11, 16.5, 2.2, hole); C(37, 16.5, 2.2, hole);
    }
    if (name === 'globe') {
      C(24, 24, 15.5);
      kids.push(R('ellipse', { cx: 24, cy: 24, rx: 7.4, ry: 15.5, fill: 'none', stroke: hole, strokeWidth: 1.8 }));
      RT(8.5, 23.1, 31, 1.8, hole);
      RT(11, 16.6, 26, 1.5, hole); RT(11, 29.9, 26, 1.5, hole);
    }
    if (name === 'briefcase') {
      S('M19.5 12 L19.5 9.8 C19.5 7.6 21 6.2 23 6.2 L25 6.2 C27 6.2 28.5 7.6 28.5 9.8 L28.5 12', 3);
      RT(5.5, 12, 37, 27, ink, 3);
      RT(5.5, 22.4, 37, 2, hole);
      RT(20.4, 20.2, 7.2, 6.6, hole, 1.2);
      RT(22.3, 22.1, 3.4, 2.8, ink, 0.6);
    }
    if (name === 'pen') {
      P_('M14.8 32.2 L33 14 C35 12 38.2 12 40.2 14 C42.2 16 42.2 19.2 40.2 21.2 L22 39.4 Z');
      P_('M14.8 32.2 L22 39.4 L8.5 45.5 Z');
      S('M8.5 45.5 L14.5 38.8', 1.5, hole);
      C(15.8, 37.8, 1.2, hole);
      S('M34 13.2 L41 20.2', 1.8, hole);
    }
    if (name === 'jester') {
      P_('M10 30.5 C8.2 24.5 6 20 3.4 16.8 C8.4 15.6 12.8 17.9 15.5 22.6 C16.5 16.2 19.8 10.4 24 5.6 C28.2 10.4 31.5 16.2 32.5 22.6 C35.2 17.9 39.6 15.6 44.6 16.8 C42 20 39.8 24.5 38 30.5 Z');
      C(3, 18.6, 2.2); C(24, 4.6, 2.3); C(45, 18.6, 2.2);
      RT(8, 30.5, 32, 5, ink, 2.5);
    }
    if (name === 'pan') {
      S('M17.5 4.5 C16 6.8 19 8.6 17.5 11', 2);
      S('M24 3.5 C22.5 5.8 25.5 7.6 24 10', 2);
      S('M30.5 4.5 C29 6.8 32 8.6 30.5 11', 2);
      RT(2, 17.5, 5.5, 3.2, ink, 1.6); RT(40.5, 17.5, 5.5, 3.2, ink, 1.6);
      RT(6.5, 15.3, 35, 3.6, ink, 1.8);
      P_('M8 18.5 L40 18.5 L40 27 C40 32 36.5 35 31 35 L17 35 C11.5 35 8 32 8 27 Z');
      S('M13 22.5 L35 22.5', 1.7, hole);
    }
    if (name === 'diamond') {
      P_('M24 14.5 L31.5 23.5 L24 32.5 L16.5 23.5 Z');
      P_('M24 19 L27.8 23.5 L24 28 L20.2 23.5 Z', hole);
    }
    return '<svg viewBox="0 0 48 48"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + ' aria-hidden="true">' + kids.join('') + '</svg>';
  };

  // ---------- covers ----------
  // One size-agnostic Penguin tri-band cover (band / oval plate / title · rule · author / band +
  // genre mark). Every size is in container units (cqi) against .cv, so the same markup renders
  // crisply from a 52px search thumbnail to the 210px book-page hero — see the .cv CSS block in
  // index.html. Band colour = color-mix(genre colour, ink) by --lit (0 = ink, 1 = full colour),
  // which the home wall's spotlight drives per cover; everywhere else --lit defaults to 1.
  // Returned as an HTML string (cached per book) so the imperative home wall (home.js) and the
  // React pages share exactly one renderer.
  P.coverHTML = function (b) {
    var cache = this._cvHtml || (this._cvHtml = {});
    var key = b.id + ':' + (b.genre || '');
    if (cache[key]) return cache[key];
    var g = this.genreOf(b);
    var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    // Title scale: 6 length buckets → font size (cqi) + line clamp. Author: 4 buckets, ≤2 lines.
    var len = b.title.length;
    var ts = len < 10 ? [10.6, 2] : len < 18 ? [9.6, 3] : len < 28 ? [8.5, 4] : len < 40 ? [7.5, 5] : len < 60 ? [6.6, 6] : [5.8, 6];
    var au = b.author && b.author !== 'Anonymous' ? b.author : (b.author || '');
    var alen = au.length;
    var as = alen < 14 ? [6.2, 1] : alen < 22 ? [5.7, 2] : alen < 32 ? [5.2, 2] : [4.7, 2];
    var style = g.name === 'MISC' ? '' : ' style="--bandc:' + g.color + '"';
    var html = '<div class="cv"' + style + '><div class="cv-in">'
      + '<div class="cv-b cv-top"><i class="cv-plate"></i></div>'
      + '<div class="cv-m"><div class="cv-t" style="--ts:' + ts[0] + ';--tl:' + ts[1] + '">' + esc(b.title) + '</div>'
      + (au ? '<i class="cv-rule"></i><div class="cv-a" style="--as:' + as[0] + ';--al:' + as[1] + '">' + esc(au) + '</div>' : '')
      + '</div>'
      + '<div class="cv-b cv-bot">' + this.mark2(g.mark, 0, '#f7f5f0', 'currentColor') + '</div>'
      + '<i class="cv-fx"></i></div></div>';
    cache[key] = html;
    return html;
  };
  // React wrapper for the template ({{ x.cv }}). Elements are cached per book + variant: a
  // reused element object lets React skip re-reconciling unchanged covers on every setState.
  P.cover = function (b, cls) {
    var cache = this._cvEl || (this._cvEl = {});
    var key = b.id + '|' + (cls || '');
    if (cache[key]) return cache[key];
    var el = h('div', { className: 'cv-host' + (cls ? ' ' + cls : ''), 'data-cover': b.id, dangerouslySetInnerHTML: { __html: this.coverHTML(b) } });
    cache[key] = el;
    return el;
  };

  // ---------- routing ----------
  // URLs are real paths, author-first: a book is /<author>/<title>, an author page is /<author>. Netlify serves
  // index.html for every path (netlify.toml), and the edge function there fills in each page's title and text.
  // Inside the app routes are still written '#/…' (navigate, _setHash), which _setHash turns into the path.
  // Reserved words keep their own routes; /book/<key> stays as a legacy alias.
  P._routePath = function () {
    var p = location.pathname.replace(/^\/+|\/+$/g, '');
    try { p = decodeURIComponent(p); } catch (e) {}
    return p === 'index.html' ? '' : p;
  };
  // Links shared before the switch (bookjumpr.com/#/<author>/<title>) are rewritten to their path.
  P._legacyHash = function () {
    if (!/^#\//.test(location.hash)) return false;
    history.replaceState(null, '', '/' + location.hash.slice(2) + location.search);
    return true;
  };
  // Puts a '#/…' route in the address bar as a path (keeping ?query switches) and, unless the caller has already
  // rendered it (_silent), applies it.
  P._setHash = function (hash) {
    var path = '/' + String(hash || '').replace(/^#?\/?/, '');
    if (path !== location.pathname) history.pushState(null, '', path + location.search);
    if (!this._silent) this.applyHash();
  };
  P._routeFromHash = function () {
    var hh = this._routePath();
    if (!hh) return { page: 'home' };
    if (hh.indexOf('search/') === 0) return { page: 'search', q: hh.slice(7) };
    if (hh === 'stats') return { page: 'stats' };
    if (hh === 'network') return { page: 'network' };
    if (hh.indexOf('network/') === 0) return { page: 'network', focus: hh.slice(8) };
    if (hh === 'about') return { page: 'about' };
    if (hh.indexOf('book/') === 0) return { page: 'book', id: hh.slice(5) }; // legacy alias
    if (hh.indexOf('/') !== -1) return { page: 'book', id: hh };            // <author>/<title>
    return { page: 'author', slug: hh };                                    // <author>
  };
  // Route changes run inside a same-document View Transition when the browser supports it: the
  // page cross-fades, and if `fromEl` (the clicked card / wall cover) holds a cover, that cover
  // morphs into the book-page hero cover (both carry view-transition-name: bj-cover — the hero
  // via .vt-hero, the source via an inline name set just for this one transition).
  // `post` runs right after the new DOM is committed (inside the transition), for callers that name
  // elements of the new page — the Explorer uses it to name the book you came from (see xJump).
  P._transition = function (update, fromEl, post) {
    var reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var clearNames = function () { [].forEach.call(document.querySelectorAll('[data-vtn]'), function (el) { el.style.viewTransitionName = ''; el.removeAttribute('data-vtn'); }); };
    if (!document.startViewTransition || reduced || document.hidden) { clearNames(); update(); return; }
    var root = document.documentElement;
    var src = fromEl && fromEl.querySelector ? (fromEl.matches && fromEl.matches('.cv') ? fromEl : fromEl.querySelector('.cv')) : null;
    if (src) { root.classList.add('vt-swap'); src.style.viewTransitionName = 'bj-cover'; }
    root.classList.toggle('vt-cover', !!src);
    var vt;
    try {
      vt = document.startViewTransition(function () {
        if (src) src.style.viewTransitionName = '';
        // The old frame is captured by now: drop temporary names before React commits, since React
        // reuses DOM nodes (e.g. a trail button) that would otherwise carry a name into the new page.
        clearNames();
        root.classList.remove('vt-swap');
        ReactDOM.flushSync(update);
        if (post) post();
      });
    } catch (e) { clearNames(); update(); return; }
    vt.finished.then(function () { root.classList.remove('vt-cover'); clearNames(); }, function () { root.classList.remove('vt-cover', 'vt-swap'); clearNames(); });
  };
  P.navigate = function (route, hash, fromEl, post) {
    var self = this;
    this._pushTrail(route);
    this._transition(function () {
      self.setState({ route: route, q: '', suggestFor: null });
      window.scrollTo(0, 0);
    }, fromEl, post);
    this._silent = true;
    this._setHash(hash);
    setTimeout(function () { self._silent = false; }, 0);
  };
  P.applyHash = function () {
    if (this._silent) return;
    var self = this, route = this._routeFromHash();
    this._pushTrail(route);
    this._transition(function () {
      self.setState({ route: route, suggestFor: null });
      window.scrollTo(0, 0);
    });
  };
  // A click handler for an <a href> to an app route: plain clicks navigate in place (fn), modified clicks
  // (⌘/Ctrl/Shift — new tab or window) are left to the browser.
  P._linkGo = function (fn) {
    return function (e) {
      if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0)) return;
      if (e && e.preventDefault) e.preventDefault();
      fn(e);
    };
  };
  P.goBook = function (id, fromEl) { this.navigate({ page: 'book', id: id }, '#/' + id, fromEl); };
  P.goAuthor = function (aslug) { if (aslug && aslug !== 'anonymous') this.navigate({ page: 'author', slug: aslug }, '#/' + aslug); };
  // Author segment of a key: slug(author) or "anonymous" (mirrors tools/bookkey.mjs authorSlug).
  P.authorSlug = function (author) { return this.slug(author || '') || 'anonymous'; };
  // Resolve a display title to its book (keys are author/title now, so slug(title) alone won't hit).
  P.bookByTitle = function (title) {
    var s = this.slug(title), all = this.all || [];
    for (var i = 0; i < all.length; i++) if (this.slug(all[i].title) === s) return all[i];
    return null;
  };

  // ---------- search ----------
  P.norm = function (s) { return this.slug(s).replace(/-/g, ' '); };
  P.matches = function (q) {
    if (!this.all || !q.trim()) return [];
    var n = this.norm(q);
    var starts = [], incl = [], auth = [];
    for (var i = 0; i < this.all.length; i++) {
      var b = this.all[i];
      var t = this.norm(b.title), a = this.norm(b.author || '');
      if (t.indexOf(n) === 0) starts.push(b);
      else if (t.indexOf(n) !== -1) incl.push(b);
      else if (a && a.indexOf(n) !== -1) auth.push(b);
    }
    var rank = function (b) { return (b.out.length + b.in.length) * -1; };
    starts.sort(function (x, y) { return rank(x) - rank(y); });
    incl.sort(function (x, y) { return rank(x) - rank(y); });
    auth.sort(function (x, y) { return rank(x) - rank(y); });
    return starts.concat(incl, auth);
  };
  P.submitSearch = function () {
    var q = this.state.q.trim();
    if (!q) return;
    var n = this.norm(q);
    var self = this;
    var exact = this.all && this.all.filter(function (b) { return self.norm(b.title) === n; })[0];
    if (exact) this.goBook(exact.id);
    else this.navigate({ page: 'search', q: q }, '#/search/' + encodeURIComponent(q));
  };
  P.subFor = function (b) {
    var o = b.out.length, i = b.in.length;
    var parts = [];
    if (o) parts.push('mentions ' + o);
    if (i) parts.push('cited by ' + i);
    return parts.join(' · ') || 'quiet one';
  };

  // ---------- the neighborhood (book-page ego graph) ----------
  // A full-width fan in ONE coordinate system (an SVG laid out for the real container width, so
  // nodes and edges can never drift apart). Wide: "mentioned by" fans in from the left, "mentions"
  // fan out to the right, mutual mentions sit right with a two-way ink edge. Narrow (<560px): a
  // tree — mentioned-by above the book, mentions below — so labels get the full width. Labels are
  // measured (canvas) and truncated to fit; edges draw in, labels rise in, hovering one dims the rest.
  P._measure = function (txt, font) {
    var c = this._mctx || (this._mctx = document.createElement('canvas').getContext('2d'));
    c.font = font;
    return c.measureText(txt).width;
  };
  P._fit = function (txt, font, max) {
    if (this._measure(txt, font) <= max) return txt;
    var lo = 0, hi = txt.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (this._measure(txt.slice(0, mid) + '…', font) <= max) lo = mid; else hi = mid - 1; }
    return txt.slice(0, Math.max(1, lo)).replace(/[\s,:;.-]+$/, '') + '…';
  };
  // Fan layout shared by the book-page neighbourhood (SVG) and the network Explorer (HTML pills):
  // mentioned-by on the left, mentions (and mutual mentions, first) on the right, or a tree when
  // narrow. Options: cap (max pills per side), font/cfont/ph/row/gap (scale), extra(it) (extra pill
  // width for a cover or count). Returns geometry only; callers render it.
  P.fanLayout = function (b, W, o) {
    o = o || {};
    var self = this, books = this.books;
    var deg = function (id) { var x = books[id]; return x.in.length + x.out.length; };
    var inSet = {}, outSet = {};
    b.in.forEach(function (id) { inSet[id] = 1; });
    b.out.forEach(function (id) { outSet[id] = 1; });
    var right = b.out.map(function (id) { return { id: id, k: inSet[id] ? 'both' : 'out' }; })
      .sort(function (x, y) { return (x.k === 'both' ? -1e6 : 0) - (y.k === 'both' ? -1e6 : 0) || deg(y.id) - deg(x.id); });
    var left = b.in.filter(function (id) { return !outSet[id]; }).map(function (id) { return { id: id, k: 'in' }; })
      .sort(function (x, y) { return deg(y.id) - deg(x.id); });
    if (!right.length && !left.length) return { empty: true };
    var narrow = W < (o.narrowAt || 560);
    var cap = o.cap != null ? o.cap : narrow ? 5 : 9;
    var extra = o.extra || function () { return 0; };
    var clip = function (list) {
      if (list.length <= cap) return list;
      var shown = list.slice(0, cap - 1);
      shown.push({ more: list.length - (cap - 1) });
      return shown;
    };
    var L = clip(left), Rt = clip(right);
    var FONT = o.font || "10.5px 'IBM Plex Mono', monospace", CFONT = o.cfont || "italic 16px 'Instrument Serif', serif";
    var PH = o.ph || 21, ROW = o.row || (narrow ? 28 : 27), CH = o.ch || 30;
    var items = [], i = 0, H, cx, cy, center;
    var mkLabel = function (it) { return it.more ? '+' + it.more + ' more' : books[it.id].title; };

    if (!narrow) {
      var n = Math.max(L.length, Rt.length, 1);
      H = Math.max(170, n * ROW + 56);
      cx = W / 2; cy = H / 2 + 8;
      var G = o.gap ? o.gap(W) : Math.max(84, Math.min(W * 0.13, 170));
      var cMax = 2 * G - 36;
      var ct = self._fit(b.title, CFONT, cMax);
      var cw = Math.min(cMax, self._measure(ct, CFONT)) + 26;
      center = { x: cx - cw / 2, y: cy - CH / 2, w: cw, h: CH, t: ct, tx: cx, ty: cy + 5, anchor: 'middle' };
      var place = function (list, side) {
        var m = list.length;
        list.forEach(function (it, j) {
          var y = cy + (j - (m - 1) / 2) * ROW;
          var t = m > 1 ? (y - cy) / (H / 2) : 0;
          var x = cx + side * (G + 34 * (1 - t * t));
          var avail = side > 0 ? W - (x + 12) - 6 : x - 12 - 6;
          var ex = extra(it);
          var txt = self._fit(mkLabel(it), FONT, Math.max(40, avail - 18 - ex));
          var tw = self._measure(txt, FONT) + 18 + ex;
          var sx = cx + side * cw / 2, sy = cy;
          var c1 = sx + side * 46, c2 = x - side * 46;
          // o.touch: lines run right up to the pill's edge (the pill starts 10px past x) instead of a dot at x
          var xin = o.touch ? x + side * 10 : x, xout = o.touch ? x + side * 8.5 : x - side * 3;
          var d = it.k === 'in'
            ? 'M' + xin.toFixed(1) + ' ' + y.toFixed(1) + ' C' + c2.toFixed(1) + ' ' + y.toFixed(1) + ' ' + c1.toFixed(1) + ' ' + sy + ' ' + (sx - 3).toFixed(1) + ' ' + sy
            : 'M' + sx.toFixed(1) + ' ' + sy + ' C' + c1.toFixed(1) + ' ' + sy + ' ' + c2.toFixed(1) + ' ' + y.toFixed(1) + ' ' + xout.toFixed(1) + ' ' + y.toFixed(1);
          items.push({ it: it, x: x, y: y, d: it.more ? null : d, txt: txt,
            px: side > 0 ? x + 10 : x - 10 - tw, tw: tw, tx: side > 0 ? x + 19 : x - 19, anchor: side > 0 ? 'start' : 'end', i: i++ });
        });
      };
      place(L, -1); place(Rt, 1);
    } else {
      // Tree: header row, mentioned-by rows, the book, mentions rows.
      var trunk = 16, dotX = 44, y0 = 18;
      var rowsTop = L.length, rowsBot = Rt.length;
      var cyy = y0 + (rowsTop ? rowsTop * ROW + 12 : 0) + 16;
      H = cyy + 16 + (rowsBot ? rowsBot * ROW + 12 : 0) + 8;
      cx = trunk; cy = cyy;
      var ct2 = self._fit(b.title, CFONT, W - 60);
      var cw2 = self._measure(ct2, CFONT) + 26;
      center = { x: 4, y: cy - CH / 2, w: cw2, h: CH, t: ct2, tx: 17, ty: cy + 5, anchor: 'start' };
      var placeV = function (list, top) {
        list.forEach(function (it, j) {
          var y = top ? y0 + 6 + j * ROW + 12 : cy + CH + j * ROW + 4;
          var x = dotX + (top ? (list.length - 1 - j) : j) * 1.2;
          var ex = extra(it);
          var txt = self._fit(mkLabel(it), FONT, W - x - 34 - ex);
          var tw = self._measure(txt, FONT) + 18 + ex;
          var sy = top ? cy - CH / 2 : cy + CH / 2, sx = trunk + 6;
          var d = top
            ? 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + ' C' + sx + ' ' + y.toFixed(1) + ' ' + sx + ' ' + y.toFixed(1) + ' ' + sx + ' ' + (sy - 3)
            : 'M' + sx + ' ' + sy + ' C' + sx + ' ' + y.toFixed(1) + ' ' + sx + ' ' + y.toFixed(1) + ' ' + (x - 3).toFixed(1) + ' ' + y.toFixed(1);
          items.push({ it: it, x: x, y: y, d: it.more ? null : d, txt: txt, px: x + 10, tw: tw, tx: x + 19, anchor: 'start', i: i++ });
        });
      };
      placeV(L, true); placeV(Rt, false);
    }
    return { narrow: narrow, H: H, cx: cx, cy: cy, G: G, center: center, items: items, L: L, Rt: Rt, PH: PH, ROW: ROW };
  };

  P.neighborhood = function (b, W, showAll) {
    var self = this, books = this.books;
    var lay = this.fanLayout(b, W, { cap: showAll ? 60 : null });
    if (lay.empty) return h('div', { className: 'ng-empty' }, 'No connections logged yet — this one is waiting for its first door.');
    var narrow = lay.narrow, H = lay.H, cx = lay.cx, cy = lay.cy, G = lay.G, center = lay.center, items = lay.items, L = lay.L, Rt = lay.Rt, PH = lay.PH, ROW = lay.ROW;

    var R = h;
    var arrow = function (id, col) {
      return R('marker', { id: id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6.5, markerHeight: 6.5, orient: 'auto-start-reverse' },
        R('path', { d: 'M0 1 L9 5 L0 9 z', fill: col }));
    };
    var defs = R('defs', { key: 'defs' }, arrow('ngA-out', '#9c3d22'), arrow('ngA-in', '#2f5590'), arrow('ngA-both', '#141414'));
    var kids = [defs];
    items.forEach(function (n) {
      var it = n.it, k = it.k || 'more';
      var go = it.more ? function () { self.setState({ ngAll: true, ngFor: b.id }); } : function (e) { self.goBook(it.id); };
      var gProps = {
        key: (it.id || 'more') + ':' + n.i, className: 'ng-it' + (it.more ? ' ng-more' : ''), style: { '--i': n.i },
        onClick: go, tabIndex: 0, role: 'link', 'aria-label': it.more ? 'Show ' + it.more + ' more' : books[it.id].title,
        onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); } }
      };
      var dotFill = k === 'out' ? '#9c3d22' : k === 'in' ? '#2f5590' : k === 'both' ? '#141414' : 'var(--card)';
      gProps.children = [
        n.d ? R('path', { key: 'e', className: 'ng-e ' + k, d: n.d, pathLength: 1,
          markerEnd: k === 'both' || k === 'out' || k === 'in' ? 'url(#ngA-' + k + ')' : null,
          markerStart: k === 'both' ? 'url(#ngA-both)' : null }) : null,
        R('g', { key: 'l', className: 'ng-lab' },
          it.more ? null : R('circle', { className: 'ng-dot', cx: n.x, cy: n.y, r: 4.2, fill: dotFill }),
          R('rect', { className: 'ng-pill', x: n.px, y: n.y - PH / 2, width: n.tw, height: PH, rx: PH / 2 }),
          R('text', { className: 'ng-txt', x: n.anchor === 'start' ? n.px + 9 : n.px + n.tw - 9, y: n.y + 3.6, textAnchor: n.anchor }, n.txt),
          it.more ? null : R('title', null, books[it.id].title + (books[it.id].author ? ' — ' + books[it.id].author : '')))
      ];
      kids.push(R('g', gProps, gProps.children));
    });
    if (!narrow) {
      var hy = Math.max(12, cy - (Math.max(L.length, Rt.length) - 1) / 2 * ROW - 20);
      if (L.length) kids.push(R('text', { key: 'hl', className: 'ng-head', x: cx - G - 34, y: hy, textAnchor: 'end' }, '← mentioned by'));
      if (Rt.length) kids.push(R('text', { key: 'hr', className: 'ng-head', x: cx + G + 34, y: hy }, 'mentions →'));
    }
    kids.push(R('g', { key: 'c', className: 'ng-c', onClick: function () { self.openNetwork(b.id); }, role: 'link', tabIndex: 0, 'aria-label': 'See ' + b.title + ' in the network' },
      R('rect', { x: center.x, y: center.y, width: center.w, height: center.h, rx: 15 }),
      R('text', { x: center.anchor === 'middle' ? center.tx : center.x + 13, y: center.ty, textAnchor: center.anchor }, center.t),
      R('title', null, 'See ' + b.title + ' in the full network')));
    return R('div', { className: 'ng', key: b.id + (showAll ? ':all' : '') },
      R('svg', { className: 'ng-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, style: { maxWidth: '100%' } }, kids));
  };
  P.openNetwork = function (id) {
    if (this._vNext() && this.xZoomOut) { this.xZoomOut(id); return; }
    this.navigate({ page: 'network', focus: id }, '#/network/' + id);
  };

  // ---------- mention notes (lazy: bookjumpr-notes.js) ----------
  P._loadNotes = function () {
    if (this._notes || this._notesLoading) return;
    this._notesLoading = true;
    var self = this, sc = document.createElement('script');
    sc.src = '/bookjumpr-notes.js?v=2';
    sc.onload = function () {
      var N = window.BookJumprNotes, M = DATA.MENTIONS || [], map = {};
      if (N && N.COUNT === M.length) N.NOTES.forEach(function (r) { var m = M[r[0]]; if (m) map[m[0] + '|' + m[1]] = r[1]; });
      self._notes = map;
      self.forceUpdate();
    };
    sc.onerror = function () { self._notes = {}; self.forceUpdate(); };
    document.body.appendChild(sc);
  };
  // A note as a React node: lines from the book render as a pull-quote, editors' notes ("Epigraph: …",
  // "Cited as …") as a caption;
  // the mentioned book's title is marked wherever it appears.
  P.noteEl = function (src, ment) {
    if (!this._notes) return h('div', { className: 'mc-q wait', 'aria-hidden': true });
    var note = this._notes[src + '|' + ment];
    if (!note) return null;
    var t = this.books[ment].title, short = t.split(/[:(]/)[0].trim();
    var esc = function (x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
    var parts = note.split(new RegExp('(' + esc(t) + (short.length > 3 && short !== t ? '|' + esc(short) : '') + ')', 'i'));
    var kids = parts.map(function (p, i) { return i % 2 ? h('mark', { key: i }, p) : p; });
    var editorial = /^\s*((chapter )?epigraph\b|(Referenced|Cited|Mentioned|Alluded|Discussed|Quoted (by|with|from))\b|—)/i.test(note) &&
      !/^\s*(referenced|cited|mentioned|alluded|discussed|quoted)/.test(note);   // lowercase = an excerpt of the book itself
    var quote = !editorial;
    return h('p', { className: 'mc-q ' + (quote ? 'quote' : 'ctx'), title: 'Click to expand', onClick: function (e) { e.currentTarget.classList.toggle('open'); } }, kids);
  };

  // ---------- jump trail (session history of books visited) ----------
  P._pushTrail = function (route) {
    // Explorer jumps keep their own trail (in memory for the session).
    if (route && route.page === 'network' && route.focus && this.books[route.focus]) {
      var xt = (this._xTrail || []).filter(function (id) { return id !== route.focus; });
      xt.push(route.focus);
      this._xTrail = xt.slice(-10);
      return;
    }
    if (!route || route.page !== 'book' || !this.books[route.id]) return;
    var t = this._trail;
    if (!t) { try { t = JSON.parse(sessionStorage.getItem('bj-trail') || '[]'); } catch (e) { t = []; } }
    t = t.filter(function (id) { return id !== route.id; });
    t.push(route.id);
    if (t.length > 9) t = t.slice(-9);
    this._trail = t;
    try { sessionStorage.setItem('bj-trail', JSON.stringify(t)); } catch (e) {}
  };
  P.trailEl = function (curId) {
    var self = this, t = (this._trail || []).filter(function (id) { return self.books[id]; });
    if (t.length < 2) return null;
    var kids = [h('span', { key: 'l', className: 'lbl' }, 'Your jumps')];
    t.forEach(function (id, i) {
      if (i) kids.push(h('svg', { key: 'h' + i, className: 'hop', viewBox: '0 0 26 14' }, h('path', { d: 'M2 12 Q13 -2 24 12' })));
      kids.push(h('button', { key: id, className: id === curId ? 'cur' : '', title: self.books[id].title, 'aria-label': self.books[id].title,
        onClick: function (e) { if (id !== curId) self.goBook(id, e.currentTarget); } }, self.cover(self.books[id])));
    });
    return h('nav', { className: 'trail', 'aria-label': 'Books you jumped through' }, kids);
  };

  // ---------- stats ----------
  P.statsData = function () {
    if (this._stats) return this._stats;
    var byBook = this.all.filter(function (b) { return b.in.length > 0; })
      .sort(function (a, b) { return b.in.length - a.in.length || a.title.localeCompare(b.title); }).slice(0, 30);
    var authors = {};
    for (var i = 0; i < this.all.length; i++) {
      var b = this.all[i];
      // Anonymous isn't a real single author (Beowulf, the folk tales, etc. are unrelated works),
      // so exclude it from the authors leaderboard — its books still rank in "Most mentioned books".
      if (!b.author || b.author === 'Anonymous' || !b.in.length) continue;
      if (!authors[b.author]) authors[b.author] = { count: 0, works: {} };
      authors[b.author].count += b.in.length;
      authors[b.author].works[b.title] = true;
    }
    var byAuthor = Object.keys(authors).map(function (name) {
      return [name, { count: authors[name].count, works: { size: Object.keys(authors[name].works).length } }];
    }).sort(function (a, b) { return b[1].count - a[1].count || a[0].localeCompare(b[0]); }).slice(0, 30);
    this._stats = { byBook: byBook, byAuthor: byAuthor };
    return this._stats;
  };

  // ---------- network tab: lazy-loaded engine ----------
  // constellation-data.js (~1.2MB) + constellation-view.js are only needed on the #/network
  // route, so they're not in index.html's static <script> list — they're fetched on first visit
  // and cached (window.Constellation/window.BookGraph persist) for every visit after that.
  P._loadConstellation = function (cb) {
    if (window.Constellation && window.BookGraph) { cb(); return; }
    if (this._cstlLoading) { this._cstlCallbacks.push(cb); return; }
    this._cstlLoading = true;
    this._cstlCallbacks = [cb];
    var self = this;
    var done = function () {
      self._cstlLoading = false;
      var cbs = self._cstlCallbacks; self._cstlCallbacks = [];
      cbs.forEach(function (fn) { fn(); });
    };
    var dataScript = document.createElement('script');
    dataScript.src = '/constellation-data.js';
    dataScript.onload = function () {
      var viewScript = document.createElement('script');
      viewScript.src = '/constellation-view.js?v=19';
      viewScript.onload = done;
      document.body.appendChild(viewScript);
    };
    document.body.appendChild(dataScript);
  };
  P._mountConstellation = function (el) {
    if (this._constellation) return;                       // guard double-instantiation
    if (!window.Constellation || !window.BookGraph) return;
    var self = this;
    this._constellation = new window.Constellation({
      root: el,
      data: window.BookGraph,
      bookUrlPattern: '/{author}/{title}',
      showRings: true, labelDensity: 1, ambientTours: true,
      onOpenPage: function (key) { self.navigate({ page: 'book', id: key }, '#/' + key); }
    });
    window.__constellation = this._constellation; // debug / integration hook
    var fk = this.state.route.focus;
    if (fk && this._constellation.focusKey) { this._cstFocused = fk; this._constellation.focusKey(fk); }
  };

  // ---------- network variants: the constellation map (default) or the Explorer (?net=v2) ----------
  // 'map' (default) · 'explorer' (?net=v2) · 'atlas' (?net=v3) · 'plus' (?net=v4, Explorer+)
  // · 'stars' (?v=next: the network page is the genre star map)
  // The site by default: book pages are the fan + panel, the network page is the starfield (with an
  // Influence chart beside it), and you zoom between them. ?v=classic restores the classic book page
  // and constellation; ?net=v2|v3|v4|map are the old network comparisons (classic book pages too);
  // ?net=petals adds the Petals layout to the network switcher.
  P._q = function (name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } };
  P._netMode = function () {
    if (this._netV === undefined) {
      var v = this._q('net');
      this._netCompare = v != null && v !== '' && v !== 'petals';
      this._netV = v === 'v2' || v === 'explorer' ? 'explorer' : v === 'v3' || v === 'atlas' ? 'atlas' : v === 'v4' || v === 'plus' ? 'plus'
        : v === 'map' ? 'map' : this._vNext() ? 'stars' : 'map';
    }
    return this._netV;
  };
  P._vNext = function () {
    if (this._vn === undefined) {
      var net = this._q('net');
      this._vClassic = this._q('v') === 'classic';
      this._vn = !this._vClassic && !(net && net !== 'petals');
    }
    return this._vn;
  };
  P._vLab = function () { return this._vNext(); };   // the network page's layout switcher (Network · Influence)
  P._netExplorer = function () { var m = this._netMode(); return m === 'explorer' || m === 'plus'; };
  P._xPlus = function () { return this._netMode() === 'plus'; };
  P._xLive = function () { return this._xPlus() || this._vNext(); };   // living fan + star map layers
  P._xReady = function () { return !!(window.__BJ.explorerReady && (!this._xLive() || (window.BJAtlas && window.BookJumprStars)) && (!this._vLab() || window.BookJumprLayouts)); };
  P._loadAtlas = function () {
    if ((window.BJAtlas && window.BookJumprAtlas && window.__BJ.explorerReady) || this._aLoading) return;
    this._aLoading = true;
    var self = this, srcs = ['atlas-data.js?v=2', 'atlas.js?v=14', 'explorer.js?v=25'], left = srcs.length;
    var done = function () { if (--left === 0) { self.forceUpdate(); self._mountAtlas(); } };
    srcs.forEach(function (src) {
      var sc = document.createElement('script');
      sc.src = '/' + src; sc.onload = done; sc.onerror = done;
      document.body.appendChild(sc);
    });
  };
  P._mountAtlas = function () {
    if (this._atlas || !this._atlasEl || !window.BJAtlas || !window.BookJumprAtlas) return;
    var self = this;
    this._atlas = new window.BJAtlas({
      root: this._atlasEl, data: window.BookJumprAtlas,
      title: function (k) { var b = self.books[k]; return b ? b.title : ''; },
      neighbors: function (k) { var b = self.books[k]; return b ? { out: b.out, in: b.in } : { out: [], in: [] }; },
      onFocus: function (k) { self.mapFocus(k); },
      bottomInset: function () { var el = window.innerWidth < 1000 && document.querySelector('.atlas-panel'); return el ? el.getBoundingClientRect().height : 0; },
      onHover: function (k) { if (self.state.xHover !== k) self.setState({ xHover: k }); }
    });
    window.__atlas = this._atlas;
    var f = this.state.route.focus;
    if (f) this._atlas.setFocus(f, false);
  };
  // Atlas focus changes update the URL and panel without a page cross-fade (the map stays put).
  P.mapFocus = function (id) {
    var route = id ? { page: 'network', focus: id } : { page: 'network' };
    this._pushTrail(route);
    this.setState({ route: route, xHover: null, xPathOpen: false, xPathTo: null, xPathQ: '' });
    this._silent = true;
    this._setHash(id ? '#/network/' + id : '#/network');
    var self = this;
    setTimeout(function () { self._silent = false; }, 0);
  };
  P._loadExplorer = function () {
    if (this._xReady() || this._xLoading) return;
    this._xLoading = true;
    // Explorer+ also brings the star map (renderer + its organic layout) for the mini-map / full view.
    var srcs = this._xLive() ? ['atlas.js?v=14', 'stars-data.js?v=3', 'explorer.js?v=25'] : ['network-regions.js?v=2', 'explorer.js?v=25'];
    if (this._vLab()) srcs.push('layouts-data.js?v=8');
    var self = this, left = srcs.length;
    var done = function () { if (--left === 0) self.forceUpdate(); };
    srcs.forEach(function (src) {
      var sc = document.createElement('script');
      sc.src = '/' + src; sc.onload = done; sc.onerror = done;
      document.body.appendChild(sc);
    });
  };

  // ---------- interactive home walls (?home=a|b|c; engine in home.js) ----------
  P._homeVariant = function () {
    if (this._hv !== undefined) return this._hv;
    var v = null;
    try { v = new URLSearchParams(location.search).get('home'); } catch (e) {}
    this._hvCompare = v != null && v !== '';     // an explicit ?home= shows the variant switcher
    try { this._wallDark = new URLSearchParams(location.search).get('wall') === 'dark'; } catch (e) {}
    // Variant B (the infinite canvas you can pan in any direction) is the default home;
    // ?home=a is the endless shelf, ?home=c the shelf rows, ?home=classic the static wall.
    if (v == null || v === '') v = 'b';
    this._hv = (v === 'a' || v === 'b' || v === 'c') && window.BJHomeWall ? v : null;
    return this._hv;
  };
  // A deep, varied pool for the walls: the same curated selection the classic wall uses
  // (popular + connected, 80/20 fiction, author/genre caps), randomised per visit.
  P._hxPool = function () {
    if (this._hxPoolIds) return this._hxPoolIds;
    var n = Math.min(720, this._ensureWallPool().length);
    this._hxPoolIds = this._selectWall(n, null, null, true);
    return this._hxPoolIds;
  };
  // B: order the pool by a depth-first walk of the mention graph, so books sit near the books
  // they mention / are mentioned by — the 2D wall then has real neighbours to draw arcs to.
  P._hxSeq = function () {
    if (this._hxSeqIds) return this._hxSeqIds;
    var self = this, pool = this._hxPool(), inPool = {}, rank = {}, seen = {}, out = [];
    pool.forEach(function (id, i) { inPool[id] = 1; rank[id] = i; });
    pool.forEach(function (start) {
      var stack = [start];
      while (stack.length) {
        var id = stack.pop();
        if (seen[id]) continue;
        seen[id] = 1; out.push(id);
        var b = self.books[id];
        var nb = b.out.concat(b.in).filter(function (x) { return inPool[x] && !seen[x]; });
        nb.sort(function (x, y) { return rank[y] - rank[x]; });
        for (var i = 0; i < nb.length; i++) stack.push(nb[i]);
      }
    });
    this._hxSeqIds = out;
    return out;
  };
  // C: themed shelves. A couple of fixed leaderboards, one "found inside" shelf drawn from a
  // big name-dropper, and genre shelves — reshuffled (order + source) on every shuffle.
  P._hxRows = function (seed) {
    var self = this, all = this.all.filter(function (b) { return self._homeOk(b.id); });
    var deg = function (b) { return b.in.length + b.out.length; };
    var top = function (list, key, n) { return list.slice().sort(function (a, b) { return key(b) - key(a) || (a.title < b.title ? -1 : 1); }).slice(0, n).map(function (b) { return b.id; }); };
    var rnd = function (k) { return self.hash(seed + ':' + k); };
    var rows = [
      { label: 'Most name-dropped', ids: top(all, function (b) { return b.in.length; }, 48) },
      { label: 'The great name-droppers', ids: top(all, function (b) { return b.out.length; }, 48) }
    ];
    var sources = all.filter(function (b) { return b.out.length >= 18; }).sort(function (a, b) { return rnd(a.id) - rnd(b.id); });
    sources.slice(0, 2).forEach(function (src) {
      rows.push({ label: 'Found inside ' + src.title, ids: src.out.filter(function (id) { return self._homeOk(id); }).sort(function (a, b) { return deg(self.books[b]) - deg(self.books[a]); }).slice(0, 48) });
    });
    var genres = [['Poetry & epics', ['POETRY & EPICS']], ['Philosophy', ['PHILOSOPHY']], ['Drama & plays', ['DRAMA & PLAYS']],
      ['Sci-fi & fantasy', ['SCI-FI', 'FANTASY']], ['Crime & mystery', ['CRIME & MYSTERY']], ['History', ['HISTORY']],
      ['Lives & memoirs', ['BIOGRAPHY & MEMOIR']], ['Essays & journalism', ['ESSAYS & JOURNALISM']], ['Adventure & travel', ['ADVENTURE & TRAVEL']]];
    genres.sort(function (a, b) { return rnd(a[0]) - rnd(b[0]); });
    genres.forEach(function (g) {
      var ids = top(all.filter(function (b) { return b.genre && g[1].indexOf(String(b.genre).toUpperCase()) !== -1 && deg(b) > 0; }), deg, 48);
      if (ids.length >= 12) rows.push({ label: g[0], ids: ids });
    });
    // Interleave so neighbouring shelves differ in kind.
    var lead = rows.slice(0, 4), rest = rows.slice(4), outRows = [];
    while (lead.length || rest.length) { if (lead.length) outRows.push(lead.shift()); if (rest.length) outRows.push(rest.shift()); }
    return outRows;
  };
  P._mountHomeWall = function () {
    if (this._hw || !this._hxStageEl || !this._hxRootEl || !window.BJHomeWall) return;
    var self = this, v = this._homeVariant();
    if (this.state.hxCompact || this.state.hxEngaged) this.setState({ hxCompact: false, hxEngaged: false });
    var reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._hw = new window.BJHomeWall({
      root: this._hxStageEl, scope: this._hxRootEl, variant: v, reduced: reduced, dark: !!this._wallDark,
      pool: this._hxPool(), seq: v === 'b' ? this._hxSeq() : null,
      rows: v === 'c' ? this._hxRows(this.state.chipSeed || 0) : null,
      html: function (id) { return self.coverHTML(self.books[id]); },
      neighbors: function (id) { var b = self.books[id]; return b ? b.out.concat(b.in) : []; },
      onOpen: function (id, el) { self.goBook(id, el); },
      onEngage: function () { self.setState({ hxEngaged: true, hxCompact: v !== 'c' }); }
    });
  };

  // Atlas overlay: toolbar (search, zoom, fit), legend, and the side panel — the Explorer's panel
  // for a focused book, otherwise a short intro with the biggest neighbourhoods.
  P.atlasUi = function (focus) {
    var self = this, st = this.state, b = focus && this.books[focus], at = this._atlas;
    var q = st.aQ || '', sugg = q.trim() ? this.matches(q).slice(0, 7) : [];
    var pick = function (id) { self.setState({ aQ: '' }); self.mapFocus(id); };
    var bar = h('div', { key: 'bar', className: 'atlas-bar' },
      h('div', { className: 'atlas-q' },
        h('input', { className: 'atlas-input', placeholder: 'Find a book on the map…', value: q, 'aria-label': 'Find a book',
          onChange: function (e) { self.setState({ aQ: e.target.value }); },
          onKeyDown: function (e) { if (e.key === 'Enter' && sugg[0]) pick(sugg[0].id); if (e.key === 'Escape') self.setState({ aQ: '' }); } }),
        sugg.length ? h('div', { className: 'sg-pop atlas-sg' }, sugg.map(function (m) {
          return h('button', { key: m.id, onMouseDown: function (e) { e.preventDefault(); pick(m.id); } },
            h('span', { className: 'sg-cv' }, self.cover(m)), h('span', { className: 'sg-t' }, h('span', { className: 't' }, m.title), h('span', { className: 'a' }, m.author || '')),
            h('span', { className: 's' }, self.subFor(m)));
        })) : null),
      h('div', { className: 'atlas-zoom' },
        h('button', { onClick: function () { if (self._atlas) self._atlas.zoomBy(1 / 1.4); }, 'aria-label': 'Zoom out' }, '−'),
        h('button', { onClick: function () { if (self._atlas) self._atlas.zoomBy(1.4); }, 'aria-label': 'Zoom in' }, '+'),
        h('button', { className: 'fit', onClick: function () { if (self._atlas) self._atlas.fit(true); } }, 'Fit')));
    var legend = h('div', { key: 'lg', className: 'atlas-legend' },
      h('span', null, h('i', { className: 'blob' }), 'neighbourhood'),
      h('span', null, h('i', { className: 'ln out' }), 'mentions'), h('span', null, h('i', { className: 'ln in' }), 'mentioned by'),
      h('span', { className: 'hint' }, b ? 'Esc or click empty space to step back' : 'Click a neighbourhood to zoom, a book to see its links'));
    var panel;
    if (b && this.explorerPanel) panel = this.explorerPanel(b);
    else {
      var regs = ((window.BookJumprAtlas && window.BookJumprAtlas.regions) || []).map(function (r, i) { return { r: r, i: i }; })
        .filter(function (x) { return x.r.name && self._homeOk(x.r.hub); }).slice(0, 12);
      panel = h('aside', { className: 'bjx-side atlas-intro' },
        h('div', { className: 'eyebrow' }, 'Network · Atlas'),
        h('h2', null, 'Every book on one map, grouped by the books they keep mentioning.'),
        h('p', { className: 'bjx-syn' }, 'Each tinted circle is a reading neighbourhood; its most-connected books sit in the middle. Lines only appear for the book you point at.'),
        h('div', { className: 'eyebrow' }, 'Biggest neighbourhoods'),
        h('div', { className: 'atlas-regs' }, regs.map(function (x) {
          return h('button', { key: x.i, onClick: function () { if (self._atlas) self._atlas.flyToRegion(x.i); } },
            h('span', { className: 'sw', style: { background: ['#c4682e', '#2f5590', '#3f7d7d', '#7d4a66', '#8a5a3a', '#2e8156', '#a34a9c', '#8c6d24', '#c33d2e', '#4a3b52'][x.i % 10] } }),
            h('span', { className: 'nm' }, x.r.name), h('span', { className: 'sz' }, x.r.size));
        })));
    }
    return [bar, legend, h('div', { key: 'pn', className: 'atlas-panel' + (b ? ' has-focus' : '') }, panel)];
  };

  P.renderVals = function () {
    var self = this;
    var Pr = this.props;
    var warm = Pr.warmPaper != null ? Pr.warmPaper : true;
    var heroStyle = Pr.heroStyle != null ? Pr.heroStyle : 'dense wall';
    var accent = Pr.accent != null ? Pr.accent : '#9c3d22';
    if (typeof document !== 'undefined') {
      var r = document.documentElement.style;
      r.setProperty('--paper', warm ? '#f7f5f0' : '#ffffff');
      r.setProperty('--card', warm ? '#fdfcfa' : '#ffffff');
      r.setProperty('--accent', accent);
    }
    var vw = this.state.vw || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    var m = vw < 640; var mid = vw < 1100;
    var route = this.state.route;
    var page = route.page;
    var books = this.books || {};
    var all = this.all || [];

    // The home page is a full-bleed dark cover wall. With viewport-fit=cover the page
    // fills the whole screen (incl. the notch / home-indicator safe areas), so paint the
    // document background AND the iOS Safari chrome tint (theme-color) ink there — otherwise
    // the paper background and paper theme-color show as white bands top & bottom around the
    // floating address bar. Every other page keeps the paper background.
    var hv = page === 'home' ? this._homeVariant() : null;
    if (typeof document !== 'undefined') {
      var homeBg = page === 'home' ? (hv ? (this._wallDark ? '#2e2a25' : '#ede6d6') : '#141414') : '';
      document.documentElement.style.background = homeBg;
      if (document.body) document.body.style.background = homeBg;
      var tcMeta = document.querySelector('meta[name="theme-color"]');
      if (tcMeta) tcMeta.setAttribute('content', page === 'home' ? homeBg : (warm ? '#f7f5f0' : '#ffffff'));
    }

    var go = function (fn) { return function (e) { if (e && e.preventDefault) e.preventDefault(); fn(); }; };
    var vals = {
      pgHome: page === 'home' && !hv, pgHomeX: !!hv, pgBook: page === 'book' && !this._vNext(), pgBookNext: page === 'book' && this._vNext(), pgSearch: page === 'search',
      pgStats: page === 'stats', pgNetwork: page === 'network', pgAbout: page === 'about',
      pgNetMap: page === 'network' && this._netMode() === 'map', pgExplorer: page === 'network' && this._netExplorer(),
      pgAtlas: page === 'network' && this._netMode() === 'atlas', pgStars: page === 'network' && this._netMode() === 'stars',
      pgAuthor: page === 'author',
      goHome: go(function () { self.navigate({ page: 'home' }, '#/'); }),
      goStats: go(function () { self.navigate({ page: 'stats' }, '#/stats'); }),
      goNetwork: go(function () { if (self.state.xView) self.setState({ xView: null }); self.navigate({ page: 'network' }, '#/network'); }),
      goAbout: go(function () { self.navigate({ page: 'about' }, '#/about'); }),
      showChrome: page !== 'home',
      showFooter: page !== 'home' && page !== 'network',
      showHeaderSearch: page !== 'home' && page !== 'network',
      navText: page !== 'home' && !m,
      navIcons: page !== 'home' && m,
      // phones: one compact row. Pages with a header search show the mark + search + icons (the wordmark
      // makes room); the network (its map has its own search) keeps the wordmark.
      hdrRow: { position: 'relative', maxWidth: '1240px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: m ? '6px' : '6px', padding: m ? '7px 10px 7px 14px' : '10px 20px', boxSizing: 'border-box' },
      hdrWord: { fontFamily: "'Instrument Serif',serif", fontSize: m ? '23px' : '25px', letterSpacing: '.01em', display: m && page !== 'home' && page !== 'network' ? 'none' : 'inline' },
      hdrSpacer: { flex: m && page !== 'home' && page !== 'network' ? '0 0 0' : '1' },
      hdrPh: vw < 360 ? 'Search…' : 'Search a book…',
      hdrSearchWrap: m ? { position: 'static', flex: '1 1 auto', minWidth: 0, margin: '0 2px 0 6px' } : { position: 'relative', marginRight: '8px' },
      hdrInput: { height: m ? '38px' : '40px', border: '1.5px solid var(--ink)', borderRadius: '999px', padding: m ? '0 14px' : '0 18px', fontSize: '16px', background: 'var(--card)', color: 'var(--ink)', fontFamily: 'inherit', boxSizing: 'border-box', boxShadow: m ? '0 2px 0 rgba(20,20,20,.85)' : '0 3px 0 rgba(20,20,20,.85)', width: m ? '100%' : '240px', minWidth: 0 },
      bookHero: { display: 'grid', gridTemplateColumns: m ? '1fr' : mid ? '180px minmax(0,1fr)' : '210px minmax(0,1fr) 340px', gap: m ? '28px' : '44px', alignItems: 'start' },
      coverWrap: { boxShadow: '10px 10px 0 rgba(20,20,20,.12)', maxWidth: m ? '180px' : 'none' },
      graphPanel: { border: '1.5px solid var(--ink)', borderRadius: '18px', background: 'var(--card)', padding: '18px 18px 10px', gridColumn: mid && !m ? '1 / -1' : 'auto', maxWidth: mid && !m ? '540px' : 'none' },
      statsCols: { display: 'grid', gridTemplateColumns: vw < 900 ? '1fr' : '1fr 1fr', gap: '44px 56px', alignItems: 'start' },
      shuffleChips: function () {
        if (hv) {
          var seedX = (self.state.chipSeed || 0) + 1;
          if (self._hw) self._hw.shuffle(hv === 'c' ? self._hxRows(seedX) : null);
          self.setState({ chipSeed: seedX });
          return;
        }
        // Reshuffle the wall: keep ~75% of the covers (they glide to new spots via the FLIP in
        // componentDidUpdate) and swap ~25% for fresh books drawn from the SAME curated pool
        // (so eligibility, the 80/20 fiction mix and variety caps still hold), then reorder.
        var cur = self._wallIds;
        if (cur && cur.length) {
          var n = cur.length, swapN = Math.max(1, Math.round(n * 0.25));
          var kept = cur.slice(), removed = [], k, j;
          for (k = 0; k < swapN && kept.length; k++) removed.push(kept.splice(Math.floor(Math.random() * kept.length), 1)[0]);
          // Refill to n keeping the survivors; exclude the just-removed so genuinely new (curated) titles
          // come in, and let the global caps span the whole wall.
          var ids = self._selectWall(n, kept, removed, true);
          for (k = ids.length - 1; k > 0; k--) { j = Math.floor(Math.random() * (k + 1)); var t = ids[k]; ids[k] = ids[j]; ids[j] = t; }
          self._wallIds = ids;
        }
        self.setState({ chipSeed: (self.state.chipSeed || 0) + 1 });
      },
      q: this.state.q,
      onQ: function (e) { self.setState({ q: e.target.value, sugIdx: -1 }); },
      onKey: function (e) {
        var n = (self._sugg || []).length, i = self.state.sugIdx == null ? -1 : self.state.sugIdx;
        if (e.key === 'ArrowDown' && n) { e.preventDefault(); self.setState({ sugIdx: (i + 1) % n }); return; }
        if (e.key === 'ArrowUp' && n) { e.preventDefault(); self.setState({ sugIdx: i <= 0 ? n - 1 : i - 1 }); return; }
        if (e.key === 'Enter') { if (i >= 0 && i < n) self.goBook(self._sugg[i].id); else self.submitSearch(); }
        if (e.key === 'Escape') self.setState({ suggestFor: null, sugIdx: -1 });
      },
      onFocusHome: function () { self.setState({ suggestFor: 'home' }); },
      onFocusHeader: function () { self.setState({ suggestFor: 'header' }); },
      onBlur: function () { setTimeout(function () { self.setState({ suggestFor: null }); }, 120); },
      st_links: this.totalLinks || 0,
      st_books: all.length,
      st_sources: all.filter(function (b) { return b.isSource; }).length
    };

    // Mobile: shorter placeholder that fits the narrow input; full copy on desktop.
    vals.homePlaceholder = m ? 'Try “Kafka on the Shore”…' : 'Search a book… try Kafka on the Shore';
    // Mobile: drop the trailing call-to-action sentence from the intro paragraph.
    // Desktop value keeps the leading space (static text ends at "name-drops one.").
    vals.introTail = m ? '' : ' Pick a book, browse its shelf, and jump.';
    // Mobile: 44px tap targets for the icon buttons (icons inside keep their size).
    var iconBtn = function (size, op) {
      return { width: size + 'px', height: size + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1.5px solid transparent', borderRadius: '999px', cursor: 'pointer', opacity: op, padding: 0 };
    };
    vals.shuffleBtn = iconBtn(m ? 44 : 26, m ? 0.55 : 0.45);
    // Mobile hero: 1 chip with the shuffle inline beside it, no "rabbit holes" label.
    vals.isMobile = m; vals.notMobile = !m;
    vals.chipsRow = m
      ? { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', justifyContent: 'center', marginTop: '16px' }
      : { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '12px' };
    // Mobile: center the hero card with slim, even gutters (no dead 40px band top/bottom).
    // This was static inline HTML on index.html; bound here so the gutter can vary by breakpoint.
    vals.heroCenter = {
      position: 'relative', zIndex: 5, display: 'flex', alignItems: 'center',
      justifyContent: 'center', minHeight: '100dvh', boxSizing: 'border-box',
      pointerEvents: 'none', padding: m ? '14px 14px' : '40px 20px'
    };
    // Mobile: trim the card's side padding so two suggestion pills + the shuffle fit on
    // one row (and the whole card reads tighter). Desktop keeps its fluid clamp padding.
    vals.heroCard = {
      pointerEvents: 'auto', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: '20px',
      boxShadow: '0 30px 70px rgba(20,20,20,.22)', maxWidth: '680px', width: '100%', textAlign: 'center', boxSizing: 'border-box',
      padding: m ? '20px 16px 18px' : 'clamp(28px,5.5vw,52px) clamp(20px,6vw,60px) clamp(26px,4.5vw,44px)'
    };
    // Mobile: tighten the hero — smaller arc/paragraph and reduced vertical gaps.
    vals.heroArc = m
      ? { display: 'flex', justifyContent: 'center', maxWidth: '300px', margin: '0 auto' }
      : { display: 'flex', justifyContent: 'center' };
    vals.heroH1 = m
      ? { fontFamily: "'Instrument Serif',serif", fontWeight: 400, fontSize: 'clamp(31px,7.5vw,54px)', lineHeight: 1.05, margin: '10px 0 8px' }
      : { fontFamily: "'Instrument Serif',serif", fontWeight: 400, fontSize: 'clamp(31px,7.5vw,54px)', lineHeight: 1.05, margin: '20px 0 12px' };
    vals.heroP = m
      ? { fontSize: '14.5px', lineHeight: 1.55, opacity: 0.75, maxWidth: '470px', margin: '0 auto' }
      : { fontSize: '15.5px', lineHeight: 1.6, opacity: 0.75, maxWidth: '470px', margin: '0 auto' };
    vals.heroSearchWrap = m
      ? { position: 'relative', maxWidth: '520px', margin: '16px auto 0' }
      : { position: 'relative', maxWidth: '520px', margin: '26px auto 0' };
    vals.homeIconsRow = m
      ? { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }
      : { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '30px' };
    vals.homeNavBtn = iconBtn(m ? 44 : 32, 0.4);
    // Active-route indication: desktop text nav gets an underline + accent color, mobile icon
    // nav gets full opacity + an ink border (matching its own hover treatment at rest).
    var navBtnBase = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', letterSpacing: '.13em', textTransform: 'uppercase', padding: '8px 10px', color: 'var(--ink)' };
    var navBtnActive = { color: 'var(--accent)' };
    vals.navBtnNetwork = vals.pgNetwork ? Object.assign({}, navBtnBase, navBtnActive) : navBtnBase;
    vals.navBtnStats = vals.pgStats ? Object.assign({}, navBtnBase, navBtnActive) : navBtnBase;
    vals.navBtnAbout = vals.pgAbout ? Object.assign({}, navBtnBase, navBtnActive) : navBtnBase;
    // Active icon = full opacity + accent color (no fill/circle — matches the desktop text nav's
    // own active treatment of underline+accent). Every key the active variant touches (opacity/
    // color) already exists on the base object with a different value — never introduce a key here
    // that's absent from the other branch, or React's style diffing will unset it instead of
    // resetting it (that's what caused icons to get stuck with a visible border after a few clicks).
    var hdrNavBtnBase = Object.assign({}, iconBtn(m ? 40 : 34, 0.6), { color: 'var(--ink)', flex: 'none' });
    var hdrNavBtnActive = { opacity: 1, color: 'var(--accent)' };
    vals.hdrNavBtnNetwork = vals.pgNetwork ? Object.assign({}, hdrNavBtnBase, hdrNavBtnActive) : hdrNavBtnBase;
    vals.hdrNavBtnStats = vals.pgStats ? Object.assign({}, hdrNavBtnBase, hdrNavBtnActive) : hdrNavBtnBase;
    vals.hdrNavBtnAbout = vals.pgAbout ? Object.assign({}, hdrNavBtnBase, hdrNavBtnActive) : hdrNavBtnBase;
    // Mobile: hide secondary captions / truncate long titles so rows don't collide.
    vals.secCaption = m ? { display: 'none' } : { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', opacity: 0.6 };
    // Book/Author/Search/Stats/About all share this top padding — on mobile the fixed 52px left too
    // much dead space between the sticky header and the page eyebrow, so it's trimmed there only.
    vals.pagePad = 'padding:' + (m ? '28px' : '52px') + ' 24px 90px;';
    vals.statTitle = m
      ? { fontSize: '14.5px', fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
      : { fontSize: '14.5px', fontWeight: 700 };
    vals.statCapBook = m ? { display: 'none' } : { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', textTransform: 'uppercase', opacity: 0.55 };
    vals.statCapWorks = m ? { display: 'none' } : { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', opacity: 0.55 };

    // suggestions
    var sugg = this.state.suggestFor && this.state.q.trim() ? this.matches(this.state.q).slice(0, 7) : [];
    this._sugg = sugg;
    var sIdx = this.state.sugIdx == null ? -1 : this.state.sugIdx;
    vals.suggestions = sugg.map(function (b, i) {
      return { title: b.title, author: b.author || '', sub: self.subFor(b), cv: self.cover(b), cls: i === sIdx ? 'on' : '',
        hover: function () { if (self.state.sugIdx !== i) self.setState({ sugIdx: i }); },
        go: function () { self.goBook(b.id); } };
    });
    vals.showHomeSuggest = this.state.suggestFor === 'home' && sugg.length > 0;
    vals.showHeaderSuggest = this.state.suggestFor === 'header' && sugg.length > 0;

    // home wall — four densities: dense wall > light wall > scattered > plain paper.
    var wallMode = heroStyle === 'scattered' ? 'scattered'
      : heroStyle === 'plain paper' ? 'plain'
      : heroStyle === 'light wall' ? 'light'
      : 'dense';
    var wallCfg = {
      dense: { count: m ? 150 : 180, min: m ? 72 : 110, gap: '0px', pad: '0', inset: '-46px -36px', tier: 's', overlap: '-15px -20px' },
      light: { count: m ? 68 : 104, min: m ? 104 : 128, gap: '0px', pad: '6px', inset: '-38px -28px', tier: 's', overlap: '-6px -8px' },
      scattered: { count: m ? 36 : 54, min: m ? 118 : 148, gap: '26px', pad: '20px', inset: '-30px', tier: 'l', overlap: null },
      plain: { count: 0, min: m ? 118 : 148, gap: '26px', pad: '20px', inset: '-30px', tier: 'l', overlap: null }
    }[wallMode];
    if (page === 'home') {
      // The wall is a persistent, curated list of book ids (this._wallIds) chosen by _selectWall
      // (popular + connected, ~80/20 fiction, genre/author variety). It persists so shuffles can KEEP
      // most covers (they glide to new spots via the FLIP in componentDidUpdate) while swapping a slice.
      var target = wallCfg.count;
      if (!this._wallIds) {
        this._wallIds = this._selectWall(target, null, null, false);
      }
      // Adapt to viewport count changes (e.g. resize across the mobile breakpoint) without a reshuffle:
      // keep the current covers and either trim or top up (respecting the same global caps).
      if (this._wallIds.length > target) {
        this._wallIds = this._wallIds.slice(0, target);
      } else if (this._wallIds.length < target) {
        this._wallIds = this._selectWall(target, this._wallIds, null, false);
      }
      var list = this._wallIds.map(function (id) { return books[id]; }).filter(Boolean);
      vals.wallCovers = list.map(function (b, i) {
        var h1 = self.hash(b.id + i), h2 = self.hash(i + '/' + b.id);
        // backface-visibility on both wrapper and card tucks antialiasing seams
        // under neighbours where rotated covers overlap.
        var inner = {
          transition: 'transform .24s cubic-bezier(.3,1.6,.45,1), box-shadow .22s ease',
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden'
        };
        var wrap = { position: 'relative', cursor: 'pointer', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' };
        if (wallMode === 'dense') {
          // Systematic zigzag: rotation direction + vertical offset flip every ~3
          // covers for a woven rhythm; uniform sizes (no per-card scale variance).
          var grp = Math.floor(i / 3), dir = grp % 2 === 0 ? 1 : -1;
          var rot = dir * (2.4 + (h1 % 4) * 0.6);
          var vy = dir * (6 + (h2 % 5) * 1.3);
          wrap.transform = 'rotate(' + rot.toFixed(2) + 'deg) translateY(' + vy.toFixed(1) + 'px)';
          wrap.margin = wallCfg.overlap;
          // Opaque ink frame (real padding, not a soft shadow) fills the thin
          // slivers that rotation opens between overlapping covers, so no light
          // edges of the covers beneath dash through. This is the black frame.
          inner.background = '#141414';
          inner.padding = '4px';
          inner.boxSizing = 'border-box';
          inner.boxShadow = '0 6px 14px rgba(20,20,20,.20)';
        } else if (wallMode === 'light') {
          // Gentle per-item scatter with a light overlap — textured, not packed.
          wrap.transform = 'rotate(' + (((h1 % 11) - 5) * 0.8).toFixed(2) + 'deg) translateY(' + (((h2 % 9) - 4) * 1.1).toFixed(1) + 'px)';
          wrap.margin = wallCfg.overlap;
          inner.background = '#141414';
          inner.padding = '3px';
          inner.boxSizing = 'border-box';
          inner.boxShadow = '0 4px 10px rgba(20,20,20,.12)';
        } else {
          wrap.transform = 'rotate(' + (((h1 % 9) - 4) * 1.2).toFixed(2) + 'deg)';
        }
        var go = (function (id) { return function (e) { if (e && e.preventDefault) e.preventDefault(); self.goBook(id, e && e.currentTarget); }; })(b.id);
        return { wrap: wrap, inner: inner, go: go, id: b.id, cv: self.cover(b) };
      });
      vals.wallStyle = {
        position: 'absolute', zIndex: 0, isolation: 'isolate',
        inset: wallCfg.inset, display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(' + wallCfg.min + 'px, 1fr))',
        gap: wallCfg.gap, padding: wallCfg.pad, alignContent: 'start'
      };
      vals.wallFade = heroStyle === 'plain paper' ? {
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
        background: 'repeating-linear-gradient(90deg, transparent 0, transparent 88px, rgba(20,20,20,.05) 88px, rgba(20,20,20,.05) 89.5px)'
      } : { display: 'none' };
      var seed = this.state.chipSeed || 0;
      var chipN = m ? 2 : 5, chipMax = m ? 16 : 22;  // short pills; 2 on mobile so they never wrap
      // Suggestions come from the curated POPULAR_FICTION set (resolved once, then cached),
      // trimmed by title length so pills stay short, shuffled deterministically per seed.
      var popPool = this._popPool || (this._popPool = POPULAR_FICTION.map(function (t) { return self.bookByTitle(t); }).filter(function (b) { return b && self._homeOk(b.id); }));
      var pool = popPool.filter(function (b) { return b.title.length <= chipMax; });
      // Prepend the seed (not append) so it perturbs the whole FNV hash via avalanche —
      // appending only shifts every hash by a constant, leaving the sort order unchanged.
      var picks = pool.slice().sort(function (a, b2) { return self.hash(seed + '~' + a.id) - self.hash(seed + '~' + b2.id); }).slice(0, chipN);
      vals.chips = picks.map(function (b) { return { label: b.title, go: function () { self.goBook(b.id); } }; });
    } else { vals.wallCovers = []; vals.chips = []; vals.wallStyle = {}; vals.wallFade = {}; }
    if (hv) {
      var seedC = this.state.chipSeed || 0, nChips = m ? 2 : hv === 'c' ? 3 : 4, maxC = m ? 16 : 22;
      var pp = this._popPool || (this._popPool = POPULAR_FICTION.map(function (t) { return self.bookByTitle(t); }).filter(function (b) { return b && self._homeOk(b.id); }));
      vals.chips = pp.filter(function (b) { return b.title.length <= maxC; })
        .sort(function (a, b2) { return self.hash(seedC + '~' + a.id) - self.hash(seedC + '~' + b2.id); }).slice(0, nChips)
        .map(function (b) { return { label: b.title, go: function () { self.goBook(b.id); } }; });
      var st = this.state;
      vals.hxClass = 'hx hx-' + hv + (this._wallDark ? ' wall-dark' : '') + (st.hxCompact && hv !== 'c' ? ' is-compact' : '') + (st.hxEngaged ? ' is-engaged' : '') + (st.hxTyping ? ' is-typing' : '');
      vals.hxIntro = m ? 'The books mentioned inside other books — pick one and jump.'
        : 'BookJumpr maps the books mentioned inside other books — when a character reads one, quotes one, or name-drops one.';
      vals.hxHint = hv === 'b' ? (m ? 'Drag anywhere' : 'Drag or scroll anywhere') : hv === 'c' ? 'Scroll to spin the shelves' : 'Scroll the shelves';
      vals.hxExpand = function () { self.setState({ hxCompact: false }); if (self._hw) self._hw.resetEngage(); };
      vals.onFocusHx = function () { self.setState({ suggestFor: 'home', hxTyping: true, hxCompact: m && hv !== 'c' ? true : self.state.hxCompact }); };
      vals.onBlurHx = function () { setTimeout(function () { self.setState({ suggestFor: null, hxTyping: false }); }, 120); };
      vals.hxShowSwitch = !!this._hvCompare; vals.hxSw0 = ''; vals.hxSwA = hv === 'a' ? 'on' : ''; vals.hxSwB = hv === 'b' ? 'on' : ''; vals.hxSwC = hv === 'c' ? 'on' : '';
    }
    vals.hxCompare = page === 'home' && !hv && !!this._hvCompare;
    // Stable refs (created once) so React only fires them on real mount/unmount of the home wall.
    vals.hxRootRef = this._hxRootRefFn || (this._hxRootRefFn = function (el) { self._hxRootEl = el; if (el) self._mountHomeWall(); });
    vals.hxStageRef = this._hxStageRefFn || (this._hxStageRefFn = function (el) {
      if (el) { self._hxStageEl = el; self._mountHomeWall(); }
      else { self._hxStageEl = null; if (self._hw) { self._hw.destroy(); self._hw = null; } }
    });

    // book page
    if (page === 'book') {
      var b = books[route.id];
      if (b) {
        vals.b_title = b.title;
        vals.b_cv = this.cover(b, 'vt-hero');
        var yl = this.yearLabel(b.year);
        var bHasAuthor = !!(b.author && b.author !== 'Anonymous');
        vals.hasAuthor = bHasAuthor;
        vals.noAuthor = !bHasAuthor;
        vals.b_author = b.author || '';
        vals.b_authorGo = this._linkGo((function (bk) { return function () { self.goAuthor(self.authorSlug(bk.author)); }; })(b));
        vals.b_authorHref = '/' + this.authorSlug(b.author);
        vals.b_yearSuffix = yl ? '  ·  ' + yl : '';
        // Plain fallback used when the author isn't a clickable link (unknown/Anonymous).
        vals.b_byline = [b.author ? 'by ' + b.author : null, yl || null].filter(Boolean).join('  ·  ');
        vals.b_synopsis = b.synopsis || 'No synopsis on file yet — but the trail doesn’t stop here. See what it’s connected to below.';
        vals.cntOut = b.out.length; vals.cntIn = b.in.length;
        vals.hasOut = b.out.length > 0; vals.noOut = b.out.length === 0;
        vals.hasIn = b.in.length > 0; vals.noIn = b.in.length === 0;
        var CARD_CAP = 24;
        var card = function (id, src, ment) {
          var bk = books[id];
          var yl2 = self.yearLabel(bk.year);
          return { cv: self.cover(bk), title: bk.title, author: (bk.author || 'author unknown') + (yl2 ? '  ·  ' + yl2 : ''), sub: self.subFor(bk),
            note: self.noteEl(src, ment), href: '/' + id, go: self._linkGo(function (e) { self.goBook(id, e && e.currentTarget); }) };
        };
        var byDeg = function (x, y) { return (books[y].in.length + books[y].out.length) - (books[x].in.length + books[x].out.length); };
        var outIds = b.out.slice().sort(byDeg), inIds = b.in.slice().sort(byDeg);
        var allOut = this.state.allOut === b.id, allIn = this.state.allIn === b.id;
        vals.cardsOut = (allOut ? outIds : outIds.slice(0, CARD_CAP)).map(function (id) { return card(id, b.id, id); });
        vals.cardsIn = (allIn ? inIds : inIds.slice(0, CARD_CAP)).map(function (id) { return card(id, id, b.id); });
        vals.moreOut = !allOut && outIds.length > CARD_CAP; vals.moreIn = !allIn && inIds.length > CARD_CAP;
        vals.showAllOut = function () { self.setState({ allOut: b.id }); };
        vals.showAllIn = function () { self.setState({ allIn: b.id }); };
        var ngW = Math.max(280, Math.min(vw, 1240) - 48 - (vw > 900 ? 15 : 0));
        vals.neighborhood = this._vNext() ? null : this.neighborhood(b, ngW, this.state.ngAll === true && this.state.ngFor === b.id);
        var nIn = b.in.filter(function (id) { return b.out.indexOf(id) === -1; }).length, nBoth = b.out.filter(function (id) { return b.in.indexOf(id) !== -1; }).length;
        vals.ngCaption = (b.out.length + nIn) ? (b.out.length + nIn) + ' books one jump away' + (nBoth ? ' · ' + nBoth + ' mention each other' : '') : '';
        vals.openNetwork = function () { self.openNetwork(b.id); };
        vals.trail = this.trailEl(b.id);
        var gb = this.genreOf(b);
        vals.b_genreLabel = gb.name === 'MISC' ? '' : '  ·  ' + gb.name.toLowerCase();
        var jump = function (sel) { return function () { var el = document.getElementById(sel); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); }; };
        vals.jumpOut = jump('mentions-out'); vals.jumpIn = jump('mentions-in');
      } else {
        vals.b_title = this.state.ready ? 'Book not found' : 'Opening the stacks…'; vals.b_byline = ''; vals.hasAuthor = false; vals.noAuthor = true; vals.b_author = ''; vals.b_authorGo = function () {}; vals.b_authorHref = '/'; vals.b_yearSuffix = ''; vals.b_synopsis = this.state.ready ? 'That book isn’t in the network yet.' : 'One moment.';
        vals.b_cv = this.cover({ id: 'x', title: '?', author: '' }, 'vt-hero');
        vals.cntOut = 0; vals.cntIn = 0; vals.hasOut = false; vals.hasIn = false; vals.noOut = true; vals.noIn = true;
        vals.cardsOut = []; vals.cardsIn = []; vals.neighborhood = null; vals.jumpOut = function () {}; vals.jumpIn = function () {};
        vals.trail = null; vals.ngCaption = ''; vals.openNetwork = function () {}; vals.b_genreLabel = ''; vals.moreOut = vals.moreIn = false;
      }
    }

    // author page — every book keyed <authorSlug>/<titleSlug>, so group on the key's first segment.
    if (page === 'author') {
      var aslug = route.slug;
      var mine = all.filter(function (b) { return b.id.split('/')[0] === aslug; });
      mine.sort(function (x, y) { return (y.out.length + y.in.length) - (x.out.length + x.in.length) || (x.title < y.title ? -1 : 1); });
      vals.a_found = mine.length > 0;
      vals.a_none = mine.length === 0;
      vals.a_name = mine.length ? (mine[0].author || 'Unknown author')
        : this.norm(aslug).replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      var aMentions = mine.reduce(function (n, b) { return n + b.in.length; }, 0);
      vals.a_count = mine.length + (mine.length === 1 ? ' work' : ' works')
        + '  ·  ' + aMentions + (aMentions === 1 ? ' mention' : ' mentions') + ' of their books';
      vals.a_books = mine.map(function (b) {
        var btnStyle = { textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'block', color: 'inherit', textDecoration: 'none' };
        return { cv: self.cover(b), btnStyle: btnStyle, title: b.title, sub: self.subFor(b), href: '/' + b.id, go: self._linkGo(function (e) { self.goBook(b.id, e && e.currentTarget); }) };
      });
    }

    // search page
    if (page === 'search') {
      var q = route.q || '';
      var res = this.matches(q).slice(0, 30);
      vals.s_query = q;
      vals.s_results = res.map(function (b) {
        var rowStyle = { display: 'flex', alignItems: 'center', gap: m ? '12px' : '22px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1.5px solid var(--ink)', cursor: 'pointer', padding: '16px 8px', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', color: 'inherit', textDecoration: 'none' };
        return { cv: self.cover(b), rowStyle: rowStyle, title: b.title, author: b.author || 'author unknown', sub: self.subFor(b), href: '/' + b.id, go: self._linkGo(function (e) { self.goBook(b.id, e && e.currentTarget); }) };
      });
      vals.s_has = res.length > 0; vals.s_none = res.length === 0;
      vals.s_count = res.length === 0 ? 'no matches' : res.length + (res.length === 1 ? ' match' : ' matches');
    }

    // stats page: on narrow screens the two lists become Books / Authors tabs
    var stNarrow = vw < 900, stTab = this.state.statsTab === 'authors' ? 'authors' : 'books';
    vals.statsTabs = stNarrow;
    vals.statsShowBooks = !stNarrow || stTab === 'books';
    vals.statsShowAuthors = !stNarrow || stTab === 'authors';
    vals.statsTabBooksCls = stTab === 'books' ? 'on' : ''; vals.statsTabAuthorsCls = stTab === 'authors' ? 'on' : '';
    vals.statsTabBooks = function () { self.setState({ statsTab: 'books' }); };
    vals.statsTabAuthors = function () { self.setState({ statsTab: 'authors' }); };
    // stats page
    if (page === 'stats' && all.length) {
      var sd = this.statsData();
      var byBook = sd.byBook, byAuthor = sd.byAuthor;
      var max = byBook.length ? byBook[0].in.length : 1;
      vals.topBooks = byBook.map(function (b, i) {
        return {
          rank: String(i + 1).padStart(2, '0'), title: b.title, author: b.author || '', count: b.in.length,
          bar: { height: '100%', width: (b.in.length / max * 100) + '%', background: 'var(--accent)', borderRadius: 3 },
          href: '/' + b.id, go: self._linkGo(function () { self.goBook(b.id); })
        };
      });
      vals.topAuthors = byAuthor.map(function (entry, i) {
        var name = entry[0], d = entry[1];
        var aslug = self.authorSlug(name);
        return {
          rank: String(i + 1).padStart(2, '0'), name: name, count: d.count,
          works: d.works.size + (d.works.size === 1 ? ' work' : ' works'),
          href: '/' + aslug, go: self._linkGo(function () { self.goAuthor(aslug); })
        };
      });
    } else { vals.topBooks = vals.topBooks || []; vals.topAuthors = vals.topAuthors || []; }

    // network page: mount the constellation canvas engine into the route host via a STABLE ref
    // (created once, reused every render) so React only fires it on real mount/unmount — not on
    // every setState — which would otherwise destroy+reconstruct the engine each frame.
    vals.netHostRef = self._netHostRef || (self._netHostRef = function (el) {
      if (el) {
        self._netHostEl = el;
        if (self._constellation) return; // already mounted
        self._loadConstellation(function () {
          if (self._netHostEl && self.state.route.page === 'network') self._mountConstellation(self._netHostEl);
        });
      } else {
        self._netHostEl = null;
        if (self._constellation) {
          self._constellation.destroy();
          self._constellation = null;
          self._cstFocused = null;
          window.__constellation = null;
        }
      }
    });

    // network: the Explorer variant (lazy) + the Map/Explorer switcher when ?net= is set
    vals.netCompare = page === 'network' && !!this._netCompare;
    var nf = route.focus ? '/' + route.focus : '';
    vals.netSwMap = '/network' + nf + '?net=map'; vals.netSwX = '/network' + nf + '?net=v2';
    vals.netSwMapCls = vals.pgNetMap ? 'on' : ''; vals.netSwXCls = vals.pgExplorer ? 'on' : '';
    vals.netSwA = '/network' + nf + '?net=v3'; vals.netSwACls = vals.pgAtlas ? 'on' : '';
    vals.netSwP = '/network' + nf + '?net=v4'; vals.netSwPCls = this._netMode() === 'plus' && page === 'network' ? 'on' : '';
    if (vals.netSwXCls && vals.netSwPCls) vals.netSwXCls = '';
    vals.atlasHostRef = this._atlasRefFn || (this._atlasRefFn = function (el) {
      if (el) { self._atlasEl = el; self._mountAtlas(); }
      else { self._atlasEl = null; if (self._atlas) { self._atlas.destroy(); self._atlas = null; window.__atlas = null; } }
    });
    if (vals.pgAtlas) {
      this._popPool || (this._popPool = POPULAR_FICTION.map(function (t) { return self.bookByTitle(t); }).filter(function (b) { return b && self._homeOk(b.id); }));
      this._loadNotes();
      this._loadAtlas();
      vals.atlasUi = this.atlasUi(route.focus);
    } else vals.atlasUi = null;
    // ?v=next: the book page (fan + panel + lists) and the star-map network page
    if (vals.pgBookNext || vals.pgStars) {
      this._loadNotes();
      if (!this._xReady()) { this._loadExplorer(); vals.bookNext = vals.starMap = h('div', { className: 'bjx-loading' }, 'Opening…'); }
      else {
        vals.bookNext = vals.pgBookNext ? (books[route.id] ? this.bookNext(books[route.id]) : h('div', { className: 'bjx-empty' }, this.state.ready ? 'That book isn’t in the network yet.' : 'Opening the stacks…')) : null;
        vals.starMap = vals.pgStars ? (this._vLab() && this.labMap ? this.labMap(route.focus) : this.starMap(route.focus)) : null;
      }
    } else vals.bookNext = vals.starMap = null;
    // only on ?v=classic: a way back to the new site
    this._vNext();
    vals.vSwitch = !!this._vClassic;
    vals.vToNew = function (e) { if (e) e.preventDefault(); location.href = location.pathname + location.hash; };
    if (vals.pgExplorer) {
      this._popPool || (this._popPool = POPULAR_FICTION.map(function (t) { return self.bookByTitle(t); }).filter(function (b) { return b && self._homeOk(b.id); }));
      this._loadNotes();
      if (this._xReady()) vals.explorer = this.explorer(route.focus);
      else { this._loadExplorer(); vals.explorer = h('div', { className: 'bjx-loading' }, 'Opening the explorer…'); }
    } else vals.explorer = null;

    // Per-route browser tab title (OG/social preview tags stay homepage-only by design —
    // this only ever affects document.title, never anything a link-unfurler reads).
    if (typeof document !== 'undefined') {
      var titleMap = {
        home: 'BookJumpr: Books Mentioned Inside Other Books',
        book: (vals.b_title || 'Book') + ' — BookJumpr',
        author: (vals.a_name || 'Author') + ' — BookJumpr',
        search: '“' + (route.q || '') + '” — Search — BookJumpr',
        stats: 'Stats — BookJumpr',
        network: 'Network — BookJumpr',
        about: 'About — BookJumpr'
      };
      document.title = titleMap[page] || titleMap.home;
      // keep the canonical URL in step with the address bar (the edge function sets it for the first page loaded)
      var can = document.querySelector('link[rel="canonical"]');
      if (can && /^(home|book|author|stats|about|network)$/.test(page)) can.href = 'https://bookjumpr.com' + (page === 'network' ? '/network' : '/' + this._routePath());
    }

    return vals;
  };

  P.render = function () {
    if (!BookJumpr._tpl) {
      var tplSrc = document.getElementById('bj-template').innerHTML;
      BookJumpr._tpl = compileTemplate(tplSrc);
    }
    return h(React.Fragment, null, BookJumpr._tpl(this.renderVals()));
  };

  // Default props mirror the design's data-props defaults.
  var DEFAULT_PROPS = { coverMode: 'ink, color on hover', heroStyle: 'dense wall', warmPaper: true, accent: '#9c3d22', coverBorder: 'ink' };

  function mount() {
    var el = document.getElementById('app');
    var node = h(BookJumpr, DEFAULT_PROPS);
    if (ReactDOM.createRoot) ReactDOM.createRoot(el).render(node);
    else ReactDOM.render(node, el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
