/*
 * BookJumpr — network "lab" views (?v=lab): Canon, Timeline and Fame.
 *
 * Most of the 4,910 books are one-off name-drops (71% have a single link); only ~200 are mentioned
 * often. These views lead with those: the ~200 most-mentioned books plus the ~40 biggest
 * name-droppers, drawn as covers, each laid out a different way so we can compare:
 *   Canon     soft genre neighbourhoods (a small force layout: genre pull + springs along links)
 *   Timeline  x = year (a warped scale), y = genre lanes; arcs reach back to the books mentioned
 *   Fame      x = how often it's mentioned, y = how many it mentions (log scales)
 * The genre star map stays available as "Stars". Selecting a book highlights its links and shows
 * the map card; "Open →" morphs its cover into the book page (the app's cover View Transition).
 * A selected book outside the set is pinned in as "you are here".
 *
 * Loaded lazily with explorer.js; extends the BookJumpr prototype (window.__BJ.P).
 */
(function () {
  'use strict';
  var BJ = window.__BJ;
  if (!BJ) return;
  var P = BJ.P, h = BJ.h, React = window.React;
  var VIEWS = [['canon', 'Canon'], ['timeline', 'Timeline'], ['fame', 'Fame'], ['stars', 'Stars']];

  // ---- a small CSS-transform pan/zoom stage ---------------------------------------------------
  function Stage(host, o) {
    this.host = host; this.layer = host.firstChild; this.o = o || {};
    this.W0 = o.W0; this.H0 = o.H0; this.cam = { x: 0, y: 0, k: 1 };
    this.reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var self = this, pts = {}, down = null, pinch = null;
    var local = function (e) { var r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    this._wheel = function (e) { e.preventDefault(); var p = local(e); self.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), p[0], p[1]); };
    this._down = function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (ids.length === 1) down = { p: local(e), cam: { x: self.cam.x, y: self.cam.y }, moved: false };
      else { down = null; var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k: self.cam.k }; }
    };
    this._move = function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = local(e);
      var ids = Object.keys(pts);
      if (ids.length >= 2 && pinch) {
        var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        self.zoomAt(pinch.k * d / pinch.d / self.cam.k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
      if (!down) return;
      var p = local(e), dx = p[0] - down.p[0], dy = p[1] - down.p[1];
      if (!down.moved && Math.abs(dx) + Math.abs(dy) > 6) { down.moved = true; host.setPointerCapture(e.pointerId); host.classList.add('dragging'); }
      if (down.moved) { self.cam.x = down.cam.x - dx / self.cam.k; self.cam.y = down.cam.y - dy / self.cam.k; self.apply(); }
    };
    this._up = function (e) {
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
      host.classList.remove('dragging');
      if (down && down.moved) { self._suppress = true; setTimeout(function () { self._suppress = false; }, 0); }
      down = null;
    };
    // a drag must not count as a click on whatever it started over
    this._click = function (e) { if (self._suppress) { e.stopPropagation(); e.preventDefault(); } };
    host.addEventListener('wheel', this._wheel, { passive: false });
    host.addEventListener('pointerdown', this._down);
    host.addEventListener('pointermove', this._move);
    host.addEventListener('pointerup', this._up);
    host.addEventListener('pointercancel', this._up);
    host.addEventListener('click', this._click, true);
    host.style.touchAction = 'none';
    this.fit(false);
  }
  Stage.prototype.size = function () {
    var r = this.host.getBoundingClientRect(), top = this.o.top ? this.o.top() : 0;
    return { w: Math.max(1, r.width), h: Math.max(1, r.height - top - (this.o.inset ? this.o.inset() : 0)), top: top };
  };
  Stage.prototype.minK = function () { var s = this.size(); return Math.min(s.w / this.W0, s.h / this.H0) * 0.5; };
  Stage.prototype.apply = function () {
    var s = this.size(), c = this.cam;
    this.layer.style.transform = 'translate(' + (s.w / 2 - c.x * c.k).toFixed(1) + 'px,' + (s.top + s.h / 2 - c.y * c.k).toFixed(1) + 'px) scale(' + c.k.toFixed(4) + ')';
    this.layer.style.setProperty('--k', c.k.toFixed(4));
    if (this.o.onZoom) this.o.onZoom(c.k);
  };
  Stage.prototype.fitK = function () {
    var s = this.size();
    return this.o.fitHeight ? s.h * 0.94 / this.H0 : Math.min(s.w / this.W0, s.h / this.H0) * 0.94;
  };
  Stage.prototype.fit = function (anim) {
    var k = this.fitK(), s = this.size();
    // fit-height views (the timeline) start at their left edge
    var x = this.o.fitHeight ? Math.min(this.W0 / 2, s.w / 2 / k) : this.W0 / 2;
    this.flyTo(x, this.H0 / 2, k, anim);
  };
  Stage.prototype.zoomAt = function (f, mx, my) {
    var s = this.size(), c = this.cam;
    my -= s.top;
    var wx = (mx - s.w / 2) / c.k + c.x, wy = (my - s.h / 2) / c.k + c.y;
    var k = Math.max(this.minK(), Math.min(4, c.k * f));
    this.cam = { k: k, x: wx - (mx - s.w / 2) / k, y: wy - (my - s.h / 2) / k };
    this.apply();
  };
  Stage.prototype.flyTo = function (x, y, k, anim) {
    var self = this, from = { x: this.cam.x, y: this.cam.y, k: this.cam.k };
    k = Math.max(this.minK(), Math.min(4, k));
    cancelAnimationFrame(this._tw);
    if (anim === false || this.reduced) { this.cam = { x: x, y: y, k: k }; this.apply(); return; }
    var t0 = performance.now(), dur = 520;
    var step = function (t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      self.cam = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e, k: Math.exp(Math.log(from.k) + (Math.log(k) - Math.log(from.k)) * e) };
      self.apply();
      if (p < 1) self._tw = requestAnimationFrame(step);
    };
    this._tw = requestAnimationFrame(step);
  };
  // Is world point (x, y) comfortably on screen?
  Stage.prototype.sees = function (x, y) {
    var s = this.size(), c = this.cam, sx = (x - c.x) * c.k + s.w / 2, sy = (y - c.y) * c.k + s.h / 2;
    return sx > 40 && sx < s.w - 40 && sy > 30 && sy < s.h - 30;
  };
  Stage.prototype.destroy = function () {
    cancelAnimationFrame(this._tw);
    var host = this.host;
    host.removeEventListener('wheel', this._wheel); host.removeEventListener('pointerdown', this._down);
    host.removeEventListener('pointermove', this._move); host.removeEventListener('pointerup', this._up);
    host.removeEventListener('pointercancel', this._up); host.removeEventListener('click', this._click, true);
  };

  // ---- the set: what's popular ------------------------------------------------------------------
  P._labSet = function () {
    if (this._labIds) return this._labIds;
    var self = this, all = this.all.filter(function (b) { return self._homeOk(b.id) && b.in.length + b.out.length > 0; });
    var byIn = all.slice().sort(function (a, b) { return b.in.length - a.in.length || b.out.length - a.out.length; }).slice(0, 200);
    var seen = {}; byIn.forEach(function (b) { seen[b.id] = 1; });
    var byOut = all.filter(function (b) { return !seen[b.id]; }).sort(function (a, b) { return b.out.length - a.out.length; }).slice(0, 40);
    this._labIds = byIn.concat(byOut).map(function (b) { return b.id; });
    return this._labIds;
  };
  P._labView = function () {
    var v = this.state.xView;
    if (!v) { try { v = sessionStorage.getItem('bj-view'); } catch (e) {} }
    return v === 'timeline' || v === 'fame' || v === 'stars' ? v : 'canon';
  };
  P.labSetView = function (v) {
    try { sessionStorage.setItem('bj-view', v); } catch (e) {}
    this.setState({ xView: v });
  };

  var mulberry = function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

  // Pushes overlapping boxes apart (n×n; n ≈ 240). `pull` keeps each near its target spot.
  var relax = function (nodes, iters, pad, pull) {
    for (var it = 0; it < iters; it++) {
      var moved = 0;
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j];
          var ox = (a.w + b.w) / 2 + pad - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + pad - Math.abs(a.y - b.y);
          if (ox <= 0 || oy <= 0) continue;
          moved++;
          if (ox < oy) { var sx = (a.x < b.x ? -1 : 1) * ox / 2; a.x += sx; b.x -= sx; }
          else { var sy = (a.y < b.y ? -1 : 1) * oy / 2; a.y += sy; b.y -= sy; }
        }
      }
      if (pull) for (i = 0; i < nodes.length; i++) { var n = nodes[i]; if (n.tx != null) { n.x += (n.tx - n.x) * pull; n.y += (n.ty - n.y) * pull; } }
      if (!moved) break;
    }
  };

  // ---- layouts (world px), cached per view + pinned extra book ------------------------------------
  P._labLayout = function (view, extra) {
    var key = view + '|' + (extra || '');
    this._labCache = this._labCache || {};
    if (this._labCache[key]) return this._labCache[key];
    var self = this, books = this.books, ids = this._labSet().slice();
    if (extra && ids.indexOf(extra) === -1) ids.push(extra);
    var inSet = {}; ids.forEach(function (id) { inSet[id] = 1; });
    var maxIn = 1, maxDeg = 1;
    ids.forEach(function (id) { maxIn = Math.max(maxIn, books[id].in.length); maxDeg = Math.max(maxDeg, books[id].in.length + books[id].out.length); });
    var gName = function (id) { var g = self.genreOf(books[id]).name; return g === 'MISC' ? 'OTHER' : g; };
    var L = view === 'timeline' ? this._labTimeline(ids, gName, maxDeg) : view === 'fame' ? this._labFame(ids, maxDeg) : this._labCanon(ids, gName, inSet, maxIn);
    L.inSet = inSet; L.extra = extra && L.byId[extra] ? extra : null;
    this._labCache[key] = L;
    return L;
  };

  var GOLDEN = Math.PI * (3 - Math.sqrt(5));
  // genres with only a handful of famous books share an "Other" group
  var groupBy = function (ids, gName, min) {
    var g = {}, out = {};
    ids.forEach(function (id) { (g[gName(id)] || (g[gName(id)] = [])).push(id); });
    Object.keys(g).forEach(function (k) { var key = g[k].length < min ? 'OTHER' : k; (out[key] || (out[key] = [])).push.apply(out[key] || (out[key] = []), g[k]); });
    return out;
  };
  // Canon: one round island per genre (the most mentioned in the middle), islands packed together,
  // genres that mention each other placed next to each other.
  P._labCanon = function (ids, gName, inSet, maxIn) {
    var books = this.books, nodes = [], byId = {}, groups = groupBy(ids, gName, 5);
    var gOf = {}; Object.keys(groups).forEach(function (g) { groups[g].forEach(function (id) { gOf[id] = g; }); });
    var islands = Object.keys(groups).map(function (g) {
      var list = groups[g].slice().sort(function (a, b) { return books[b].in.length - books[a].in.length; }), area = 0, ns = [];
      list.forEach(function (id, j) {
        var w = Math.round(28 + 50 * Math.sqrt(books[id].in.length / maxIn)), hh = w * 1.5 + 18;
        area += (w + 10) * (hh + 6);
        var r = j ? Math.sqrt(area / Math.PI) * 0.92 : 0, th = j * GOLDEN;
        var n = { id: id, w: w, h: hh, x: Math.cos(th) * r * 1.15, y: Math.sin(th) * r, tx: Math.cos(th) * r * 1.15, ty: Math.sin(th) * r, g: g };
        ns.push(n); nodes.push(n); byId[id] = n;
      });
      relax(ns, 300, 6, 0.01);
      var R = 0; ns.forEach(function (n) { R = Math.max(R, Math.hypot(n.x, n.y) + Math.hypot(n.w, n.h) / 2); });
      return { g: g, ns: ns, R: R + 12 };
    });
    // order islands so neighbours share links, then place them on a spiral without overlaps
    var link = function (A, B) { var n = 0; A.ns.forEach(function (m) { books[m.id].out.concat(books[m.id].in).forEach(function (x) { if (gOf[x] === B.g) n++; }); }); return n; };
    islands.sort(function (a, b) { return b.ns.length - a.ns.length; });
    var order = [islands.shift()];
    while (islands.length) { var last = order[order.length - 1], bi = 0, bv = -1; islands.forEach(function (I, i) { var v = link(last, I) + link(order[0], I) * 0.5 + I.ns.length * 0.01; if (v > bv) { bv = v; bi = i; } }); order.push(islands.splice(bi, 1)[0]); }
    var placed = [];
    order.forEach(function (I) {
      var cx = 0, cy = 0;
      if (placed.length) {
        for (var t = 0; t < 4000; t++) {
          var th = t * 0.12, r = 6 * th;
          cx = Math.cos(th) * r * 1.5; cy = Math.sin(th) * r;
          if (placed.every(function (P2) { return Math.hypot((P2.cx - cx) / 1.0, P2.cy - cy) >= P2.R + I.R + 26; })) break;
        }
      }
      I.cx = cx; I.cy = cy; placed.push(I);
      I.ns.forEach(function (n) { n.x += cx; n.y += cy; });
    });
    var lbls = order.map(function (I) {
      var top = 1e9; I.ns.forEach(function (n) { top = Math.min(top, n.y - n.h / 2); });
      return { g: I.g, x: I.cx, y: top - 12, n: I.ns.length };
    });
    return this._labFrame(nodes, byId, { labels: lbls });
  };

  // years on a warped scale: the 1800s–2000s get room, antiquity is compressed
  var YB = [-800, 1, 1400, 1600, 1750, 1850, 1900, 1950, 2000, 2030], YP = [0, 0.07, 0.15, 0.24, 0.35, 0.5, 0.63, 0.77, 0.91, 1];
  var yearX = function (y, W) {
    if (y <= YB[0]) return 0;
    for (var i = 1; i < YB.length; i++) if (y <= YB[i]) return W * (YP[i - 1] + (YP[i] - YP[i - 1]) * (y - YB[i - 1]) / (YB[i] - YB[i - 1]));
    return W;
  };
  P._labTimeline = function (ids, gName, maxDeg) {
    var books = this.books, nodes = [], byId = {}, W = 2600, TOP = 50;
    var groups = groupBy(ids, gName, 8), dated = [], undated = [];
    ids.forEach(function (id) { if (books[id].year) dated.push(id); else undated.push(id); });
    var gOf = {}; Object.keys(groups).forEach(function (g) { groups[g].forEach(function (id) { gOf[id] = g; }); });
    var order = Object.keys(groups).sort(function (a, b) { return (b === 'OTHER' ? -1 : 0) - (a === 'OTHER' ? -1 : 0) || groups[b].length - groups[a].length; });
    var deg = function (id) { return books[id].in.length + books[id].out.length; };
    dated.sort(function (a, b) { return deg(b) - deg(a); });
    // stack each lane's books around a centre line (y = 0), most connected nearest the line
    var lanes = {};
    order.forEach(function (g) { lanes[g] = { list: [], lo: 0, hi: 0 }; });
    // nearest free spot around (year, lane centre): spread sideways first, lanes capped in height,
    // so a crowded year (Shakespeare's plays around 1600) fans out along the axis instead of a tower
    var HALF = 120;
    dated.forEach(function (id) {
      var w = Math.round(24 + 32 * Math.sqrt(deg(id) / maxDeg)), hh = w * 1.5 + 16, tx = yearX(books[id].year, W), ln = lanes[gOf[id]], x = tx, y = 0;
      for (var t = 0; t < 4000; t++) {
        var th = t * 0.5, r = t ? 2.2 * Math.sqrt(t) * 3 : 0;
        x = tx + Math.cos(th) * r * 3; y = Math.sin(th) * r;
        if (Math.abs(y) + hh / 2 > HALF) continue;
        var clash = ln.list.some(function (o) { return Math.abs(o.x - x) < (o.w + w) / 2 + 3 && Math.abs(o.y - y) < (o.h + hh) / 2 + 2; });
        if (!clash) break;
      }
      var n = { id: id, w: w, h: hh, x: x, y: y, g: gOf[id] };
      ln.list.push(n); ln.lo = Math.min(ln.lo, y - hh / 2); ln.hi = Math.max(ln.hi, y + hh / 2);
      nodes.push(n); byId[id] = n;
    });
    var yy = TOP, laneOut = [];
    order.forEach(function (g) {
      var ln = lanes[g], top = yy, hgt = Math.max(110, ln.hi - ln.lo + 40), c = top + 20 - ln.lo;
      ln.list.forEach(function (n) { n.y += c; });
      laneOut.push({ g: g, y: top, h: hgt });
      yy += hgt;
    });
    undated.sort(function (a, b) { return deg(b) - deg(a); });
    undated.forEach(function (id, i) {
      var n = { id: id, w: 30, h: 30 * 1.5 + 16, x: W + 120 + (i % 4) * 46, y: TOP + 40 + Math.floor(i / 4) * 66, g: gOf[id] };
      nodes.push(n); byId[id] = n;
    });
    var ticks = [[-800, 'Antiquity'], [1400, '1400'], [1600, '1600'], [1750, '1750'], [1850, '1850'], [1900, '1900'], [1950, '1950'], [2000, '2000']]
      .map(function (t) { return { x: yearX(t[0], W), t: t[1] }; });
    return this._labFrame(nodes, byId, { lanes: laneOut, ticks: ticks, W: W + (undated.length ? 330 : 40), H: Math.max(yy + 20, TOP + 60 + Math.ceil(undated.length / 4) * 66), tray: undated.length ? W + 100 : 0, fixed: true });
  };

  var LOGT = [0, 1, 3, 10, 30, 100, 300];
  P._labFame = function (ids, maxDeg) {
    var books = this.books, nodes = [], byId = {}, W = 1800, H = 1150, BAND = 150;
    var maxIn = 1, maxOut = 1;
    ids.forEach(function (id) { maxIn = Math.max(maxIn, books[id].in.length); maxOut = Math.max(maxOut, books[id].out.length); });
    var y0 = H - BAND - 60;   // the axis; books that mention nothing sit in a band below it
    var sx = function (v) { return 70 + (W - 140) * Math.log(1 + v) / Math.log(1 + maxIn); };
    var sy = function (v) { return y0 - 30 - (y0 - 100) * Math.log(v) / Math.log(maxOut); };   // v >= 1
    ids.forEach(function (id) {
      var b = books[id], d = b.in.length + b.out.length, w = Math.round(18 + 26 * Math.sqrt(d / maxDeg));
      var none = b.out.length === 0;
      var n = { id: id, w: w, h: w * 1.5 + 14, x: sx(b.in.length), y: none ? y0 + BAND / 2 : sy(b.out.length), none: none };
      n.tx = n.x; n.ty = n.y; nodes.push(n); byId[id] = n;
    });
    // greedy: the most connected keep their exact spot; each next book takes the nearest free spot
    // (spiral search, x-stretched) on its own side of the axis
    var placed = [];
    nodes.slice().sort(function (a, b) { return (b.w - a.w) || (a.x - b.x); }).forEach(function (n) {
      var tx = n.x, ty = n.y;
      for (var t = 0; t < 3000; t++) {
        var th = t * 0.5, r = t ? 2.2 * Math.sqrt(t) * 3 : 0;
        var x = tx + Math.cos(th) * r * 1.6, y = ty + Math.sin(th) * r;
        if (n.none ? y - n.h / 2 < y0 + 14 : y + n.h / 2 > y0 - 10) continue;
        var ok = true;
        for (var q = 0; q < placed.length; q++) { var o = placed[q]; if (Math.abs(o.x - x) < (o.w + n.w) / 2 + 3 && Math.abs(o.y - y) < (o.h + n.h) / 2 + 2) { ok = false; break; } }
        if (ok) { n.x = x; n.y = y; break; }
      }
      placed.push(n);
    });
    var lo = 1e9, hi = -1e9;
    nodes.forEach(function (n) { lo = Math.min(lo, n.y - n.h / 2); hi = Math.max(hi, n.y + n.h / 2); });
    var shift = lo < 40 ? 40 - lo : 0;
    if (shift) nodes.forEach(function (n) { n.y += shift; });
    y0 += shift; BAND = Math.max(BAND, hi + shift - y0 + 10); H = y0 + BAND + 70;
    var sy0 = sy; sy = function (v) { return sy0(v) + shift; };
    var tx = LOGT.filter(function (v) { return v <= maxIn * 1.2; }).map(function (v) { return { x: sx(v), t: String(v) }; });
    var ty = LOGT.filter(function (v) { return v >= 1 && v <= maxOut * 1.2; }).map(function (v) { return { y: sy(v), t: String(v) }; });
    return this._labFrame(nodes, byId, { axes: { tx: tx, ty: ty, x0: 70, y0: y0, W: W, H: H, band: BAND }, W: W, H: H, fixed: true });
  };

  // shift everything into a positive world box with a margin
  P._labFrame = function (nodes, byId, extra) {
    var M = 70, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    nodes.forEach(function (n) { x0 = Math.min(x0, n.x - n.w / 2); y0 = Math.min(y0, n.y - n.h / 2); x1 = Math.max(x1, n.x + n.w / 2); y1 = Math.max(y1, n.y + n.h / 2); });
    var L = { nodes: nodes, byId: byId };
    if (extra.fixed) { L.W = extra.W; L.H = extra.H; }
    else {
      var dx = M - x0, dy = M - y0;
      nodes.forEach(function (n) { n.x += dx; n.y += dy; });
      (extra.labels || []).forEach(function (l) { l.x += dx; l.y += dy; });
      L.W = x1 - x0 + 2 * M; L.H = y1 - y0 + 2 * M;
    }
    for (var k in extra) if (k !== 'W' && k !== 'H' && k !== 'fixed') L[k] = extra[k];
    return L;
  };

  // ---- render ---------------------------------------------------------------------------------
  P._labStageRef = function (view, L) {
    var self = this;
    this._labRefs = this._labRefs || {};
    var key = view + '|' + (L.extra || '');
    this._labCurL = L;
    if (this._labRefs[key]) return this._labRefs[key];
    var fn = this._labRefs[key] = function (el) {
      if (self._labStage) { self._labStage.destroy(); self._labStage = null; }
      if (!el) return;
      var S = self._labStage = window.__labStage = new Stage(el, {
        W0: self._labCurL.W, H0: self._labCurL.H,
        top: function () { var b = document.querySelector('.lab .bjx-fbar'), sw = document.querySelector('.lab .lab-switch'), st = el.getBoundingClientRect().top, m = 0;
          [b, sw].forEach(function (x) { if (x) m = Math.max(m, x.getBoundingClientRect().bottom - st); }); return m + 8; },
        inset: function () { var c = window.innerWidth < 760 && document.querySelector('.bjx-fcard'); return c ? c.getBoundingClientRect().height + 20 : 0; },
        onZoom: function (k) { self._labLabels(k); }
      });
      self._labView0 = view;
      var f = self.state.route.focus, n = f && self._labCurL.byId[f], Lc = self._labCurL;
      if (n) S.flyTo(n.x, n.y, Math.max(S.fitK() * 1.8, 0.75), false);
      else if (window.innerWidth < 760) {
        // phones: "fit everything" makes covers specks; start somewhere readable instead
        var at = view === 'canon' && Lc.labels && Lc.labels[0] ? { x: Lc.labels[0].x, y: Lc.labels[0].y + 260 }
          : view === 'timeline' ? { x: Lc.ticks[4].x, y: Math.min(Lc.H / 2, 380) }
          : { x: Lc.W * 0.62, y: Lc.H * 0.62 };
        S.flyTo(at.x, at.y, 0.62, false);
      }
      self._labLabels(S.cam.k);
    };
    return fn;
  };
  // titles: always for the selection, its links and the biggest covers; for the rest once readable
  P._labLabels = function (k) {
    var host = document.querySelector('.lab-layer');
    if (!host) return;
    [].forEach.call(host.querySelectorAll('.lab-n'), function (el) {
      var w = +el.getAttribute('data-w');
      el.classList.toggle('lbl', w * k >= 46 || el.classList.contains('is-sel') || el.classList.contains('is-nb'));
    });
  };
  // keep the selection on screen when it changes from outside (search, zoom-out, back button)
  P._labSync = function () {
    var S = this._labStage, L = this._labCurL;
    if (!S || !L || this.state.route.page !== 'network') return;
    var f = this.state.route.focus || null;
    if (f === this._labLastF) { this._labLabels(S.cam.k); return; }
    this._labLastF = f;
    var n = f && L.byId[f];
    if (n && !S.sees(n.x, n.y)) S.flyTo(n.x, n.y, Math.max(S.cam.k, S.fitK() * 1.4));
    this._labLabels(S.cam.k);
  };

  P.labMap = function (focus) {
    var self = this, st = this.state, books = this.books, view = this._labView();
    var sel = focus && books[focus] ? books[focus] : null;
    var switcher = h('div', { key: 'sw', className: 'lab-switch', role: 'tablist' }, VIEWS.map(function (v) {
      return h('button', { key: v[0], role: 'tab', 'aria-selected': view === v[0] ? 'true' : 'false', className: view === v[0] ? 'on' : '', onClick: function () { self.labSetView(v[0]); } }, v[1]);
    }));
    if (view === 'stars') return h(React.Fragment, null, this.starMap(focus), switcher);

    var L = this._labLayout(view, sel && !this._labSet().some(function (x) { return x === sel.id; }) ? sel.id : null);
    window.__labL = L;
    var hot = st.labHover && L.byId[st.labHover] ? st.labHover : null, foc = sel && L.byId[sel.id] ? sel.id : null;
    var nb = {};
    if (foc) { books[foc].out.forEach(function (x) { nb[x] = nb[x] ? 'both' : 'out'; }); books[foc].in.forEach(function (x) { nb[x] = nb[x] === 'out' ? 'both' : 'in'; }); }
    var kids = [];
    // guides: genre names, timeline lanes + year ticks, fame axes
    if (L.labels) L.labels.forEach(function (l) {
      kids.push(h('div', { key: 'gl' + l.g, className: 'lab-glbl', style: { left: l.x, top: l.y, color: self.xGenreColor(l.g === 'OTHER' ? 'MISC' : l.g) } }, l.g === 'OTHER' ? 'Other' : self.xGenreLabel(l.g)));
    });
    var svg = [];
    if (L.lanes) {
      L.lanes.forEach(function (ln, i) {
        svg.push(h('rect', { key: 'lane' + i, className: 'lab-lane' + (i % 2 ? ' alt' : ''), x: 0, y: ln.y, width: L.W, height: ln.h }));
        kids.push(h('div', { key: 'll' + ln.g, className: 'lab-lane-l', style: { top: ln.y + 8, color: self.xGenreColor(ln.g === 'OTHER' ? 'MISC' : ln.g) } }, ln.g === 'OTHER' ? 'Other' : self.xGenreLabel(ln.g)));
      });
      L.ticks.forEach(function (t, i) {
        svg.push(h('line', { key: 'tk' + i, className: 'lab-tick', x1: t.x, y1: 40, x2: t.x, y2: L.H - 10 }));
        kids.push(h('div', { key: 'tt' + i, className: 'lab-tick-l', style: { left: t.x, top: 18 } }, t.t));
      });
      if (L.tray) kids.push(h('div', { key: 'tray', className: 'lab-tick-l', style: { left: L.tray + 90, top: 18 } }, 'Undated'));
    }
    if (L.axes) {
      var A = L.axes;
      svg.push(h('line', { key: 'ax', className: 'lab-axis', x1: A.x0, y1: A.y0, x2: A.W - 40, y2: A.y0 }));
      svg.push(h('line', { key: 'ay', className: 'lab-axis', x1: A.x0, y1: A.y0, x2: A.x0, y2: 40 }));
      A.tx.forEach(function (t, i) { kids.push(h('div', { key: 'xt' + i, className: 'lab-tick-l', style: { left: t.x, top: A.y0 + A.band + 14 } }, t.t)); });
      A.ty.forEach(function (t, i) { kids.push(h('div', { key: 'yt' + i, className: 'lab-tick-l y', style: { left: A.x0 - 14, top: t.y - 8 } }, t.t)); });
      svg.push(h('rect', { key: 'band', className: 'lab-lane alt', x: A.x0, y: A.y0 + 8, width: A.W - 40 - A.x0, height: A.band }));
      kids.push(h('div', { key: 'bandl', className: 'lab-tick-l y', style: { left: A.x0 - 14, top: A.y0 + A.band / 2 } }, 'none'));
      kids.push(h('div', { key: 'axl', className: 'lab-axis-l x', style: { left: A.W - 40, top: A.y0 + A.band + 22 } }, 'mentioned by more books →'));
      kids.push(h('div', { key: 'ayl', className: 'lab-axis-l y', style: { left: A.x0 + 12, top: 30 } }, '↑ mentions more books'));
      [['The canon', 'mentioned everywhere, mentions little', A.W - 260, A.y0 - 80], ['Name-droppers', 'mention everything', A.x0 + 40, 60], ['Hubs', 'both', A.W - 220, 60], ['Footnotes', 'rarely either', A.x0 + 40, A.y0 - 80]]
        .forEach(function (q, i) { kids.push(h('div', { key: 'q' + i, className: 'lab-quad', style: { left: q[2], top: q[3] } }, h('b', null, q[0]), h('span', null, q[1]))); });
    }
    // links: faint arcs for every link inside the set on the timeline; the selected/hovered book's links on top
    var arc = function (a, b, up) {
      var mx = (a.x + b.x) / 2, dist = Math.abs(a.x - b.x), lift = Math.max(40, dist * 0.32) * (up ? -1 : 1);
      return 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q' + mx.toFixed(1) + ' ' + (Math.min(a.y, b.y) + lift).toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
    };
    var curve = function (a, b) {
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
      return 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q' + (mx - dy * 0.18).toFixed(1) + ' ' + (my + dx * 0.18).toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
    };
    var path = L.lanes ? function (a, b) { return arc(a, b, true); } : curve;
    if (L.lanes && !foc) L.nodes.forEach(function (n) {
      books[n.id].out.forEach(function (x) { var m = L.byId[x]; if (m && m !== n) svg.push(h('path', { key: 'ba' + n.id + '>' + x, className: 'lab-arc', d: path(n, m) })); });
    });
    var drawLinks = function (id, strong) {
      var n = L.byId[id], i = 0;
      books[id].out.forEach(function (x) { var m = L.byId[x]; if (m && m !== n) svg.push(h('g', { key: 'o' + id + x, className: 'lab-eg' + (strong ? '' : ' soft') }, h('path', { className: 'ng-e ' + (books[x].out.indexOf(id) !== -1 ? 'both' : 'out'), d: path(n, m), pathLength: 1, style: { '--i': i++ } }), h('path', { className: 'ng-flow out', d: path(n, m), style: { '--i': i } }))); });
      books[id].in.forEach(function (x) { if (books[id].out.indexOf(x) !== -1) return; var m = L.byId[x]; if (m && m !== n) svg.push(h('g', { key: 'i' + id + x, className: 'lab-eg' + (strong ? '' : ' soft') }, h('path', { className: 'ng-e in', d: path(m, n), pathLength: 1, style: { '--i': i++ } }), h('path', { className: 'ng-flow in', d: path(m, n), style: { '--i': i } }))); });
    };
    if (foc) drawLinks(foc, true);
    if (hot && hot !== foc) drawLinks(hot, false);
    var layerKids = [h('svg', { key: 'svg', className: 'lab-svg', width: L.W, height: L.H, viewBox: '0 0 ' + L.W + ' ' + L.H }, svg)].concat(kids);
    L.nodes.forEach(function (n) {
      var b = books[n.id], isSel = n.id === foc, isNb = !!nb[n.id], outside = (b.in.length + b.out.length) - b.in.concat(b.out).filter(function (x) { return L.inSet[x]; }).length;
      layerKids.push(h('button', { key: n.id, 'data-id': n.id, 'data-w': n.w, title: b.title,
        className: 'lab-n' + (isSel ? ' is-sel' : '') + (isNb ? ' is-nb nb-' + nb[n.id] : '') + (foc && !isSel && !isNb ? ' dim' : '') + (n.id === L.extra ? ' pinned' : '') + (n.id === hot ? ' hot' : ''),
        style: { left: n.x - n.w / 2, top: n.y - n.h / 2, width: n.w },
        onClick: function () { self.mapFocus(isSel ? null : n.id); },
        onMouseEnter: function () { if (self.state.labHover !== n.id) self.setState({ labHover: n.id }); },
        onMouseLeave: function () { if (self.state.labHover === n.id) self.setState({ labHover: null }); } },
        self.cover(b, isSel ? 'vt-hero' : null),
        h('span', { className: 'lab-t' }, b.title),
        (isSel || n.id === hot) && outside > 0 ? h('span', { className: 'lab-badge', title: outside + ' more links to books outside this view (on its page)' }, '+' + outside) : null,
        n.id === L.extra ? h('span', { className: 'lab-here' }, 'you are here') : null));
    });
    var card = sel ? this.mapCard(sel, {
      eyebrow: L.extra === sel.id ? 'Outside the ' + view + ' · pinned' : null,
      open: function (id) { var el = document.querySelector('.lab-n[data-id="' + CSS.escape(id) + '"] .cv-host'); self.goBook(id, el); }
    }) : null;
    var S = function () { return self._labStage; };
    var hint = { canon: 'The ~240 most-mentioned books and biggest name-droppers · size = how often mentioned', timeline: 'Left → right through time · arcs reach back to the books each one mentions', fame: 'Right = mentioned by more books · up = mentions more books' }[view];
    return h('div', { className: 'bjx-full bjx-plus lab lab-' + view },
      h('div', { key: 'stage:' + view + ':' + (L.extra || ''), className: 'lab-stage', ref: this._labStageRef(view, L),
        onClick: function (e) { if (!e.target.closest('.lab-n') && self.state.route.focus) self.mapFocus(null); } },
        h('div', { className: 'lab-layer', style: { width: L.W, height: L.H } }, layerKids)),
      h('div', { className: 'bjx-fbar' },
        this.mapSearch(),
        h('div', { className: 'atlas-zoom' },
          h('button', { onClick: function () { var s = S(); if (s) { var z = s.size(); s.zoomAt(1 / 1.4, z.w / 2, z.h / 2); } }, 'aria-label': 'Zoom out' }, '−'),
          h('button', { onClick: function () { var s = S(); if (s) { var z = s.size(); s.zoomAt(1.4, z.w / 2, z.h / 2); } }, 'aria-label': 'Zoom in' }, '+'),
          h('button', { className: 'fit', onClick: function () { if (S()) S().fit(true); } }, 'Fit'))),
      switcher,
      h('div', { className: 'bjx-fkey' }, sel
        ? [h('span', { key: 'lo' }, h('i', { className: 'ln out' }), 'mentions'), h('span', { key: 'li' }, h('i', { className: 'ln in' }), 'mentioned by'), h('span', { key: 'h', className: 'hint' }, '+N = links to books outside this view')]
        : h('span', { className: 'hint' }, hint)),
      card);
  };

  window.__BJ.labReady = true;
})();
