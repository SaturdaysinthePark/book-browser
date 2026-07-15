/*
 * network-view.js — BookJumpr structural network, canvas engine (framework-agnostic).
 *
 *   new NetworkView(canvas, DATA, { onNavigate(id), tint })
 *
 * DATA = window.BookJumprNetwork (see tools/build-network-data.mjs). Zero dependencies,
 * so the same engine backs the standalone staging page today and the SPA route later.
 *
 * Model: communities are pre-laid-out islands. Neighborhood/mixed islands render their
 * books; fan-out communities render one hub dot that expands its bibliography on click.
 * Connection lines are ON DEMAND — hover a book and only ITS links light up (drawing all
 * ~2,100 at once is the hairball this replaces). Monochrome by default; hover reveals the
 * hovered book + its neighbours in their genre colours.
 */
(function () {
  'use strict';
  var INK = '#141414', PAPER = '#f7f5f0', CARD = '#fdfcfa';

  function NetworkView(canvas, data, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = data;
    this.opts = opts || {};
    this.nodes = data.nodes;
    this.edges = data.edges;         // interior edges (for zoomed base render)
    this.adj = data.adj;             // full per-node adjacency (for hover)
    this.comms = data.communities;
    this.bounds = data.meta.bounds;

    this.cam = { x: 0, y: 0, z: 1 };
    this.target = null;              // {x,y,z} while animating
    this.hover = null;               // node index under cursor
    this.sel = null;                 // pinned node (touch / click-to-hold)
    this.expanded = null;            // { comm, hubNode, spokes:[{...,x,y,idx}] }
    this.dirty = true;
    this.DPR = Math.max(1, window.devicePixelRatio || 1);
    this.VW = 0; this.VH = 0;

    this._makePopover();
    this._bind();
    this.resize();
    this.fit();
    var self = this;
    var start = function () { self.dirty = true; self._loop(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
  }

  var Q = NetworkView.prototype;

  // ---------------------------------------------------------------- camera
  Q.resize = function () {
    this.VW = this.canvas.clientWidth; this.VH = this.canvas.clientHeight;
    this.canvas.width = this.VW * this.DPR; this.canvas.height = this.VH * this.DPR;
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.dirty = true;
  };
  Q.fit = function () {
    var b = this.bounds, w = b.maxX - b.minX, h = b.maxY - b.minY;
    this.cam.z = Math.min(this.VW / (w + 140), this.VH / (h + 180));
    this.cam.x = (b.minX + b.maxX) / 2; this.cam.y = (b.minY + b.maxY) / 2;
    this.dirty = true;
  };
  Q.sx = function (x) { return (x - this.cam.x) * this.cam.z + this.VW / 2; };
  Q.sy = function (y) { return (y - this.cam.y) * this.cam.z + this.VH / 2; };
  Q.wx = function (px) { return (px - this.VW / 2) / this.cam.z + this.cam.x; };
  Q.wy = function (py) { return (py - this.VH / 2) / this.cam.z + this.cam.y; };
  Q.zoomAt = function (px, py, f) {
    var wx = this.wx(px), wy = this.wy(py);
    this.cam.z = Math.max(0.12, Math.min(12, this.cam.z * f));
    this.cam.x = wx - (px - this.VW / 2) / this.cam.z;
    this.cam.y = wy - (py - this.VH / 2) / this.cam.z;
    this.target = null; this.dirty = true;
  };
  Q.zoomBy = function (f) { this.zoomAt(this.VW / 2, this.VH / 2, f); };

  // animate camera to frame a world point at a given zoom (search / goToBook)
  Q.animateTo = function (x, y, z) { this.target = { x: x, y: y, z: z }; this.dirty = true; };

  // ---------------------------------------------------------------- render loop
  Q._loop = function () {
    var self = this;
    var step = function () {
      if (self.target) {
        var t = self.target, c = self.cam, e = 0.16;
        c.x += (t.x - c.x) * e; c.y += (t.y - c.y) * e; c.z += (t.z - c.z) * e;
        if (Math.abs(t.x - c.x) < 0.5 && Math.abs(t.y - c.y) < 0.5 && Math.abs(t.z - c.z) / t.z < 0.005) { c.x = t.x; c.y = t.y; c.z = t.z; self.target = null; }
        self.dirty = true;
      }
      if (self.dirty) { self.dirty = false; self.draw(); }
      self._raf = requestAnimationFrame(step);
    };
    if (!self._raf) self._raf = requestAnimationFrame(step);
  };

  // ---------------------------------------------------------------- draw
  Q.draw = function () {
    var ctx = this.ctx, z = this.cam.z;
    ctx.clearRect(0, 0, this.VW, this.VH);
    var focus = this.hover != null ? this.hover : this.sel;
    var nbr = null;
    if (focus != null) { nbr = new Set([focus]); var a = this.adj[focus] || []; for (var i = 0; i < a.length; i++) nbr.add(a[i]); }
    var focusDim = focus != null || this.expanded != null;

    // island regions (neighbourhood/mixed)
    for (var ci = 0; ci < this.comms.length; ci++) {
      var c = this.comms[ci]; if (c.flavor === 'fan-out') continue;
      var X = this.sx(c.cx), Y = this.sy(c.cy), R = c.r * z;
      if (X + R < 0 || X - R > this.VW || Y + R < 0 || Y - R > this.VH) continue;
      ctx.beginPath(); ctx.arc(X, Y, R, 0, 7);
      ctx.fillStyle = 'rgba(20,20,20,0.032)'; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(20,20,20,0.13)'; ctx.stroke();
    }

    // base interior edges: fade in with zoom (skipped while a focus owns the lines)
    var edgeAlpha = z < 0.9 ? 0 : Math.min(0.15, (z - 0.9) * 0.35);
    if (edgeAlpha > 0 && focus == null && !this.expanded) {
      ctx.strokeStyle = 'rgba(20,20,20,' + edgeAlpha + ')'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var e = 0; e < this.edges.length; e++) {
        var na = this.nodes[this.edges[e][0]], nb = this.nodes[this.edges[e][1]];
        ctx.moveTo(this.sx(na.x), this.sy(na.y)); ctx.lineTo(this.sx(nb.x), this.sy(nb.y));
      }
      ctx.stroke();
    }

    // focus lines — the hovered/selected book's own connections, bold
    if (focus != null) {
      var f = this.nodes[focus], adj = this.adj[focus] || [];
      ctx.strokeStyle = 'rgba(20,20,20,0.7)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (var k = 0; k < adj.length; k++) { var nn = this.nodes[adj[k]]; ctx.moveTo(this.sx(f.x), this.sy(f.y)); ctx.lineTo(this.sx(nn.x), this.sy(nn.y)); }
      ctx.stroke();
    }

    // nodes
    for (var n = 0; n < this.nodes.length; n++) {
      var nd = this.nodes[n], NX = this.sx(nd.x), NY = this.sy(nd.y);
      if (NX < -30 || NX > this.VW + 30 || NY < -30 || NY > this.VH + 30) continue;
      var r = Math.max(nd.hub ? 3.6 : 1.4, nd.r * z * (nd.hub ? 0.85 : 1));
      var lit = nbr ? nbr.has(n) : false;
      ctx.globalAlpha = focusDim && !lit ? 0.14 : 1;
      ctx.beginPath(); ctx.arc(NX, NY, r, 0, 7);
      if (lit) {                        // hover reveals genre colour
        ctx.fillStyle = nd.color; ctx.fill();
        ctx.lineWidth = 1.2; ctx.strokeStyle = INK; ctx.stroke();
      } else if (nd.hub) {
        ctx.fillStyle = INK; ctx.fill();
      } else {
        ctx.fillStyle = CARD; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // expanded fan-out: spokes + rays
    if (this.expanded) this._drawExpanded();

    this._drawLabels(focus, nbr);
    if (this.expanded) this._positionPopover();
  };

  Q._drawExpanded = function () {
    var ctx = this.ctx, ex = this.expanded, hub = this.nodes[ex.hubNode];
    var HX = this.sx(hub.x), HY = this.sy(hub.y);
    ctx.strokeStyle = 'rgba(20,20,20,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i < ex.spokes.length; i++) { var s = ex.spokes[i]; ctx.moveTo(HX, HY); ctx.lineTo(this.sx(s.x), this.sy(s.y)); }
    ctx.stroke();
    for (var j = 0; j < ex.spokes.length; j++) {
      var sp = ex.spokes[j], X = this.sx(sp.x), Y = this.sy(sp.y);
      var r = Math.max(2.4, (1.6 + 1.0 * Math.sqrt(sp.deg)) * this.cam.z);
      ctx.beginPath(); ctx.arc(X, Y, r, 0, 7);
      ctx.fillStyle = sp.hovered ? sp.color : CARD; ctx.fill();
      ctx.lineWidth = 1.1; ctx.strokeStyle = INK; ctx.stroke();
    }
    // hub emphasised
    ctx.beginPath(); ctx.arc(HX, HY, Math.max(5, hub.r * this.cam.z * 0.85), 0, 7);
    ctx.fillStyle = INK; ctx.fill();
  };

  // ---------------------------------------------------------------- labels
  Q._drawLabels = function (focus, nbr) {
    var ctx = this.ctx, z = this.cam.z, placed = [], CAP = z < 1.2 ? 24 : 54;
    var cand = [];
    // region hubs (always priority)
    for (var i = 0; i < this.comms.length; i++) { var c = this.comms[i]; if (c.hubNode == null) continue; cand.push({ n: c.hubNode, region: true, pr: 1e5 + this.nodes[c.hubNode].deg }); }
    // individual books once close
    if (z > 1.6) for (var n = 0; n < this.nodes.length; n++) if (!this.nodes[n].hub) cand.push({ n: n, region: false, pr: this.nodes[n].deg });
    // expanded spokes get labels too
    var spokeLabels = [];
    if (this.expanded) for (var s = 0; s < this.expanded.spokes.length; s++) spokeLabels.push(this.expanded.spokes[s]);
    // focus + its neighbours are forced on
    if (focus != null) { cand.push({ n: focus, region: this.nodes[focus].hub, pr: 1e9 }); if (nbr) nbr.forEach(function (m) { cand.push({ n: m, region: false, pr: 1e8 }); }); }
    cand.sort(function (a, b) { return b.pr - a.pr; });

    for (var k = 0; k < cand.length && placed.length < CAP; k++) {
      var nd = this.nodes[cand[k].n], X = this.sx(nd.x), Y = this.sy(nd.y);
      if (X < -20 || X > this.VW + 20 || Y < -20 || Y > this.VH + 20) continue;
      this._placeLabel(nd.title, X, Y, nd.hub || cand[k].region, cand[k].n === focus, placed, nd);
    }
    // spoke labels (only a few, priority by degree) when expanded + zoomed a bit
    if (this.expanded && z > 0.8) {
      spokeLabels.sort(function (a, b) { return b.deg - a.deg; });
      for (var q = 0; q < spokeLabels.length && placed.length < CAP + 30; q++) {
        var sp = spokeLabels[q]; this._placeLabel(sp.title, this.sx(sp.x), this.sy(sp.y), false, false, placed, sp);
      }
    }
  };

  // try positions around the node; place the first that doesn't collide
  Q._placeLabel = function (title, X, Y, region, isFocus, placed, node) {
    var ctx = this.ctx;
    var font = region ? "18px 'Instrument Serif', serif" : "11px 'IBM Plex Mono', monospace";
    ctx.font = font;
    var txt = title.length > 34 ? title.slice(0, 33) + '…' : title;
    var tw = ctx.measureText(txt).width, th = region ? 20 : 13;
    var pad = region ? 0 : 6, bw = tw + pad * 2, bh = th + 4;
    var offs = region ? [[8, 0]] : [[9, 0], [-9 - bw, 0], [0, -bh - 3], [0, bh + 3]];
    for (var o = 0; o < offs.length; o++) {
      var bx = X + offs[o][0] - (offs[o][0] < 0 ? 0 : 0), by = Y + offs[o][1] - bh / 2;
      if (offs[o][0] < 0) bx = X + offs[o][0]; // left placement already accounts width
      var hit = false;
      for (var p = 0; p < placed.length; p++) { var g = placed[p]; if (bx < g.x + g.w && bx + bw > g.x && by < g.y + g.h && by + bh > g.y) { hit = true; break; } }
      if (hit && !isFocus) continue;
      placed.push({ x: bx, y: by, w: bw, h: bh });
      if (region) {
        ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.font = font; ctx.fillText(txt, bx, Y);
        ctx.font = "9.5px 'IBM Plex Mono', monospace"; ctx.fillStyle = 'rgba(20,20,20,.5)'; ctx.fillText((node.deg || 0) + ' mentions', bx, Y + 14);
      } else {
        ctx.font = font;
        ctx.fillStyle = CARD; ctx.strokeStyle = INK; ctx.lineWidth = 1.1;
        if (isFocus) { ctx.save(); ctx.shadowColor = 'rgba(20,20,20,.9)'; ctx.shadowOffsetY = 3; }
        this._roundRect(bx, by, bw, bh, 7); ctx.fill(); if (isFocus) ctx.restore(); ctx.stroke();
        ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + pad, by + bh / 2);
      }
      return;
    }
  };
  Q._roundRect = function (x, y, w, h, r) { var c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

  // ---------------------------------------------------------------- hit testing
  Q.pick = function (px, py) {
    var wx = this.wx(px), wy = this.wy(py), best = null, bd = Infinity, self = this;
    // expanded spokes take priority
    if (this.expanded) { for (var i = 0; i < this.expanded.spokes.length; i++) { var s = this.expanded.spokes[i]; var d = (s.x - wx) * (s.x - wx) + (s.y - wy) * (s.y - wy); if (d < bd) { bd = d; best = { spoke: s }; } } }
    for (var n = 0; n < this.nodes.length; n++) { var nd = this.nodes[n]; var dd = (nd.x - wx) * (nd.x - wx) + (nd.y - wy) * (nd.y - wy); if (dd < bd) { bd = dd; best = { node: n }; } }
    var thr = Math.pow((best && best.spoke ? 16 : 16) / this.cam.z, 2);
    return bd < thr ? best : null;
  };

  // ---------------------------------------------------------------- interaction
  Q._bind = function () {
    var self = this, cv = this.canvas;
    var drag = null;
    cv.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, cx: self.cam.x, cy: self.cam.y, moved: 0 }; cv.style.cursor = 'grabbing'; });
    window.addEventListener('mouseup', function (e) {
      if (drag && drag.moved < 5) self._click(e.offsetX != null ? e.offsetX : e.clientX, e.offsetY != null ? e.offsetY : e.clientY, e);
      drag = null; cv.style.cursor = 'grab';
    });
    window.addEventListener('mousemove', function (e) {
      var rect = cv.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (drag) { drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); self.cam.x = drag.cx - (e.clientX - drag.x) / self.cam.z; self.cam.y = drag.cy - (e.clientY - drag.y) / self.cam.z; self.target = null; self.dirty = true; return; }
      if (px < 0 || py < 0 || px > self.VW || py > self.VH) { if (self.hover != null) { self.hover = null; self.dirty = true; } return; }
      self._hoverAt(px, py);
    });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); self.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    // touch: one finger pan, tap = select, pinch = zoom
    var touch = null;
    cv.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) { var t = e.touches[0]; touch = { x: t.clientX, y: t.clientY, cx: self.cam.x, cy: self.cam.y, moved: 0 }; }
      else if (e.touches.length === 2) { touch = { pinch: self._pinchDist(e), z: self.cam.z }; }
    }, { passive: true });
    cv.addEventListener('touchmove', function (e) {
      if (!touch) return;
      if (touch.pinch && e.touches.length === 2) { var d = self._pinchDist(e); self.cam.z = Math.max(0.12, Math.min(12, touch.z * d / touch.pinch)); self.dirty = true; }
      else if (e.touches.length === 1) { var t = e.touches[0]; touch.moved += Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y); self.cam.x = touch.cx - (t.clientX - touch.x) / self.cam.z; self.cam.y = touch.cy - (t.clientY - touch.y) / self.cam.z; self.dirty = true; }
    }, { passive: true });
    cv.addEventListener('touchend', function (e) {
      if (touch && !touch.pinch && touch.moved < 8) { var rect = cv.getBoundingClientRect(); self._tap(touch.x - rect.left, touch.y - rect.top); }
      touch = null;
    });
  };
  Q._pinchDist = function (e) { var a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); };

  Q._hoverAt = function (px, py) {
    var hit = this.pick(px, py);
    if (this.expanded && hit && hit.spoke) { // spoke hover
      if (this._hoverSpoke !== hit.spoke) { if (this._hoverSpoke) this._hoverSpoke.hovered = false; this._hoverSpoke = hit.spoke; hit.spoke.hovered = true; this.dirty = true; }
      if (this.hover != null) { this.hover = null; this.dirty = true; }
      this.canvas.style.cursor = 'pointer'; return;
    }
    if (this._hoverSpoke) { this._hoverSpoke.hovered = false; this._hoverSpoke = null; this.dirty = true; }
    var h = hit && hit.node != null ? hit.node : null;
    if (h !== this.hover) { this.hover = h; this.canvas.style.cursor = h != null ? 'pointer' : 'grab'; this.dirty = true; }
  };

  Q._click = function (px, py, e) {
    var hit = this.pick(px, py);
    if (!hit) { this._collapse(); this.sel = null; this.dirty = true; return; }
    if (hit.spoke) { this._navigate(hit.spoke.id); return; }
    var nd = this.nodes[hit.node];
    if (nd.hub && nd.flavor === 'fan-out') { this._toggleExpand(hit.node); return; }
    this._navigate(nd.id);
  };
  Q._tap = function (px, py) {
    var hit = this.pick(px, py);
    if (!hit) { this._collapse(); this.sel = null; this.hidePopover(); this.dirty = true; return; }
    if (hit.spoke) { this._navigate(hit.spoke.id); return; }
    var nd = this.nodes[hit.node];
    if (nd.hub && nd.flavor === 'fan-out') { this._toggleExpand(hit.node); return; }
    // touch: first tap selects (shows links + open popover), second tap opens
    if (this.sel === hit.node) { this._navigate(nd.id); return; }
    this.sel = hit.node; this._showPopover(nd, false); this.dirty = true;
  };
  Q._navigate = function (id) { if (this.opts.onNavigate) this.opts.onNavigate(id); };

  // ---------------------------------------------------------------- fan-out expand
  Q._toggleExpand = function (nodeIdx) {
    if (this.expanded && this.expanded.hubNode === nodeIdx) { this._collapse(); return; }
    var comm = null; for (var i = 0; i < this.comms.length; i++) if (this.comms[i].hubNode === nodeIdx) { comm = this.comms[i]; break; }
    if (!comm || !comm.spokes) return;
    var hub = this.nodes[nodeIdx], spokes = comm.spokes.slice().sort(function (a, b) { return b.deg - a.deg; });
    // radial rings around the hub, sized so they clear neighbours
    var placed = [], perRing = 18, baseR = Math.max(comm.r * 1.5, 40);
    for (var s = 0; s < spokes.length; s++) {
      var ring = Math.floor(s / perRing), idxInRing = s % perRing, count = Math.min(perRing, spokes.length - ring * perRing);
      var rr = baseR + ring * 34, ang = (idxInRing / count) * Math.PI * 2 - Math.PI / 2 + ring * 0.3;
      placed.push(Object.assign({}, spokes[s], { x: hub.x + Math.cos(ang) * rr, y: hub.y + Math.sin(ang) * rr, hovered: false }));
    }
    this.expanded = { comm: comm, hubNode: nodeIdx, spokes: placed };
    // frame the burst
    var span = baseR + Math.ceil(spokes.length / perRing) * 34 + 30;
    this.animateTo(hub.x, hub.y, Math.min(this.VW, this.VH) / (span * 2.1));
    this._showPopover(hub, true);
    this.dirty = true;
  };
  Q._collapse = function () { if (this.expanded) { this.expanded = null; this.hidePopover(); this.dirty = true; } };

  // ---------------------------------------------------------------- popover (DOM)
  Q._makePopover = function () {
    var el = document.createElement('div');
    el.style.cssText = 'position:absolute;z-index:20;display:none;background:' + CARD + ';border:1.5px solid ' + INK + ';border-radius:12px;padding:11px 13px;box-shadow:0 4px 0 rgba(20,20,20,.9);font-family:\'IBM Plex Mono\',monospace;max-width:240px;pointer-events:auto;';
    (this.canvas.parentNode || document.body).appendChild(el);
    this.popover = el;
  };
  Q._showPopover = function (node, isHub) {
    var self = this, el = this.popover;
    var sub = isHub ? ((node.deg || 0) + ' books cited · fan-out hub') : (node.author || '');
    el.innerHTML = '<div style="font-family:\'Instrument Serif\',serif;font-size:17px;line-height:1.15;margin-bottom:3px;">' + esc(node.title) + '</div>' +
      '<div style="font-size:10.5px;opacity:.6;margin-bottom:9px;">' + esc(sub) + '</div>' +
      '<button style="border:1.5px solid ' + INK + ';background:' + PAPER + ';border-radius:999px;padding:6px 13px;font-size:11.5px;cursor:pointer;font-family:inherit;">open book →</button>';
    el.querySelector('button').onclick = function () { self._navigate(node.id); };
    el._node = node; el.style.display = 'block';
    this._positionPopover();
  };
  Q._positionPopover = function () {
    var el = this.popover; if (el.style.display === 'none' || !el._node) return;
    var X = this.sx(el._node.x), Y = this.sy(el._node.y);
    el.style.left = Math.min(this.VW - 250, Math.max(8, X + 14)) + 'px';
    el.style.top = Math.min(this.VH - 90, Math.max(8, Y + 14)) + 'px';
  };
  Q.hidePopover = function () { this.popover.style.display = 'none'; this.popover._node = null; };

  // ---------------------------------------------------------------- search API
  Q.findBooks = function (q) {
    q = norm(q); if (!q) return [];
    var out = [];
    for (var n = 0; n < this.nodes.length; n++) { var nd = this.nodes[n]; var t = norm(nd.title); if (t.indexOf(q) === 0) out.push({ i: n, nd: nd, pr: 2, len: t.length }); else if (t.indexOf(q) !== -1) out.push({ i: n, nd: nd, pr: 1, len: t.length }); }
    // include fan-out spokes (not rendered) so any book is findable
    for (var c = 0; c < this.comms.length; c++) { var sp = this.comms[c].spokes; if (!sp) continue; for (var s = 0; s < sp.length; s++) { var tt = norm(sp[s].title); if (tt.indexOf(q) !== -1) out.push({ spoke: sp[s], hub: this.comms[c].hubNode, pr: tt.indexOf(q) === 0 ? 2 : 1, len: tt.length }); } }
    out.sort(function (a, b) { return b.pr - a.pr || a.len - b.len; });
    return out.slice(0, 8).map(function (r) { return r.spoke ? { id: r.spoke.id, title: r.spoke.title, author: r.spoke.author, spoke: true, hub: r.hub } : { id: r.nd.id, title: r.nd.title, author: r.nd.author, node: r.i }; });
  };
  Q.goToBook = function (res) {
    if (res.node != null) { var nd = this.nodes[res.node]; this.sel = res.node; this.hover = res.node; this.animateTo(nd.x, nd.y, Math.max(2.4, this.cam.z)); this._showPopover(nd, nd.hub && nd.flavor === 'fan-out'); }
    else if (res.spoke) { this._toggleExpand(res.hub); } // reveal its bibliography; the book is a spoke
    this.dirty = true;
  };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  window.NetworkView = NetworkView;
})();
