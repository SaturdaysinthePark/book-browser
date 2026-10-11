/*
 * BookJumpr — network Explorer (#/network with ?net=v2).
 *
 * A calmer alternative to the full constellation map, built from the book page's neighbourhood
 * fan: one book sits in the middle, the books that mention it fan in from the left (blue), the
 * books it mentions fan out to the right (rust), mutual mentions get a two-way ink edge. You
 * explore by jumping from fan to fan — the clicked pill glides into the centre (a same-document
 * View Transition) and the book you came from slides into place in the new fan.
 *
 * Loaded lazily by app.js; it extends the BookJumpr component prototype (window.__BJ.P) with
 * render helpers, so it shares the app's data, covers (coverHTML), fan layout (fanLayout),
 * mention notes (noteEl), search (matches) and routing (navigate).
 */
(function () {
  'use strict';
  var BJ = window.__BJ;
  if (!BJ) return;
  var P = BJ.P, h = BJ.h;
  var SMALL = "10px 'IBM Plex Mono', monospace";

  // ---- jumping ---------------------------------------------------------------------------
  // Name the clicked element "bjx-c" and the current centre "bjx-p": after the route change the
  // new centre pill (class .bjx-center → bjx-c) morphs out of the clicked pill, and the book we
  // came from (now a neighbour in the new fan) receives "bjx-p", so it slides into its new spot.
  P.xJump = function (id, fromEl) {
    if (!id || !this.books[id]) return;
    if (this._netMode && this._netMode() === 'atlas') { this.mapFocus(id); return; }   // the Atlas moves its camera instead
    var self = this, prev = this.state.route.page === 'network' ? this.state.route.focus : null;
    if (prev === id) return;
    var cur = document.querySelector('.bjx-center');
    if (fromEl && fromEl.style) { fromEl.style.viewTransitionName = 'bjx-c'; fromEl.setAttribute('data-vtn', '1'); }
    if (cur && prev) { cur.style.viewTransitionName = 'bjx-p'; cur.setAttribute('data-vtn', '1'); }
    this.setState({ xHover: null, xPathOpen: false, xPathTo: null, xPathQ: '' });
    this.navigate({ page: 'network', focus: id }, '#/network/' + id, null, function () {
      if (!prev) return;
      var el = document.querySelector('.bjx-pill[data-id="' + CSS.escape(prev) + '"]');
      if (el) { el.style.viewTransitionName = 'bjx-p'; el.setAttribute('data-vtn', '1'); }
    });
  };

  // Shortest undirected chain of mentions between two books (BFS).
  P.xPath = function (a, b) {
    if (a === b) return [a];
    var books = this.books, prev = {}, q = [a], seen = {};
    seen[a] = 1;
    while (q.length) {
      var x = q.shift(), bx = books[x], nb = bx.out.concat(bx.in);
      for (var i = 0; i < nb.length; i++) {
        var y = nb[i];
        if (seen[y]) continue;
        seen[y] = 1; prev[y] = x;
        if (y === b) { var path = [b]; while (path[0] !== a) path.unshift(prev[path[0]]); return path; }
        q.push(y);
      }
    }
    return null;
  };

  P.xCountTxt = function (id) {
    var x = this.books[id], n = x.in.length + x.out.length - 1;
    return n > 0 ? '+' + n : '';
  };

  // ---- the fan ---------------------------------------------------------------------------
  P.explorerFan = function (b, W, availH) {
    var self = this, books = this.books, st = this.state;
    var FONT = "12px 'IBM Plex Mono', monospace";
    var narrow = W < 560;
    var extra = function (it) {
      if (it.more) return 0;
      var c = self.xCountTxt(it.id);
      return 24 + (c ? self._measure(c, SMALL) + 8 : 0);
    };
    var cap = st.xAll === b.id ? 80 : Math.max(5, Math.min(16, Math.floor((availH - 90) / 38)));
    var lay = this.fanLayout(b, W, {
      cap: cap, font: FONT, cfont: "italic 22px 'Instrument Serif', serif", ph: 30, row: 38, ch: 42, extra: extra,
      gap: function (w) { return Math.max(120, Math.min(w * 0.17, 240)); }
    });
    if (lay.empty) return h('div', { className: 'bjx-empty' }, 'No connections logged for ' + b.title + ' yet.');
    var PH = lay.PH, hot = st.xHover;
    var arrow = function (id, col) {
      return h('marker', { key: id, id: id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6.5, markerHeight: 6.5, orient: 'auto-start-reverse' },
        h('path', { d: 'M0 1 L9 5 L0 9 z', fill: col }));
    };
    var svgKids = [h('defs', { key: 'd' }, arrow('bjxA-out', '#9c3d22'), arrow('bjxA-in', '#2f5590'), arrow('bjxA-both', '#141414'))];
    var pills = [];
    lay.items.forEach(function (n) {
      var it = n.it, k = it.k || 'more', id = it.id, isHot = id && id === hot;
      // each edge sits in its own group so hover-dimming (group opacity) composes with the draw-in fade
      if (n.d) svgKids.push(h('g', { key: 'e' + n.i, className: 'bjx-eg' + (isHot ? ' is-hot' : '') },
        h('path', { className: 'ng-e ' + k + (isHot ? ' is-hot' : ''), d: n.d, pathLength: 1, style: { '--i': n.i },
          markerEnd: 'url(#bjxA-' + k + ')', markerStart: k === 'both' ? 'url(#bjxA-both)' : null })));
      if (!it.more) svgKids.push(h('circle', { key: 'c' + n.i, className: 'bjx-dot ' + k, cx: n.x, cy: n.y, r: 4.6, style: { '--i': n.i } }));
      // Hovered neighbour: faint stubs hint at where it leads next.
      if (isHot) {
        var onward = Math.min(8, books[id].in.length + books[id].out.length - 1), side = n.anchor === 'start' ? 1 : -1;
        var ox = side > 0 ? n.px + n.tw + 6 : n.px - 6;
        for (var s = 0; s < onward; s++) {
          var a = (s - (onward - 1) / 2) * 0.32;
          svgKids.push(h('line', { key: 'g' + s, className: 'bjx-ghost', x1: ox, y1: n.y, x2: ox + side * 34 * Math.cos(a), y2: n.y + 34 * Math.sin(a) }));
        }
      }
      var go = it.more ? function () { self.setState({ xAll: b.id }); } : function (e) { self.xJump(id, e.currentTarget); };
      var kids = it.more ? [h('span', { key: 't', className: 't' }, n.txt)] : [
        h('span', { key: 'cv', className: 'mcv' }, self.cover(books[id])),
        h('span', { key: 't', className: 't' }, n.txt),
        self.xCountTxt(id) ? h('span', { key: 'n', className: 'n', title: 'one jump further: ' + self.xCountTxt(id).slice(1) + ' more books' }, self.xCountTxt(id)) : null
      ];
      pills.push(h('button', {
        key: (id || 'more') + ':' + n.i, 'data-id': id || '', className: 'bjx-pill k-' + k + (n.anchor === 'end' ? ' left' : '') + (isHot ? ' is-hot' : ''),
        style: { left: n.px, top: n.y - PH / 2, width: n.tw, height: PH, '--i': n.i },
        onClick: go, onMouseEnter: it.more ? null : function () { if (self.state.xHover !== id) self.setState({ xHover: id }); },
        onFocus: it.more ? null : function () { self.setState({ xHover: id }); },
        title: it.more ? 'Show all' : books[id].title + (books[id].author ? ' — ' + books[id].author : '')
      }, kids));
    });
    var c = lay.center;
    pills.push(h('div', { key: 'center', className: 'bjx-center', style: { left: c.x, top: c.y, width: c.w, height: c.h, justifyContent: c.anchor === 'middle' ? 'center' : 'flex-start' } }, c.t));
    if (!narrow) {
      var hy = Math.max(10, lay.cy - (Math.max(lay.L.length, lay.Rt.length) - 1) / 2 * lay.ROW - 30);
      if (lay.L.length) svgKids.push(h('text', { key: 'hl', className: 'ng-head', x: lay.cx - lay.G - 34, y: hy, textAnchor: 'end' }, '← mentioned by ' + b.in.filter(function (x) { return b.out.indexOf(x) === -1; }).length));
      if (lay.Rt.length) svgKids.push(h('text', { key: 'hr', className: 'ng-head', x: lay.cx + lay.G + 34, y: hy }, 'mentions ' + b.out.length + ' →'));
    }
    return h('div', { key: 'fan:' + b.id, className: 'bjx-fan' + (hot ? ' has-hot' : ''), style: { width: W, height: lay.H },
      onMouseLeave: function () { if (self.state.xHover) self.setState({ xHover: null }); } },
      h('svg', { width: W, height: lay.H, viewBox: '0 0 ' + W + ' ' + lay.H }, svgKids), pills);
  };

  // ---- side panel ------------------------------------------------------------------------
  P.explorerPanel = function (b) {
    var self = this, books = this.books, st = this.state, hot = st.xHover && books[st.xHover] ? books[st.xHover] : null;
    var kids = [];
    var yl = this.yearLabel(b.year);
    kids.push(h('div', { key: 'head', className: 'bjx-head' },
      h('div', { className: 'bjx-hcv' }, this.cover(b)),
      h('div', { className: 'bjx-hmeta' },
        h('div', { className: 'eyebrow' }, this._netMode && this._netMode() === 'atlas' ? 'Selected book' : 'In the middle'),
        h('h2', null, b.title),
        h('div', { className: 'by' }, [b.author, yl].filter(Boolean).join('  ·  ')),
        h('div', { className: 'cnt' }, h('i', { className: 'dot out' }), 'mentions ' + b.out.length, h('i', { className: 'dot in' }), 'mentioned by ' + b.in.length))));
    if (b.synopsis) kids.push(h('p', { key: 'syn', className: 'bjx-syn' }, b.synopsis));
    kids.push(h('div', { key: 'act', className: 'bjx-act' },
      h('button', { className: 'pill solid', onClick: function (e) { self.goBook(b.id); } }, 'Open book page'),
      h('button', { className: 'pill', onClick: function () { self.setState({ xPathOpen: !st.xPathOpen, xPathTo: null, xPathQ: '' }); } }, st.xPathOpen ? 'Close path finder' : 'Find a path to…')));

    if (st.xPathOpen) {
      var pk = [];
      pk.push(h('input', { key: 'in', className: 'bjx-input', placeholder: 'Another book…', value: st.xPathQ || '', autoFocus: true,
        onChange: function (e) { self.setState({ xPathQ: e.target.value, xPathTo: null }); } }));
      if (st.xPathQ && !st.xPathTo) {
        pk.push(h('div', { key: 'sg', className: 'sg-pop bjx-sg' }, this.matches(st.xPathQ).filter(function (m) { return m.id !== b.id; }).slice(0, 6).map(function (m) {
          return h('button', { key: m.id, onMouseDown: function (e) { e.preventDefault(); self.setState({ xPathTo: m.id, xPathQ: m.title }); } },
            h('span', { className: 'sg-cv' }, self.cover(m)), h('span', { className: 'sg-t' }, h('span', { className: 't' }, m.title), h('span', { className: 'a' }, m.author || '')));
        })));
      }
      if (st.xPathTo) {
        var path = this.xPath(b.id, st.xPathTo);
        if (!path) pk.push(h('p', { key: 'np', className: 'bjx-note' }, 'No chain of mentions connects these two yet.'));
        else {
          var chain = [];
          path.forEach(function (id, i) {
            if (i) {
              var u = path[i - 1], fwd = books[u].out.indexOf(id) !== -1, back = books[id].out.indexOf(u) !== -1;
              chain.push(h('span', { key: 'a' + i, className: 'bjx-arr ' + (fwd && back ? 'both' : fwd ? 'out' : 'in'), title: fwd && back ? 'mention each other' : fwd ? books[u].title + ' mentions ' + books[id].title : books[id].title + ' mentions ' + books[u].title }, fwd && back ? '⇄' : fwd ? '→' : '←'));
            }
            chain.push(h('button', { key: id, className: 'bjx-chip' + (i === 0 ? ' here' : ''), onClick: function (e) { if (i) self.xJump(id, e.currentTarget); } },
              h('span', { className: 'mcv' }, self.cover(books[id])), books[id].title));
          });
          pk.push(h('div', { key: 'pl', className: 'bjx-path' }, h('div', { className: 'eyebrow' }, (path.length - 1) + (path.length === 2 ? ' jump' : ' jumps')), chain));
        }
      }
      kids.push(h('div', { key: 'pf', className: 'bjx-pf' }, pk));
    }

    // How the hovered neighbour connects (with the mention's own words when we have them).
    if (hot) {
      var out = b.out.indexOf(hot.id) !== -1, inn = b.in.indexOf(hot.id) !== -1;
      var lines = [];
      if (out) lines.push(h('div', { key: 'o', className: 'bjx-rel out' }, h('b', null, b.title), ' mentions ', h('b', null, hot.title)), this.noteEl(b.id, hot.id) ? h('div', { key: 'on' }, this.noteEl(b.id, hot.id)) : null);
      if (inn) lines.push(h('div', { key: 'i', className: 'bjx-rel in' }, h('b', null, hot.title), ' mentions ', h('b', null, b.title)), this.noteEl(hot.id, b.id) ? h('div', { key: 'inn' }, this.noteEl(hot.id, b.id)) : null);
      kids.push(h('div', { key: 'hot', className: 'bjx-hot' }, h('div', { className: 'eyebrow' }, 'How they connect'), lines,
        h('div', { className: 'bjx-note' }, 'Click it to jump · ' + (hot.in.length + hot.out.length) + ' connections of its own')));
    } else {
      kids.push(h('p', { key: 'tip', className: 'bjx-note tip' }, 'Hover a book to see how it connects. Click to jump to it.'));
    }
    return h('aside', { className: 'bjx-side' }, kids);
  };

  // ---- trail -----------------------------------------------------------------------------
  P.explorerTrail = function (curId) {
    var self = this, t = (this._xTrail || []).filter(function (id) { return self.books[id]; });
    if (t.length < 2) return null;
    var kids = [h('span', { key: 'l', className: 'lbl' }, 'Your jumps')];
    t.forEach(function (id, i) {
      if (i) kids.push(h('svg', { key: 'h' + i, className: 'hop', viewBox: '0 0 26 14' }, h('path', { d: 'M2 12 Q13 -2 24 12' })));
      kids.push(h('button', { key: id, className: id === curId ? 'cur' : '', title: self.books[id].title, 'aria-label': self.books[id].title,
        onClick: function (e) { if (id !== curId) self.xJump(id, e.currentTarget); } }, self.cover(self.books[id])));
    });
    kids.push(h('button', { key: 'clr', className: 'clr', onClick: function () { self._xTrail = curId ? [curId] : []; self.forceUpdate(); } }, 'clear'));
    return h('nav', { className: 'trail bjx-trail', 'aria-label': 'Books you jumped through' }, kids);
  };

  // ---- entry -----------------------------------------------------------------------------
  P.explorerEntry = function () {
    var self = this, books = this.books, st = this.state, q = st.xQ || '';
    var sugg = q.trim() ? this.matches(q).slice(0, 7) : [];
    var pick = function (id, el) { self.setState({ xQ: '' }); self.xJump(id, el); };
    var pp = (this._popPool || []).slice(0, 8);
    var regions = (window.BookJumprRegions && window.BookJumprRegions.regions) || [];
    var pool = this._ensureWallPool();
    return h('div', { className: 'bjx-entry' },
      h('div', { className: 'eyebrow' }, 'Network · Explorer'),
      h('h1', null, 'Start from a book, then follow the mentions.'),
      h('p', { className: 'lede' }, (this.state.vw || 1024) < 560
        ? 'Each book opens its neighbourhood: the books that mention it above, the books it mentions below. Tap any of them to jump.'
        : 'Each book opens its neighbourhood: the books it mentions on the right, the books that mention it on the left. Click any of them to jump.'),
      h('div', { className: 'bjx-q' },
        h('input', { className: 'bjx-input big', placeholder: 'Search a book…', value: q, 'aria-label': 'Search a book',
          onChange: function (e) { self.setState({ xQ: e.target.value }); },
          onKeyDown: function (e) { if (e.key === 'Enter' && sugg[0]) pick(sugg[0].id, e.currentTarget); } }),
        sugg.length ? h('div', { className: 'sg-pop bjx-sg' }, sugg.map(function (m) {
          return h('button', { key: m.id, onMouseDown: function (e) { e.preventDefault(); pick(m.id, e.currentTarget); } },
            h('span', { className: 'sg-cv' }, self.cover(m)), h('span', { className: 'sg-t' }, h('span', { className: 't' }, m.title), h('span', { className: 'a' }, m.author || '')),
            h('span', { className: 's' }, self.subFor(m)));
        })) : null),
      h('div', { className: 'bjx-chips' },
        pp.map(function (b) { return h('button', { key: b.id, onClick: function (e) { pick(b.id, e.currentTarget); } }, b.title); }),
        h('button', { key: 'rnd', className: 'rnd', onClick: function (e) { var c = pool[Math.floor(Math.random() * Math.min(300, pool.length))]; if (c) pick(c.id, e.currentTarget); } }, '↯ Surprise me')),
      regions.length ? h('section', { className: 'bjx-regions' },
        h('div', { className: 'sec-h' }, h('h2', null, 'Reading neighbourhoods'), h('span', { className: 'cap' }, 'clusters of books that keep mentioning each other')),
        h('div', { className: 'bjx-rgrid' }, regions.map(function (r, i) {
          var hubs = r.hubKeys.filter(function (k) { return books[k] && self._homeOk(k); });
          if (!hubs.length) return null;
          return h('button', { key: i, className: 'bjx-region', onClick: function (e) { pick(hubs[0], e.currentTarget); } },
            h('div', { className: 'covers' }, hubs.slice(0, 5).map(function (k) { return h('span', { key: k }, self.cover(books[k])); })),
            h('div', { className: 'nm' }, r.name),
            h('div', { className: 'au' }, r.authors.join(' · ')),
            h('div', { className: 'sz' }, r.size + ' books'));
        }))) : null);
  };

  // ---- page ------------------------------------------------------------------------------
  P.explorer = function (focus) {
    var b = focus && this.books[focus];
    if (!b) return this.explorerEntry();
    var vw = this.state.vw || window.innerWidth, vh = window.innerHeight;
    var wide = vw >= 1000, W = wide ? vw - 400 - 64 : vw - 32;
    var availH = vh - 56 - 90;
    return h('div', { className: 'bjx-page' + (wide ? ' wide' : '') },
      h('div', { className: 'bjx-main' },
        h('div', { className: 'bjx-top' },
          h('button', { className: 'bjx-back', onClick: function () { location.hash = '#/network'; } }, '← All starting points'),
          this.explorerTrail(b.id)),
        h('div', { className: 'bjx-stage' }, this.explorerFan(b, Math.max(300, W), availH)),
        h('div', { className: 'bjx-legend' }, h('span', null, h('i', { className: 'ln in' }), 'mentioned by'), h('span', null, h('i', { className: 'ln out' }), 'mentions'), h('span', null, h('i', { className: 'ln both' }), 'mention each other'), h('span', { className: 'cnt' }, '+12 = books one more jump away'))),
      this.explorerPanel(b));
  };

  window.__BJ.explorerReady = true;
})();
