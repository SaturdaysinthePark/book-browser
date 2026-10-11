/*
 * BookJumpr — interactive home walls (?home=a|b|c).
 *
 * An imperative engine (no React in the hot path) that fills a stage element with recycled
 * cover slots and moves them with transforms only:
 *
 *   a  "Endless shelf"  — vertical columns that scroll and loop forever, each column at a
 *                          slightly different speed (parallax), wheel / drag / keys.
 *   b  "Infinite canvas" — a wrap-around 2D wall you can pan in any direction; hovering a
 *                          cover lights it and draws dotted arcs to its on-screen neighbours.
 *   c  "Shelf rows"      — themed horizontal rows looping at different speeds; scrolling
 *                          spins them faster (or backwards).
 *
 * Every variant shares: ring-buffer slot recycling (a slot that leaves one edge re-enters the
 * other with the next book from a deterministic (lane, index) → book mapping, so the wall is a
 * slow tour of the whole catalogue and scrolling back shows the same books), Lenis-style
 * smoothing (pos eases toward target), drag with release inertia (velocity from the last
 * ~100ms, friction 0.94/frame, dt-normalised), and the colour spotlight: covers stay ink and
 * light up to their genre colour near the cursor (fine pointers) or as they sweep through the
 * middle of the screen while scrolling (touch). Under prefers-reduced-motion there is no drift,
 * smoothing or inertia, and the loop sleeps whenever nothing moves.
 *
 * Exposed as window.BJHomeWall; app.js mounts/destroys it via a stable React ref.
 */
