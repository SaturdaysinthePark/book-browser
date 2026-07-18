/*
 * constellation-view.js — BookJumpr "Book Constellation Explorer", canvas engine.
 *
 *   new Constellation({ root, data, bookUrlPattern, showRings, labelDensity, ambientTours })
 *
 * A radial starfield of the book-mention network: pan/zoom a canvas, focus a book to trace its
 * 1st-hop connections (animated directional flow lines) + 2nd-hop onward citations, with ambient
 * "tours" when idle. Framework-agnostic vanilla JS (ported ~1:1 from the design prototype's
 * Component class); the reactive chrome (header/chip/panel/dropdown/rail) is driven by a small
 * state + renderChrome() bridge instead of React. BOOKS mode only.
 *
 * data = window.BookGraph (see tools/build-book-graph.mjs / design handoff book-graph.js):
 *   meta{books,backbone,edges,leaves,rings:[{r,v}],extent}, nodes[{n,a,x,y,o,i,f,yr,sy,ls,key?}],
 *   edges[[from,to,w]], leaves[{name,a}], leavesFor{hubIdx:[leafIdx...]}.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  class Constellation {
    constructor(opts) {
      this.opts = opts || {};
      this.root = this.opts.root;
      this.onOpenPage = this.opts.onOpenPage || null; // in-app nav hook (SPA); falls back to window.open
      this.props = {
        bookUrlPattern: this.opts.bookUrlPattern || '',
        showRings: this.opts.showRings !== false,
        labelDensity: this.opts.labelDensity == null ? 1 : this.opts.labelDensity,
        ambientTours: this.opts.ambientTours !== false,
      };
      this.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (this.reduceMotion) this.props.ambientTours = false;

      // reactive state (drives DOM chrome only)
      this.state = { ready: false, focus: -1, panelOpen: false, searchQ: '', searchResults: [], popular: false, isMobile: false };
      // per-frame instance state (never triggers a chrome re-render)
      this.view = { x: 0, y: 0, k: 0.5 };
      this.railHorizontal = false;
      this.tween = null; this.dragging = false; this.dragMoved = false; this.lastMX = 0; this.lastMY = 0;
      this.hover = -1; this.dirty = true; this.raf = 0; this.dpr = 1;
      this.pulseOn = !this.reduceMotion; this.pinch = null; this.touchStart = null;
      this.tourT0 = 0; this.tourIdx = 0; this.railDrag = false; this.lastRailK = 0; this.hop2Lit = null;

      this.init();
    }

    // ---------------------------------------------------------------- lifecycle
    init() {
      const root = this.root;
      this.graph = this.prep(this.opts.data);
      this.wrapEl = root.querySelector('#wrap');
      this.canvasEl = root.querySelector('#canvas');
      this.railEl = root.querySelector('#rail');
      this.railThumbEl = root.querySelector('#railThumb');
      this.searchEl = root.querySelector('#search');
      this.statEl = root.querySelector('#stat');
      this.dropdownEl = root.querySelector('#dropdown');
      this.chipEl = root.querySelector('#chip');
      this.panelEl = root.querySelector('#panel');

      this.setupCanvas();
      this.fit();

      // static chrome wiring
      this.searchEl.addEventListener('input', this.onSearch);
      this.searchEl.addEventListener('focus', this.onSearchFocus);
      this.searchEl.addEventListener('blur', this.onSearchBlur);
      root.querySelector('#zoomIn').addEventListener('click', () => { const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight; this.zoomAt(w / 2, h / 2, 1.5); });
      root.querySelector('#zoomOut').addEventListener('click', () => { const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight; this.zoomAt(w / 2, h / 2, 1 / 1.5); });
      root.querySelector('#fit').addEventListener('click', () => { this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.fit(); });
      this.railEl.addEventListener('pointerdown', (e) => { this.railDrag = true; try { e.target.setPointerCapture(e.pointerId); } catch (_) {} this.railApply(e); });
      this.railEl.addEventListener('pointermove', (e) => { if (this.railDrag) this.railApply(e); });
      this.railEl.addEventListener('pointerup', () => { this.railDrag = false; });

      this.canvasEl.addEventListener('mousedown', this.handleDown);
      this.canvasEl.addEventListener('mousemove', this.handleMove);
      window.addEventListener('mouseup', this.handleUp);
      this.canvasEl.addEventListener('mouseleave', this.handleLeave);
      this.canvasEl.addEventListener('click', this.handleClick);

      this.keyH = (e) => {
        if (e.key === 'Escape') { this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.dirty = true; }
        else if (e.key === '/' && document.activeElement !== this.searchEl) { e.preventDefault(); if (this.searchEl) this.searchEl.focus(); }
      };
      window.addEventListener('keydown', this.keyH);

      this.setState({ ready: true, isMobile: this.wrapEl.clientWidth < 640 });
      const start = () => this.loop();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
    }

    destroy() {
      cancelAnimationFrame(this.raf);
      if (this.ro) this.ro.disconnect();
      window.removeEventListener('keydown', this.keyH);
      window.removeEventListener('mouseup', this.handleUp);
    }

    setState(patch, cb) {
      Object.assign(this.state, patch);
      this.dirty = true;
      this.renderChrome();
      if (cb) cb();
    }

    // ---------------------------------------------------------------- data prep
    prep(G) {
      const adjOut = G.nodes.map(() => []), adjIn = G.nodes.map(() => []);
      for (const [i, j, w] of G.edges) { adjOut[i].push([j, w || 1]); adjIn[j].push([i, w || 1]); }
      const neigh = G.nodes.map((_, i) => new Set([...adjOut[i].map(e => e[0]), ...adjIn[i].map(e => e[0])]));
      const order = [...G.nodes.keys()].sort((x, y) => (G.nodes[y].o + G.nodes[y].i) - (G.nodes[x].o + G.nodes[x].i));
      const labelOrder = [...G.nodes.keys()].sort((x, y) => (G.nodes[y].ls || 0) - (G.nodes[x].ls || 0));
      const c = { G, adjOut, adjIn, neigh, order, labelOrder, extent: G.meta.extent || 2000 };
      c.chains = this.buildChains(c);
      return c;
    }
    buildChains(c) {
      const res = [], used = new Set();
      for (const s of c.order) {
        if (res.length >= 20) break;
        const seen = new Set([s]); const path = [s]; let cur = s;
        while (path.length < 6) {
          let best = -1, bw = -1;
          for (const [j, w] of c.adjOut[cur]) if (!seen.has(j) && w > bw) { bw = w; best = j; }
          if (best < 0) break;
          seen.add(best); path.push(best); cur = best;
        }
        if (path.length >= 4 && !used.has(path[0]) && !used.has(path[1])) { res.push(path); for (const p of path) used.add(p); }
      }
      for (let i = res.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [res[i], res[j]] = [res[j], res[i]]; }
      return res;
    }

    // ---------------------------------------------------------------- canvas / camera
    setupCanvas() {
      const cv = this.canvasEl, wrap = this.wrapEl;
      this.ctx = cv.getContext('2d');
      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        cv.width = wrap.clientWidth * dpr; cv.height = wrap.clientHeight * dpr;
        cv.style.width = wrap.clientWidth + 'px'; cv.style.height = wrap.clientHeight + 'px';
        this.dpr = dpr; this.dirty = true;
        const mob = wrap.clientWidth < 640;
        if (this.state.ready && mob !== this.state.isMobile) this.setState({ isMobile: mob });
      };
      this.ro = new ResizeObserver(resize); this.ro.observe(wrap); resize();
      wrap.addEventListener('wheel', e => {
        e.preventDefault();
        const r = wrap.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
      }, { passive: false });
      if (this.railEl) this.railEl.addEventListener('wheel', e => {
        e.preventDefault(); e.stopPropagation();
        const w = wrap.clientWidth, h = wrap.clientHeight;
        this.zoomAt(w / 2, h / 2, Math.exp(-e.deltaY * 0.0016));
      }, { passive: false });
      wrap.addEventListener('touchstart', e => {
        e.preventDefault();
        if (e.touches.length === 1) {
          const t = e.touches[0];
          this.touchStart = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
          this.lastMX = t.clientX; this.lastMY = t.clientY;
        } else if (e.touches.length === 2) {
          this.touchStart = null;
          const [a, b] = e.touches;
          this.pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
        }
      }, { passive: false });
      wrap.addEventListener('touchmove', e => {
        e.preventDefault();
        const r = wrap.getBoundingClientRect();
        if (e.touches.length === 1 && this.touchStart) {
          const t = e.touches[0];
          const dx = t.clientX - this.lastMX, dy = t.clientY - this.lastMY;
          if (Math.abs(t.clientX - this.touchStart.x) + Math.abs(t.clientY - this.touchStart.y) > 8) this.touchStart.moved = true;
          this.view.x -= dx / this.view.k; this.view.y -= dy / this.view.k;
          this.lastMX = t.clientX; this.lastMY = t.clientY;
          this.tween = null; this.dirty = true;
        } else if (e.touches.length === 2 && this.pinch) {
          const [a, b] = e.touches;
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          const mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top;
          this.zoomAt(mx, my, d / this.pinch.d);
          this.pinch.d = d;
        }
      }, { passive: false });
      wrap.addEventListener('touchend', e => {
        e.preventDefault();
        if (e.touches.length === 0 && this.pinch) this.pinch = null;
        if (this.touchStart && !this.touchStart.moved && Date.now() - this.touchStart.t < 500) {
          const r = wrap.getBoundingClientRect();
          const i = this.pick(this.touchStart.x - r.left, this.touchStart.y - r.top, true);
          if (i < 0 || i === this.state.focus) { this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.dirty = true; }
          else this.focusNode(i);
        }
        this.touchStart = null;
      }, { passive: false });
    }

    fit() {
      const c = this.graph; if (!c) return;
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      this.view = { x: 0, y: 0, k: Math.min(w / c.extent, h / c.extent) };
      this.dirty = true;
    }
    toScreen(x, y) { const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight; return [(x - this.view.x) * this.view.k + w / 2, (y - this.view.y) * this.view.k + h / 2]; }
    toWorld(sx, sy) { const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight; return [(sx - w / 2) / this.view.k + this.view.x, (sy - h / 2) / this.view.k + this.view.y]; }
    zoomAt(mx, my, f) {
      const [wx, wy] = this.toWorld(mx, my);
      const k2 = Math.max(0.1, Math.min(10, this.view.k * f));
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      this.view.x = wx - (mx - w / 2) / k2; this.view.y = wy - (my - h / 2) / k2; this.view.k = k2;
      this.tween = null; this.dirty = true;
    }
    flyTo(x, y, k) { this.tween = { t0: performance.now(), dur: 550, from: { ...this.view }, to: { x, y, k } }; this.dirty = true; }
    railApply(e) {
      const r = this.railEl.getBoundingClientRect();
      const horizontal = r.width > r.height;
      const t = horizontal
        ? 1 - Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
        : Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const k = Math.exp(Math.log(10) + t * (Math.log(0.1) - Math.log(10)));
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      this.zoomAt(w / 2, h / 2, k / this.view.k);
    }

    // ---------------------------------------------------------------- render loop
    loop = () => {
      this.raf = requestAnimationFrame(this.loop);
      if (this.tween) {
        const p = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
        const e = 1 - Math.pow(1 - p, 3);
        const { from, to } = this.tween;
        this.view.x = from.x + (to.x - from.x) * e; this.view.y = from.y + (to.y - from.y) * e; this.view.k = from.k + (to.k - from.k) * e;
        if (p >= 1) this.tween = null;
        this.dirty = true;
      }
      if (this.railThumbEl && this.view.k !== this.lastRailK) {
        this.lastRailK = this.view.k;
        const t = (Math.log(10) - Math.log(this.view.k)) / (Math.log(10) - Math.log(0.1));
        const p = Math.max(0, Math.min(1, t)) * 100;
        if (this.railHorizontal) { this.railThumbEl.style.left = (100 - p) + '%'; this.railThumbEl.style.top = ''; }
        else { this.railThumbEl.style.top = p + '%'; this.railThumbEl.style.left = ''; }
      }
      if (!this.reduceMotion) {
        if (this.state.focus < 0 && (this.pulseOn || this.props.ambientTours)) this.dirty = true;
        if (this.state.focus >= 0 || this.hover >= 0) this.dirty = true;
      }
      if (this.dirty) { this.dirty = false; this.draw(); }
    };

    nodeR(n) { return Math.max(2.8, Math.min(24, (2 + Math.sqrt(n.o + n.i) * 1.5) * Math.sqrt(this.view.k) * 1.35)); }
    genreCol(n) { return n.f ? '#9c3d22' : '#2e8156'; }

    leafPositions(f) {
      const c = this.graph;
      const ids = (c.G.leavesFor[f] || []);
      const n = c.G.nodes[f];
      const rim = c.extent / 2 - 40;
      const focR = Math.hypot(n.x, n.y);
      const outA = focR > 1 ? Math.atan2(n.y, n.x) : 0;
      const spread = Math.min(Math.PI * 0.9, 0.5 + ids.length * 0.05);
      const r0 = Math.max(focR + 90, rim * 0.45);
      return ids.map((li, j) => {
        const t = ids.length === 1 ? 0.5 : j / (ids.length - 1);
        const a = outA + (t - 0.5) * spread;
        const shell = j % 3;
        const rr = Math.min(rim, r0 + (rim - r0) * (0.55 + shell * 0.22));
        return { li, x: Math.cos(a) * rr, y: Math.sin(a) * rr };
      });
    }

    arrow(ctx, x1, y1, x2, y2, col, alpha, lw) {
      ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = lw;
      const flow = this.reduceMotion ? 0 : (performance.now() / 40) % 20;
      ctx.setLineDash([9, 11]); ctx.lineDashOffset = -flow;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
    }

    tourInfo(c) {
      if (!c.chains || !c.chains.length) return null;
      const t = performance.now();
      if (!this.tourT0) { this.tourT0 = t; }
      const F = 800, H = 3200, GAP = 700, TOT = F + H + F + GAP;
      let el = t - this.tourT0;
      if (el > TOT) { this.tourIdx = (this.tourIdx + 1) % c.chains.length; this.tourT0 = t; el = 0; }
      const a = el < F ? el / F : el < F + H ? 1 : el < F + H + F ? 1 - (el - F - H) / F : 0;
      return { path: c.chains[this.tourIdx], a };
    }

    draw() {
      const ctx = this.ctx; const c = this.graph; if (!ctx || !c) return;
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight, dpr = this.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#f7f5f0'; ctx.fillRect(0, 0, w, h);
      const k = this.view.k;
      const focus = this.state.focus >= 0 ? this.state.focus : this.hover;
      const hasFocus = focus >= 0;
      const N = c.G.nodes;
      const showRings = this.props.showRings;
      const mob = this.state.isMobile;

      let hop2 = null;
      if (hasFocus) {
        hop2 = new Set();
        for (const j of c.neigh[focus]) for (const [j2] of c.adjOut[j]) if (j2 !== focus && !c.neigh[focus].has(j2)) hop2.add(j2);
      }

      if (showRings && c.G.meta.rings) {
        const [cx, cy] = this.toScreen(0, 0);
        ctx.textAlign = 'center';
        for (const ring of c.G.meta.rings) {
          if (ring.r === 0) continue;
          const sr = ring.r * k;
          ctx.beginPath(); ctx.arc(cx, cy, sr, 0, 7);
          ctx.strokeStyle = 'rgba(20,20,20,0.055)'; ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
          if (k > 0.35 && !hasFocus) {
            ctx.font = '400 9px "IBM Plex Mono", monospace';
            ctx.fillStyle = 'rgba(20,20,20,0.30)';
            ctx.fillText(ring.v + '+ CONNECTIONS', cx, cy - sr - 4);
          }
        }
      }

      for (const [i, j, wt0] of c.G.edges) {
        const wt = wt0 || 1;
        if (hasFocus) continue;
        const [x1, y1] = this.toScreen(N[i].x, N[i].y);
        const [x2, y2] = this.toScreen(N[j].x, N[j].y);
        if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
        ctx.strokeStyle = '#141414';
        ctx.globalAlpha = Math.min(0.16, 0.05 + wt * 0.02);
        ctx.lineWidth = Math.min(3, 0.5 + wt * 0.3);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (this.state.focus >= 0) {
        const lp = this.leafPositions(this.state.focus);
        const [fx, fy] = this.toScreen(N[this.state.focus].x, N[this.state.focus].y);
        for (const p of lp) {
          const [sx, sy] = this.toScreen(p.x, p.y);
          this.arrow(ctx, fx, fy, sx, sy, '#9c3d22', 0.45, 0.9);
          ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, 7);
          ctx.fillStyle = '#fdfcfa'; ctx.fill();
          ctx.strokeStyle = '#9c3d22'; ctx.lineWidth = 1; ctx.stroke();
        }
        // leaf *labels* are drawn later (in the label pass) so they respect the collision set
      }

      const hovChain = hasFocus && this.state.focus >= 0 && this.hover >= 0 && this.hover !== focus && c.neigh[focus].has(this.hover) ? this.hover : -1;
      this.hop2Lit = hovChain >= 0 ? new Set(c.adjOut[hovChain].map(e => e[0])) : null;
      if (hasFocus) {
        const flow = this.reduceMotion ? 0 : (performance.now() / 55) % 14;
        ctx.setLineDash([4, 10]); ctx.lineDashOffset = -flow;
        for (const j of c.neigh[focus]) {
          ctx.strokeStyle = '#a04a2a';
          ctx.globalAlpha = j === hovChain ? 0.7 : hovChain >= 0 ? 0.08 : 0.28;
          ctx.lineWidth = j === hovChain ? 1.4 : 0.8;
          ctx.beginPath();
          const [jx, jy] = this.toScreen(N[j].x, N[j].y);
          for (const [j2] of c.adjOut[j]) {
            if (j2 === focus || c.neigh[focus].has(j2)) continue;
            const [kx, ky] = this.toScreen(N[j2].x, N[j2].y);
            ctx.moveTo(jx, jy); ctx.lineTo(kx, ky);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      if (hasFocus) {
        const [fx, fy] = this.toScreen(N[focus].x, N[focus].y);
        let strongJ = -1, strongW = -1;
        for (const [j, wt] of c.adjOut[focus]) if (wt > strongW) { strongW = wt; strongJ = j; }
        for (const [j, wt] of c.adjOut[focus]) {
          const [jx, jy] = this.toScreen(N[j].x, N[j].y);
          const em = j === strongJ;
          this.arrow(ctx, fx, fy, jx, jy, '#9c3d22', em ? 0.85 : 0.6, Math.min(4, 0.8 + wt * 0.5) + (em ? 0.8 : 0));
        }
        for (const [j, wt] of c.adjIn[focus]) {
          const [jx, jy] = this.toScreen(N[j].x, N[j].y);
          this.arrow(ctx, jx, jy, fx, fy, '#2f5590', 0.6, Math.min(4, 0.8 + wt * 0.5));
        }
      }

      for (let i = 0; i < N.length; i++) {
        const n = N[i];
        const [sx, sy] = this.toScreen(n.x, n.y);
        const r = this.nodeR(n);
        if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
        const isF = i === focus;
        const conn = hasFocus && c.neigh[focus].has(i);
        const inHop2 = hasFocus && hop2.has(i);
        const lit2 = inHop2 && this.hop2Lit && this.hop2Lit.has(i);
        ctx.globalAlpha = hasFocus ? (isF || conn || lit2 ? 1 : inHop2 ? (this.hop2Lit ? 0.15 : 0.45) : 0.12) : 1;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7);
        const gc = this.genreCol(n);
        const hovered = i === this.hover && !mob;
        ctx.fillStyle = isF ? gc : hovered ? gc : '#fdfcfa'; ctx.fill();
        ctx.strokeStyle = (isF || hovered) ? gc : '#141414'; ctx.lineWidth = isF ? 1.5 : 1.1; ctx.stroke();
        if (!isF && !hovered && n.o > 0 && n.i > 0) { ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.2, r * 0.35), 0, 7); ctx.fillStyle = '#141414'; ctx.fill(); }
        ctx.globalAlpha = 1;
      }

      if (this.pulseOn && !hasFocus && !this.reduceMotion && c.order.length) {
        const top = c.order[0];
        const [px, py] = this.toScreen(N[top].x, N[top].y);
        const ph = (performance.now() % 1600) / 1600;
        const pr = this.nodeR(N[top]) + 6 + ph * 26;
        ctx.beginPath(); ctx.arc(px, py, pr, 0, 7);
        ctx.strokeStyle = 'rgba(156,61,34,' + (0.55 * (1 - ph)).toFixed(3) + ')';
        ctx.lineWidth = 2; ctx.stroke();
      }

      // labels
      const placedR = [];
      const tryPlace = (x, y, wpx, hpx) => {
        const r1 = { x: x - wpx / 2, y: y - hpx / 2, w: wpx, h: hpx };
        for (const r2 of placedR) if (r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y) return false;
        placedR.push(r1); return true;
      };
      const place = (sx, sy, twd, fs, r, padW, padH) => {
        for (const ly of [sy - r - 6, sy + r + fs + 4]) if (tryPlace(sx, ly - fs / 2, twd + padW, fs + padH)) return ly;
        return null;
      };
      ctx.textAlign = 'center';
      if (hasFocus) {
        let nb = [...c.neigh[focus]].sort((a, b) => (N[b].ls || 0) - (N[a].ls || 0));
        let h2list;
        if (this.hop2Lit) h2list = [...this.hop2Lit];
        else { h2list = [...hop2].sort((a, b) => (N[b].ls || 0) - (N[a].ls || 0)).slice(0, 8); }
        if (mob) { nb = nb.slice(0, 12); h2list = h2list.slice(0, 4); }
        const list = [[focus, 1], ...nb.map(i => [i, 0]), ...h2list.map(i => [i, 2])];
        for (const [i, tier] of list) {
          const n = N[i];
          const [sx, sy] = this.toScreen(n.x, n.y);
          if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
          const fs = tier === 1 ? Math.max(13, Math.min(17, 9 + Math.sqrt(n.o + n.i) * 0.75)) : tier === 0 ? (mob ? 11.5 : 11) : 10;
          ctx.font = 'italic ' + (tier === 1 ? '700 ' : '600 ') + fs + 'px "Instrument Serif", Georgia, serif';
          let label = n.n; if (label.length > 30) label = label.slice(0, 28) + '…';
          const twd = ctx.measureText(label).width;
          const ly = place(sx, sy, twd, fs, this.nodeR(n), mob ? 30 : 14, mob ? 14 : 8);
          if (ly === null) continue;
          ctx.fillStyle = 'rgba(247,245,240,0.88)'; ctx.fillRect(sx - twd / 2 - 3, ly - fs, twd + 6, fs + 4);
          ctx.fillStyle = tier === 1 ? this.genreCol(n) : tier === 0 ? '#141414' : (this.hop2Lit ? 'rgba(20,20,20,0.78)' : 'rgba(20,20,20,0.52)');
          ctx.fillText(label, sx, ly);
        }
        // rim leaves fill only the gaps the important labels left (share placedR → no overlap)
        if (this.state.focus >= 0) {
          const lp2 = this.leafPositions(this.state.focus);
          if (lp2.length <= 40 || k > 1.4) {
            const lfs = mob ? 11 : 10.5;
            ctx.font = 'italic 400 ' + lfs + 'px "Instrument Serif", Georgia, serif';
            ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(20,20,20,0.62)';
            let lcount = 0; const lcap = mob ? 14 : 999;
            for (const p of lp2) {
              if (lcount >= lcap) break;
              const [sx, sy] = this.toScreen(p.x, p.y);
              if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
              let name = c.G.leaves[p.li].name; if (name.length > 26) name = name.slice(0, 24) + '…';
              const twd = ctx.measureText(name).width;
              if (!tryPlace(sx + 6 + twd / 2, sy - 2, twd + (mob ? 18 : 10), lfs + (mob ? 7 : 5))) continue;
              ctx.fillText(name, sx + 6, sy + 3);
              lcount++;
            }
            ctx.textAlign = 'center';
          }
        }
      } else {
        const density = this.props.labelDensity;
        const budget = Math.round(Math.min(70, (w * h) / 60000 * (k < 0.4 ? 0.45 : k < 0.8 ? 0.7 : k < 1.5 ? 1.0 : 1.5)) * density);
        const rankCap = Math.round((k < 0.35 ? 24 : k < 0.6 ? 48 : k < 1 ? 90 : k < 1.8 ? 160 : N.length) * density);
        let count = 0, rank = 0;
        for (const i of c.labelOrder) {
          rank++;
          if (count >= budget || rank > rankCap) break;
          const n = N[i];
          const [sx, sy] = this.toScreen(n.x, n.y);
          if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
          const fs = Math.max(mob ? 12 : 10.5, Math.min(17, 9 + Math.sqrt(n.o + n.i) * 0.75));
          ctx.font = 'italic 600 ' + fs + 'px "Instrument Serif", Georgia, serif';
          let label = n.n; if (label.length > 30) label = label.slice(0, 28) + '…';
          const twd = ctx.measureText(label).width;
          const ly = sy - this.nodeR(n) - 6;
          if (!tryPlace(sx, ly - fs / 2, twd + 44, fs + 26)) continue;
          ctx.fillStyle = 'rgba(247,245,240,0.88)'; ctx.fillRect(sx - twd / 2 - 3, ly - fs, twd + 6, fs + 4);
          ctx.fillStyle = 'rgba(20,20,20,0.78)';
          ctx.fillText(label, sx, ly);
          count++;
        }
      }

      // ambient constellation tour (drawn last so its labels stay readable)
      if (!hasFocus && this.props.ambientTours) {
        const ti = this.tourInfo(c);
        if (ti && ti.a > 0.01) {
          const a = ti.a, path = ti.path;
          const pts = path.map(i => this.toScreen(N[i].x, N[i].y));
          ctx.strokeStyle = '#9c3d22'; ctx.globalAlpha = a * 0.55; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
          ctx.stroke();
          ctx.globalAlpha = a * 0.7; ctx.lineWidth = 1.2;
          for (let p = 0; p < pts.length; p++) {
            ctx.beginPath(); ctx.arc(pts[p][0], pts[p][1], this.nodeR(N[path[p]]) + 3.5, 0, 7); ctx.stroke();
          }
          ctx.globalAlpha = a; ctx.textAlign = 'center';
          ctx.font = 'italic 600 12px "Instrument Serif", Georgia, serif';
          for (let p = 0; p < pts.length; p++) {
            const n2 = N[path[p]]; let lb = n2.n; if (lb.length > 26) lb = lb.slice(0, 24) + '…';
            const twd = ctx.measureText(lb).width;
            const ly = pts[p][1] - this.nodeR(n2) - 8;
            if (!tryPlace(pts[p][0], ly - 6, twd + 12, 16)) continue;
            ctx.fillStyle = 'rgba(247,245,240,0.92)'; ctx.fillRect(pts[p][0] - twd / 2 - 3, ly - 12, twd + 6, 16);
            ctx.fillStyle = '#9c3d22'; ctx.fillText(lb, pts[p][0], ly);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    // ---------------------------------------------------------------- hit testing / interaction
    pick(mx, my, touch) {
      const c = this.graph;
      const [wx, wy] = this.toWorld(mx, my);
      let best = -1, bd = 1e9;
      for (let i = 0; i < c.G.nodes.length; i++) {
        const n = c.G.nodes[i];
        const d = Math.hypot(n.x - wx, n.y - wy);
        const tol = (this.nodeR(n) + (touch ? 20 : 8)) / this.view.k;
        if (d < tol && d < bd) { bd = d; best = i; }
      }
      return best;
    }

    handleDown = e => { this.dragging = true; this.dragMoved = false; this.lastMX = e.clientX; this.lastMY = e.clientY; };
    handleMove = e => {
      const r = this.wrapEl.getBoundingClientRect();
      if (this.dragging) {
        const dx = e.clientX - this.lastMX, dy = e.clientY - this.lastMY;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
        this.view.x -= dx / this.view.k; this.view.y -= dy / this.view.k;
        this.lastMX = e.clientX; this.lastMY = e.clientY;
        this.tween = null; this.dirty = true;
      } else {
        const hv = this.pick(e.clientX - r.left, e.clientY - r.top);
        if (hv !== this.hover) { this.hover = hv; this.dirty = true; this.wrapEl.style.cursor = hv >= 0 ? 'pointer' : 'grab'; }
      }
    };
    handleUp = () => { this.dragging = false; };
    handleLeave = () => { this.dragging = false; if (this.hover >= 0) { this.hover = -1; this.dirty = true; } };
    handleClick = e => {
      if (this.dragMoved) return;
      const r = this.wrapEl.getBoundingClientRect();
      const i = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (i < 0 || i === this.state.focus) { this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.dirty = true; return; }
      this.focusNode(i);
    };

    focusNode(i) {
      this.pulseOn = false;
      const c = this.graph, N = c.G.nodes, n = N[i];
      this.setState({ focus: i, panelOpen: false, searchQ: '', searchResults: [], popular: false });
      const xs = [n.x], ys = [n.y];
      const hop2 = [];
      for (const j of c.neigh[i]) {
        xs.push(N[j].x); ys.push(N[j].y);
        for (const [j2] of c.adjOut[j]) if (j2 !== i && !c.neigh[i].has(j2)) hop2.push(j2);
      }
      hop2.sort((a, b) => (N[b].ls || 0) - (N[a].ls || 0));
      for (const j2 of hop2.slice(0, 8)) { xs.push(N[j2].x); ys.push(N[j2].y); }
      for (const p of this.leafPositions(i)) { xs.push(p.x); ys.push(p.y); }
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      const mob = this.state.isMobile;
      const padX = mob ? 28 : 90, padT = mob ? 66 : 76, padB = mob ? 235 : 110;
      const availW = Math.max(120, w - padX * 2), availH = Math.max(120, h - padT - padB);
      const bw = Math.max(maxX - minX, 120), bh = Math.max(maxY - minY, 120);
      let k = Math.min(availW / bw, availH / bh);
      k = Math.max(0.28, Math.min(mob ? 1.5 : 1.8, k));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const sx0 = padX + availW / 2, sy0 = padT + availH / 2;
      this.flyTo(cx - (sx0 - w / 2) / k, cy - (sy0 - h / 2) / k, k);
      this.dirty = true;
    }

    bookUrl(n) {
      if (n && n.key) return 'index.html#/' + n.key;
      const pat = this.props.bookUrlPattern || '';
      if (!pat) return null;
      const slug = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return pat.replace('{title}', slug(n.n)).replace('{author}', slug(n.a || ''));
    }

    // ---------------------------------------------------------------- reactive chrome (replaces renderVals)
    computeFocus() {
      const c = this.graph, f = this.state.focus;
      const fn = f >= 0 ? c.G.nodes[f] : null;
      if (!fn) return null;
      const pl = n => n === 1 ? ' BOOK' : ' BOOKS';
      const onward = j => { const o = c.adjOut[j].length + ((c.G.leavesFor[j] || []).length); return o > 0 ? '→ ' + o : ''; };
      const cites = c.adjOut[f].slice().sort((a, b) => b[1] - a[1]).map(([j, w]) => ({ name: c.G.nodes[j].n, w: (w > 1 ? '×' + w + ' ' : '') + onward(j), idx: j, leaf: false }));
      const leafIds = c.G.leavesFor[f] || [];
      for (const li of leafIds) cites.push({ name: c.G.leaves[li].name, w: 'only here', idx: -1, leaf: true });
      const citedBy = c.adjIn[f].slice().sort((a, b) => b[1] - a[1]).map(([j, w]) => ({ name: c.G.nodes[j].n, w: (w > 1 ? '×' + w + ' ' : '') + onward(j), idx: j, leaf: false }));
      const focSections = [];
      if (citedBy.length) focSections.push({ label: 'MENTIONED BY ' + citedBy.length + pl(citedBy.length), color: '#2f5590', items: citedBy });
      if (cites.length) focSections.push({ label: 'MENTIONS ' + cites.length + pl(cites.length), color: '#9c3d22', items: cites });
      const m = n => n + (n === 1 ? ' mention' : ' mentions');
      const recvd = c.adjIn[f].reduce((s, e) => s + e[1], 0);
      const made = c.adjOut[f].reduce((s, e) => s + e[1], 0) + (leafIds.length || 0);
      const focSub = (fn.f ? 'FICTION' : 'NONFICTION') + (fn.yr ? ' · ' + fn.yr : '') + ' · ' + (recvd > 0 ? m(recvd) + ' received' : '') + (recvd > 0 && made > 0 ? ' · ' : '') + (made > 0 ? m(made) + ' made' : '');
      let best = null;
      for (const [j, w] of c.adjOut[f]) if (!best || w > best.w) best = { j, w };
      if (!best) for (const [j, w] of c.adjIn[f]) if (!best || w > best.w) best = { j, w };
      const strong = best ? { name: c.G.nodes[best.j].n, idx: best.j } : null;
      return { fn, focAuthor: fn.a || null, focSyn: fn.sy || null, focSub, focSections, strong };
    }

    renderChrome() {
      const st = this.state, c = this.graph;
      this.root.classList.toggle('is-mobile', !!st.isMobile);
      const nh = !!st.isMobile;
      if (nh !== this.railHorizontal) {
        this.railHorizontal = nh; this.lastRailK = null;
        if (this.railThumbEl) { this.railThumbEl.style.top = ''; this.railThumbEl.style.left = ''; }
        this.dirty = true;
      }
      if (this.statEl) this.statEl.textContent = c ? (c.G.meta.backbone + ' OF ' + c.G.meta.books + ' BOOKS · ' + c.G.meta.leaves + ' TUCKED AT THE RIM · EXACT MENTION DATA') : 'LOADING…';
      if (this.searchEl && this.searchEl.value !== st.searchQ) this.searchEl.value = st.searchQ;
      this.renderDropdown();
      this.renderFocusUI();
    }

    renderDropdown() {
      const st = this.state, d = this.dropdownEl;
      if (!st.searchResults.length) { d.style.display = 'none'; d.innerHTML = ''; return; }
      let html = '';
      if (st.popular) html += '<div class="pophead">MOST CONNECTED</div>';
      html += st.searchResults.map((r, i) =>
        '<div class="row" data-i="' + i + '"><div class="t">' + esc(r.name) + '</div><div class="s">' + esc(r.sub) + '</div></div>'
      ).join('');
      d.innerHTML = html;
      d.style.display = 'block';
      const results = st.searchResults;
      d.querySelectorAll('.row').forEach(row => {
        row.addEventListener('mousedown', () => { const r = results[+row.getAttribute('data-i')]; if (r && r.pick) r.pick(); });
      });
    }

    renderFocusUI() {
      const st = this.state, chip = this.chipEl, panel = this.panelEl;
      const d = this.computeFocus();
      if (!d) {
        chip.style.display = 'none'; chip.innerHTML = '';
        panel.style.display = 'none'; panel.innerHTML = '';
        return;
      }
      if (st.panelOpen) {
        chip.style.display = 'none'; chip.innerHTML = '';
        this.buildPanel(panel, d); panel.style.display = 'flex';
      } else {
        panel.style.display = 'none'; panel.innerHTML = '';
        this.buildChip(chip, d); chip.style.display = 'block';
      }
    }

    buildChip(chip, d) {
      const fn = d.fn;
      let html = '<div class="top"><div class="name">' + esc(fn.n) + '</div><button class="x" data-act="close">✕</button></div>';
      if (d.focAuthor) html += '<div class="author">' + esc(d.focAuthor) + '</div>';
      html += '<div class="sub">' + esc(d.focSub) + '</div>';
      if (d.strong) html += '<div class="strong" data-act="strong"><div class="lbl">STRONGEST LINK →</div><div class="sn">' + esc(d.strong.name) + '</div></div>';
      html += '<div class="btns"><button class="details" data-act="details">DETAILS</button>';
      const url = this.bookUrl(fn);
      if (url) html += '<button class="open" data-act="open">OPEN PAGE ↗</button>';
      html += '</div>';
      chip.innerHTML = html;
      chip.querySelector('[data-act="close"]').onclick = () => this.clearFocus();
      const s = chip.querySelector('[data-act="strong"]'); if (s) s.onclick = () => { if (d.strong) this.focusNode(d.strong.idx); };
      chip.querySelector('[data-act="details"]').onclick = () => this.setState({ panelOpen: true });
      const o = chip.querySelector('[data-act="open"]');
      if (o) o.onclick = () => {
        if (this.onOpenPage && fn.key) { this.onOpenPage(fn.key); return; }
        const u = this.bookUrl(fn); if (u) window.open(u, '_blank');
      };
    }

    buildPanel(panel, d) {
      const fn = d.fn;
      let html = '<div class="head"><div class="top"><div class="name">' + esc(fn.n) + '</div><button class="x" data-act="close">✕</button></div>';
      if (d.focAuthor) html += '<div class="author">' + esc(d.focAuthor) + '</div>';
      html += '<div class="sub">' + esc(d.focSub) + '</div>';
      if (d.focSyn) html += '<div class="syn">' + esc(d.focSyn) + '</div>';
      html += '</div><div class="body">';
      d.focSections.forEach((sec, si) => {
        html += '<div class="seclabel" style="color:' + sec.color + '">' + esc(sec.label) + '</div>';
        sec.items.forEach((it, ii) => {
          html += '<div class="item" data-si="' + si + '" data-ii="' + ii + '"><div class="n">' + esc(it.name) + '</div><div class="w">' + esc(it.w) + '</div></div>';
        });
      });
      html += '</div>';
      panel.innerHTML = html;
      panel.querySelector('[data-act="close"]').onclick = () => this.setState({ panelOpen: false });
      panel.querySelectorAll('.item').forEach(el => {
        el.onclick = () => {
          const sec = d.focSections[+el.getAttribute('data-si')];
          const it = sec.items[+el.getAttribute('data-ii')];
          if (it && !it.leaf && it.idx >= 0) this.focusNode(it.idx);
        };
      });
    }

    clearFocus() { this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.dirty = true; }

    popularList() {
      const c = this.graph;
      return c.order.slice(0, 6).map(i => {
        const n = c.G.nodes[i];
        return { name: n.n, sub: (n.a || '—') + ' · ' + (n.o + n.i) + ' connections', pick: () => this.focusNode(i) };
      });
    }

    onSearch = e => {
      const c = this.graph; const q = e.target.value; let res = [];
      if (c && q.trim().length > 1) {
        const ql = q.trim().toLowerCase();
        for (let i = 0; i < c.G.nodes.length && res.length < 7; i++) {
          const n = c.G.nodes[i];
          if (n.n.toLowerCase().includes(ql) || (n.a || '').toLowerCase().includes(ql)) {
            const sub = (n.a || '—') + ' · ' + (n.o + n.i) + ' connections';
            res.push({ name: n.n, sub, pick: () => this.focusNode(i) });
          }
        }
        if (res.length < 7) {
          for (const [hub, ids] of Object.entries(c.G.leavesFor)) {
            if (res.length >= 7) break;
            for (const li of ids) {
              if (res.length >= 7) break;
              const lf = c.G.leaves[li];
              if (lf.name.toLowerCase().includes(ql)) { const h = +hub; res.push({ name: lf.name, sub: 'cited only by ' + c.G.nodes[h].n, pick: () => this.focusNode(h) }); }
            }
          }
        }
        this.setState({ searchQ: q, searchResults: res, popular: false });
      } else if (c && !q.trim()) {
        this.setState({ searchQ: q, searchResults: this.popularList(), popular: true });
      } else {
        this.setState({ searchQ: q, searchResults: [], popular: false });
      }
    };
    onSearchFocus = () => { if (this.graph && !this.state.searchQ.trim()) this.setState({ searchResults: this.popularList(), popular: true }); };
    onSearchBlur = () => { setTimeout(() => { if (document.activeElement !== this.searchEl) this.setState({ searchResults: [], popular: false }); }, 200); };
  }

  window.Constellation = Constellation;
})();
