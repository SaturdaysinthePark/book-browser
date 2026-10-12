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
 *
 * Explorer+ (?net=v4) is the same page with a few living layers on top: the fan's lines flow in
 * the mention's direction and the centre has a slow heartbeat; a spark runs along the edge you
 * just hopped; genre chips filter (and label) big fans; the panel opens with a mini star map of
 * the whole network (genre-coloured, your hops drawn across it) that expands to a full-screen
 * view. The star map is atlas.js with its Explorer+ options, over stars-data.js.
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
    var self = this, next = this._vNext(), r = this.state.route;
    var prev = next ? (r.page === 'book' ? r.id : null) : r.page === 'network' ? r.focus : null;
    if (prev === id) return;
    var cur = document.querySelector('.bjx-center');
    if (fromEl && fromEl.style) { fromEl.style.viewTransitionName = 'bjx-c'; fromEl.setAttribute('data-vtn', '1'); }
    if (cur && prev) { cur.style.viewTransitionName = 'bjx-p'; cur.setAttribute('data-vtn', '1'); }
    this.setState({ xHover: null, xPathOpen: false, xPathTo: null, xPathQ: '', xGenre: null });
    this.navigate(next ? { page: 'book', id: id } : { page: 'network', focus: id }, next ? '#/' + id : '#/network/' + id, null, function () {
      if (!prev) return;
      var el = document.querySelector('.bjx-pill[data-id="' + CSS.escape(prev) + '"], .bkp-cv[data-id="' + CSS.escape(prev) + '"]');
      if (el) { el.style.viewTransitionName = 'bjx-p'; el.setAttribute('data-vtn', '1'); }
    });
    if (prev && this._xLive()) setTimeout(function () { self.xSpark(prev); }, 480);
  };

  // Explorer+: a spark runs along the edge between the book you came from and the new centre.
  P.xSpark = function (from) {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var fan = document.querySelector('.bjx-fan, .bkp-shelves'), q = CSS.escape(from);
    var g = fan && fan.querySelector('.bjx-eg[data-id="' + q + '"] .ng-e, .bkp-eg[data-id="' + q + '"] .ng-e');
    if (!g || !g.animate) return;
    // Edges are drawn in the mention's direction; the spark always travels from the old book inward.
    var inward = g.classList.contains('in'), sp = document.createElement('i');
    sp.className = 'bjx-spark ' + (inward ? 'in' : g.classList.contains('out') ? 'out' : 'both');
    sp.style.offsetPath = 'path("' + g.getAttribute('d') + '")';
    fan.appendChild(sp);
    var a = sp.animate([{ offsetDistance: inward ? '0%' : '100%', opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { offsetDistance: inward ? '100%' : '0%', opacity: 0 }],
      { duration: 760, easing: 'cubic-bezier(.45,0,.25,1)' });
    a.onfinish = a.oncancel = function () { sp.remove(); };
  };

  // ---- genre (Explorer+) -----------------------------------------------------------------
  var GENRE_LABEL = { 'FICTION': 'Fiction', 'POETRY & EPICS': 'Poetry & epics', 'DRAMA & PLAYS': 'Drama', 'CRIME & MYSTERY': 'Crime & mystery',
    'SCI-FI': 'Sci-fi', 'FANTASY': 'Fantasy', 'HORROR': 'Horror', 'ADVENTURE & TRAVEL': 'Adventure & travel', 'HISTORY': 'History',
    'BIOGRAPHY & MEMOIR': 'Lives & memoirs', 'PHILOSOPHY': 'Philosophy', 'PSYCHOLOGY': 'Psychology', 'POLITICS & WORLD': 'Politics',
    'BUSINESS & ECONOMICS': 'Business', 'ESSAYS & JOURNALISM': 'Essays', 'HUMOR & COMEDY': 'Humour', 'FOOD & COOKING': 'Food', 'MISC': 'Other' };
  var MISC_DOT = '#b3ad9f';
  P.xGenreKey = function (id) { return this.genreOf(this.books[id]).name; };
  P.xGenreLabel = function (name) { return GENRE_LABEL[name] || name; };
  P.xGenreColor = function (name) { return name === 'MISC' ? MISC_DOT : (this.genreByName(name) || this.GEN3[17]).color; };
  // Genres among a book's neighbours, biggest first (Other last).
  P.xGenres = function (b) {
    var self = this, cnt = {}, seen = {};
    b.out.concat(b.in).forEach(function (id) { if (seen[id] || !self.books[id]) return; seen[id] = 1; var g = self.xGenreKey(id); cnt[g] = (cnt[g] || 0) + 1; });
    return Object.keys(cnt).map(function (g) { return { g: g, n: cnt[g] }; })
      .sort(function (x, y) { return (x.g === 'MISC') - (y.g === 'MISC') || y.n - x.n; });
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
    var self = this, books = this.books, st = this.state, plus = this._xLive();
    if (plus && st.xGenre) {   // genre chip: both sides narrowed before layout (mutual pairs stay mutual)
      var keep = function (id) { return self.xGenreKey(id) === st.xGenre; };
      b = { id: b.id, title: b.title, out: b.out.filter(keep), in: b.in.filter(keep) };
    }
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
      // Explorer+: a second dashed path streams along the line in the mention's direction (mutual stays still)
      if (n.d) svgKids.push(h('g', { key: 'e' + n.i, 'data-id': id, className: 'bjx-eg' + (isHot ? ' is-hot' : '') },
        h('path', { className: 'ng-e ' + k + (isHot ? ' is-hot' : ''), d: n.d, pathLength: 1, style: { '--i': n.i },
          markerEnd: 'url(#bjxA-' + k + ')', markerStart: k === 'both' ? 'url(#bjxA-both)' : null }),
        plus && k !== 'both' ? h('path', { className: 'ng-flow ' + k, d: n.d, style: { '--i': n.i } }) : null));
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
    var next = this._vNext(), openMap = next ? function () { self.xZoomOut(b.id); } : function () { self.xOpenFull(); };
    if (this._xLive()) {
      kids.push(h('div', { key: 'mini', className: 'bjx-mini' },
        h('div', { className: 'bjx-mini-h' }, h('span', { className: 'eyebrow' }, 'Where you are'),
          h('button', { className: 'bjx-mini-open', onClick: openMap }, next ? 'Zoom out ⤢' : 'Full map ↗')),
        h('div', { className: 'bjx-mini-map', ref: this._xMiniRef(), role: 'button', tabIndex: 0, 'aria-label': next ? 'Zoom out to the star map' : 'Open the full star map',
          onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMap(); } } })));
    }
    var hasAu = b.author && b.author !== 'Anonymous', gl = this.genreOf(b).name;
    kids.push(h('div', { key: 'head', className: 'bjx-head' },
      h('div', { className: 'bjx-hcv' }, this.cover(b, next ? 'vt-hero' : null)),
      h('div', { className: 'bjx-hmeta' },
        h('div', { className: 'eyebrow' }, next ? 'Book' + (gl === 'MISC' ? '' : ' · ' + this.xGenreLabel(gl).toLowerCase()) : this._netMode && this._netMode() === 'atlas' ? 'Selected book' : 'In the middle'),
        h(next ? 'h1' : 'h2', null, b.title),
        next && hasAu
          ? h('div', { className: 'by' }, h('button', { className: 'lnk', onClick: function () { self.goAuthor(self.authorSlug(b.author)); } }, b.author), yl ? '  ·  ' + yl : '')
          : h('div', { className: 'by' }, [b.author, yl].filter(Boolean).join('  ·  ')),
        h('div', { className: 'cnt' }, h('i', { className: 'dot out' }), 'mentions ' + b.out.length, h('i', { className: 'dot in' }), 'mentioned by ' + b.in.length))));
    if (b.synopsis) kids.push(h('p', { key: 'syn', className: 'bjx-syn' }, b.synopsis));
    kids.push(h('div', { key: 'act', className: 'bjx-act' },
      next ? h('button', { className: 'pill solid', onClick: function () { self.xZoomOut(b.id); } }, 'Zoom out to the map ⤢')
        : h('button', { className: 'pill solid', onClick: function (e) { self.goBook(b.id); } }, 'Open book page'),
      next ? null : h('button', { className: 'pill', onClick: function () { self.setState({ xPathOpen: !st.xPathOpen, xPathTo: null, xPathQ: '' }); } }, st.xPathOpen ? 'Close path finder' : 'Find a path to…')));

    if (st.xPathOpen && !next) {
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
    var self = this, next = this._vNext(), t = ((next ? this._trail : this._xTrail) || []).filter(function (id) { return self.books[id]; });
    if (t.length < 2) return null;
    var kids = [h('span', { key: 'l', className: 'lbl' }, 'Your jumps')];
    t.forEach(function (id, i) {
      if (i) kids.push(h('svg', { key: 'h' + i, className: 'hop', viewBox: '0 0 26 14' }, h('path', { d: 'M2 12 Q13 -2 24 12' })));
      kids.push(h('button', { key: id, className: id === curId ? 'cur' : '', title: self.books[id].title, 'aria-label': self.books[id].title,
        onClick: function (e) { if (id !== curId) self.xJump(id, e.currentTarget); } }, self.cover(self.books[id])));
    });
    kids.push(h('button', { key: 'clr', className: 'clr', onClick: function () {
      var keep = curId ? [curId] : [];
      if (next) { self._trail = keep; try { sessionStorage.setItem('bj-trail', JSON.stringify(keep)); } catch (e) {} } else self._xTrail = keep;
      self.forceUpdate();
    } }, 'clear'));
    return h('nav', { className: 'trail bjx-trail', 'aria-label': 'Books you jumped through' }, kids);
  };

  // ---- entry -----------------------------------------------------------------------------
  P.explorerEntry = function () {
    var self = this, books = this.books, st = this.state, q = st.xQ || '';
    var sugg = q.trim() ? this.matches(q).slice(0, 7) : [];
    var pick = function (id, el) { self.setState({ xQ: '' }); self.xJump(id, el); };
    var pp = (this._popPool || []).slice(0, 8);
    var regions = (window.BookJumprRegions && window.BookJumprRegions.regions) || [];
    var pool = this._ensureWallPool(), plus = this._xLive();
    return h('div', { className: 'bjx-entry' },
      h('div', { className: 'eyebrow' }, plus ? 'Network · Explorer+' : 'Network · Explorer'),
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
        h('button', { key: 'rnd', className: 'rnd', onClick: function (e) { var c = pool[Math.floor(Math.random() * Math.min(300, pool.length))]; if (c) pick(c.id, e.currentTarget); } }, '↯ Surprise me'),
        plus ? h('button', { key: 'stars', className: 'stars', onClick: function () { self.xOpenFull(); } }, '✦ See every book as a star') : null),
      plus ? this.explorerStarts() : regions.length ? h('section', { className: 'bjx-regions' },
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

  // Explorer+ entry: places to start — the same shelves the themed home wall uses (most
  // name-dropped, great name-droppers, found inside…, genre shelves), each opening on its top book.
  P.explorerStarts = function () {
    var self = this, books = this.books, rows = this._hxRows(0);
    return h('section', { className: 'bjx-regions bjx-starts' },
      h('div', { className: 'sec-h' }, h('h2', null, 'Places to start'), h('span', { className: 'cap' }, 'pick a shelf — you start at its most connected book')),
      h('div', { className: 'bjx-rgrid' }, rows.map(function (r, i) {
        var ids = r.ids.filter(function (k) { return books[k]; });
        if (!ids.length) return null;
        var top = books[ids[0]];
        var g = r.label.indexOf('Found inside') === 0 || r.label.indexOf('Most') === 0 || r.label.indexOf('The great') === 0 ? null : self.genreOf(books[ids[0]]).name;
        return h('button', { key: i, className: 'bjx-region', onClick: function (e) { self.setState({ xQ: '' }); self.xJump(top.id, e.currentTarget); } },
          h('div', { className: 'covers' }, ids.slice(0, 5).map(function (k) { return h('span', { key: k }, self.cover(books[k])); })),
          h('div', { className: 'nm' }, g ? h('i', { className: 'sw', style: { background: self.xGenreColor(g) } }) : null, r.label),
          h('div', { className: 'au' }, 'starts at ' + top.title),
          h('div', { className: 'sz' }, ids.length + (ids.length === 48 ? '+' : '') + ' books'));
      })));
  };

  // ---- star map (Explorer+): mini-map in the panel, full-screen view ------------------------
  P._xStarOpts = function (extra) {
    var self = this, o = {
      data: window.BookJumprStars, regions: false, flow: true, twinkle: true,
      colorOf: function (k) { var g = self.books[k] ? self.xGenreKey(k) : 'MISC'; return g === 'MISC' ? 'rgba(179,173,159,0.6)' : self.xGenreColor(g); },
      title: function (k) { var b = self.books[k]; return b ? b.title : ''; },
      neighbors: function (k) { var b = self.books[k]; return b ? { out: b.out, in: b.in } : { out: [], in: [] }; }
    };
    for (var k in extra) o[k] = extra[k];
    return o;
  };
  P._xMiniRef = function () {
    var self = this;
    return this._xMiniFn || (this._xMiniFn = function (el) {
      if (self._xMini) { self._xMini.destroy(); self._xMini = null; }
      if (!el || !window.BJAtlas || !window.BookJumprStars) return;
      self._xMini = new window.BJAtlas(self._xStarOpts({ root: el, mini: true, onClick: function () { if (self._vNext()) self.xZoomOut(); else self.xOpenFull(); } }));
      var f = self._xCur();
      if (f) self._xMini.setFocus(f, false);
    });
  };
  P.xOpenFull = function () {
    var f = this.state.route.page === 'network' ? this.state.route.focus : null;
    this.setState({ xFull: true, xSel: f || null, xFq: '' });
  };
  P.xCloseFull = function () { this.setState({ xFull: false, xSel: null, xFq: '' }); };
  P.xHopFromFull = function (id) {
    this.setState({ xFull: false, xSel: null, xFq: '' });
    if (id && id !== this.state.route.focus) this.xJump(id, null);
  };
  P._xFullRef = function () {
    var self = this;
    return this._xFullFn || (this._xFullFn = function (el) {
      if (self._xFullMap) { self._xFullMap.destroy(); self._xFullMap = null; window.__xfull = null; }
      if (self._xFullKey) { window.removeEventListener('keydown', self._xFullKey); self._xFullKey = null; }
      if (!el || !window.BJAtlas || !window.BookJumprStars) return;
      var m = self._xFullMap = window.__xfull = new window.BJAtlas(self._xStarOpts({
        root: el,
        onFocus: function (k) { self.setState({ xSel: k }); m.setFocus(k); },
        bottomInset: function () { var c = window.innerWidth < 760 && document.querySelector('.bjx-fcard'); return c ? c.getBoundingClientRect().height + 16 : 0; }
      }));
      el.addEventListener('dblclick', function (e) {
        var r = el.getBoundingClientRect(), i = m.pick(e.clientX - r.left, e.clientY - r.top, 6);
        if (i >= 0) self.xHopFromFull(m.keys[i]);
      });
      self._xFullKey = function (e) {
        if (e.key !== 'Escape') return;
        if (e.target && e.target.tagName === 'INPUT' && self.state.xFq) self.setState({ xFq: '' });
        else self.xCloseFull();
      };
      window.addEventListener('keydown', self._xFullKey);
      var f = self.state.xSel;
      if (f) m.setFocus(f, false);
    });
  };
  // The book in the middle: the book page's book (?v=next) or the network route's focus.
  P._xCur = function () {
    var r = this.state.route;
    return this._vNext() ? (r.page === 'book' ? r.id : r.page === 'network' ? r.focus || null : null) : r.page === 'network' ? r.focus || null : null;
  };
  // Keep the star maps in step with the route / selection (called from componentDidUpdate).
  P._xStarSync = function () {
    var r = this.state.route;
    if (this.state.xFull && r.page !== 'network') this.setState({ xFull: false, xSel: null });
    // a new book (from anywhere: home, search, back button) starts unfiltered
    var bk = r.page === 'book' ? r.id : null;
    if (bk !== this._xLastBook) { this._xLastBook = bk; if (this.state.xGenre || this.state.xHover) this.setState({ xGenre: null, xHover: null }); }
    if (this._bkpEl) this._bkpQueue();
    var f = this._xCur(), mi = this._xMini;
    if (mi) { var cur = mi.focus >= 0 ? mi.keys[mi.focus] : null; if (cur !== f) mi.setFocus(f); }
    var sm = this._stars;
    if (sm && r.page === 'network' && !this._xMorphing) { var sc = sm.focus >= 0 ? sm.keys[sm.focus] : null, want = r.focus || null; if (sc !== want) sm.setFocus(want); }
  };
  P.explorerFull = function () {
    var self = this, st = this.state, books = this.books, sel = st.xSel && books[st.xSel] ? books[st.xSel] : null;
    var q = st.xFq || '', sugg = q.trim() ? this.matches(q).slice(0, 7) : [];
    var find = function (id) { self.setState({ xFq: '', xSel: id }); if (self._xFullMap) self._xFullMap.setFocus(id); };
    var m = function () { return self._xFullMap; };
    // genre legend: the most common genres across the network
    if (!this._xGenTop) {
      var cnt = {};
      (window.BookJumprStars.nodes || []).forEach(function (nd) { if (books[nd[0]]) { var g = self.xGenreKey(nd[0]); cnt[g] = (cnt[g] || 0) + 1; } });
      this._xGenTop = Object.keys(cnt).filter(function (g) { return g !== 'MISC'; }).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 9);
    }
    var card = null;
    if (sel) {
      var yl = this.yearLabel(sel.year);
      card = h('div', { className: 'bjx-fcard' },
        h('div', { className: 'bjx-fcv' }, this.cover(sel)),
        h('div', { className: 'bjx-fmeta' },
          h('div', { className: 'eyebrow' }, sel.id === st.route.focus ? 'You are here' : 'Selected star'),
          h('h3', null, sel.title),
          h('div', { className: 'by' }, [sel.author, yl].filter(Boolean).join('  ·  ')),
          h('div', { className: 'cnt' }, h('i', { className: 'dot out' }), 'mentions ' + sel.out.length, h('i', { className: 'dot in' }), 'mentioned by ' + sel.in.length),
          h('div', { className: 'bjx-act' },
            sel.id === st.route.focus
              ? h('button', { className: 'pill solid', onClick: function () { self.xCloseFull(); } }, 'Back to its fan')
              : h('button', { className: 'pill solid', onClick: function () { self.xHopFromFull(sel.id); } }, 'Hop here →'),
            h('button', { className: 'pill', onClick: function () { self.setState({ xFull: false }); self.goBook(sel.id); } }, 'Book page'))));
    }
    return h('div', { key: 'xfull', className: 'bjx-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Star map of every book' },
      h('div', { className: 'bjx-full-map', ref: this._xFullRef() }),
      h('div', { className: 'bjx-fbar' },
        h('div', { className: 'bjx-ftitle' }, h('span', { className: 'eyebrow' }, 'Every book, as stars'), h('span', { className: 'sub' }, 'coloured by genre')),
        h('div', { className: 'atlas-q' },
          h('input', { className: 'atlas-input', placeholder: 'Find a star…', value: q, 'aria-label': 'Find a book on the star map',
            onChange: function (e) { self.setState({ xFq: e.target.value }); },
            onKeyDown: function (e) { if (e.key === 'Enter' && sugg[0]) find(sugg[0].id); } }),
          sugg.length ? h('div', { className: 'sg-pop atlas-sg' }, sugg.map(function (x) {
            return h('button', { key: x.id, onMouseDown: function (e) { e.preventDefault(); find(x.id); } },
              h('span', { className: 'sg-cv' }, self.cover(x)), h('span', { className: 'sg-t' }, h('span', { className: 't' }, x.title), h('span', { className: 'a' }, x.author || '')));
          })) : null),
        h('div', { className: 'atlas-zoom' },
          h('button', { onClick: function () { if (m()) m().zoomBy(1 / 1.4); }, 'aria-label': 'Zoom out' }, '−'),
          h('button', { onClick: function () { if (m()) m().zoomBy(1.4); }, 'aria-label': 'Zoom in' }, '+'),
          h('button', { className: 'fit', onClick: function () { if (m()) m().fit(true); } }, 'Fit')),
        h('button', { className: 'bjx-fclose', onClick: function () { self.xCloseFull(); }, 'aria-label': 'Close the star map' }, '✕')),
      h('div', { className: 'bjx-flegend' },
        this._xGenTop.map(function (g) { return h('span', { key: g }, h('i', { className: 'sw', style: { background: self.xGenreColor(g) } }), self.xGenreLabel(g)); }),
        h('span', { key: 'o' }, h('i', { className: 'sw', style: { background: MISC_DOT } }), 'Genre unknown'),
        h('span', { key: 'lo' }, h('i', { className: 'ln out' }), 'mentions'),
        h('span', { key: 'li' }, h('i', { className: 'ln in' }), 'mentioned by'),
        h('span', { key: 'h', className: 'hint' }, sel ? 'Double-click a star to hop · Esc to close' : 'Click a star to see its links · Esc to close')),
      card);
  };

  // ---- ?v=next: the book page is the fan --------------------------------------------------
  // Fan in the middle, the panel beside it, and every mention below as compact quote cards
  // (filtered by the same genre chip, hovering a card lights its pill). "Zoom out" morphs the fan
  // into the star map; the map's "Open →" morphs a star's neighbourhood back into its fan.
  P.bookNext = function (b) {
    var self = this, st = this.state, vw = st.vw || window.innerWidth, vh = window.innerHeight;
    if (vw < 760) return this.bookNextPhone(b);
    var wide = vw >= 1000, W = wide ? vw - 400 - 64 : vw - 32;
    var main = h('div', { key: 'main', className: 'bjx-main' },
      h('div', { className: 'bjx-top' }, this.explorerTrail(b.id),
        h('button', { className: 'bkn-zoom', onClick: function () { self.xZoomOut(b.id); } }, 'Zoom out to the map ⤢')),
      h('div', { className: 'bjx-stage' + (st.xArriving ? ' arriving' : '') }, this.explorerFan(b, Math.max(300, W), vh - 56 - 110)),
      h('div', { className: 'bjx-legend' }, h('span', null, h('i', { className: 'ln in' }), 'mentioned by'), h('span', null, h('i', { className: 'ln out' }), 'mentions'), h('span', null, h('i', { className: 'ln both' }), 'mention each other'), h('span', { className: 'cnt' }, '+12 = books one more jump away')),
      this.bookLists(b),
      this.classicLink());
    var panel = h(React.Fragment, { key: 'panel' }, this.explorerPanel(b));
    // narrower screens: the book (panel) comes first, so it anchors the page
    return h('div', { className: 'bjx-page bjx-plus bkn-page' + (wide ? ' wide' : ' stacked') }, wide ? [main, panel] : [panel, main]);
  };
  P.classicLink = function () {
    return h('p', { key: 'classic', className: 'bkn-classic' }, h('a', { href: location.pathname + location.hash, onClick: function (e) { e.preventDefault(); location.href = location.pathname + location.hash; } }, 'Switch to the classic view'));
  };

  // Phone: a slim book header with a map thumbnail, the fan as two shelves of covers (swipe
  // sideways) with lines flowing into the book, a sheet for the tapped cover, then tabs.
  P.bookNextPhone = function (b) {
    var self = this, st = this.state, yl = this.yearLabel(b.year), gl = this.genreOf(b).name, hot = st.xHover && this.books[st.xHover] && (b.out.indexOf(st.xHover) !== -1 || b.in.indexOf(st.xHover) !== -1) ? this.books[st.xHover] : null;
    var hasAu = b.author && b.author !== 'Anonymous', synOpen = st.bkSyn === b.id;
    var kids = [];
    kids.push(h('div', { key: 'head', className: 'bkp-head' },
      h('div', { className: 'bkp-cv0' }, this.cover(b, 'vt-hero')),
      h('div', { className: 'bkp-meta' },
        h('div', { className: 'eyebrow' }, 'Book' + (gl === 'MISC' ? '' : ' · ' + this.xGenreLabel(gl).toLowerCase())),
        h('h1', null, b.title),
        h('div', { className: 'by' }, hasAu ? h('button', { className: 'lnk', onClick: function () { self.goAuthor(self.authorSlug(b.author)); } }, b.author) : (b.author || ''), yl ? (b.author ? '  ·  ' : '') + yl : ''),
        h('div', { className: 'cnt' }, h('i', { className: 'dot out' }), b.out.length, h('i', { className: 'dot in' }), b.in.length)),
      h('div', { className: 'bkp-map', role: 'button', tabIndex: 0, 'aria-label': 'Zoom out to the star map', onKeyDown: function (e) { if (e.key === 'Enter') self.xZoomOut(b.id); } },
        h('div', { className: 'bkp-map-c', ref: this._xMiniRef() }),
        h('span', { className: 'bkp-map-l' }, 'Zoom out ⤢'))));
    if (b.synopsis) kids.push(h('p', { key: 'syn', className: 'bkp-syn' + (synOpen ? ' open' : ''), onClick: function () { self.setState({ bkSyn: synOpen ? null : b.id }); } }, b.synopsis));
    kids.push(this.coverShelves(b));
    if (hot) {
      var isOut = b.out.indexOf(hot.id) !== -1, isIn = b.in.indexOf(hot.id) !== -1, hy = this.yearLabel(hot.year);
      kids.push(h('div', { key: 'sheet', className: 'bkp-sheet' },
        h('div', { className: 'bkp-sheet-h' },
          h('div', { className: 'bkp-sheet-t' }, h('div', { className: 'eyebrow ' + (isOut && isIn ? '' : isOut ? 'out' : 'in') }, isOut && isIn ? 'They mention each other' : isOut ? b.title + ' mentions' : 'Mentions ' + b.title),
            h('div', { className: 't' }, hot.title), h('div', { className: 'a' }, [hot.author, hy].filter(Boolean).join('  ·  '))),
          h('button', { className: 'pill solid', onClick: function () { self.xJump(hot.id, document.querySelector('.bkp-cv[data-id="' + CSS.escape(hot.id) + '"]')); } }, 'Jump →')),
        isOut ? this.noteEl(b.id, hot.id) : this.noteEl(hot.id, b.id)));
    } else kids.push(h('p', { key: 'tip', className: 'bkp-tip' }, 'Tap a cover to see how it connects · swipe the shelves for more'));
    kids.push(this.bookLists(b));
    kids.push(this.classicLink());
    return h('div', { className: 'bjx-page bjx-plus bkp-page' }, kids);
  };

  P.coverShelves = function (b) {
    var self = this, st = this.state, books = this.books, CAP = 30;
    var deg = function (id) { return books[id].in.length + books[id].out.length; };
    var top = b.in.filter(function (id) { return books[id] && b.out.indexOf(id) === -1; }).sort(function (x, y) { return deg(y) - deg(x); });
    var bot = b.out.filter(function (id) { return books[id]; }).sort(function (x, y) { return (b.in.indexOf(y) !== -1) - (b.in.indexOf(x) !== -1) || deg(y) - deg(x); });
    var row = function (ids, side) {
      var items = ids.slice(0, CAP).map(function (id, i) {
        var k = side === 'in' ? 'in' : b.in.indexOf(id) !== -1 ? 'both' : 'out';
        return h('button', { key: id, className: 'bkp-cv k-' + k + (st.xHover === id ? ' is-hot' : ''), 'data-id': id, 'data-k': k, style: { '--i': i },
          'aria-label': books[id].title, title: books[id].title,
          onClick: function (e) { if (self.state.xHover === id) self.xJump(id, e.currentTarget); else self.setState({ xHover: id }); } },
          self.cover(books[id]), k === 'both' ? h('span', { className: 'mut' }, '⇄') : null);
      });
      if (ids.length > CAP) items.push(h('button', { key: 'more', className: 'bkp-more', onClick: function () {
        self.setState({ bkTab: { id: b.id, side: side === 'in' ? 'in' : 'out' } });
        setTimeout(function () { var el = document.querySelector('.bkn-tabs'); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' }); }, 30);
      } }, '+' + (ids.length - CAP), h('br'), 'in the list ↓'));
      if (!ids.length) items.push(h('span', { key: 'none', className: 'bkp-none' }, side === 'in' ? 'No book mentions it yet' : 'It doesn’t mention any books yet'));
      return h('div', { key: 'r' + side, className: 'bkp-row ' + side, onScroll: function () { self._bkpQueue(); } }, items);
    };
    return h('div', { key: 'shelves:' + b.id, className: 'bkp-shelves' + (st.xArriving ? ' arriving' : '') + (st.xHover ? ' has-hot' : ''), ref: this._bkpRef() },
      h('svg', { className: 'bkp-lines', 'aria-hidden': true }),
      h('div', { className: 'bkp-lab in' }, h('i', { className: 'dot in' }), 'Mentioned by ' + top.length),
      row(top, 'in'),
      h('div', { className: 'bkp-mid' }, h('div', { className: 'bjx-center' }, b.title)),
      row(bot, 'out'),
      h('div', { className: 'bkp-lab out' }, h('i', { className: 'dot out' }), 'Mentions ' + b.out.length));
  };
  // The shelves' lines are drawn imperatively (they follow the covers as the rows scroll).
  P._bkpRef = function () {
    var self = this;
    return this._bkpFn || (this._bkpFn = function (el) {
      self._bkpEl = el; self._bkpPaths = null;
      if (el) { self._bkpDraw(); if (!self._bkpRs) { self._bkpRs = function () { self._bkpQueue(); }; window.addEventListener('resize', self._bkpRs); } }
    });
  };
  P._bkpQueue = function () {
    var self = this;
    if (this._bkpRaf) return;
    this._bkpRaf = requestAnimationFrame(function () { self._bkpRaf = 0; self._bkpDraw(); });
  };
  P._bkpDraw = function () {
    var el = this._bkpEl;
    if (!el || !el.isConnected) return;
    var svg = el.querySelector('svg.bkp-lines'), cen = el.querySelector('.bjx-center');
    if (!svg || !cen) return;
    var R = el.getBoundingClientRect(), W = R.width, H = R.height, NS = 'http://www.w3.org/2000/svg';
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var bookId = this._xCur();
    if (!this._bkpPaths || this._bkpFor !== bookId || !svg.firstChild) {
      var mk = function (id, col) { return '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="' + col + '"/></marker>'; };
      svg.innerHTML = '<defs>' + mk('bkpA-in', '#2f5590') + mk('bkpA-out', '#9c3d22') + mk('bkpA-both', '#141414') + '</defs>';
      this._bkpPaths = {}; this._bkpFor = bookId;
    }
    var c = cen.getBoundingClientRect(), cx = c.left - R.left + c.width / 2, ctop = c.top - R.top, cbot = c.bottom - R.top;
    var paths = this._bkpPaths, hot = this.state.xHover, n = 0;
    [].forEach.call(el.querySelectorAll('.bkp-cv[data-id]'), function (cv) {
      var id = cv.getAttribute('data-id'), k = cv.getAttribute('data-k'), r = cv.getBoundingClientRect();
      var x = r.left - R.left + r.width / 2, vis = x > -6 && x < W + 6;
      var g = paths[id];
      if (!g) {
        g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'bkp-eg'); g.setAttribute('data-id', id);
        var e = document.createElementNS(NS, 'path'); e.setAttribute('class', 'ng-e ' + k); e.setAttribute('pathLength', '1'); e.style.setProperty('--i', n);
        e.setAttribute('marker-end', 'url(#bkpA-' + k + ')'); if (k === 'both') e.setAttribute('marker-start', 'url(#bkpA-both)');
        g.appendChild(e);
        if (k !== 'both') { var f = document.createElementNS(NS, 'path'); f.setAttribute('class', 'ng-flow ' + k); f.style.setProperty('--i', n); g.appendChild(f); }
        svg.appendChild(g); paths[id] = g;
      }
      n++;
      g.style.display = vis ? '' : 'none';
      if (!vis) return;
      var ex = cx + Math.max(-40, Math.min(40, (x - cx) * 0.14)), d;
      if (k === 'in') { var y0 = r.bottom - R.top + 3; d = 'M' + x.toFixed(1) + ' ' + y0.toFixed(1) + ' C' + x.toFixed(1) + ' ' + (y0 + 44).toFixed(1) + ' ' + ex.toFixed(1) + ' ' + (ctop - 46).toFixed(1) + ' ' + ex.toFixed(1) + ' ' + (ctop - 3).toFixed(1); }
      else { var y1 = r.top - R.top - 3; d = 'M' + ex.toFixed(1) + ' ' + (cbot + 3).toFixed(1) + ' C' + ex.toFixed(1) + ' ' + (cbot + 40).toFixed(1) + ' ' + x.toFixed(1) + ' ' + (y1 - 40).toFixed(1) + ' ' + x.toFixed(1) + ' ' + y1.toFixed(1); }
      for (var q = 0; q < g.childNodes.length; q++) g.childNodes[q].setAttribute('d', d);
      g.setAttribute('class', 'bkp-eg' + (id === hot ? ' is-hot' : ''));
    });
  };

  P.bookLists = function (b) {
    var self = this, st = this.state, books = this.books, vw = st.vw || window.innerWidth, tabs = vw < 1000, CAP = tabs ? 20 : 12;
    var keep = function (id) { return !!books[id]; };
    var byDeg = function (x, y) { return (books[y].in.length + books[y].out.length) - (books[x].in.length + books[x].out.length); };
    var col = function (side) {
      var out = side === 'out', ids = (out ? b.out : b.in).filter(keep).sort(byDeg);
      var all = (out ? st.allOut : st.allIn) === b.id, shown = all ? ids : ids.slice(0, CAP);
      var cards = shown.map(function (id) {
        var bk = books[id], yl = self.yearLabel(bk.year), hot = st.xHover === id;
        var mutual = out ? b.in.indexOf(id) !== -1 : b.out.indexOf(id) !== -1;
        return h('article', { key: id, className: 'bkn-card' + (hot ? ' is-hot' : ''),
          onMouseEnter: tabs ? null : function () { if (self.state.xHover !== id) self.setState({ xHover: id }); },
          onMouseLeave: tabs ? null : function () { if (self.state.xHover === id) self.setState({ xHover: null }); } },
          h('button', { className: 'bkn-cv', 'aria-label': bk.title, onClick: function (e) { self.xJump(id, e.currentTarget); } }, self.cover(bk)),
          h('div', { className: 'bkn-body' },
            h('button', { className: 'bkn-t', onFocus: tabs ? null : function () { self.setState({ xHover: id }); },
              onClick: function (e) { self.xJump(id, e.currentTarget.closest('.bkn-card').querySelector('.bkn-cv')); } }, bk.title),
            h('div', { className: 'bkn-a' }, (bk.author || 'author unknown') + (yl ? '  ·  ' + yl : ''), mutual ? h('span', { className: 'mut', title: 'they mention each other' }, ' ⇄') : null),
            out ? self.noteEl(b.id, id) : self.noteEl(id, b.id)));
      });
      return h('section', { key: side, className: 'bkn-col ' + side },
        tabs ? h('div', { className: 'bkn-cap' }, out ? 'Books found inside ' + b.title : 'Books that reference ' + b.title)
          : h('div', { className: 'bkn-h' },
            h('h2', null, out ? 'Mentions' : 'Mentioned by'),
            h('span', { className: 'count ' + side }, ids.length),
            h('span', { className: 'cap' }, (out ? 'found inside ' : 'that reference ') + b.title)),
        cards.length ? h('div', { className: 'bkn-cards' }, cards)
          : h('p', { className: 'bjx-note' }, out ? 'Nothing logged inside this one yet.' : 'No book has name-dropped it yet.'),
        ids.length > shown.length ? h('button', { className: 'pill more', onClick: function () { self.setState(out ? { allOut: b.id } : { allIn: b.id }); } }, 'Show all ' + ids.length) : null);
    };
    if (!tabs) return h('div', { key: 'lists', className: 'bkn-lists' }, col('out'), col('in'));
    var side = st.bkTab && st.bkTab.id === b.id ? st.bkTab.side : b.in.length > b.out.length ? 'in' : 'out';
    var tab = function (sd, label, n) {
      return h('button', { key: sd, role: 'tab', 'aria-selected': side === sd ? 'true' : 'false', className: 'bkn-tab ' + sd + (side === sd ? ' on' : ''),
        onClick: function () { self.setState({ bkTab: { id: b.id, side: sd } }); } }, label, h('span', { className: 'n' }, n));
    };
    return h('div', { key: 'lists', className: 'bkn-lists tabbed' },
      h('div', { className: 'bkn-tabs', role: 'tablist' }, tab('out', 'Mentions', b.out.length), tab('in', 'Mentioned by', b.in.length)),
      col(side));
  };

  // ---- ?v=next: the network page is the star map ---------------------------------------------
  // One BJAtlas per layout: the genre continents (stars-data.js) or, in ?v=lab, a point layout from
  // layouts-data.js (spiral / petals / blend / fame). Switching layouts re-mounts the map.
  P._starsRef = function (lk) {
    var self = this, key = lk || 'stars';
    this._starsFns = this._starsFns || {};
    return this._starsFns[key] || (this._starsFns[key] = function (el) {
      if (self._stars) { self._stars.destroy(); self._stars = null; window.__stars = null; }
      if (!el || !window.BJAtlas || !window.BookJumprStars) return;
      var data = lk ? self._layoutData(lk) : window.BookJumprStars;
      if (!data) return;
      var m = self._stars = window.__stars = new window.BJAtlas(self._xStarOpts({
        root: el, data: data,
        regions: !lk || lk === 'petals' || lk === 'wrap' || lk === 'blend' || lk === 'fame', regionCircles: false, regionTint: lk !== 'petals', bundle: lk === 'fame',
        wrapX: data.guides && data.guides.torus ? data.guides.torus.P : 0,
        wrapY: data.guides && data.guides.torus ? data.guides.torus.PY : 0,
        regionZoom: lk !== 'wrap',
        dust: lk === 'wrap', gravity: lk === 'wrap',
        regionColor: function (R) { return self.xGenreColor(R.genre); },
        guides: data.guides && (data.guides.rings || data.guides.axes) ? data.guides : null,
        labelTop: lk ? (window.innerWidth < 760 ? 10 : 25) : 0,
        onFocus: function (k) { self.mapFocus(k); },
        topInset: function () {   // keep the framing clear of the search bar / switcher
          var bottom = 0, top = el.getBoundingClientRect().top;
          [].forEach.call(document.querySelectorAll('.bjx-stars .bjx-fbar, .lab-switch'), function (x) { bottom = Math.max(bottom, x.getBoundingClientRect().bottom - top); });
          return bottom ? bottom + 14 : 0;
        },
        bottomInset: function () { var c = window.innerWidth < 760 && document.querySelector('.bjx-fcard'); return c ? c.getBoundingClientRect().height + 16 : 0; }
      }));
      el.addEventListener('dblclick', function (e) {
        var r = el.getBoundingClientRect(), i = m.pick(e.clientX - r.left, e.clientY - r.top, 6);
        if (i >= 0) self.xOpenBook(m.keys[i]);
      });
      var f = self.state.route.focus;
      if (f) m.setFocus(f, false);
    });
  };
  // ?v=lab: a point layout expanded into BJAtlas's data shape (cached)
  P._layoutData = function (lk) {
    var D = window.BookJumprLayouts, L = D && D.layouts[lk];
    if (!L) return null;
    this._layoutCache = this._layoutCache || {};
    if (this._layoutCache[lk]) return this._layoutCache[lk];
    var nodes = D.keys.map(function (k, i) { return [k, L.xy[2 * i], L.xy[2 * i + 1], L.reg[i], D.deg[i]]; });
    return (this._layoutCache[lk] = { nodes: nodes, regions: L.regions, guides: L.guides });
  };
  var LAB_VIEWS = [['wrap', 'Wrap'], ['spiral', 'Spiral'], ['petals', 'Petals'], ['blend', 'Blend'], ['fame', 'Fame'], ['stars', 'Stars']];
  P._labView = function () {
    var v = this.state.xView;
    if (!v) { try { v = sessionStorage.getItem('bj-lab'); } catch (e) {} }
    return LAB_VIEWS.some(function (x) { return x[0] === v; }) ? v : 'wrap';
  };
  P.labSetView = function (v) {
    try { sessionStorage.setItem('bj-lab', v); } catch (e) {}
    this.setState({ xView: v });
  };
  P.labMap = function (focus) {
    var self = this, view = this._labView();
    var switcher = h('div', { key: 'sw', className: 'lab-switch', role: 'tablist' }, LAB_VIEWS.map(function (v) {
      return h('button', { key: v[0], role: 'tab', 'aria-selected': view === v[0] ? 'true' : 'false', className: view === v[0] ? 'on' : '', onClick: function () { self.labSetView(v[0]); } }, v[1]);
    }));
    return this.starMap(focus, view === 'stars' ? null : view, switcher);
  };

  // The selected book's card on a map view (stars, and the lab views): cover, counts, Open, Clear.
  P.mapCard = function (sel, o) {
    var self = this, yl = this.yearLabel(sel.year), g = this.xGenreLabel(this.xGenreKey(sel.id));
    o = o || {};
    return h('div', { className: 'bjx-fcard' },
      h('div', { className: 'bjx-fcv' }, this.cover(sel)),
      h('div', { className: 'bjx-fmeta' },
        h('div', { className: 'eyebrow' }, o.eyebrow || (g === 'Unsorted' || g === 'Other' ? 'Selected' : g)),
        h('h3', null, sel.title),
        h('div', { className: 'by' }, [sel.author, yl].filter(Boolean).join('  ·  ')),
        h('div', { className: 'cnt' }, h('i', { className: 'dot out' }), 'mentions ' + sel.out.length, h('i', { className: 'dot in' }), 'mentioned by ' + sel.in.length),
        h('div', { className: 'bjx-act' },
          h('button', { className: 'pill solid', onClick: function () { if (o.open) o.open(sel.id); else self.xOpenBook(sel.id); } }, 'Open →'),
          h('button', { className: 'pill', onClick: function () { self.mapFocus(null); } }, 'Clear'))));
  };
  // "Find a book…" for the map views; picking one selects it (mapFocus).
  P.mapSearch = function () {
    var self = this, q = this.state.xFq || '', sugg = q.trim() ? this.matches(q).slice(0, 7) : [];
    var find = function (id) { self.setState({ xFq: '' }); self.mapFocus(id); };
    return h('div', { className: 'atlas-q' },
      h('input', { className: 'atlas-input', placeholder: 'Find a book…', value: q, 'aria-label': 'Find a book on the map',
        onChange: function (e) { self.setState({ xFq: e.target.value }); },
        onKeyDown: function (e) { if (e.key === 'Enter' && sugg[0]) find(sugg[0].id); if (e.key === 'Escape') self.setState({ xFq: '' }); } }),
      sugg.length ? h('div', { className: 'sg-pop atlas-sg' }, sugg.map(function (x) {
        return h('button', { key: x.id, onMouseDown: function (e) { e.preventDefault(); find(x.id); } },
          h('span', { className: 'sg-cv' }, self.cover(x)), h('span', { className: 'sg-t' }, h('span', { className: 't' }, x.title), h('span', { className: 'a' }, x.author || '')));
      })) : null);
  };
  P.starMap = function (focus, lk, extra) {
    var self = this, books = this.books, sel = focus && books[focus] ? books[focus] : null;
    var m = function () { return self._stars; };
    var card = sel ? this.mapCard(sel) : null;
    return h('div', { className: 'bjx-full bjx-stars' },
      h('div', { key: 'map:' + (lk || 'stars'), className: 'bjx-full-map', ref: this._starsRef(lk) }),
      h('div', { className: 'bjx-fbar' },
        this.mapSearch(),
        h('div', { className: 'atlas-zoom' },
          h('button', { onClick: function () { if (m()) m().zoomBy(1 / 1.4); }, 'aria-label': 'Zoom out' }, '−'),
          h('button', { onClick: function () { if (m()) m().zoomBy(1.4); }, 'aria-label': 'Zoom in' }, '+'),
          h('button', { className: 'fit', onClick: function () { if (m()) m().fit(true); } }, 'Fit'))),
      h('div', { className: 'bjx-fkey' }, sel
        ? [h('span', { key: 'lo' }, h('i', { className: 'ln out' }), 'mentions'), h('span', { key: 'li' }, h('i', { className: 'ln in' }), 'mentioned by'),
          h('span', { key: 'u' }, h('i', { className: 'sw', style: { background: MISC_DOT } }), 'genre unknown'), h('span', { key: 'h', className: 'hint' }, 'Esc to clear')]
        : h('span', { className: 'hint' }, lk === 'wrap' ? 'Scroll or drag to travel — it never ends · pinch or +/− to zoom · point to look closer · click a star' : 'Scroll or pinch to zoom · click a star')),
      card, extra || null);
  };

  // ---- morphs between the fan and the star map ---------------------------------------------
  var EASE = 'cubic-bezier(.22,.8,.24,1)';
  var box = function (r) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }; };
  var reducedMotion = function () { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  P._xMorphLayer = function () { var L = document.createElement('div'); L.className = 'bjx-morph'; document.body.appendChild(L); return L; };
  // Where the fan's pills sit on screen (layout boxes: ignores their entrance transform).
  P._xPillSnap = function () {
    var self = this, out = [], shelves = document.querySelector('.bkp-shelves');
    if (shelves) {   // phone: the centre pill and every cover that's on screen
      var sr = shelves.getBoundingClientRect(), cc = shelves.querySelector('.bjx-center');
      if (cc) out.push({ id: this._xCur(), r: cc.getBoundingClientRect(), center: true, t: cc.textContent });
      [].forEach.call(shelves.querySelectorAll('.bkp-cv[data-id]'), function (el) {
        var r = el.getBoundingClientRect(), id = el.getAttribute('data-id');
        if (!self.books[id] || r.right < sr.left || r.left > sr.right || r.bottom < 0 || r.top > window.innerHeight) return;
        out.push({ id: id, r: { left: r.left, top: r.top, width: r.width, height: r.height }, cover: true, t: '' });
      });
      return out;
    }
    var fan = document.querySelector('.bjx-fan');
    if (!fan) return out;
    var fr = fan.getBoundingClientRect();
    var at = function (el) { return { left: fr.left + el.offsetLeft, top: fr.top + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }; };
    var c = fan.querySelector('.bjx-center');
    if (c) out.push({ id: this._xCur(), r: at(c), center: true, t: c.textContent });
    [].forEach.call(fan.querySelectorAll('.bjx-pill[data-id]'), function (el) {
      var id = el.getAttribute('data-id');
      if (!id || !self.books[id]) return;
      var r = at(el);
      if (r.top + r.height < 0 || r.top > window.innerHeight) return;
      var t = el.querySelector('.t');
      out.push({ id: id, r: r, t: t ? t.textContent : '' });
    });
    return out;
  };
  // A star's dot on screen, or null when it's off the visible map.
  P._xStarPt = function (m, id) {
    var i = m.idx[id];
    if (i == null) return null;
    var cr = m.canvas.getBoundingClientRect(), x = cr.left + m.sx(m._x ? m._x(i) : m.wx[i]), y = cr.top + m.sy(m._y ? m._y(i) : m.wy[i]), rad = Math.max(3, m._r(i));
    if (x < cr.left - 10 || x > cr.right + 10 || y < cr.top - 10 || y > cr.bottom + 10) return null;
    return { left: x - rad, top: y - rad, width: rad * 2, height: rad * 2 };
  };
  P._xChip = function (L, it) {
    var e = document.createElement('i');
    e.className = 'bjx-mchip' + (it.center ? ' c' : '') + (it.cover ? ' cvr' : '');
    e.textContent = it.t || '';
    L.appendChild(e);
    return e;
  };
  P._xSwapRoute = function (route, hash) {
    var self = this;
    this._pushTrail(route);
    window.ReactDOM.flushSync(function () { self.setState({ route: route, q: '', suggestFor: null, xHover: null, xPathOpen: false, xPathTo: null, xPathQ: '' }); });
    this._silent = true;
    location.hash = hash;
    setTimeout(function () { self._silent = false; }, 0);
    window.scrollTo(0, 0);
  };

  // Book → map: each pill flies to its star and shrinks into the dot while the map fades in around it.
  P.xZoomOut = function (id) {
    id = id || this._xCur();
    if (!id || !this.books[id]) return;
    var self = this, route = { page: 'network', focus: id }, hash = '#/network/' + id;
    if (reducedMotion() || document.hidden || !window.ReactDOM || !document.querySelector('.bjx-fan, .bkp-shelves') || this._xMorphing) { this.navigate(route, hash); return; }
    var items = this._xPillSnap(), L = this._xMorphLayer();
    var chips = items.map(function (it) { var c = self._xChip(L, it); Object.assign(c.style, box(it.r)); return c; });
    this._xMorphing = true;
    this._xSwapRoute(route, hash);
    var m = this._stars;
    if (!m) { L.remove(); this._xMorphing = false; return; }
    if (m.focus < 0 || m.keys[m.focus] !== id) m.setFocus(id, false);
    m.canvas.animate([{ opacity: 0, transform: 'scale(1.035)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: 160, easing: EASE, fill: 'backwards' });
    var chrome = document.querySelectorAll('.bjx-stars .bjx-fbar, .bjx-stars .bjx-flegend, .bjx-stars .bjx-fcard');
    [].forEach.call(chrome, function (el) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 480, fill: 'backwards' }); });
    var D = 620;
    items.forEach(function (it, j) {
      var to = self._xStarPt(m, it.id), c = chips[j], col = self.xGenreColor(self.xGenreKey(it.id));
      if (!to) { c.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.7)' }], { duration: 280, fill: 'forwards' }); return; }
      c.animate([
        Object.assign({ borderRadius: it.cover ? '3px' : '999px', color: it.center ? 'rgba(247,245,240,1)' : 'rgba(20,20,20,1)', backgroundColor: it.center ? '#141414' : it.cover ? col : '#fdfcfa', borderWidth: '1.4px' }, box(it.r)),
        { color: 'rgba(20,20,20,0)', offset: 0.3 },
        Object.assign({ borderRadius: '50%', color: 'rgba(20,20,20,0)', backgroundColor: col, borderWidth: '1px' }, box(to))
      ], { duration: D, delay: Math.min(j, 24) * 10, easing: EASE, fill: 'forwards' });
    });
    setTimeout(function () {
      self._xMorphing = false;
      m.t0 = performance.now(); m._animateIn();
      L.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).onfinish = function () { L.remove(); };
    }, D + 240);
  };

  // Map → book: the star and its neighbours fly into the new fan's pills; the map fades away.
  P.xOpenBook = function (id) {
    if (!id || !this.books[id]) return;
    var self = this, m = this._stars, route = { page: 'book', id: id }, hash = '#/' + id;
    if (reducedMotion() || document.hidden || !m || !window.ReactDOM || this._xMorphing) { this.goBook(id); return; }
    var b = this.books[id], pts = {};
    [id].concat(b.out, b.in).forEach(function (k) { if (!pts[k]) { var p = self._xStarPt(m, k); if (p) pts[k] = p; } });
    var L = this._xMorphLayer(), cr = m.canvas.getBoundingClientRect(), snap = document.createElement('canvas');
    snap.width = m.canvas.width; snap.height = m.canvas.height;
    snap.getContext('2d').drawImage(m.canvas, 0, 0);
    snap.className = 'bjx-msnap';
    Object.assign(snap.style, box(cr));
    L.appendChild(snap);
    this._xMorphing = true;
    this._pushTrail(route);
    window.ReactDOM.flushSync(function () { self.setState({ route: route, xArriving: true, xGenre: null, q: '', suggestFor: null, xHover: null, xPathOpen: false, xFq: '' }); });
    this._silent = true; location.hash = hash; setTimeout(function () { self._silent = false; }, 0);
    window.scrollTo(0, 0);
    var items = this._xPillSnap(), D = 640;
    snap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 120, easing: 'ease-out', fill: 'forwards' });
    items.forEach(function (it, j) {
      var c = self._xChip(L, it), from = pts[it.id], col = self.xGenreColor(self.xGenreKey(it.id));
      Object.assign(c.style, box(it.r));
      var end = Object.assign({ borderRadius: it.cover ? '3px' : '999px', color: it.center ? 'rgba(247,245,240,1)' : 'rgba(20,20,20,1)', backgroundColor: it.center ? '#141414' : it.cover ? col : '#fdfcfa', borderWidth: '1.4px' }, box(it.r));
      if (!from) { c.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 280, easing: EASE, fill: 'both' }); return; }
      c.animate([
        Object.assign({ borderRadius: '50%', color: 'rgba(20,20,20,0)', backgroundColor: col, borderWidth: '1px' }, box(from)),
        { color: 'rgba(20,20,20,0)', offset: 0.7 },
        end
      ], { duration: D, delay: Math.min(j, 24) * 10, easing: EASE, fill: 'both' });
    });
    setTimeout(function () {
      self._xMorphing = false;
      self.setState({ xArriving: false });
      L.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = function () { L.remove(); };
    }, D + 260);
  };

  // ---- page ------------------------------------------------------------------------------
  // Explorer+: genre chips over the fan — a legend of what's here, and a filter for big fans.
  P.explorerGenres = function (b) {
    var self = this, st = this.state, gs = this.xGenres(b);
    if (gs.length < 2) return null;
    var chip = function (g, label, n, on) {
      return h('button', { key: g || 'all', className: 'bjx-gchip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onClick: function () { self.setState({ xGenre: g, xAll: null, xHover: null }); } },
        g ? h('i', { className: 'sw', style: { background: self.xGenreColor(g) } }) : null, label, n != null ? h('span', { className: 'n' }, n) : null);
    };
    var kids = [chip(null, 'All', b.out.length + b.in.filter(function (x) { return b.out.indexOf(x) === -1; }).length, !st.xGenre)];
    gs.slice(0, 7).forEach(function (x) { kids.push(chip(x.g, self.xGenreLabel(x.g), x.n, st.xGenre === x.g)); });
    if (st.xGenre && !gs.slice(0, 7).some(function (x) { return x.g === st.xGenre; })) kids.push(chip(st.xGenre, self.xGenreLabel(st.xGenre), null, true));
    return h('div', { className: 'bjx-genres', role: 'group', 'aria-label': 'Filter by genre' }, kids);
  };

  P.explorer = function (focus) {
    var b = focus && this.books[focus], plus = this._xLive();
    var full = plus && this.state.xFull ? this.explorerFull() : null;
    if (!b) return plus ? h(React.Fragment, null, this.explorerEntry(), full) : this.explorerEntry();
    var vw = this.state.vw || window.innerWidth, vh = window.innerHeight;
    var wide = vw >= 1000, W = wide ? vw - 400 - 64 : vw - 32;
    var availH = vh - 56 - 90 - (plus ? 44 : 0);
    return h('div', { className: 'bjx-page' + (wide ? ' wide' : '') + (plus ? ' bjx-plus' : '') },
      h('div', { className: 'bjx-main' },
        h('div', { className: 'bjx-top' },
          h('button', { className: 'bjx-back', onClick: function () { location.hash = '#/network'; } }, '← All starting points'),
          this.explorerTrail(b.id)),
        plus ? this.explorerGenres(b) : null,
        h('div', { className: 'bjx-stage' }, this.explorerFan(b, Math.max(300, W), availH)),
        h('div', { className: 'bjx-legend' }, h('span', null, h('i', { className: 'ln in' }), 'mentioned by'), h('span', null, h('i', { className: 'ln out' }), 'mentions'), h('span', null, h('i', { className: 'ln both' }), 'mention each other'), h('span', { className: 'cnt' }, '+12 = books one more jump away'))),
      this.explorerPanel(b), full);
  };

  window.__BJ.explorerReady = true;
})();
