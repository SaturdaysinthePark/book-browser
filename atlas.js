/*
 * BookJumpr — network "Atlas" (#/network with ?net=v3).
 *
 * A calmer whole-network map. Books are grouped into reading neighbourhoods (Louvain regions,
 * laid out offline by tools/build-atlas.mjs: hubs in the middle of each region, related regions
 * near each other). At rest the map shows only regions and dots — no lines, no ambient motion,
 * and labels only where there is room (region names when zoomed out, hub titles as you zoom in).
 * Hover a book to see its mentions; click to focus it: everything else dims, its connections draw
 * in (rust = it mentions, blue = mentioned by) and every neighbour is labelled. The panel beside
 * the map is React (app.js reuses the Explorer's panel).
 *
 * Canvas 2D, redrawn only when something changes. window.BJAtlas; app.js mounts it via a ref.
 */
(function () {
  'use strict';
  var PAL = ['#c4682e', '#2f5590', '#3f7d7d', '#7d4a66', '#8a5a3a', '#2e8156', '#a34a9c', '#8c6d24', '#c33d2e', '#4a3b52'];
  var OUT = '#9c3d22', IN = '#2f5590', INK = '#141414', PAPER = '#f7f5f0';
  var SERIF = "'Instrument Serif', Georgia, serif", MONO = "'IBM Plex Mono', monospace";
  var hexA = function (hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  };

  function Atlas(o) {
    this.o = o;
    this.host = o.root;
    this.reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var D = o.data;
    this.regions = D.regions;
    this.N = D.nodes.length;
    this.keys = []; this.wx = new Float32Array(this.N); this.wy = new Float32Array(this.N);
    this.reg = new Int32Array(this.N); this.deg = new Float32Array(this.N);
    this.idx = {};
    var ext = 0, i;
    for (i = 0; i < this.N; i++) {
      var nd = D.nodes[i];
      this.keys.push(nd[0]); this.wx[i] = nd[1]; this.wy[i] = nd[2]; this.reg[i] = nd[3]; this.deg[i] = nd[4];
      this.idx[nd[0]] = i;
      ext = Math.max(ext, Math.abs(nd[1]) + 10, Math.abs(nd[2]) + 10);
    }
    this.extent = ext;
    // label priority: most connected first
    this.order = [];
    for (i = 0; i < this.N; i++) this.order.push(i);
    var dg = this.deg;
    this.order.sort(function (a, b) { return dg[b] - dg[a]; });
    // spatial grid in world units for picking
    this.cell = 40; this.grid = {};
    for (i = 0; i < this.N; i++) {
      var gk = Math.floor(this.wx[i] / this.cell) + ',' + Math.floor(this.wy[i] / this.cell);
      (this.grid[gk] || (this.grid[gk] = [])).push(i);
    }
    // Options (all default to the Atlas v3 behaviour):
    //   regions:false  no neighbourhood circles / names   colorOf(key)  per-book colour (e.g. genre)
    //   regionCircles:false  continents: names only (anchored at lx/ly, kept while a book is focused),
    //                        with a soft tint in regionColor(region) under the dots
    //   guides         { rings:[{r,t}] } concentric guide rings, or { axes } a chart frame (ticks, titles, captions)
    //   regionTint:false  no soft tint under continents (petals share one centre)
    //   wrapX/wrapY    periods in world units: the map loops both ways (a surface whose edges join)
    //   regionZoom:false  clicks never zoom into a region
    //   dust           books with a single link draw as faint dust (they light up near the cursor,
    //                  when linked to the selection, or zoomed in)
    //   gravity        stars lean toward the mouse on a damped spring (as the classic constellation)
    //   bundle         3+ links into one region draw as one thick line with a count (binned charts)
    //   labelTop       at overview, always label this many of the most connected books
    //   flow           animated directional dashes on the focused book's lines (rust out, blue in)
    //   twinkle        slow shimmer on a sparse subset of stars     mini  compact, click-only
    this.showRegions = o.regions !== false;
    this.dust = !!o.dust;
    this.grav = !!o.gravity && !this.reduced;
    this.ox = new Float32Array(this.N); this.oy = new Float32Array(this.N);   // gravity offsets (screen px)
    this.gvx = new Float32Array(this.N); this.gvy = new Float32Array(this.N);
    this._gAct = new Set();
    this.P = o.wrapX || 0;   // horizontal period: the map repeats every P world units (infinite sideways pan)
    this.PY = o.wrapY || 0;  // vertical period (with wrapX: a surface whose edges join, pan any way forever)
    this.regionCircles = o.regionCircles !== false;
    this.mini = !!o.mini;
    if (o.colorOf) { this.col = []; for (i = 0; i < this.N; i++) this.col.push(o.colorOf(this.keys[i])); }
    if (o.twinkle && !o.mini) {
      this.tw = new Float32Array(this.N);   // 0 = steady; otherwise an angular speed (about 1 star in 25, slow)
      for (i = 0; i < this.N; i++) { var hsh = Math.sin(i * 12.9898) * 43758.5453; hsh -= Math.floor(hsh); this.tw[i] = hsh < 0.04 && !(o.dust && this.deg[i] <= 1) ? 1.6 + hsh * 55 : 0; }
    }
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'atlas-canvas';
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.cam = { x: 0, y: 0, k: 1 };
    this.focus = -1; this.hover = -1; this.nb = null;
    this._bind();
    var self = this;
    this.ro = new ResizeObserver(function () { self._resize(); });
    this.ro.observe(this.host);
    this._resize();
    this.fit(false);
    this._startTick();
  }
  var P = Atlas.prototype;

  // ---- camera ------------------------------------------------------------------------------
  P._resize = function () {
    var r = this.host.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.draw();
  };
  P.sx = function (x) { return (x - this.cam.x) * this.cam.k + this.W / 2; };
  P.sy = function (y) { return (y - this.cam.y) * this.cam.k + this.H / 2; };
  // wrapped maps: the copy of world x nearest the camera (the view is never wider than one period)
  P._wrap = function (x) { return this.P ? x + this.P * Math.round((this.cam.x - x) / this.P) : x; };
  P._x = function (i) { return this._wrap(this.wx[i]) + this.ox[i] / this.cam.k; };
  P._wrapY = function (y) { return this.PY ? y + this.PY * Math.round((this.cam.y - y) / this.PY) : y; };
  P._y = function (i) { return this._wrapY(this.wy[i]) + this.oy[i] / this.cam.k; };
  // On phones the panel is a bottom sheet over the map; frame things in the visible area above it.
  P._inset = function () { return this.o.bottomInset ? Math.min(this.H * 0.6, this.o.bottomInset() || 0) : 0; };
  P._insetTop = function () { return this.o.topInset ? Math.min(this.H * 0.3, this.o.topInset() || 0) : 0; };
  P._lookAt = function (x, y, k, anim) {   // put world (x,y) in the middle of the visible area
    var ins = this._inset() - this._insetTop();
    this.flyTo(x, y + (ins / 2) / Math.max(this.minK || 0.05, Math.min(6, k)), k, anim);
  };
  P.fit = function (anim) {
    var ins = this._inset() + this._insetTop();
    if (this.P && this.PY) {   // a surface that wraps both ways: never show more than one period either way
      this.minK = Math.max(this.W / this.P, (this.H - ins) / this.PY);
      this._lookAt(this.cam.x || 0, this.cam.y || 0, this.minK * 1.25, anim);
      return;
    }
    var A = this.o.guides && this.o.guides.axes;
    if (A) {   // a chart: fit its frame, keeping screen room for tick labels, axis titles and corner captions
      var hx = Math.max(Math.abs(A.x0), Math.abs(A.x1)), hy = Math.max(Math.abs(A.y0), Math.abs(A.y1));
      var sm = this.W < 600, TOP = sm ? 74 : 56, BOT = sm ? 128 : 100, SIDE = sm ? 58 : 80;   // phones: room for the hint line below   // phones: tighter sides
      var kc = Math.min((this.W - 2 * SIDE) / (2 * hx), (this.H - ins - TOP - BOT) / (2 * hy));
      this.minK = kc * 0.7;
      this._lookAt(0, ((BOT - TOP) / 2) / kc, kc, anim);
      return;
    }
    var ex = this.extent, ey = this.extent;
    var k = Math.min(this.W * 0.94 / (2 * ex), (this.H - ins) * 0.94 / (2 * ey));
    this.minK = k * 0.7;
    this._lookAt(0, 0, k, anim);
  };
  P.flyTo = function (x, y, k, anim) {
    var self = this;
    if (this.P) x = this._wrap(x);
    if (this.PY) y = this._wrapY(y);
    k = Math.max(this.minK || 0.05, Math.min(6, k));
    cancelAnimationFrame(this._tw);
    if (anim === false || this.reduced) { this.cam = { x: x, y: y, k: k }; this.draw(); return; }
    var from = { x: this.cam.x, y: this.cam.y, k: this.cam.k }, t0 = performance.now(), dur = 560;
    var step = function (t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      // zoom interpolated in log space so it doesn't lurch
      self.cam = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e, k: Math.exp(Math.log(from.k) + (Math.log(k) - Math.log(from.k)) * e) };
      self.draw();
      if (p < 1) self._tw = requestAnimationFrame(step);
    };
    this._tw = requestAnimationFrame(step);
  };
  P.zoomBy = function (f, mx, my) {
    if (mx == null) { mx = this.W / 2; my = this.H / 2; }
    var wx = (mx - this.W / 2) / this.cam.k + this.cam.x, wy = (my - this.H / 2) / this.cam.k + this.cam.y;
    var k = Math.max(this.minK || 0.05, Math.min(6, this.cam.k * f));
    this.cam = { k: k, x: wx - (mx - this.W / 2) / k, y: wy - (my - this.H / 2) / k };
    this.draw();
  };
  // Frame a set of nodes, leaving room for the panel on the right (desktop).
  P.frame = function (ids, anim) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (var j = 0; j < ids.length; j++) {
      var i = ids[j];
      var fx = this.P ? this.wx[i] + this.P * Math.round((this.wx[ids[0]] - this.wx[i]) / this.P) : this.wx[i];
      var fy = this.PY ? this.wy[i] + this.PY * Math.round((this.wy[ids[0]] - this.wy[i]) / this.PY) : this.wy[i];
      minX = Math.min(minX, fx); maxX = Math.max(maxX, fx); minY = Math.min(minY, fy); maxY = Math.max(maxY, fy);
    }
    var narrow = this.W < 640, padX = narrow ? 40 : 120, padY = narrow ? 50 : 90, ins = this._inset() + this._insetTop();
    if (this.mini) { padX = Math.max(8, this.W * 0.09); padY = Math.max(8, this.H * 0.1); }   // thumbnails: small margins, or the links fall off the edges
    var k = Math.min((this.W - padX * 2) / Math.max(80, maxX - minX), (this.H - ins - padY * 2) / Math.max(80, maxY - minY));
    k = Math.min(k, 2.4);
    this._lookAt((minX + maxX) / 2, (minY + maxY) / 2, k, anim);
  };
  P.flyToRegion = function (ri) {
    var r = this.regions[ri];
    if (!r) return;
    this._lookAt(r.x, r.y, Math.min(this.W, this.H - this._inset()) * 0.42 / r.r);
  };

  // ---- focus / hover ---------------------------------------------------------------------
  P.setFocus = function (key, anim) {
    var i = key != null && this.idx[key] != null ? this.idx[key] : -1;
    this.focus = i;
    this.nb = null;
    if (i >= 0) {
      var n = this.o.neighbors(key), self = this, set = {}, ids = [i];
      n.out.forEach(function (k) { var j = self.idx[k]; if (j != null) { set[j] = set[j] ? 'both' : 'out'; } });
      n.in.forEach(function (k) { var j = self.idx[k]; if (j != null) { set[j] = set[j] === 'out' ? 'both' : 'in'; } });
      for (var j in set) ids.push(+j);
      this.nb = set;
      this.t0 = performance.now();
      this.frame(ids, anim);
      this._animateIn();
    }
    this.draw();
  };
  P._animateIn = function () {
    if (this.reduced) return;
    var self = this;
    cancelAnimationFrame(this._ai);
    var step = function () { self.draw(); if (performance.now() - self.t0 < 700) self._ai = requestAnimationFrame(step); };
    this._ai = requestAnimationFrame(step);
  };

  P.pick = function (mx, my, tol) {
    var wx = (mx - this.W / 2) / this.cam.k + this.cam.x, wy = (my - this.H / 2) / this.cam.k + this.cam.y;
    if (!this.P && !this.PY) return this._pickAt(wx, wy, tol).i;
    // wrapped: stored positions live in one period; try the click there and across the seams
    var xs = this.P ? [0, -1, 1].map(function (n) { return wx - this.P * Math.round(wx / this.P) + n * this.P; }, this) : [wx];
    var ys = this.PY ? [0, -1, 1].map(function (n) { return wy - this.PY * Math.round(wy / this.PY) + n * this.PY; }, this) : [wy];
    var best = { i: -1, d: 1e9 };
    xs.forEach(function (cx) { ys.forEach(function (cy) { var r = this._pickAt(cx, cy, tol); if (r.d < best.d) best = r; }, this); }, this);
    return best.i;
  };
  P._pickAt = function (wx, wy, tol) {
    var rad = (tol + 9 + (this.grav ? 50 : 0)) / this.cam.k, c = this.cell, best = -1, bd = 1e9;
    for (var gx = Math.floor((wx - rad) / c); gx <= Math.floor((wx + rad) / c); gx++) {
      for (var gy = Math.floor((wy - rad) / c); gy <= Math.floor((wy + rad) / c); gy++) {
        var list = this.grid[gx + ',' + gy];
        if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          var i = list[j], d = Math.hypot(this.wx[i] + this.ox[i] / this.cam.k - wx, this.wy[i] + this.oy[i] / this.cam.k - wy) * this.cam.k;
          if (d < this._r(i) + tol && d < bd) { bd = d; best = i; }
        }
      }
    }
    return { i: best, d: bd };
  };
  P.regionAt = function (mx, my) {
    var wx = (mx - this.W / 2) / this.cam.k + this.cam.x, wy = (my - this.H / 2) / this.cam.k + this.cam.y;
    for (var r = 0; r < this.regions.length; r++) {
      var R = this.regions[r];
      if (Math.hypot(R.x - wx, R.y - wy) < R.r) return r;
    }
    return -1;
  };

  // dot radius: grows gently with connections and with zoom (dust is smaller unless `full`)
  P._r = function (i, full) {
    var z = Math.sqrt(Math.max(0.15, this.cam.k));
    if (this.mini) return Math.max(0.9, Math.min(5, (0.7 + Math.sqrt(this.deg[i]) * 0.35) * z * 1.4));
    var r = Math.max(1.3, Math.min(11, (0.9 + Math.sqrt(this.deg[i]) * 0.55) * z * 1.6));
    return this.dust && this.deg[i] <= 1 && !full && this.cam.k < this._dustK() ? Math.max(1, r * 0.62) : r;
  };
  // zoomed in past this, dust is drawn as ordinary dots (there's room to read everything)
  P._dustK = function () { return (this.minK || 0.05) / 0.8 * 1.6; };
  // 0 (far) → 1 (at the cursor): how much a star is lit by the mouse's gravity well
  P._glow = function (sx, sy) {
    var C = this._cur; if (!C || !this.grav) return 0;
    var d = Math.hypot(sx - C[0], sy - C[1]);
    return d < 150 ? 1 - d / 150 : 0;
  };

  // ---- drawing ---------------------------------------------------------------------------
  P.draw = function () {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () { self._raf = 0; self._draw(); });
  };
  P._draw = function () {
    var c = this.ctx, W = this.W, H = this.H, k = this.cam.k;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
    var focus = this.focus, nb = this.nb, hover = this.hover, now = performance.now() / 1000;
    var ip = focus >= 0 && !this.reduced ? Math.min(1, (performance.now() - (this.t0 || 0)) / 600) : 1;
    var ease = 1 - Math.pow(1 - ip, 3);
    var placed = [];
    var tryPlace = function (x, y, w, h) {
      for (var q = 0; q < placed.length; q++) { var p = placed[q]; if (x < p[0] + p[2] && x + w > p[0] && y < p[1] + p[3] && y + h > p[1]) return false; }
      placed.push([x, y, w, h]); return true;
    };
    var r, R, sx, sy, sr, i;

    // regions
    for (r = 0; this.showRegions && !this.regionCircles && this.o.regionColor && this.o.regionTint !== false && r < this.regions.length; r++) {
      R = this.regions[r]; if (R.tint === false) continue;
      sx = this.sx(this._wrap(R.x)); sy = this.sy(this._wrapY(R.y)); sr = R.r * k * 1.08;
      if (sx + sr < 0 || sx - sr > W || sy + sr < 0 || sy - sr > H) continue;
      var tc = this.o.regionColor(R), gr = c.createRadialGradient(sx, sy, 0, sx, sy, sr);
      var tA = this.dust ? 0.11 : 0.075;
      gr.addColorStop(0, hexA(tc, tA)); gr.addColorStop(0.7, hexA(tc, tA * 0.55)); gr.addColorStop(1, hexA(tc, 0));
      c.fillStyle = gr; c.beginPath(); c.arc(sx, sy, sr, 0, 6.2832); c.fill();
    }
    for (r = 0; this.showRegions && this.regionCircles && r < this.regions.length; r++) {
      R = this.regions[r]; sx = this.sx(R.x); sy = this.sy(R.y); sr = R.r * k;
      if (sx + sr < 0 || sx - sr > W || sy + sr < 0 || sy - sr > H) continue;
      var col = R.name ? PAL[r % PAL.length] : '#8a8474';
      c.globalAlpha = focus >= 0 ? 0.35 : 1;
      c.beginPath(); c.arc(sx, sy, sr, 0, 6.2832);
      c.fillStyle = hexA(col, R.name ? 0.07 : 0.03); c.fill();
      c.setLineDash([3, 5]); c.lineWidth = 1; c.strokeStyle = 'rgba(20,20,20,0.14)'; c.stroke(); c.setLineDash([]);
    }
    c.globalAlpha = 1;
    if (this.o.guides) this._guides(c, k, placed);

    // dots
    for (i = 0; i < this.N; i++) {
      sx = this.sx(this._x(i)); sy = this.sy(this._y(i));
      if (sx < -12 || sx > W + 12 || sy < -12 || sy > H + 12) continue;
      R = this.regions[this.reg[i]];
      var linked = i === focus || (nb && nb[i]), on = focus < 0 || linked;
      // dust: single-link books stay faint unless lit (linked to the selection, near the cursor, zoomed in)
      var isDust = this.dust && this.deg[i] <= 1 && !linked && k < this._dustK(), glow = this.dust && this.deg[i] <= 4 ? this._glow(sx, sy) : 0;
      var rad = this._r(i, !isDust);
      var a = on ? 1 : (this.mini ? 0.14 : this.col ? 0.2 : 0.13);
      if (on && this.dust && focus < 0) a = isDust ? 0.34 + 0.66 * glow : this.deg[i] <= 4 ? 0.8 + 0.2 * glow : 1;
      if (isDust && glow > 0) rad *= 1 + 0.6 * glow;
      if (this.tw && this.tw[i] && !this.reduced && !linked) a *= 0.75 + 0.25 * Math.sin(now * this.tw[i] + i);
      c.globalAlpha = a;
      c.beginPath(); c.arc(sx, sy, rad, 0, 6.2832);
      c.fillStyle = this.col ? this.col[i] : R.name ? hexA(PAL[this.reg[i] % PAL.length], 0.8) : 'rgba(110,104,92,0.6)';
      // thumbnails: a linked book is drawn in its link's colour (in / out / both), so the ends of the lines read
      if ((this.mini || W < 600) && nb && nb[i]) { c.fillStyle = nb[i] === 'out' ? OUT : nb[i] === 'in' ? IN : INK; rad = Math.max(rad, 1.8); }
      c.fill();
      if (rad > 3.2 && !isDust) { c.lineWidth = 1; c.strokeStyle = 'rgba(20,20,20,0.55)'; c.stroke(); }
    }
    c.globalAlpha = 1;

    // connections of the hovered (unfocused) book or the focused book
    var hub = focus >= 0 ? focus : hover;
    var edgesOf = hub >= 0 ? (focus >= 0 ? nb : this._nbOf(hover)) : null;
    if (edgesOf) {
      var hx = this.sx(this._x(hub)), hy = this.sy(this._y(hub));
      // bundle: 3+ links of one kind into one neighbourhood (not the hub's own) draw as a single
      // thicker line to that neighbourhood's edge, with a count.
      // phones (bundleNarrow): a big hub's links are bundled per genre territory, own one included, and
      // each bundle ends at the middle of the books it stands for (territories on the starfield aren't round)
      var nE = 0; for (var jc in edgesOf) nE++;
      var near = this.o.bundleNarrow && W < 600 && !this.mini && focus >= 0 && nE > 16;
      var lines = [], groups = {};
      for (var js in edgesOf) {
        var j0 = +js, kd = edgesOf[js], rg = this.reg[j0];
        if ((this.o.bundle && rg !== this.reg[hub]) || (near && kd !== 'both')) { var gk = rg + kd; (groups[gk] || (groups[gk] = { rg: rg, kind: kd, ids: [] })).ids.push(j0); }
        else lines.push({ j: j0, kind: kd });
      }
      for (var gk2 in groups) {
        var G2 = groups[gk2];
        if (G2.ids.length < 3) { G2.ids.forEach(function (x) { lines.push({ j: x, kind: G2.kind }); }); continue; }
        if (near) {
          var mxs = 0, mys = 0;
          for (var gi = 0; gi < G2.ids.length; gi++) { mxs += this.sx(this._x(G2.ids[gi])); mys += this.sy(this._y(G2.ids[gi])); }
          mxs /= G2.ids.length; mys /= G2.ids.length;
          if (Math.hypot(mxs - hx, mys - hy) < 40) { G2.ids.forEach(function (x) { lines.push({ j: x, kind: G2.kind }); }); continue; }   // too close to read as a bundle
          // keep the bundle's end (and its count) on screen, between the top bar and the bottom card
          var top0 = this._insetTop() + 22, bot0 = H - this._inset() - 22, f0 = 1, vx = mxs - hx, vy = mys - hy;
          if (hx + vx * f0 < 24) f0 = (24 - hx) / vx; if (hx + vx * f0 > W - 24) f0 = (W - 24 - hx) / vx;
          if (hy + vy * f0 < top0) f0 = (top0 - hy) / vy; if (hy + vy * f0 > bot0) f0 = (bot0 - hy) / vy;
          f0 = Math.max(0.25, Math.min(1, f0));
          lines.push({ j: -1, kind: G2.kind, tx: hx + vx * f0, ty: hy + vy * f0, n: G2.ids.length });
          continue;
        }
        var RG = this.regions[G2.rg], rcx = this.sx(RG.x), rcy = this.sy(RG.y), rr = RG.r * k, ddx = hx - rcx, ddy = hy - rcy, dd = Math.hypot(ddx, ddy) || 1;
        lines.push({ j: -1, kind: G2.kind, tx: rcx + ddx / dd * rr, ty: rcy + ddy / dd * rr, n: G2.ids.length });
      }
      var ne = lines.length, plain = W < 600;   // phones: colour alone says in / out (as on the book page)
      var thin = this.o.flow ? Math.max(0.6, Math.min(1, 36 / ne)) : 1;   // big hubs: quieter lines
      var badges = [];
      for (var li0 = 0; li0 < lines.length; li0++) {
        var LN = lines[li0], j = LN.j, kind = LN.kind;
        var tx = j >= 0 ? this.sx(this._x(j)) : LN.tx, ty = j >= 0 ? this.sy(this._y(j)) : LN.ty;
        if (LN.n) badges.push(LN);
        var mx = (hx + tx) / 2, my = (hy + ty) / 2, dx = tx - hx, dy = ty - hy;
        var cx2 = mx - dy * 0.18, cy2 = my + dx * 0.18;
        var hot = j === hover && focus >= 0;
        c.strokeStyle = kind === 'out' ? OUT : kind === 'in' ? IN : INK;
        c.globalAlpha = (focus >= 0 ? (hover >= 0 && focus >= 0 && !hot && hover !== focus ? 0.3 : 0.9) : 0.55) * (hot ? 1 : thin);
        c.lineWidth = (hot ? 3.2 : LN.n ? Math.min(8, 2.2 + Math.sqrt(LN.n) * 0.7) : focus >= 0 ? 2.2 : 1.3) * (W < 600 ? 0.55 : 1);   // phones: finer lines
        if (this.mini) { c.lineWidth = W < 180 ? 0.8 : 1.1; c.globalAlpha = Math.min(c.globalAlpha, ne > 30 ? 0.45 : 0.7); }   // thumbnails: plain hairlines
        else if (plain && !hot && !LN.n) { c.lineWidth = 1.1; c.globalAlpha = Math.min(c.globalAlpha, ne > 30 ? 0.5 : 0.8); }   // phones: plain fine lines
        if (LN.n) c.globalAlpha = Math.max(c.globalAlpha, 0.7);
        // Flow (after the reveal): dashes travel in the mention's direction — out from the book for
        // books it mentions, in toward it for books that mention it. Mutual stays solid.
        var flowing = this.o.flow && !this.mini && !plain && focus >= 0 && ip >= 1 && kind !== 'both' && !this.reduced;
        var rev = flowing && kind === 'in';
        if (flowing) { var dsh = W < 600 ? [5, 4] : [8, 6]; c.setLineDash(dsh); c.lineDashOffset = -((now * 18) % (dsh[0] + dsh[1])); }
        c.beginPath();
        // draw-in: grow along the curve during the focus reveal
        var steps = 18, upto = Math.max(1, Math.round(steps * ease));
        for (var s = 0; s <= upto; s++) {
          var t = rev ? 1 - s / steps : s / steps, a1 = 1 - t;
          var qx = a1 * a1 * hx + 2 * a1 * t * cx2 + t * t * tx, qy = a1 * a1 * hy + 2 * a1 * t * cy2 + t * t * ty;
          if (s) c.lineTo(qx, qy); else c.moveTo(qx, qy);
        }
        c.stroke();
        if (flowing) c.setLineDash([]);
        // arrowhead at the curve's midpoint, pointing the way the mention goes (mutual: none)
        if (focus >= 0 && ip >= 1 && kind !== 'both' && !this.mini && !plain) {
          var t1 = 0.5, t2 = 0.56, m1 = 1 - t1, m2 = 1 - t2;
          var ax1 = m1 * m1 * hx + 2 * m1 * t1 * cx2 + t1 * t1 * tx, ay1 = m1 * m1 * hy + 2 * m1 * t1 * cy2 + t1 * t1 * ty;
          var ax2 = m2 * m2 * hx + 2 * m2 * t2 * cx2 + t2 * t2 * tx, ay2 = m2 * m2 * hy + 2 * m2 * t2 * cy2 + t2 * t2 * ty;
          var ang = Math.atan2(ay2 - ay1, ax2 - ax1) + (kind === 'in' ? Math.PI : 0), AS = (hot ? 9 : 7) * (W < 600 ? 0.7 : 1);
          c.fillStyle = c.strokeStyle; c.beginPath();
          c.moveTo(ax1 + Math.cos(ang) * AS, ay1 + Math.sin(ang) * AS);
          c.lineTo(ax1 + Math.cos(ang + 2.5) * AS, ay1 + Math.sin(ang + 2.5) * AS);
          c.lineTo(ax1 + Math.cos(ang - 2.5) * AS, ay1 + Math.sin(ang - 2.5) * AS);
          c.fill();
        }
      }
      c.globalAlpha = 1;
      // counts where bundled lines meet their neighbourhood
      if (ip >= 1) badges.forEach(function (B) {
        var t = String(B.n);
        c.font = '600 11px ' + MONO; var bw = c.measureText(t).width + 12;
        c.fillStyle = B.kind === 'out' ? OUT : B.kind === 'in' ? IN : INK;
        c.beginPath(); c.roundRect ? c.roundRect(B.tx - bw / 2, B.ty - 9, bw, 18, 9) : c.rect(B.tx - bw / 2, B.ty - 9, bw, 18); c.fill();
        c.fillStyle = PAPER; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, B.tx, B.ty + 0.5); c.textBaseline = 'alphabetic';
      });
    }

    // focus ring + hover ring
    if (focus >= 0) this._ring(focus, INK, 3.5);
    if (hover >= 0 && hover !== focus) this._ring(hover, INK, 2.5);

    // labels: focused book, its neighbours (by connections), then hubs/regions with whatever room is left
    c.textBaseline = 'alphabetic';
    var labelNode = function (self2, i2, size, weight, color, bg, pad) {
      var tl = self2.o.title(self2.keys[i2]); if (!tl) return;
      if (tl.length > 34) tl = tl.slice(0, 32) + '…';
      c.font = 'italic ' + weight + ' ' + size + 'px ' + SERIF;
      var tw = c.measureText(tl).width, x0 = self2.sx(self2._x(i2)), y0 = self2.sy(self2._y(i2)) - self2._r(i2) - 5;
      if (x0 < -40 || x0 > W + 40 || y0 < -10 || y0 > H + 20) return;
      pad = pad || 0;   // keep-clear margin, so titles don't pack into a wall
      if (!tryPlace(x0 - tw / 2 - 4 - pad, y0 - size - pad * 0.6, tw + 8 + pad * 2, size + 5 + pad * 1.2)) return;
      c.fillStyle = bg; c.fillRect(x0 - tw / 2 - 3, y0 - size + 1, tw + 6, size + 3);
      c.fillStyle = color; c.textAlign = 'center'; c.fillText(tl, x0, y0);
    };
    if (this.mini) {
      if (focus >= 0 && W >= 180) labelNode(this, focus, 12, 700, INK, 'rgba(247,245,240,0.9)');   // thumbnails stay unlabelled
      return;
    }
    if (focus >= 0) {
      labelNode(this, focus, 19, 700, INK, 'rgba(247,245,240,0.92)');
      if (ip > 0.6) {
        var list = [];
        for (var q in nb) list.push(+q);
        var dg = this.deg;
        list.sort(function (a, b) { return (b === hover) - (a === hover) || dg[b] - dg[a]; });
        if (list.length > 40) list = list.slice(0, 30);   // big hubs: the 30 best-connected (hovered first)
        for (var li = 0; li < list.length; li++) {
          var kk = nb[list[li]];
          labelNode(this, list[li], list[li] === hover ? 15 : 12.5, 600, kk === 'out' ? OUT : kk === 'in' ? IN : INK, 'rgba(247,245,240,0.88)');
        }
      }
    } else if (hover >= 0) {
      labelNode(this, hover, 16, 700, INK, 'rgba(247,245,240,0.92)');
    }
    // region names (zoomed out) — big regions first
    c.textAlign = 'center';
    for (r = 0; this.showRegions && r < this.regions.length; r++) {
      R = this.regions[r];
      if (!R.name) continue;
      sr = R.r * k;
      var cont = !this.regionCircles;
      if (sr < 34 || (focus >= 0 && !cont)) continue;
      sx = this.sx(this._wrap(R.lx != null ? R.lx : R.x)); sy = R.ly != null ? this.sy(this._wrapY(R.ly)) - 9 : this.sy(this._wrapY(R.y)) - sr - 6;
      if (sx < -100 || sx > W + 100 || sy < 0 || sy > H + 20) continue;
      var fs = this.dust ? Math.max(17, Math.min(30, sr / 4.5)) : Math.max(13, Math.min(22, sr / 7));
      // starfield: genre names fade out once zoomed in (titles take over)
      var zf = this.dust ? k / ((this.minK || 0.05) * 1.25) : 1, nameA = zf < 2 ? 1 : Math.max(0, 1 - (zf - 2) * 1.2);
      if (nameA < 0.05) continue;
      c.font = fs + 'px ' + SERIF;
      var nm = R.name.replace(/^Around /, ''), tw2 = c.measureText(nm).width;   // the panel keeps "Around …"; the map just names the hub
      if (!tryPlace(sx - tw2 / 2 - 4, sy - fs, tw2 + 8, fs + 6)) continue;
      c.globalAlpha = (cont && focus >= 0 ? 0.55 : this.dust ? 0.9 : 1) * nameA;
      if (!cont) { c.fillStyle = 'rgba(247,245,240,0.85)'; c.fillRect(sx - tw2 / 2 - 4, sy - fs + 1, tw2 + 8, fs + 4); }
      if (cont) { c.lineJoin = 'round'; c.lineWidth = this.dust ? 5 : 4; c.strokeStyle = 'rgba(247,245,240,0.9)'; c.strokeText(nm, sx, sy); }
      c.fillStyle = this.o.regionColor ? this.o.regionColor(R) : INK; c.fillText(nm, sx, sy);
      c.globalAlpha = 1;
      if (sr > 120) {
        c.font = '10px ' + MONO; c.fillStyle = 'rgba(20,20,20,0.55)';
        var au = (R.authors || []).join(' · '); var aw = c.measureText(au).width;
        if (au && tryPlace(sx - aw / 2, sy + 4, aw, 12)) c.fillText(au, sx, sy + 14);
      }
    }
    // hub titles once zoomed in enough to read them
    if (focus < 0 && (k > 0.55 || this.o.labelTop)) {
      var budget = k > 1.6 ? 120 : k > 1 ? 60 : k > 0.55 ? Math.max(24, this.o.labelTop || 0) : this.o.labelTop, shown = 0;
      for (var oi = 0; oi < this.order.length && shown < budget; oi++) {
        var ni = this.order[oi];
        if (this.deg[ni] < 3 && k < 1.6 && !this.o.labelTop) break;
        var before = placed.length;
        labelNode(this, ni, k > 1.6 ? 13 : 12, 600, 'rgba(20,20,20,0.82)', 'rgba(247,245,240,0.85)', this.dust ? 24 : 0);
        if (placed.length > before) shown++;
      }
    }
  };
  // guide rings (spiral) or a chart frame (fame), in world coordinates; text stays screen-sized
  P._guides = function (c, k, placed) {
    var keep = function (x, y, w, h) { if (placed) placed.push([x, y, w, h]); };   // titles then avoid these
    var G = this.o.guides, self = this, ox = this.sx(0), oy = this.sy(0);
    c.save();
    c.font = '10.5px ' + MONO; c.fillStyle = 'rgba(20,20,20,0.5)'; c.strokeStyle = 'rgba(20,20,20,0.16)'; c.lineWidth = 1;
    if (G.rings) G.rings.forEach(function (R) {
      var r = R.r * k;
      c.setLineDash([3, 6]); c.beginPath(); c.arc(ox, oy, r, 0, 6.2832); c.stroke(); c.setLineDash([]);
      if (r > 30) { c.textAlign = 'center'; c.fillStyle = 'rgba(247,245,240,0.9)'; var tw = c.measureText(R.t).width; c.fillRect(ox - tw / 2 - 4, oy - r - 8, tw + 8, 15); c.fillStyle = 'rgba(20,20,20,0.55)'; c.fillText(R.t, ox, oy - r + 3); }
    });
    var A = G.axes;
    if (A) {
      var X = function (x) { return self.sx(x); }, Y = function (y) { return self.sy(y); };
      c.strokeStyle = 'rgba(20,20,20,0.45)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(X(A.x0), Y(A.y0)); c.lineTo(X(A.x1), Y(A.y0)); c.moveTo(X(A.x0), Y(A.y0)); c.lineTo(X(A.x0), Y(A.y1)); c.stroke();
      if (A.grid) {   // binned chart: solid lines between the bins
        c.strokeStyle = 'rgba(20,20,20,0.17)'; c.lineWidth = 1;
        A.bx.forEach(function (x) { c.beginPath(); c.moveTo(X(x), Y(A.y0)); c.lineTo(X(x), Y(A.y1)); c.stroke(); });
        A.by.forEach(function (y) { c.beginPath(); c.moveTo(X(A.x0), Y(y)); c.lineTo(X(A.x1), Y(y)); c.stroke(); });
      } else {
        c.strokeStyle = 'rgba(20,20,20,0.08)'; c.lineWidth = 1; c.setLineDash([3, 6]);
        A.tx.forEach(function (t) { c.beginPath(); c.moveTo(X(t.x), Y(A.y0)); c.lineTo(X(t.x), Y(A.y1)); c.stroke(); });
        A.ty.forEach(function (t) { c.beginPath(); c.moveTo(X(A.x0), Y(t.y)); c.lineTo(X(A.x1), Y(t.y)); c.stroke(); });
        c.setLineDash([]);
      }
      c.fillStyle = 'rgba(20,20,20,0.6)';
      // tick labels, skipping any that would collide with the previous one (narrow screens)
      var lastR = -1e9;
      c.textAlign = 'center'; A.tx.forEach(function (t) { var w = c.measureText(t.t).width, x = X(t.x); if (x - w / 2 < lastR + 6) return; c.fillText(t.t, x, Y(A.y0) + 16); keep(x - w / 2, Y(A.y0) + 6, w, 13); lastR = x + w / 2; });
      var lastY = 1e9;
      c.textAlign = 'right'; A.ty.forEach(function (t) { var y = Y(t.y), w = c.measureText(t.t).width; if (y > lastY - 13) return; c.fillText(t.t, X(A.x0) - 8, y + 4); keep(X(A.x0) - 8 - w, y - 7, w + 8, 14); lastY = y; });
      c.font = '11.5px ' + MONO; c.fillStyle = INK;
      c.textAlign = 'right'; c.fillText(A.xt, X(A.x1), Y(A.y0) + 34);
      // y-axis title runs up the axis, clear of the corner captions
      c.save(); c.translate(X(A.x0) - (A.grid ? (this.W < 600 ? 44 : 52) : 34), (Y(A.y0) + Y(A.y1)) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText(A.yt, 0, 0); c.restore();
      var small = this.W < 600, L = X(A.x0), Rr = X(A.x1), T = Y(A.y1), B = Y(A.y0);
      (A.caps || []).forEach(function (q) {
        var x, y, al;
        if (q.c) { al = q.c[1] === 'l' ? 'left' : 'right'; x = al === 'left' ? L : Rr; y = q.c[0] === 't' ? T - (small ? 30 : 26) : B + (small ? 60 : 64); }
        else { al = 'left'; x = X(q.x); y = Y(q.y); }
        c.textAlign = al;
        c.font = (small ? 14 : 22) + 'px ' + SERIF; c.fillStyle = 'rgba(20,20,20,0.55)'; c.fillText(q.t, x, y);
        var cw = c.measureText(q.t).width, fs = small ? 14 : 22; keep(al === 'left' ? x : x - cw, y - fs, cw, fs + (small ? 4 : 18));
        if (!small) { c.font = '10px ' + MONO; c.fillStyle = 'rgba(20,20,20,0.45)'; c.fillText(q.s, x, y + 15); }
      });
    }
    c.restore();
  };
  P._ring = function (i, col, pad) {
    var c = this.ctx;
    c.beginPath(); c.arc(this.sx(this._x(i)), this.sy(this._y(i)), this._r(i) + pad, 0, 6.2832);
    c.globalAlpha = 1;
    if (this.mini) { c.lineWidth = 4.5; c.strokeStyle = PAPER; c.stroke(); }   // thumbnails: a paper halo keeps the ring clear of the lines
    c.lineWidth = 1.8; c.strokeStyle = col; c.stroke();
  };
  P._nbOf = function (i) {
    if (this._nbCache && this._nbCache.i === i) return this._nbCache.set;
    var n = this.o.neighbors(this.keys[i]), self = this, set = {};
    n.out.forEach(function (k) { var j = self.idx[k]; if (j != null) set[j] = set[j] ? 'both' : 'out'; });
    n.in.forEach(function (k) { var j = self.idx[k]; if (j != null) set[j] = set[j] === 'out' ? 'both' : 'in'; });
    this._nbCache = { i: i, set: set };
    return set;
  };

  // ---- input -----------------------------------------------------------------------------
  // One light loop for ambient motion: flowing focus lines (~30fps) and twinkle (~15fps). It only
  // runs while the canvas is on screen, the tab is visible and motion is allowed.
  // Cursor gravity (from the classic constellation): each star near the mouse sits on a damped
  // spring pulled toward the pointer inside a smooth well (zero force at the rim and at the cursor),
  // then settles back with a little overshoot. Simulated in screen px, only for stars in the well
  // or still settling. Off while dragging, with a book selected, on touch, and under reduced motion.
  P._gravStep = function (dt) {
    var R = 150, KS = 90, KD = 14, KC = 30, k = this.cam.k, act = this._gAct, self = this;
    var cur = this._cur && this.focus < 0 && !this._dragging ? this._cur : null;
    if (cur) {   // add the stars inside the well (all wrapped copies of the cursor's world spot)
      var wx = (cur[0] - this.W / 2) / k + this.cam.x, wy = (cur[1] - this.H / 2) / k + this.cam.y, rad = R / k + 2, c = this.cell;
      var xs = this.P ? [-1, 0, 1].map(function (n) { return wx - self.P * Math.round(wx / self.P) + n * self.P; }) : [wx];
      var ys = this.PY ? [-1, 0, 1].map(function (n) { return wy - self.PY * Math.round(wy / self.PY) + n * self.PY; }) : [wy];
      xs.forEach(function (cx) { ys.forEach(function (cy) {
        for (var gx = Math.floor((cx - rad) / c); gx <= Math.floor((cx + rad) / c); gx++)
          for (var gy = Math.floor((cy - rad) / c); gy <= Math.floor((cy + rad) / c); gy++) {
            var list = self.grid[gx + ',' + gy]; if (list) for (var j = 0; j < list.length; j++) act.add(list[j]);
          }
      }); });
    }
    var ox = this.ox, oy = this.oy, vx = this.gvx, vy = this.gvy;
    act.forEach(function (i) {
      var px = ox[i], py = oy[i], pvx = vx[i], pvy = vy[i];
      var ax = -KS * px - KD * pvx, ay = -KS * py - KD * pvy, inWell = false;
      if (cur) {
        var bx = self.sx(self._wrap(self.wx[i])) + px, by = self.sy(self._wrapY(self.wy[i])) + py;
        var dx = cur[0] - bx, dy = cur[1] - by, d = Math.hypot(dx, dy);
        if (d < R) { var fall = 1 - d / R; ax += dx * KC * fall; ay += dy * KC * fall; inWell = true; }
      }
      pvx += ax * dt; pvy += ay * dt; px += pvx * dt; py += pvy * dt;
      if (!inWell && px * px + py * py < 0.01 && pvx * pvx + pvy * pvy < 0.01) { px = py = pvx = pvy = 0; act.delete(i); }
      ox[i] = px; oy[i] = py; vx[i] = pvx; vy[i] = pvy;
    });
    return act.size > 0 || !!cur;
  };
  P._startTick = function () {
    if (this.reduced || (!this.o.flow && !this.o.twinkle && !this.grav)) return;
    var self = this, last = 0;
    this._vis = true;
    if (typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(function (es) { self._vis = es[0].isIntersecting; });
      this._io.observe(this.canvas);
    }
    var lastG = 0;
    var tick = function (t) {
      self._tk = requestAnimationFrame(tick);
      if (!self._vis || document.hidden) return;
      if (self.grav && (self._cur || self._gAct.size)) {   // gravity runs at full frame rate while active
        var dt = lastG ? Math.min(0.048, (t - lastG) / 1000) : 0.016; lastG = t;
        self._gravStep(dt); self._draw(); last = t;
        return;
      }
      lastG = 0;
      var flowing = self.o.flow && !self.mini && self.W >= 600 && self.focus >= 0;   // phones draw plain lines: nothing to animate
      var every = flowing ? 33 : self.o.twinkle && !self.mini ? 66 : 0;
      if (!every || t - last < every) return;
      last = t;
      self._draw();
    };
    this._tk = requestAnimationFrame(tick);
  };

  P._bind = function () {
    var self = this, cv = this.canvas, pts = {}, down = null;
    if (this.mini) {
      cv.style.cursor = 'pointer';
      this._onClickMini = function () { if (self.o.onClick) self.o.onClick(); };
      cv.addEventListener('click', this._onClickMini);
      this._onKey = function () {};
      window.addEventListener('keydown', this._onKey);
      return;
    }
    cv.style.touchAction = 'none';
    var local = function (e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    this._onWheel = function (e) {
      e.preventDefault();
      if (self.P && self.PY && !e.ctrlKey && !e.metaKey) {   // wrapped surface: scrolling travels (pinch / ⌘-scroll zooms)
        var u = (e.deltaMode === 1 ? 16 : 1) / self.cam.k;
        self.cam.x += e.deltaX * u; self.cam.y += e.deltaY * u;
        self.draw();
        return;
      }
      var p = local(e);
      // trackpad pinch arrives as ctrl+wheel with small deltas: give it a little more reach
      var zr = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.0032 : 0.0018;
      self.zoomBy(Math.exp(-e.deltaY * zr), p[0], p[1]);
    };
    this._onDown = function (e) {
      cv.setPointerCapture(e.pointerId);
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (ids.length === 1) down = { p: local(e), cam: { x: self.cam.x, y: self.cam.y }, t: performance.now(), moved: false, touch: e.pointerType !== 'mouse' };
      else { down = null; self._pinch = { d: self._pd(pts), k: self.cam.k }; }
    };
    this._onMove = function (e) {
      var p = local(e);
      if (pts[e.pointerId]) pts[e.pointerId] = p;
      var ids = Object.keys(pts);
      if (ids.length >= 2 && self._pinch) {
        var a = pts[ids[0]], b = pts[ids[1]];
        self.zoomBy(self._pinch.k * self._pd(pts) / self._pinch.d / self.cam.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
      if (down) {
        var dx = p[0] - down.p[0], dy = p[1] - down.p[1];
        if (Math.abs(dx) + Math.abs(dy) > 5) down.moved = true;
        if (down.moved) { self._dragging = true; self.cam.x = down.cam.x - dx / self.cam.k; self.cam.y = down.cam.y - dy / self.cam.k; self.host.setAttribute('data-drag', '1'); self.draw(); }
        return;
      }
      if (e.pointerType === 'mouse') {
        if (self.grav) self._cur = p;
        var hv = self.pick(p[0], p[1], 4);
        if (hv !== self.hover) {
          self.hover = hv; cv.style.cursor = hv >= 0 ? 'pointer' : 'grab';
          if (self.o.onHover) self.o.onHover(hv >= 0 ? self.keys[hv] : null);
          self.draw();
        }
      }
    };
    this._onUp = function (e) {
      self._dragging = false;
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) self._pinch = null;
      self.host.removeAttribute('data-drag');
      if (!down) return;
      var d = down; down = null;
      if (d.moved || performance.now() - d.t > 600) return;
      var p = local(e), ri = self.showRegions && self.o.regionZoom !== false ? self.regionAt(p[0], p[1]) : -1;
      // Overview: while a neighbourhood is still small on screen, a click inside it zooms into it —
      // only a direct hit on a dot (no slop) selects a book. Zoomed in, normal forgiving picking.
      var small = ri >= 0 && self.focus < 0 && self.regions[ri].r * self.cam.k < Math.min(self.W, self.H) * 0.3;
      var hit = self.pick(p[0], p[1], small ? 0 : d.touch ? 16 : 5);
      if (hit >= 0) { self.o.onFocus(self.keys[hit]); return; }
      if (self.focus >= 0) { self.o.onFocus(null); return; }   // empty space steps back out of a focus
      if (small) self.flyToRegion(ri);
    };
    this._onLeave = function () { self._cur = null; if (self.hover >= 0) { self.hover = -1; if (self.o.onHover) self.o.onHover(null); self.draw(); } };
    this._onKey = function (e) {
      if (e.key === 'Escape' && self.focus >= 0) self.o.onFocus(null);
    };
    cv.addEventListener('wheel', this._onWheel, { passive: false });
    cv.addEventListener('pointerdown', this._onDown);
    cv.addEventListener('pointermove', this._onMove);
    cv.addEventListener('pointerup', this._onUp);
    cv.addEventListener('pointercancel', this._onUp);
    cv.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('keydown', this._onKey);
  };
  P._pd = function (pts) { var ids = Object.keys(pts), a = pts[ids[0]], b = pts[ids[1]]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; };

  P.destroy = function () {
    cancelAnimationFrame(this._raf); cancelAnimationFrame(this._tw); cancelAnimationFrame(this._ai); cancelAnimationFrame(this._tk);
    if (this._io) this._io.disconnect();
    if (this.ro) this.ro.disconnect();
    window.removeEventListener('keydown', this._onKey);
    this.host.textContent = '';
  };

  window.BJAtlas = Atlas;
})();
