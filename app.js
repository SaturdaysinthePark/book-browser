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
    "Uncle Tom's Cabin", 'Madame Bovary', 'Vanity Fair', 'Middlemarch', 'A Farewell to Arms', 'Lolita'
  ];

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
    this.state = { route: { page: 'home' }, q: '', suggestFor: null, ready: false, vw: 0, chipSeed: 0 };
    // Data is available synchronously via the vendored global, so build it up front.
    this.buildData(DATA.NODES || {}, DATA.MENTIONS || []);
    this.state.ready = true;
    this.state.vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    if (typeof location !== 'undefined' && location.hash && location.hash.length > 2) {
      this.state.route = this._routeFromHash();
    }
  };
  BookJumpr.prototype = Object.create(React.Component.prototype);
  BookJumpr.prototype.constructor = BookJumpr;
  var P = BookJumpr.prototype;

  P.componentDidMount = function () {
    var self = this;
    this._onHash = function () { self.applyHash(); };
    window.addEventListener('hashchange', this._onHash);
    this._onResize = function () { self.setState({ vw: window.innerWidth }); };
    window.addEventListener('resize', this._onResize);
    if (location.hash && location.hash.length > 2) this.applyHash();
  };
  P.componentWillUnmount = function () {
    window.removeEventListener('hashchange', this._onHash);
    window.removeEventListener('resize', this._onResize);
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

  P.mark2 = function (name, size, ink, hole) {
    var R = React.createElement;
    var kids = [];
    var P_ = function (d, f) { kids.push(R('path', { d: d, fill: f || ink, key: kids.length })); };
    var S = function (d, w, col) { kids.push(R('path', { d: d, fill: 'none', stroke: col || ink, strokeWidth: w, strokeLinecap: 'round', key: kids.length })); };
    var C = function (cx, cy, r, f) { kids.push(R('circle', { cx: cx, cy: cy, r: r, fill: f || ink, key: kids.length })); };
    var E = function (cx, cy, rx, ry, f) { kids.push(R('ellipse', { cx: cx, cy: cy, rx: rx, ry: ry, fill: f || ink, key: kids.length })); };
    var RT = function (x, y, w, ht, f, rx) { kids.push(R('rect', { x: x, y: y, width: w, height: ht, fill: f || ink, rx: rx || 0, key: kids.length })); };
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
      kids.push(R('path', { d: 'M19 34.5 L29 34.5 L33.5 44 L14.5 44 Z', fill: ink, opacity: 0.3, key: kids.length }));
    }
    if (name === 'dragon2') {
      kids.push(R('path', { d: 'M33.2 9.0 L36.6 12.2 L36.9 11.9 L37.2 12.5 L41.1 13.6 L43.8 16.8 L44.7 17.4 L45.2 16.9 L45.5 17.5 L45.2 19.1 L42.7 18.2 L44.1 19.1 L43.6 19.6 L42.9 19.6 L40.5 17.8 L37.9 16.6 L36.6 16.3 L36.2 16.9 L36.2 19.4 L38.5 25.9 L38.5 28.8 L37.7 30.8 L36.2 32.6 L34.6 33.4 L34.9 32.5 L34.9 31.9 L34.6 32.2 L34.0 35.0 L34.0 37.8 L35.2 38.4 L34.8 39.0 L33.3 39.0 L32.6 38.4 L31.6 36.4 L31.0 32.5 L31.0 34.4 L30.2 34.5 L24.2 34.2 L23.2 33.9 L23.4 33.3 L22.0 35.0 L21.0 37.5 L21.0 38.3 L22.3 38.6 L22.6 39.0 L20.4 39.0 L19.3 36.9 L19.2 33.0 L18.5 33.6 L14.8 32.5 L10.6 30.2 L9.0 28.6 L6.4 23.8 L5.5 20.7 L5.3 18.6 L3.1 17.5 L2.5 15.4 L2.7 14.9 L3.3 15.4 L3.7 15.2 L3.9 13.8 L4.8 11.8 L5.8 12.5 L6.9 14.9 L8.0 14.4 L8.0 17.2 L6.4 18.2 L6.6 19.6 L7.5 21.7 L10.8 25.6 L15.0 28.3 L17.1 28.9 L19.9 28.9 L28.1 26.9 L30.5 28.1 L29.3 26.9 L26.6 25.8 L22.6 25.6 L21.8 25.9 L21.4 23.0 L20.1 22.1 L18.9 21.9 L19.2 21.0 L18.9 19.2 L15.9 18.0 L18.1 17.8 L21.2 18.3 L27.0 20.5 L28.2 22.1 L28.8 24.5 L29.9 26.7 L30.4 27.0 L30.4 26.7 L32.3 26.3 L33.0 25.5 L33.5 24.1 L32.7 16.6 L34.0 14.0 L34.8 13.3 L35.2 13.5 L33.2 9.1Z M38.3 14.3 L39.0 15.0 L39.6 15.0 L39.6 14.1 L38.3 14.1Z', fill: ink, fillRule: 'evenodd', key: kids.length }));
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
      kids.push(R('ellipse', { cx: 24, cy: 24, rx: 7.4, ry: 15.5, fill: 'none', stroke: hole, strokeWidth: 1.8, key: kids.length }));
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
    return R('svg', { viewBox: '0 0 48 48', width: size, height: size, style: { display: 'block' } }, kids);
  };

  P.triCover = function (b, g, tier, mode, borderOpt) {
    this._tri = this._tri || {};
    borderOpt = (borderOpt === 'cream' || borderOpt === 'none') ? borderOpt : 'ink';
    var key = b.id + ':' + tier + ':' + mode + ':' + borderOpt + ':' + (b.genre || '');
    if (this._tri[key]) return this._tri[key];
    var misc = g.name === 'MISC';
    var bandBg;
    if (mode === 'static') bandBg = misc ? '#141414' : g.color;
    else if (misc) bandBg = '#141414';
    else if (mode === 'color') bandBg = 'var(--hb, ' + g.color + ')';
    else bandBg = 'var(--hb, #141414)';
    var T = {
      xs: { mark: 13, blob: [14, 6.5], bw: '1.5px', tb: 6.5, tmin: 5, ab: 4.5, amin: 4, gap: '2px', pad: '2px 4px' },
      s: { mark: 26, blob: [25, 11], bw: '2px', tb: 11.5, tmin: 7.5, ab: 7, amin: 5.5, gap: '7px', pad: '6px 8px' },
      l: { mark: 34, blob: [30, 13], bw: '2px', tb: 13, tmin: 9, ab: 8, amin: 6.5, gap: '4px', pad: '4px 10px' },
      xl: { mark: 46, blob: [42, 18], bw: '2.5px', tb: 19, tmin: 12, ab: 9.5, amin: 7.5, gap: '6px', pad: '6px 14px' }
    }[tier];
    var band = { backgroundColor: bandBg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };

    // Outer cover frame is tweakable (ink / cream / none); the internal color-band
    // dividers below stay ink regardless so the bands never lose their edge.
    var coverBorder = borderOpt === 'none' ? 'none'
      : borderOpt === 'cream' ? (T.bw + ' solid #f2ecdd')
      : (T.bw + ' solid var(--ink)');

    // Title: 6 length buckets, each a smaller size + more clamp lines (up to 6).
    var len = b.title.length;
    var ts = len < 10 ? [1.00, 2] : len < 18 ? [0.90, 3] : len < 28 ? [0.80, 4]
      : len < 40 ? [0.70, 5] : len < 60 ? [0.60, 6] : [0.52, 6];
    var tSize = Math.max(T.tmin, Math.round(T.tb * ts[0] * 2) / 2);
    var tClamp = tier === 'xs' ? Math.min(ts[1], 3) : ts[1];

    // Author scales on its own length and wraps to 2 lines when the name is long.
    var alen = (b.author || '').length;
    var as = alen < 14 ? [1.00, 1] : alen < 22 ? [0.90, 2] : alen < 32 ? [0.82, 2] : [0.74, 2];
    var aSize = Math.max(T.amin, Math.round(T.ab * as[0] * 2) / 2);
    var aClamp = as[1];

    var item = {
      cover: { aspectRatio: '2 / 3', width: '100%', border: coverBorder, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f2ecdd', boxSizing: 'border-box', textAlign: 'center' },
      top: Object.assign({}, band, { height: '26%', borderBottom: '1.5px solid var(--ink)' }),
      blob: { width: T.blob[0] + 'px', height: T.blob[1] + 'px', background: '#f2ecdd', borderRadius: '50% / 48%' },
      mid: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: T.gap, padding: T.pad, overflow: 'hidden' },
      title: { fontFamily: 'Helvetica, Arial, sans-serif', fontWeight: 700, textTransform: 'uppercase', fontSize: tSize + 'px', lineHeight: 1.18, letterSpacing: '.01em', color: 'var(--ink)', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: tClamp, overflow: 'hidden' },
      author: { fontFamily: "'IBM Plex Mono', monospace", fontSize: aSize + 'px', letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.7, color: 'var(--ink)', lineHeight: 1.3, display: tier === 'xs' ? 'none' : '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: aClamp, overflow: 'hidden' },
      // Penguin-style rule between title and author (wall covers with a known author).
      // Dash tracks the band colour: ink by default, genre colour on hover (same
      // var(--hb, …) mechanism as the top/bottom bands).
      divider: { width: '18px', height: '2px', background: bandBg, borderRadius: '1px', flexShrink: 0, display: (tier === 's' && b.author) ? 'block' : 'none' },
      bot: Object.assign({}, band, { height: '24%', borderTop: '1.5px solid var(--ink)' }),
      mark: this.mark2(g.mark, T.mark, '#f7f5f0', mode === 'static' ? bandBg : (misc ? '#141414' : bandBg)),
      titleText: b.title, authorText: b.author
    };
    this._tri[key] = item;
    return item;
  };

  // ---------- routing ----------
  // URL scheme is author-first: a book is #/<author>/<title>, an author page is #/<author>.
  // Reserved words keep their own routes; #/book/<key> stays as a legacy alias.
  P._routeFromHash = function () {
    var hh = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (!hh) return { page: 'home' };
    if (hh.indexOf('search/') === 0) return { page: 'search', q: hh.slice(7) };
    if (hh === 'stats') return { page: 'stats' };
    if (hh === 'network') return { page: 'network' };
    if (hh === 'about') return { page: 'about' };
    if (hh.indexOf('book/') === 0) return { page: 'book', id: hh.slice(5) }; // legacy alias
    if (hh.indexOf('/') !== -1) return { page: 'book', id: hh };            // <author>/<title>
    return { page: 'author', slug: hh };                                    // <author>
  };
  P.navigate = function (route, hash) {
    this.setState({ route: route, q: '', suggestFor: null });
    this._silent = true;
    location.hash = hash;
    var self = this;
    setTimeout(function () { self._silent = false; }, 0);
    window.scrollTo(0, 0);
  };
  P.applyHash = function () {
    if (this._silent) return;
    this.setState({ route: this._routeFromHash(), suggestFor: null });
    window.scrollTo(0, 0);
  };
  P.goBook = function (id) { this.navigate({ page: 'book', id: id }, '#/' + id); };
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

  // ---------- mini ego graph ----------
  P.miniGraph = function (b) {
    var R = React.createElement;
    var self = this;
    var W = 300, H = 260, cx = W / 2, cy = H / 2;
    var outN = b.out.map(function (id) { return { id: id, kind: 'out' }; });
    var inN = b.in.map(function (id) { return { id: id, kind: 'in' }; }).filter(function (n) { return b.out.indexOf(n.id) === -1; });
    var nodes = outN.concat(inN);
    var extra = Math.max(0, nodes.length - 12);
    nodes = nodes.slice(0, 12);
    var n = nodes.length || 1;
    var pts = nodes.map(function (nd, i) {
      var ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return Object.assign({}, nd, { x: cx + Math.cos(ang) * 108, y: cy + Math.sin(ang) * 92 });
    });
    var lines = pts.map(function (p, i) {
      return R('line', {
        key: i, x1: cx, y1: cy, x2: p.x, y2: p.y,
        stroke: 'var(--ink)', strokeWidth: 1.2, opacity: 0.55,
        strokeDasharray: p.kind === 'in' ? '2 4' : 'none'
      });
    });
    var nodeEls = pts.map(function (p, i) {
      var bk = self.books[p.id];
      var label = bk.title.length > 20 ? bk.title.slice(0, 19).replace(/\s+$/, '') + '…' : bk.title;
      return R('button', {
        key: 'n' + i,
        onClick: function () { self.goBook(p.id); },
        title: bk.title,
        style: {
          position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%,-50%)',
          background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: 999,
          padding: '3px 8px', fontSize: 9.5, fontFamily: "'IBM Plex Mono', monospace",
          cursor: 'pointer', maxWidth: 110, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }
      }, label);
    });
    var center = R('div', {
      style: {
        position: 'absolute', left: cx, top: cy, transform: 'translate(-50%,-50%)',
        background: 'var(--ink)', color: 'var(--paper)', borderRadius: 999,
        padding: '5px 11px', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
        maxWidth: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }
    }, b.title);
    var more = extra ? R('div', {
      style: { position: 'absolute', right: 6, bottom: 4, fontSize: 9.5, fontFamily: "'IBM Plex Mono', monospace", opacity: 0.55 }
    }, '+' + extra + ' more') : null;
    var empty = n === 0 || (nodes.length === 0) ? R('div', {
      style: { position: 'absolute', left: 0, right: 0, top: '70%', textAlign: 'center', fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", opacity: 0.55 }
    }, 'no connections yet') : null;
    return R('div', { style: { position: 'relative', width: '100%', height: H } },
      R('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, style: { position: 'absolute', inset: 0 }, preserveAspectRatio: 'xMidYMid meet' }, lines),
      pts.length ? nodeEls : empty, center, more);
  };

  // ---------- stats ----------
  P.statsData = function () {
    if (this._stats) return this._stats;
    var byBook = this.all.filter(function (b) { return b.in.length > 0; })
      .sort(function (a, b) { return b.in.length - a.in.length || a.title.localeCompare(b.title); }).slice(0, 20);
    var authors = {};
    for (var i = 0; i < this.all.length; i++) {
      var b = this.all[i];
      if (!b.author || !b.in.length) continue;
      if (!authors[b.author]) authors[b.author] = { count: 0, works: {} };
      authors[b.author].count += b.in.length;
      authors[b.author].works[b.title] = true;
    }
    var byAuthor = Object.keys(authors).map(function (name) {
      return [name, { count: authors[name].count, works: { size: Object.keys(authors[name].works).length } }];
    }).sort(function (a, b) { return b[1].count - a[1].count || a[0].localeCompare(b[0]); }).slice(0, 20);
    this._stats = { byBook: byBook, byAuthor: byAuthor };
    return this._stats;
  };

  P.renderVals = function () {
    var self = this;
    var Pr = this.props;
    var warm = Pr.warmPaper != null ? Pr.warmPaper : true;
    var heroStyle = Pr.heroStyle != null ? Pr.heroStyle : 'dense wall';
    var accent = Pr.accent != null ? Pr.accent : '#9c3d22';
    var coverMode = String(Pr.coverMode != null ? Pr.coverMode : 'ink, color on hover').indexOf('color,') === 0 ? 'color' : 'ink';
    var coverBorder = (Pr.coverBorder === 'cream' || Pr.coverBorder === 'none') ? Pr.coverBorder : 'ink';
    var bandcFor = function (g) { return g.name === 'MISC' ? null : (coverMode === 'ink' ? g.color : '#141414'); };
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

    var go = function (fn) { return function (e) { if (e && e.preventDefault) e.preventDefault(); fn(); }; };
    var vals = {
      pgHome: page === 'home', pgBook: page === 'book', pgSearch: page === 'search',
      pgStats: page === 'stats', pgNetwork: page === 'network', pgAbout: page === 'about',
      pgAuthor: page === 'author',
      goHome: go(function () { self.navigate({ page: 'home' }, '#/'); }),
      goStats: go(function () { self.navigate({ page: 'stats' }, '#/stats'); }),
      goNetwork: go(function () { self.navigate({ page: 'network' }, '#/network'); }),
      goAbout: go(function () { self.navigate({ page: 'about' }, '#/about'); }),
      showChrome: page !== 'home',
      showFooter: page !== 'home' && page !== 'network',
      showHeaderSearch: page !== 'home' && page !== 'network',
      navText: page !== 'home' && !m,
      navIcons: page !== 'home' && m,
      hdrSearchWrap: m ? { position: 'relative', flexBasis: '100%', order: 9, margin: '2px 0 4px' } : { position: 'relative', marginRight: '8px' },
      hdrInput: { height: '40px', border: '1.5px solid var(--ink)', borderRadius: '999px', padding: '0 18px', fontSize: '16px', background: 'var(--card)', color: 'var(--ink)', fontFamily: 'inherit', boxSizing: 'border-box', boxShadow: '0 3px 0 rgba(20,20,20,.85)', width: m ? '100%' : '240px' },
      bookHero: { display: 'grid', gridTemplateColumns: m ? '1fr' : mid ? '180px minmax(0,1fr)' : '210px minmax(0,1fr) 340px', gap: m ? '28px' : '44px', alignItems: 'start' },
      coverWrap: { boxShadow: '10px 10px 0 rgba(20,20,20,.12)', maxWidth: m ? '180px' : 'none' },
      graphPanel: { border: '1.5px solid var(--ink)', borderRadius: '18px', background: 'var(--card)', padding: '18px 18px 10px', gridColumn: mid && !m ? '1 / -1' : 'auto', maxWidth: mid && !m ? '540px' : 'none' },
      statsCols: { display: 'grid', gridTemplateColumns: vw < 900 ? '1fr' : '1fr 1fr', gap: '44px 56px', alignItems: 'start' },
      shuffleChips: function () { self.setState({ chipSeed: (self.state.chipSeed || 0) + 1 }); },
      q: this.state.q,
      onQ: function (e) { self.setState({ q: e.target.value }); },
      onKey: function (e) { if (e.key === 'Enter') self.submitSearch(); if (e.key === 'Escape') self.setState({ suggestFor: null }); },
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
      ? { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', justifyContent: 'center', marginTop: '24px' }
      : { display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '12px' };
    // Mobile: trim the card's side padding so two suggestion pills + the shuffle fit on
    // one row (and the whole card reads tighter). Desktop keeps its fluid clamp padding.
    vals.heroCard = {
      pointerEvents: 'auto', background: 'var(--card)', border: '1.5px solid var(--ink)', borderRadius: '20px',
      boxShadow: '0 30px 70px rgba(20,20,20,.22)', maxWidth: '680px', width: '100%', textAlign: 'center', boxSizing: 'border-box',
      padding: m ? '24px 18px 22px' : 'clamp(28px,5.5vw,52px) clamp(20px,6vw,60px) clamp(26px,4.5vw,44px)'
    };
    // Mobile: tighten the hero — smaller arc/paragraph and reduced vertical gaps.
    vals.heroArc = m
      ? { display: 'flex', justifyContent: 'center', maxWidth: '300px', margin: '0 auto' }
      : { display: 'flex', justifyContent: 'center' };
    vals.heroH1 = m
      ? { fontFamily: "'Instrument Serif',serif", fontWeight: 400, fontSize: 'clamp(31px,7.5vw,54px)', lineHeight: 1.05, margin: '12px 0 10px' }
      : { fontFamily: "'Instrument Serif',serif", fontWeight: 400, fontSize: 'clamp(31px,7.5vw,54px)', lineHeight: 1.05, margin: '20px 0 12px' };
    vals.heroP = m
      ? { fontSize: '14.5px', lineHeight: 1.55, opacity: 0.75, maxWidth: '470px', margin: '0 auto' }
      : { fontSize: '15.5px', lineHeight: 1.6, opacity: 0.75, maxWidth: '470px', margin: '0 auto' };
    vals.heroSearchWrap = m
      ? { position: 'relative', maxWidth: '520px', margin: '20px auto 0' }
      : { position: 'relative', maxWidth: '520px', margin: '26px auto 0' };
    vals.homeIconsRow = m
      ? { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '22px' }
      : { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '30px' };
    vals.homeNavBtn = iconBtn(m ? 44 : 32, 0.4);
    vals.hdrNavBtn = iconBtn(m ? 44 : 34, 0.6);
    // Mobile: hide secondary captions / truncate long titles so rows don't collide.
    vals.secCaption = m ? { display: 'none' } : { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', opacity: 0.6 };
    vals.statTitle = m
      ? { fontSize: '14.5px', fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
      : { fontSize: '14.5px', fontWeight: 700 };
    vals.statCapBook = m ? { display: 'none' } : { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', textTransform: 'uppercase', opacity: 0.55 };
    vals.statCapWorks = m ? { display: 'none' } : { fontFamily: "'IBM Plex Mono', monospace", fontSize: '10px', opacity: 0.55 };

    // suggestions
    var sugg = this.state.suggestFor && this.state.q.trim() ? this.matches(this.state.q).slice(0, 7) : [];
    vals.suggestions = sugg.map(function (b) { return { title: b.title, sub: self.subFor(b), go: function () { self.goBook(b.id); } }; });
    vals.showHomeSuggest = this.state.suggestFor === 'home' && sugg.length > 0;
    vals.showHeaderSuggest = this.state.suggestFor === 'header' && sugg.length > 0;

    // home wall — four densities: dense wall > light wall > scattered > plain paper.
    var wallMode = heroStyle === 'scattered' ? 'scattered'
      : heroStyle === 'plain paper' ? 'plain'
      : heroStyle === 'light wall' ? 'light'
      : 'dense';
    var wallCfg = {
      dense: { count: m ? 110 : 180, min: m ? 88 : 110, gap: '0px', pad: '0', inset: '-46px -36px', tier: 's', overlap: '-15px -20px' },
      light: { count: m ? 68 : 104, min: m ? 104 : 128, gap: '0px', pad: '6px', inset: '-38px -28px', tier: 's', overlap: '-6px -8px' },
      scattered: { count: m ? 36 : 54, min: m ? 118 : 148, gap: '26px', pad: '20px', inset: '-30px', tier: 'l', overlap: null },
      plain: { count: 0, min: m ? 118 : 148, gap: '26px', pad: '20px', inset: '-30px', tier: 'l', overlap: null }
    }[wallMode];
    if (page === 'home') {
      var sorted = all.slice().sort(function (a, b2) { return self.hash(a.id) - self.hash(b2.id); });
      var list = [];
      var target = wallCfg.count;
      while (list.length < target && sorted.length) list = list.concat(sorted.slice(0, target - list.length));
      vals.wallCovers = list.map(function (b, i) {
        var h1 = self.hash(b.id + i), h2 = self.hash(i + '/' + b.id);
        var g = self.genreOf(b);
        var bc = bandcFor(g);
        // backface-visibility on both wrapper and card tucks antialiasing seams
        // under neighbours where rotated covers overlap.
        var inner = {
          transition: 'transform .24s cubic-bezier(.3,1.6,.45,1), box-shadow .22s ease',
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden'
        };
        if (bc) inner['--bandc'] = bc;
        var wrap = { position: 'relative', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' };
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
        // Overlapping walls draw their dark edge with the opaque frame above, so the
        // cover's own border is dropped (no double edge); other modes keep it.
        var wallBorder = (wallMode === 'dense' || wallMode === 'light') ? 'none' : coverBorder;
        return Object.assign({ wrap: wrap, inner: inner }, self.triCover(b, g, wallCfg.tier, coverMode, wallBorder));
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
      var popPool = this._popPool || (this._popPool = POPULAR_FICTION.map(function (t) { return self.bookByTitle(t); }).filter(Boolean));
      var pool = popPool.filter(function (b) { return b.title.length <= chipMax; });
      // Prepend the seed (not append) so it perturbs the whole FNV hash via avalanche —
      // appending only shifts every hash by a constant, leaving the sort order unchanged.
      var picks = pool.slice().sort(function (a, b2) { return self.hash(seed + '~' + a.id) - self.hash(seed + '~' + b2.id); }).slice(0, chipN);
      vals.chips = picks.map(function (b) { return { label: b.title, go: function () { self.goBook(b.id); } }; });
    } else { vals.wallCovers = []; vals.chips = []; vals.wallStyle = {}; vals.wallFade = {}; }

    // book page
    if (page === 'book') {
      var b = books[route.id];
      if (b) {
        vals.b_title = b.title;
        vals.b_t = this.triCover(b, this.genreOf(b), 'xl', 'static', coverBorder);
        var yl = this.yearLabel(b.year);
        var bHasAuthor = !!(b.author && b.author !== 'Anonymous');
        vals.hasAuthor = bHasAuthor;
        vals.noAuthor = !bHasAuthor;
        vals.b_author = b.author || '';
        vals.b_authorGo = go((function (bk) { return function () { self.goAuthor(self.authorSlug(bk.author)); }; })(b));
        vals.b_yearSuffix = yl ? '  ·  ' + yl : '';
        // Plain fallback used when the author isn't a clickable link (unknown/Anonymous).
        vals.b_byline = [b.author ? 'by ' + b.author : null, yl || null].filter(Boolean).join('  ·  ');
        vals.b_synopsis = b.synopsis || 'No synopsis on file yet — but the trail doesn’t stop here. See what it’s connected to below.';
        vals.cntOut = b.out.length; vals.cntIn = b.in.length;
        vals.hasOut = b.out.length > 0; vals.noOut = b.out.length === 0;
        vals.hasIn = b.in.length > 0; vals.noIn = b.in.length === 0;
        var card = function (id) {
          var bk = books[id]; var g = self.genreOf(bk);
          var bc = bandcFor(g);
          var btnStyle = { textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'block' };
          if (bc) btnStyle['--bandc'] = bc;
          return { t: self.triCover(bk, g, 'l', coverMode, coverBorder), btnStyle: btnStyle, title: bk.title, author: bk.author || 'author unknown', sub: self.subFor(bk), go: function () { self.goBook(id); } };
        };
        vals.cardsOut = b.out.map(card);
        vals.cardsIn = b.in.map(card);
        vals.miniGraph = this.miniGraph(b);
        var jump = function (sel) { return function () { var el = document.getElementById(sel); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); }; };
        vals.jumpOut = jump('mentions-out'); vals.jumpIn = jump('mentions-in');
      } else {
        vals.b_title = this.state.ready ? 'Book not found' : 'Opening the stacks…'; vals.b_byline = ''; vals.hasAuthor = false; vals.noAuthor = true; vals.b_author = ''; vals.b_authorGo = function () {}; vals.b_yearSuffix = ''; vals.b_synopsis = this.state.ready ? 'That book isn’t in the network yet.' : 'One moment.';
        var phb = { id: 'x', title: '?', author: '' };
        vals.b_t = this.triCover(phb, this.genreOf(phb), 'xl', 'static', coverBorder);
        vals.cntOut = 0; vals.cntIn = 0; vals.hasOut = false; vals.hasIn = false; vals.noOut = true; vals.noIn = true;
        vals.cardsOut = []; vals.cardsIn = []; vals.miniGraph = null; vals.jumpOut = function () {}; vals.jumpIn = function () {};
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
        var g = self.genreOf(b);
        var bc = bandcFor(g);
        var btnStyle = { textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'block' };
        if (bc) btnStyle['--bandc'] = bc;
        return { t: self.triCover(b, g, 'l', coverMode, coverBorder), btnStyle: btnStyle, title: b.title, sub: self.subFor(b), go: function () { self.goBook(b.id); } };
      });
    }

    // search page
    if (page === 'search') {
      var q = route.q || '';
      var res = this.matches(q).slice(0, 30);
      vals.s_query = q;
      vals.s_results = res.map(function (b) {
        var g = self.genreOf(b);
        var bc = bandcFor(g);
        var rowStyle = { display: 'flex', alignItems: 'center', gap: m ? '12px' : '22px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1.5px solid var(--ink)', cursor: 'pointer', padding: '16px 8px', fontFamily: 'inherit', width: '100%' };
        if (bc) rowStyle['--bandc'] = bc;
        return { t: self.triCover(b, g, 'xs', coverMode, coverBorder), rowStyle: rowStyle, title: b.title, author: b.author || 'author unknown', sub: self.subFor(b), go: function () { self.goBook(b.id); } };
      });
      vals.s_has = res.length > 0; vals.s_none = res.length === 0;
      vals.s_count = res.length === 0 ? 'no matches' : res.length + (res.length === 1 ? ' match' : ' matches');
    }

    // stats page
    if (page === 'stats' && all.length) {
      var sd = this.statsData();
      var byBook = sd.byBook, byAuthor = sd.byAuthor;
      var max = byBook.length ? byBook[0].in.length : 1;
      vals.topBooks = byBook.map(function (b, i) {
        return {
          rank: String(i + 1).padStart(2, '0'), title: b.title, author: b.author || '', count: b.in.length,
          bar: { height: '100%', width: (b.in.length / max * 100) + '%', background: 'var(--accent)', borderRadius: 3 },
          go: function () { self.goBook(b.id); }
        };
      });
      vals.topAuthors = byAuthor.map(function (entry, i) {
        var name = entry[0], d = entry[1];
        var aslug = self.authorSlug(name);
        return {
          rank: String(i + 1).padStart(2, '0'), name: name, count: d.count,
          works: d.works.size + (d.works.size === 1 ? ' work' : ' works'),
          go: function () { self.goAuthor(aslug); }
        };
      });
    } else { vals.topBooks = vals.topBooks || []; vals.topAuthors = vals.topAuthors || []; }

    // network page: mount the constellation canvas engine into the route host via a STABLE ref
    // (created once, reused every render) so React only fires it on real mount/unmount — not on
    // every setState — which would otherwise destroy+reconstruct the engine each frame.
    vals.netHostRef = self._netHostRef || (self._netHostRef = function (el) {
      if (el) {
        if (self._constellation) return;                       // guard double-instantiation
        if (!window.Constellation || !window.BookGraph) return;
        self._constellation = new window.Constellation({
          root: el,
          data: window.BookGraph,
          bookUrlPattern: 'index.html#/{author}/{title}',
          showRings: true, labelDensity: 1, ambientTours: true,
          onOpenPage: function (key) { self.navigate({ page: 'book', id: key }, '#/' + key); }
        });
        window.__constellation = self._constellation; // debug / integration hook
      } else if (self._constellation) {
        self._constellation.destroy();
        self._constellation = null;
        window.__constellation = null;
      }
    });

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