(function () {
  'use strict';

  var mod = function (a, n) { return ((a % n) + n) % n; };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  // Small integer hash → [0,1). Deterministic per (a, b) so rotations/phases are stable.
  var rnd = function (a, b) {
    var h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be59b, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };
  var SVGNS = 'http://www.w3.org/2000/svg';

  // Backdrop doodles: one hand-drawn 520px tile (jump arcs with a little book, stars, open books,
  // quote marks, spirals, arrows, an ex-libris stamp…) repeated behind the covers on its own
  // parallax layer above a graph-paper grid. Built once per ink colour as an SVG data URI.
  var DOODLE_W = 520, DOODLE_SZ = 420;   // drawn at 520, painted at 420 (denser)
  var doodleTile = function (ink, accent) {
    var st = 'fill="none" stroke="' + ink + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
    var ac = 'fill="none" stroke="' + accent + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    var book = function (x, y, r) {   // the logo's little book, tilted
      return '<g transform="translate(' + x + ' ' + y + ') rotate(' + r + ')"><rect x="-5" y="-7" width="10" height="14" ' + st + '/><path d="M-2.4 -7 V7" ' + st + '/></g>';
    };
    var star = function (x, y, s) {
      return '<path transform="translate(' + x + ' ' + y + ') scale(' + s + ')" d="M0 -9 C1 -3 3 -1 9 0 C3 1 1 3 0 9 C-1 3 -3 1 -9 0 C-3 -1 -1 -3 0 -9 Z" ' + st + '/>';
    };
    var openBook = function (x, y, r) {
      return '<g transform="translate(' + x + ' ' + y + ') rotate(' + r + ')"><path d="M0 -6 C-5 -10 -13 -10 -18 -8 V9 C-13 7 -5 7 0 11 C5 7 13 7 18 9 V-8 C13 -10 5 -10 0 -6 Z M0 -6 V11" ' + st + '/><path d="M-14 -3 C-10 -4 -6 -3 -4 -1 M-14 2 C-10 1 -6 2 -4 4 M14 -3 C10 -4 6 -3 4 -1" ' + st + '/></g>';
    };
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="520" height="520" viewBox="0 0 520 520">'
      // dotted jump arcs (the BookJumpr motif) ending in a tilted book
      + '<path d="M28 132 Q86 52 150 118 Q182 80 214 112" ' + st + ' stroke-dasharray="2 6"/>' + '<circle cx="28" cy="132" r="2.4" fill="' + ink + '"/>' + book(222, 104, 38)
      + '<path d="M300 452 Q360 386 418 440" ' + ac + ' stroke-dasharray="2 6"/>' + '<circle cx="300" cy="452" r="2.4" fill="' + accent + '"/>' + book(426, 432, 44)
      + star(420, 70, 1) + star(96, 300, 0.7) + star(250, 250, 0.55) + star(486, 300, 0.8)
      + openBook(360, 190, -8) + openBook(140, 430, 6)
      // quote marks
      + '<path d="M44 220 c-6 4 -8 10 -4 15 c4 3 9 0 8 -5 c-1 -4 -6 -4 -6 -4 M58 220 c-6 4 -8 10 -4 15 c4 3 9 0 8 -5 c-1 -4 -6 -4 -6 -4" ' + st + '/>'
      // spiral
      + '<path d="M300 92 c3 -4 9 -1 8 4 c-1 7 -11 8 -14 1 c-4 -9 5 -18 15 -15 c12 4 13 20 2 26" ' + st + '/>'
      // curly arrow
      + '<path d="M212 352 c18 -26 46 -20 40 -2 c-5 14 -24 6 -12 -12 c10 -14 30 -16 44 -8" ' + st + '/><path d="M282 324 l3 7 l-7 3" ' + st + '/>'
      // ex-libris stamp
      + '<g transform="translate(470 172) rotate(-12)"><rect x="-26" y="-17" width="52" height="34" rx="4" ' + st + ' stroke-dasharray="3 3"/><path d="M-15 -4 H15 M-15 4 H8" ' + st + '/></g>'
      // dot trio + squiggle + tiny bookmark ribbon
      + '<circle cx="372" cy="300" r="1.8" fill="' + ink + '"/><circle cx="382" cy="304" r="1.8" fill="' + ink + '"/><circle cx="392" cy="300" r="1.8" fill="' + ink + '"/>'
      + '<path d="M40 486 q8 -10 16 0 t16 0 t16 0 t16 0" ' + st + '/>'
      + '<path d="M196 30 v22 l6 -5 l6 5 v-22 z" ' + ac + '/>'
      + '</svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  };

  function HomeWall(o) {
    this.o = o;
    this.root = o.root;                         // the stage (React-owned, otherwise childless)
    this.scope = o.scope || o.root.parentNode;  // receives wheel / pointer / key input
    this.v = o.variant;
    this.reduced = !!o.reduced;
    this.fine = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.pos = { x: 0, y: 0 }; this.target = { x: 0, y: 0 }; this.vel = { x: 0, y: 0 };
    this.seed = 0;
    this.pointer = null;          // last pointer position (client coords) for the spotlight
    this.onStage = false;         // is the pointer over the wall itself (not the hero card)
    this.hot = null;              // slot under the pointer
    this.activity = 0;            // 0..1 recent scroll energy (drives the touch colour sweep)
    this.engaged = 0;             // accumulated user-driven travel (px) → onEngage once past a threshold
    this.drift = this.reduced ? 0 : 1;
    this.rows = o.rows || [];
    // Parallax backdrop: a graph-paper grid far back (0.3×) and a doodle layer nearer (0.6×). Each is
    // one oversized element translated by (offset mod tile), so the backdrop is pure compositing.
    var dark = !!o.dark;
    var g = document.createElement('div'); g.className = 'hw-bg hw-grid';
    var d = document.createElement('div'); d.className = 'hw-bg hw-doodles';
    d.style.backgroundImage = doodleTile(dark ? 'rgba(242,236,221,.55)' : 'rgba(20,20,20,.55)', dark ? 'rgba(214,120,80,.7)' : 'rgba(156,61,34,.75)');
    this.root.appendChild(g); this.root.appendChild(d);
    this.bgs = [{ el: g, k: 0.3, tile: 160, tf: '' }, { el: d, k: 0.6, tile: DOODLE_SZ, tf: '' }];
    this.layer = document.createElement('div');
    this.layer.className = 'hw-layer';
    this.root.appendChild(this.layer);
    if (this.v === 'b') {
      this.arcs = document.createElementNS(SVGNS, 'svg');
      this.arcs.setAttribute('class', 'hw-arcs');
      this.root.appendChild(this.arcs);
    }
    this._bind();
    this.layout();
    this._last = 0;
    this._wake();
  }
  var P = HomeWall.prototype;

  // ---------------------------------------------------------------- layout
  P.layout = function () {
    var W = this.root.clientWidth || window.innerWidth, H = this.root.clientHeight || window.innerHeight;
    this.W = W; this.H = H;
    var mobile = W < 640;
    var cw = this.v === 'c' ? (mobile ? 78 : W < 1100 ? 96 : 108) : (mobile ? 88 : W < 1100 ? 112 : 124);
    var ch = Math.round(cw * 1.5);
    // A leaves wider gutters so the doodled graph paper behind can breathe.
    var gx = this.v === 'a' ? (mobile ? 16 : 30) : (mobile ? 12 : 18), gy = this.v === 'a' ? (mobile ? 18 : 26) : (mobile ? 14 : 20);
    this.cw = cw; this.ch = ch;
    this.cellW = cw + gx; this.pitch = ch + gy;
    this.root.style.setProperty('--cw', cw + 'px');
    this.layer.textContent = '';
    this.slots = [];
    this.labels = [];
    var i, n;
    if (this.v === 'a') {
      this.K = Math.ceil(W / this.cellW) + 2;
      this.S = Math.ceil(H / this.pitch) + 3;
      this.x0 = (W - this.K * this.cellW) / 2 + gx / 2;
      this.cols = [];
      for (i = 0; i < this.K; i++) {
        // Speeds 0.84–1.16× (parallax) and a per-column phase for a staggered, masonry rhythm.
        this.cols.push({ speed: 1 + 0.16 * Math.sin(i * 2.17 + 0.6), phase: rnd(i, 7) * this.pitch, off: NaN });
      }
      n = this.K * this.S;
    } else if (this.v === 'b') {
      this.nc = Math.ceil(W / this.cellW) + 2;
      this.nr = Math.ceil(H / this.pitch) + 4;
      n = this.nc * this.nr;
    } else {
      this._layoutRows();
      n = 0;
      for (i = 0; i < this.lanes.length; i++) n += this.lanes[i].S;
    }
    for (i = 0; i < n; i++) this.slots.push(this._makeSlot());
    if (this.v === 'c') {
      var k = 0;
      for (i = 0; i < this.lanes.length; i++) { this.lanes[i].base = k; k += this.lanes[i].S; }
    }
    this._dirty = true;
  };

  // Shelf rows sit above and below the hero band (measured from the DOM so CSS owns its size).
  P._layoutRows = function () {
    var band = this.scope.querySelector('[data-hx-band]');
    var r = band ? band.getBoundingClientRect() : null;
    var rootR = this.root.getBoundingClientRect();
    var top = r ? r.top - rootR.top : this.H / 2 - 110, bot = r ? r.bottom - rootR.top : this.H / 2 + 110;
    var lab = 28, rowH = this.ch + lab + (this.W < 640 ? 10 : 18);
    var ys = [], k;
    // Interleave below/above so the rows nearest the band get the strongest themes.
    var above = [], below = [];
    for (k = 0; bot + k * rowH < this.H; k++) below.push(bot + k * rowH + lab + 6);
    for (k = 0; top - (k + 1) * rowH + lab > -this.ch; k++) above.push(top - (k + 1) * rowH + lab + 2);
    for (k = 0; k < Math.max(above.length, below.length); k++) {
      if (k < below.length) ys.push(below[k]);
      if (k < above.length) ys.push(above[k]);
    }
    var S = Math.ceil(this.W / this.cellW) + 2;
    this.lanes = ys.map(function (y, i) {
      return { y: y, S: S, dir: i % 2 ? -1 : 1, speed: 0.85 + rnd(i, 3) * 0.35, drift: rnd(i, 9) * 400, row: null, off: NaN };
    });
    this._assignRows();
  };
  P._assignRows = function () {
    var self = this;
    this.labels.forEach(function (l) { l.remove(); });
    this.labels = [];
    (this.lanes || []).forEach(function (ln, i) {
      ln.row = self.rows.length ? self.rows[i % self.rows.length] : { label: '', ids: self.o.pool };
      ln.off = NaN;
      var lab = document.createElement('div');
      lab.className = 'hw-label';
      lab.textContent = ln.row.label;
      lab.style.transform = 'translate3d(0,' + (ln.y - 26) + 'px,0)';
      self.layer.appendChild(lab);
      self.labels.push(lab);
    });
  };

  P._makeSlot = function () {
    var el = document.createElement('div');
    el.className = 'hw-slot';
    var card = document.createElement('div');
    card.className = 'hw-card';
    el.appendChild(card);
    this.layer.appendChild(el);
    return { el: el, card: card, bk: null, lit: 0, litSet: -1, x: 0, y: 0, tf: '' };
  };
  P._setBook = function (s, id) {
    if (s.bk === id) return;
    s.bk = id;
    s.card.innerHTML = this.o.html(id);
    s.el.setAttribute('data-bk', id);
    s.litSet = -1;
  };
  P._place = function (s, x, y, rot) {
    s.x = x; s.y = y;
    var tf = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + rot.toFixed(2) + 'deg)';
    if (tf !== s.tf) { s.el.style.transform = tf; s.tf = tf; }
  };

  // ---------------------------------------------------------------- render
  P._render = function () {
    var pool = this.o.pool, N = pool.length, i, j, v, s;
    if (!N) return;
    var seed = this.seed;
    if (this.v === 'a') {
      for (i = 0; i < this.K; i++) {
        var col = this.cols[i];
        var off = this.pos.y * col.speed + col.phase;
        if (off === col.off) continue;
        col.off = off;
        var first = Math.floor(off / this.pitch) - 1;
        var x = this.x0 + i * this.cellW;
        for (j = 0; j < this.S; j++) {
          v = first + j;
          s = this.slots[i * this.S + mod(v, this.S)];
          this._setBook(s, pool[mod(v * this.K + i + seed, N)]);
          this._place(s, x, v * this.pitch - off, (rnd(i * 977 + seed, v) - 0.5) * 5);
        }
      }
    } else if (this.v === 'b') {
      var seq = this.o.seq || pool, M = seq.length;
      var fc = Math.floor(this.pos.x / this.cellW) - 1, fr = Math.floor(this.pos.y / this.pitch) - 2;
      var ROWW = 29;
      for (i = 0; i < this.nc; i++) {
        var gc = fc + i, shift = mod(gc, 2) ? this.pitch / 2 : 0;
        for (j = 0; j < this.nr; j++) {
          var gr = fr + j;
          s = this.slots[mod(gc, this.nc) + mod(gr, this.nr) * this.nc];
          this._setBook(s, seq[mod(gr * ROWW + gc + seed, M)]);
          this._place(s, gc * this.cellW - this.pos.x + 9, gr * this.pitch - this.pos.y + shift, (rnd(gc + seed, gr) - 0.5) * 4);
        }
      }
    } else {
      for (i = 0; i < this.lanes.length; i++) {
        var ln = this.lanes[i];
        var lo = this.pos.y * ln.dir * ln.speed + ln.drift;
        if (lo === ln.off) continue;
        ln.off = lo;
        var ids = ln.row.ids, L = ids.length;
        var f = Math.floor(lo / this.cellW) - 1;
        for (j = 0; j < ln.S; j++) {
          v = f + j;
          s = this.slots[ln.base + mod(v, ln.S)];
          this._setBook(s, ids[mod(v + seed, L)]);
          this._place(s, v * this.cellW - lo + 14, ln.y, (rnd(i * 31 + seed, v) - 0.5) * 3);
        }
      }
    }
  };

  P._backdrop = function () {
    for (var i = 0; i < this.bgs.length; i++) {
      var b = this.bgs[i], T = b.tile;
      // C's rows move sideways, so its backdrop drifts with the scroll instead (vertical, slow).
      var ox = this.v === 'b' ? this.pos.x * b.k : 0;
      var oy = this.pos.y * b.k;
      var tf = 'translate3d(' + (-mod(ox, T)).toFixed(1) + 'px,' + (-mod(oy, T)).toFixed(1) + 'px,0)';
      if (tf !== b.tf) { b.el.style.transform = tf; b.tf = tf; }
    }
  };

  // Spotlight: ease each visible cover's --lit toward its target (pointer distance on desktop,
  // scroll-energy × centre band on touch; hovered + B-neighbour covers are fully lit).
  P._spot = function (k) {
    var W = this.W, H = this.H, cw2 = this.cw / 2, ch2 = this.ch / 2;
    var p = this.pointer, rootR = this._rootRect;
    var px = p && rootR ? p.x - rootR.left : -1e5, py = p && rootR ? p.y - rootR.top : -1e5;
    var act = this.activity, nb = this._nbSet, any = false;
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      var cx = s.x + cw2, cy = s.y + ch2;
      if (cx < -this.cw || cx > W + this.cw || cy < -this.ch || cy > H + this.ch) continue;
      var t = 0;
      if (this.fine && p) {
        var d = Math.sqrt((cx - px) * (cx - px) + (cy - py) * (cy - py));
        var u = clamp(1 - (d - 40) / 230, 0, 1);
        t = u * u * (3 - 2 * u);
      }
      if (act > 0.01) {
        var band = this.v === 'a' ? 1 - Math.abs(cy - H * 0.5) / (H * 0.36)
          : this.v === 'c' ? 1 - Math.abs(cx - W * 0.5) / (W * 0.42)
          : 1 - Math.sqrt((cx - W / 2) * (cx - W / 2) + (cy - H / 2) * (cy - H / 2)) / (Math.min(W, H) * 0.55);
        t = Math.max(t, act * clamp(band, 0, 1));
      }
      if (s === this.hot) t = 1;
      else if (nb && nb[s.bk]) t = Math.max(t, 0.92);
      s.lit += (t - s.lit) * k;
      if (Math.abs(s.lit - t) > 0.004) any = true;
      // Contrast curve: half-mixed ink/colour reads muddy, so covers commit quickly to one or the other.
      var c = clamp((s.lit - 0.12) / 0.7, 0, 1); c = c * c * (3 - 2 * c);
      if (Math.abs(c - s.litSet) > 0.015 || (c === 0 && s.litSet !== 0) || (c === 1 && s.litSet !== 1)) {
        var val = c;
        s.el.style.setProperty('--lit', val.toFixed(3));
        s.litSet = val;
      }
    }
    return any;
  };

  // Which slot is under the pointer (math, not :hover — elements move under a still cursor).
  P._hitTest = function () {
    if (!this.fine || !this.pointer || !this.onStage || this.dragging) return null;
    var rootR = this._rootRect, px = this.pointer.x - rootR.left, py = this.pointer.y - rootR.top;
    var best = null;
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      if (px >= s.x && px <= s.x + this.cw && py >= s.y && py <= s.y + this.ch) best = s;
    }
    return best;
  };

  P._setHot = function (s) {
    if (s === this.hot) return;
    if (this.hot) this.hot.el.classList.remove('is-hot');
    this.hot = s;
    if (s) s.el.classList.add('is-hot');
    if (this.v === 'b') {
      this._nbSet = null;
      if (s && this.o.neighbors) {
        var ids = this.o.neighbors(s.bk), set = {};
        for (var i = 0; i < ids.length; i++) set[ids[i]] = 1;
        this._nbSet = set;
      }
    }
  };

  P._drawArcs = function () {
    if (!this.arcs) return;
    var s = this.hot, nb = this._nbSet, out = '';
    if (s && nb) {
      var ax = s.x + this.cw / 2, ay = s.y + this.ch / 2, n = 0;
      for (var i = 0; i < this.slots.length && n < 14; i++) {
        var t = this.slots[i];
        if (t === s || !nb[t.bk]) continue;
        var bx = t.x + this.cw / 2, by = t.y + this.ch / 2;
        if (bx < -40 || bx > this.W + 40 || by < -40 || by > this.H + 40) continue;
        var mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay;
        var cx = mx - dy * 0.22, cy = my + dx * 0.22 - 30;
        out += '<path d="M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1) + '"/>'
          + '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="4"/>';
        n++;
      }
    }
    if (out !== this._arcsHtml) { this.arcs.innerHTML = out; this._arcsHtml = out; }
  };

  // ---------------------------------------------------------------- loop
  P._wake = function () {
    if (this._raf || this._dead) return;
    var self = this;
    this._raf = requestAnimationFrame(function (t) { self._frame(t); });
  };
  P._frame = function (t) {
    this._raf = 0;
    if (this._dead) return;
    var dt = this._last ? Math.min(48, t - this._last) / 16.667 : 1;
    this._last = t;
    this._rootRect = this.root.getBoundingClientRect();
    var px = this.pos.x, py = this.pos.y;
    var hovering = !!this.hot;
    if (!this.dragging) {
      if (!this.reduced) {
        var f = Math.pow(0.94, dt);
        this.target.x += this.vel.x * dt; this.target.y += this.vel.y * dt;
        this.vel.x *= f; this.vel.y *= f;
        if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0;
        if (Math.abs(this.vel.y) < 0.02) this.vel.y = 0;
        // Ambient drift keeps the wall alive; it holds still while you're pointing at a cover.
        if (this.drift && !hovering && !document.hidden) {
          if (this.v === 'a') this.target.y += 0.32 * dt;
          else if (this.v === 'b') { this.target.x += 0.16 * dt; this.target.y += 0.1 * dt; }
          else for (var i = 0; i < this.lanes.length; i++) this.lanes[i].drift += 0.38 * this.lanes[i].speed * this.lanes[i].dir * dt;
        }
      }
    }
    if (this.reduced || this.dragging) { this.pos.x = this.target.x; this.pos.y = this.target.y; }
    else {
      var e = 1 - Math.pow(1 - 0.16, dt);
      this.pos.x += (this.target.x - this.pos.x) * e;
      this.pos.y += (this.target.y - this.pos.y) * e;
      if (Math.abs(this.target.x - this.pos.x) < 0.05) this.pos.x = this.target.x;
      if (Math.abs(this.target.y - this.pos.y) < 0.05) this.pos.y = this.target.y;
    }
    var moved = Math.abs(this.pos.x - px) + Math.abs(this.pos.y - py);
    // Scroll energy for the touch colour sweep (ambient drift is far below the threshold).
    var userSpeed = this._userMoving ? moved : 0;
    this.activity = Math.max(this.activity * Math.pow(0.955, dt), clamp(userSpeed / 5, 0, 1));
    if (this.activity < 0.01) this.activity = 0;
    if (this.target.x === this.pos.x && this.target.y === this.pos.y && !this.vel.x && !this.vel.y) this._userMoving = false;
    this._render();
    this._backdrop();
    this._setHot(this._hitTest());
    var lighting = this._spot(this.reduced ? 1 : 1 - Math.pow(1 - 0.22, dt));
    this._drawArcs();
    var busy = moved > 0 || this.vel.x || this.vel.y || this.dragging || lighting || this.activity || (this.drift && !this.reduced);
    if (busy) this._wake();
  };

  // ---------------------------------------------------------------- input
  P._engage = function (d) {
    this.engaged += Math.abs(d);
    if (this.engaged > 70 && !this._engagedFired) {
      this._engagedFired = true;
      if (this.o.onEngage) this.o.onEngage();
    }
  };
  P.resetEngage = function () { this.engaged = 0; this._engagedFired = false; };

  P._bind = function () {
    var self = this, scope = this.scope;
    var isUI = function (el) { return el && el.closest && el.closest('input,button,a,textarea,select,[data-nodrag]'); };
    this._onWheel = function (e) {
      if (isUI(e.target) && e.target.closest('[data-hx-sugg]')) return;
      e.preventDefault();
      var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? self.H : 1;
      var dx = e.deltaX * k, dy = e.deltaY * k;
      if (e.shiftKey && !dx) { dx = dy; dy = 0; }
      if (self.v === 'a') { self.target.y += dy + dx * 0.3; self._engage(dy); }
      else if (self.v === 'b') { self.target.x += dx; self.target.y += dy; self._engage(dx + dy); }
      else { self.target.y += dy + dx; self._engage(dy + dx); }
      self._userMoving = true;
      self._wake();
    };
    this._onDown = function (e) {
      if (e.button > 0 || isUI(e.target)) return;
      self.dragging = false;
      self._press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, tx: self.target.x, ty: self.target.y, samples: [], lane: self._laneAt(e.clientY) };
      self.vel.x = self.vel.y = 0;
      self.target.x = self.pos.x; self.target.y = self.pos.y;
      self._press.tx = self.target.x; self._press.ty = self.target.y;
    };
    this._onMove = function (e) {
      self.pointer = { x: e.clientX, y: e.clientY };
      self.onStage = e.target === self.root || (self.root.contains(e.target) && !isUI(e.target));
      var pr = self._press;
      if (pr && pr.id === e.pointerId) {
        var dx = e.clientX - pr.x, dy = e.clientY - pr.y;
        if (!self.dragging && Math.abs(dx) + Math.abs(dy) > 6) {
          self.dragging = true;
          self.scope.setAttribute('data-drag', '1');
          try { scope.setPointerCapture(e.pointerId); } catch (err) {}
        }
        if (self.dragging) {
          if (self.v === 'a') { self.target.y = pr.ty - dy; }
          else if (self.v === 'b') { self.target.x = pr.tx - dx; self.target.y = pr.ty - dy; }
          else { self.target.y = pr.ty - dy - dx * (pr.lane ? pr.lane.dir / pr.lane.speed : 1); }
          var now = performance.now();
          pr.samples.push({ t: now, x: self.target.x, y: self.target.y });
          while (pr.samples.length > 2 && now - pr.samples[0].t > 100) pr.samples.shift();
          self._userMoving = true;
          self._engage(Math.abs(dx) + Math.abs(dy) - (pr.lastD || 0)); pr.lastD = Math.abs(dx) + Math.abs(dy);
        }
      }
      self._wake();
    };
    this._onUp = function (e) {
      var pr = self._press;
      if (!pr || pr.id !== e.pointerId) return;
      self._press = null;
      if (self.dragging) {
        self.dragging = false;
        self.scope.removeAttribute('data-drag');
        var sm = pr.samples;
        if (sm.length >= 2 && !self.reduced) {
          var a = sm[0], b = sm[sm.length - 1], span = Math.max(16, b.t - a.t);
          if (performance.now() - b.t < 80) {
            self.vel.x = clamp((b.x - a.x) / span * 16.667, -90, 90);
            self.vel.y = clamp((b.y - a.y) / span * 16.667, -90, 90);
          }
        }
        self._wake();
        return;
      }
      // A tap/click on a cover opens it.
      if (performance.now() - pr.t < 600) {
        var slot = e.target.closest && e.target.closest('.hw-slot');
        // A tap in the gutter between covers opens the nearest one (forgiving touch targets).
        if (!slot && e.target.closest && e.target.closest('.hx-stage')) slot = self._nearest(e.clientX, e.clientY);
        if (slot && self.root.contains(slot) && self.o.onOpen) self.o.onOpen(slot.getAttribute('data-bk'), slot);
      }
    };
    this._onLeave = function () { self.pointer = null; self.onStage = false; self._wake(); };
    this._onKey = function (e) {
      var ae = document.activeElement;
      if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
      var step = 0, side = 0;
      if (e.key === 'ArrowDown') step = 90; else if (e.key === 'ArrowUp') step = -90;
      else if (e.key === 'PageDown' || e.key === ' ') step = self.H * 0.8; else if (e.key === 'PageUp') step = -self.H * 0.8;
      else if (e.key === 'ArrowRight') side = 90; else if (e.key === 'ArrowLeft') side = -90;
      else return;
      e.preventDefault();
      if (self.v === 'b') { self.target.x += side; self.target.y += step; }
      else self.target.y += step + side;
      self._userMoving = true;
      self._engage(step + side);
      self._wake();
    };
    this._onResize = function () {
      clearTimeout(self._rz);
      self._rz = setTimeout(function () { if (!self._dead) { self.layout(); self._wake(); } }, 120);
    };
    scope.addEventListener('wheel', this._onWheel, { passive: false });
    scope.addEventListener('pointerdown', this._onDown);
    scope.addEventListener('pointermove', this._onMove);
    scope.addEventListener('pointerup', this._onUp);
    scope.addEventListener('pointercancel', this._onUp);
    scope.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
  };

  P._nearest = function (cx, cy) {
    var r = this.root.getBoundingClientRect(), x = cx - r.left, y = cy - r.top, best = null, bd = 1e9;
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      var dx = Math.max(s.x - x, 0, x - (s.x + this.cw)), dy = Math.max(s.y - y, 0, y - (s.y + this.ch));
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s; }
    }
    return bd <= 18 * 18 && best ? best.el : null;
  };
  P._laneAt = function (clientY) {
    if (this.v !== 'c' || !this.lanes) return null;
    var y = clientY - this.root.getBoundingClientRect().top;
    for (var i = 0; i < this.lanes.length; i++) if (y >= this.lanes[i].y - 26 && y <= this.lanes[i].y + this.ch) return this.lanes[i];
    return null;
  };

  // ---------------------------------------------------------------- public
  // Shuffle = reseed the (lane, index) → book mapping and fling the wall so new books spin in.
  P.shuffle = function (rows) {
    this.seed = (Math.random() * 100000) | 0;
    if (rows && this.v === 'c') { this.rows = rows; this._assignRows(); }
    for (var i = 0; i < this.slots.length; i++) this.slots[i].bk = null;
    if (this.cols) this.cols.forEach(function (c) { c.off = NaN; });
    if (this.lanes) this.lanes.forEach(function (l) { l.off = NaN; });
    if (!this.reduced) {
      this.root.classList.remove('hw-reseed'); void this.root.offsetWidth; this.root.classList.add('hw-reseed');
      var a = Math.random() * Math.PI * 2;
      if (this.v === 'b') { this.vel.x = Math.cos(a) * 46; this.vel.y = Math.sin(a) * 46; }
      else this.vel.y = (this.W < 640 ? 38 : 52) * (Math.random() < 0.5 ? -1 : 1);
      this._userMoving = true;
    }
    this._wake();
  };
  P.destroy = function () {
    this._dead = true;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._rz);
    var s = this.scope;
    s.removeEventListener('wheel', this._onWheel);
    s.removeEventListener('pointerdown', this._onDown);
    s.removeEventListener('pointermove', this._onMove);
    s.removeEventListener('pointerup', this._onUp);
    s.removeEventListener('pointercancel', this._onUp);
    s.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    this.root.textContent = '';
  };

  window.BJHomeWall = HomeWall;
})();
