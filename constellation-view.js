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

  const MODES = ['all', 'fiction', 'nonfiction'];

  class Constellation {
    static IMMERSIVE_K = 1.45; // default entry zoom (see enterView()) — 1.0 would show the whole graph

    constructor(opts) {
      this.opts = opts || {};
      this.root = this.opts.root;
      this.onOpenPage = this.opts.onOpenPage || null; // in-app nav hook (SPA); falls back to window.open
      this.fullData = this.opts.data || {};   // { all, fiction, nonfiction } — each an independently laid-out graph
      this.mode = MODES.includes(this.opts.initialMode) ? this.opts.initialMode : 'all';
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
      this.view = { x: 0, y: 0, k: 1 };
      this.railHorizontal = false;
      this.tween = null; this.dragging = false; this.dragMoved = false; this.lastMX = 0; this.lastMY = 0;
      this.hover = -1; this.dirty = true; this.raf = 0; this.dpr = 1;
      this.pulseOn = !this.reduceMotion; this.pinch = null; this.touchStart = null;
      this.tourT0 = 0; this.tourIdx = 0; this.railDrag = false; this.lastRailK = 0; this.hop2Lit = null;
      this.pulseT0 = 0;
      // A↔B "storyline" (see buildThread): pick one book, then shift-click a second, and we thread
      // the single longest undirected chain that runs into A, between A and B, and out of B.
      this.thread = null;     // { connected, a, b, nodes:[ordered idx…], aPos, bPos }
      this.threadT0 = 0;      // storyline reveal-animation start (mirrors igniteT0)
      this.armPick = false;   // touch/keyboard-less: panel button armed the next tap as the 2nd pick
      // ambient / interaction animation state
      this.mouse = null;      // {mx,my} canvas-relative pointer for the gravitational cursor
      this.morph = null;      // active lens-swap "reconstellation" transition
      this.igniteT0 = 0;      // focus "ignition" start timestamp (0 = none)
      this.lastT = 0;         // last frame time for the spring integrator's dt
      // per-node motion buffers live on the prepped graph (this.graph.ax/ay/ox/oy/vx/vy + seeds),
      // so they auto-reset to the right size whenever prep() swaps lenses — see buildMotion().

      this.init();
    }

    // ---------------------------------------------------------------- lifecycle
    init() {
      const root = this.root;
      this.graph = this.prep(this.fullData[this.mode]);
      this.wrapEl = root.querySelector('#wrap');
      this.canvasEl = root.querySelector('#canvas');
      this.railEl = root.querySelector('#rail');
      this.railThumbEl = root.querySelector('#railThumb');
      this.searchEl = root.querySelector('#search');
      this.dropdownEl = root.querySelector('#dropdown');
      this.chipEl = root.querySelector('#chip');
      this.panelEl = root.querySelector('#panel');
      this.pathHintEl = root.querySelector('#pathHint');
      this.modesEl = root.querySelector('#modes');
      this.modesCompactEl = root.querySelector('#modesCompact');
      this.modesPopEl = root.querySelector('#modesPop');

      this.setupCanvas();
      this.enterView();

      // static chrome wiring
      this.searchEl.addEventListener('input', this.onSearch);
      this.searchEl.addEventListener('focus', this.onSearchFocus);
      this.searchEl.addEventListener('blur', this.onSearchBlur);
      root.querySelector('#zoomIn').addEventListener('click', () => { const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight; this.zoomAt(w / 2, h / 2, 1.5); });
      root.querySelector('#zoomOut').addEventListener('click', () => { const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight; this.zoomAt(w / 2, h / 2, 1 / 1.5); });
      root.querySelector('#fit').addEventListener('click', () => { this.clearThread(); this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.fit(); });
      if (this.modesEl) this.modesEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]'); if (!btn) return;
        this.setMode(btn.getAttribute('data-mode'));
        if (this.modesPopEl) this.modesPopEl.classList.remove('open');
      });
      if (this.modesCompactEl) this.modesCompactEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.modesPopEl) this.modesPopEl.classList.toggle('open');
      });
      this.modesOutsideClickH = (e) => {
        if (this.modesPopEl && this.modesPopEl.classList.contains('open') && !this.modesEl.contains(e.target)) {
          this.modesPopEl.classList.remove('open');
        }
      };
      document.addEventListener('click', this.modesOutsideClickH);
      if (this.modesCompactEl) this.modesCompactEl.classList.toggle('filtered', this.mode !== 'all');
      this.railEl.addEventListener('pointerdown', (e) => { this.railDrag = true; try { e.target.setPointerCapture(e.pointerId); } catch (_) {} this.railApply(e); });
      this.railEl.addEventListener('pointermove', (e) => { if (this.railDrag) this.railApply(e); });
      this.railEl.addEventListener('pointerup', () => { this.railDrag = false; });

      this.canvasEl.addEventListener('mousedown', this.handleDown);
      this.canvasEl.addEventListener('mousemove', this.handleMove);
      window.addEventListener('mouseup', this.handleUp);
      this.canvasEl.addEventListener('mouseleave', this.handleLeave);
      this.canvasEl.addEventListener('click', this.handleClick);

      this.keyH = (e) => {
        if (e.key === 'Escape') { this.clearThread(); this.armPick = false; this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.dirty = true; if (this.modesPopEl) this.modesPopEl.classList.remove('open'); }
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
      document.removeEventListener('click', this.modesOutsideClickH);
    }

    // Swap to a different lens's independently-laid-out graph (see tools/build-book-graph.mjs —
    // "fiction"/"nonfiction" aren't the "all" layout with nodes hidden, they're recomputed from
    // scratch, so degree/rings/positions genuinely differ per mode). Resets camera + open focus.
    setMode(mode) {
      if (mode === this.mode || !this.fullData[mode]) return;
      const prev = this.graph;
      this.mode = mode;
      // the storyline is indexed to the old lens's node array — it can't survive a lens swap
      this.thread = null; this.threadT0 = 0; this.armPick = false; this.hidePathHint();
      this.graph = this.prep(this.fullData[mode]);
      this.hover = -1; this.tourT0 = 0; this.tourIdx = 0;
      this.pulseOn = !this.reduceMotion; this.pulseT0 = 0;  // replay the intro spotlight pulse for the new lens
      if (this.modesEl) this.modesEl.querySelectorAll('[data-mode]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode);
      });
      if (this.modesCompactEl) this.modesCompactEl.classList.toggle('filtered', mode !== 'all');
      this.setState({ focus: -1, panelOpen: false, searchQ: '', searchResults: [], popular: false });
      if (this.reduceMotion || !prev) { this.morph = null; this.enterView(); }
      else { this.buildMorph(prev, this.graph); this.dirty = true; } // animate in place — camera stays put
    }
    // "Reconstellation" transition: books present in both lenses glide from their old position to
    // their new one (matched by stable `key`), books only in the new lens fade in, books only in
    // the old lens fade out as ghosts. Positions are interpolated in computePositions(); alphas in
    // draw(). Camera is left untouched so you watch the sky reorganize.
    buildMorph(prev, next) {
      const oldByKey = new Map();
      for (const nd of prev.G.nodes) if (nd.key) oldByKey.set(nd.key, { x: nd.x, y: nd.y });
      const N = next.G.nodes, n = N.length;
      const from = new Array(n), fadeIn = new Uint8Array(n), newKeys = new Set();
      for (let i = 0; i < n; i++) {
        const nd = N[i]; if (nd.key) newKeys.add(nd.key);
        const o = nd.key && oldByKey.get(nd.key);
        if (o) from[i] = { x: o.x, y: o.y };
        else { from[i] = { x: nd.x, y: nd.y }; fadeIn[i] = 1; }
      }
      const leaving = [];
      for (const nd of prev.G.nodes) if (!nd.key || !newKeys.has(nd.key)) {
        leaving.push({ x: nd.x, y: nd.y, r: 2 + Math.sqrt((nd.o || 0) + (nd.i || 0)) * 1.2 });
      }
      this.morph = { t0: performance.now(), dur: 900, p: 0, from, fadeIn, leaving };
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
      // The one always-on "spotlight" (pulse ring + persistent label) must be a node the radial
      // layout actually drew near the visual center. labelOrder[0] (PageRank `ls`, rewards being
      // *cited*) is normally that node, and is preferred here to avoid a "book-about-books" hub
      // (high out-degree, cites everything, cited by nobody) winning the spotlight just by
      // name-dropping widely. But in small/sparse lenses a handful of citations can win a
      // disproportionate PageRank share for a node the layout still parks near the rim (low total
      // degree) — using labelOrder[0] blindly then spotlights a book sitting visibly off to the
      // side. So: use labelOrder[0] only if the layout placed it inside the well-connected inner
      // band; otherwise fall back to order[0] (raw degree — the same ranking targetRadius() in
      // tools/build-book-graph.mjs centers on), which is guaranteed near-center by construction.
      const SPOTLIGHT_R = c.extent * 0.22; // ≈ the "8+ CONNECTIONS" ring boundary
      const rad = i => Math.hypot(G.nodes[i].x, G.nodes[i].y);
      c.spotlight = labelOrder.length
        ? (rad(labelOrder[0]) <= SPOTLIGHT_R ? labelOrder[0] : order[0])
        : -1;
      c.chains = this.buildChains(c);
      this.buildMotion(c);
      return c;
    }
    // Per-node ambient-motion state, tied to this lens's node indexing (auto-reset on lens swap).
    // Seeds (phase/frequency/amplitude/twinkle) are deterministic from the node index — no runtime
    // RNG — so the field looks identical every load. Spring state (ox/oy/vx/vy) starts at rest;
    // ax/ay (animated world positions, read by draw()/pick()) start at the baked positions so hit-
    // testing works before the first computePositions() runs and under prefers-reduced-motion.
    buildMotion(c) {
      const N = c.G.nodes, n = N.length, TAU = Math.PI * 2;
      const frac = x => x - Math.floor(x);
      const h = (i, s) => frac(Math.sin((i + 1) * s) * 43758.5453);
      c.sPhX = new Float64Array(n); c.sPhY = new Float64Array(n);
      c.sFx = new Float64Array(n); c.sFy = new Float64Array(n);
      c.sAmp = new Float64Array(n); c.sTwPh = new Float64Array(n); c.sTwFq = new Float64Array(n);
      c.ox = new Float64Array(n); c.oy = new Float64Array(n);
      c.vx = new Float64Array(n); c.vy = new Float64Array(n);
      c.ax = new Float64Array(n); c.ay = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        c.sPhX[i] = h(i, 12.9898) * TAU; c.sPhY[i] = h(i, 78.233) * TAU;
        c.sFx[i] = 0.28 + h(i, 3.17) * 0.34; c.sFy[i] = 0.28 + h(i, 5.91) * 0.34;
        const deg = (N[i].o || 0) + (N[i].i || 0);
        c.sAmp[i] = 9 - 7 * Math.min(1, Math.sqrt(deg) / 6); // hubs near-anchored (≈2), leaves shimmer (≈9)
        c.sTwPh[i] = h(i, 1.7) * TAU; c.sTwFq[i] = 1.3 + h(i, 9.1) * 1.9;
        c.ax[i] = N[i].x; c.ay[i] = N[i].y;
      }
    }
    buildChains(c) {
      const res = [], used = new Set();
      const deg = i => c.G.nodes[i].o + c.G.nodes[i].i;
      for (const s of c.order) {
        if (res.length >= 20) break;
        const seen = new Set([s]); const path = [s]; let cur = s;
        while (path.length < 6) {
          let best = -1, bd = -1;
          // undirected: c.adjOut alone starves in lenses where most backbone nodes are pure
          // "sink" targets (0 outbound edges within this lens) — walk c.neigh instead (both
          // directions), tie-breaking on total degree since every mention edge weight is 1
          // anyway (mentions is UNIQUE(source,target); see file header).
          for (const j of c.neigh[cur]) if (!seen.has(j) && deg(j) > bd) { bd = deg(j); best = j; }
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
          const [bxT, byT] = this.axisScales();
          this.view.x -= dx / (bxT * this.view.k); this.view.y -= dy / (byT * this.view.k);
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
        if (this.touchStart && !this.touchStart.moved && !this.morph && Date.now() - this.touchStart.t < 500) {
          const r = wrap.getBoundingClientRect();
          const i = this.pick(this.touchStart.x - r.left, this.touchStart.y - r.top, true);
          if (this.armPick && this.state.focus >= 0 && i >= 0 && i !== this.state.focus) { this.buildThread(this.state.focus, i); }
          else if (this.thread) { this.clearThread(); if (i >= 0 && i !== this.state.focus) this.focusNode(i); }
          else if (i < 0 || i === this.state.focus) { this.clearFocus(); }
          else this.focusNode(i);
        }
        this.touchStart = null;
      }, { passive: false });
    }

    // Per-axis world→screen scale so the fixed circular layout stretches into an ellipse
    // matching the live container's aspect ratio (wide oval on desktop, tall oval on mobile
    // portrait) instead of being letterboxed to whichever dimension is smaller. No clamp —
    // full bleed, the ellipse always touches every edge of the container.
    axisScales() {
      const c = this.graph; if (!c) return [1, 1];
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      return [w / c.extent, h / c.extent];
    }
    fit() {
      if (!this.graph) return;
      this.view = { x: 0, y: 0, k: 1 };
      this.dirty = true;
    }
    // Camera reset used for "the view just changed under you" moments (first load, lens
    // switch) — starts zoomed past the sparse outer rim for an immersive drop-into-the-network
    // feel, rather than the full "everything at once" overview `fit()` shows. The FIT button
    // still calls fit() directly — it's the one explicit "zoom all the way out" affordance.
    enterView() {
      this.fit();
      this.view.k = Constellation.IMMERSIVE_K;
      this.dirty = true;
    }
    toScreen(x, y) {
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      const [bx, by] = this.axisScales();
      return [(x - this.view.x) * bx * this.view.k + w / 2, (y - this.view.y) * by * this.view.k + h / 2];
    }
    toWorld(sx, sy) {
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      const [bx, by] = this.axisScales();
      return [(sx - w / 2) / (bx * this.view.k) + this.view.x, (sy - h / 2) / (by * this.view.k) + this.view.y];
    }
    zoomAt(mx, my, f) {
      const [wx, wy] = this.toWorld(mx, my);
      const k2 = Math.max(0.1, Math.min(10, this.view.k * f));
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight;
      const [bx, by] = this.axisScales();
      this.view.x = wx - (mx - w / 2) / (bx * k2); this.view.y = wy - (my - h / 2) / (by * k2); this.view.k = k2;
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
        // ambient drift/twinkle/spring animate every frame; rAF already pauses on hidden tabs
        this.dirty = true;
      }
      if (this.dirty) { this.dirty = false; this.draw(); }
    };

    nodeR(n) {
      const [bx, by] = this.axisScales();
      const refK = Math.min(bx, by) * this.view.k;
      return Math.max(2.8, Math.min(24, (2 + Math.sqrt(n.o + n.i) * 1.5) * Math.sqrt(refK) * 1.35));
    }
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

    // seg (0..1) grows the line for the focus "ignition" reveal: anchorStart=true grows from
    // (x1,y1) outward toward (x2,y2); anchorStart=false grows from the (x2,y2) end back toward
    // (x1,y1) — used for inbound arrows so they still extend outward from the focused node while
    // keeping their dash flow direction. seg omitted ⇒ full line (steady state).
    arrow(ctx, x1, y1, x2, y2, col, alpha, lw, seg, anchorStart) {
      if (seg == null) seg = 1; else if (seg <= 0) return;
      let ax1 = x1, ay1 = y1, ax2 = x2, ay2 = y2;
      if (seg < 1) {
        if (anchorStart === false) { ax1 = x2 + (x1 - x2) * seg; ay1 = y2 + (y1 - y2) * seg; }
        else { ax2 = x1 + (x2 - x1) * seg; ay2 = y1 + (y2 - y1) * seg; }
      }
      ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = lw;
      const flow = this.reduceMotion ? 0 : (performance.now() / 40) % 20;
      ctx.setLineDash([9, 11]); ctx.lineDashOffset = -flow;
      ctx.beginPath(); ctx.moveTo(ax1, ay1); ctx.lineTo(ax2, ay2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.globalAlpha = 1;
    }

    // Small filled triangle at (tipX,tipY) pointing along `angle` — used to mark the true
    // direction of a storyline mention (see the thread block in draw()).
    arrowHead(ctx, tipX, tipY, angle, col, size) {
      const s = size, spread = 0.45;
      ctx.fillStyle = col; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - s * Math.cos(angle - spread), tipY - s * Math.sin(angle - spread));
      ctx.lineTo(tipX - s * Math.cos(angle + spread), tipY - s * Math.sin(angle + spread));
      ctx.closePath(); ctx.fill();
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

    // Fill c.ax/c.ay (animated world positions) for every backbone node, once per frame. Layers:
    // (1) analytic drift = gentle per-node breathing around the baked position; (2) reconstellation
    // morph = glide old→new position during a lens swap; (3) a damped spring per node that pulls
    // toward the pointer (gravitational cursor) and settles back with a little overshoot. Under
    // prefers-reduced-motion this is a straight copy of the baked positions.
    computePositions(t) {
      const c = this.graph; if (!c) return;
      const N = c.G.nodes, n = N.length, ax = c.ax, ay = c.ay;
      if (this.reduceMotion) { for (let i = 0; i < n; i++) { ax[i] = N[i].x; ay[i] = N[i].y; } return; }
      const dt = this.lastT ? Math.min(0.048, (t - this.lastT) / 1000) : 0.016; this.lastT = t;
      const ts = t / 1000;
      let mp = 1, morph = this.morph;
      if (morph) { const raw = Math.min(1, (t - morph.t0) / morph.dur); mp = 1 - Math.pow(1 - raw, 3); morph.p = mp; if (raw >= 1) { this.morph = null; morph = null; } }
      // cursor gravity: off while dragging, focused, or mid-morph (keeps those states stable)
      let hasCur = false, cwx = 0, cwy = 0;
      if (this.mouse && !this.dragging && this.state.focus < 0 && !morph) {
        const wc = this.toWorld(this.mouse.mx, this.mouse.my); cwx = wc[0]; cwy = wc[1]; hasCur = true;
      }
      const R = 190, R2 = R * R, KS = 90, KD = 14, KC = 30;
      const ox = c.ox, oy = c.oy, vx = c.vx, vy = c.vy;
      for (let i = 0; i < n; i++) {
        const b = N[i], amp = c.sAmp[i];
        let hx = b.x + Math.sin(ts * c.sFx[i] + c.sPhX[i]) * amp;
        let hy = b.y + Math.cos(ts * c.sFy[i] + c.sPhY[i]) * amp;
        if (morph) { const ef = morph.from[i]; if (ef) { hx = ef.x + (hx - ef.x) * mp; hy = ef.y + (hy - ef.y) * mp; } }
        let px = ox[i], py = oy[i], pvx = vx[i], pvy = vy[i];
        let accx = -KS * px - KD * pvx, accy = -KS * py - KD * pvy;
        if (hasCur) {
          // smooth attraction well: force ∝ (cursor−node), tapering to 0 at radius R AND at the
          // cursor itself — so a node resting under the pointer feels ~no force (no jitter), and
          // the pull is a gentle lean rather than a yank.
          const dx = cwx - (hx + px), dy = cwy - (hy + py), d2 = dx * dx + dy * dy;
          if (d2 < R2) { const fall = 1 - Math.sqrt(d2) / R; accx += dx * KC * fall; accy += dy * KC * fall; }
        }
        pvx += accx * dt; pvy += accy * dt; px += pvx * dt; py += pvy * dt;
        if (px * px + py * py < 1e-4 && pvx * pvx + pvy * pvy < 1e-4) { px = 0; py = 0; pvx = 0; pvy = 0; } // settle to exact rest
        ox[i] = px; oy[i] = py; vx[i] = pvx; vy[i] = pvy;
        ax[i] = hx + px; ay[i] = hy + py;
      }
    }
    nodeScreen(i) { const c = this.graph; return this.toScreen(c.ax[i], c.ay[i]); }

    draw() {
      const ctx = this.ctx; const c = this.graph; if (!ctx || !c) return;
      this.computePositions(performance.now());
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight, dpr = this.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#f7f5f0'; ctx.fillRect(0, 0, w, h);
      const k = this.view.k;
      const [bx, by] = this.axisScales();
      const refK = Math.min(bx, by) * k;
      const thr = this.thread; // A↔B storyline takes over highlighting when active
      const focus = thr ? -1 : (this.state.focus >= 0 ? this.state.focus : this.hover);
      const hasFocus = focus >= 0;
      const N = c.G.nodes;
      // storyline reveal: nodes/segments light up sequentially from the lead-in tail to the tail-out
      let threadPos = null, threadReveal = 1;
      if (thr) {
        threadPos = new Map(); thr.nodes.forEach((idx, p) => threadPos.set(idx, p));
        const TH_MS = 1100;
        threadReveal = (this.reduceMotion || !this.threadT0) ? 1 : Math.min(1, (performance.now() - this.threadT0) / TH_MS);
      }
      const threadLit = i => { // 0→1 reveal fraction for a thread node at chain index p
        const p = threadPos.get(i); return Math.max(0, Math.min(1, threadReveal * thr.nodes.length - p));
      };
      const showRings = this.props.showRings;
      const mob = this.state.isMobile;

      // reconstellation morph (lens swap in flight) — computePositions clears this.morph when done
      const morph = this.morph, mp = morph ? morph.p : 1;
      const mEdgeA = morph ? Math.max(0, (mp - 0.35) / 0.65) : 1; // edges fade in over the back half
      // focus "ignition": lines/nodes light up outward from the clicked node over IGNITE_MS.
      // Only a real click (state.focus) ignites; hover-focus is instant. ip=1 ⇒ steady state.
      const IGNITE_MS = 700;
      const ip = (this.state.focus >= 0 && !this.reduceMotion && this.igniteT0)
        ? Math.min(1, (performance.now() - this.igniteT0) / IGNITE_MS) : 1;
      const smooth = s => s <= 0 ? 0 : s >= 1 ? 1 : s * s * (3 - 2 * s);
      const seg1 = smooth(ip / 0.55);              // 1-hop window [0, 0.55]
      const seg2 = smooth((ip - 0.4) / 0.6);       // 2-hop window [0.4, 1.0]

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
          const srx = ring.r * bx * k, sry = ring.r * by * k;
          ctx.beginPath(); ctx.ellipse(cx, cy, srx, sry, 0, 0, 7);
          ctx.strokeStyle = 'rgba(20,20,20,0.055)'; ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
          if (refK > 0.35 && !hasFocus && !thr) {
            ctx.font = '400 9px "IBM Plex Mono", monospace';
            ctx.fillStyle = 'rgba(20,20,20,0.30)';
            ctx.fillText(ring.v + '+ CONNECTIONS', cx, cy - sry - 4);
          }
        }
      }

      if (mEdgeA > 0 && !thr) for (const [i, j, wt0] of c.G.edges) {
        const wt = wt0 || 1;
        if (hasFocus) continue;
        const [x1, y1] = this.nodeScreen(i);
        const [x2, y2] = this.nodeScreen(j);
        if ((x1 < 0 && x2 < 0) || (x1 > w && x2 > w) || (y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) continue;
        ctx.strokeStyle = '#141414';
        ctx.globalAlpha = Math.min(0.16, 0.05 + wt * 0.02) * mEdgeA;
        ctx.lineWidth = Math.min(3, 0.5 + wt * 0.3);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // A↔B storyline: each link drawn in its TRUE mention direction (arrowhead + flow point the
      // real way a book cites another; a mutual pair gets a double head). Undirected pathfinding
      // still chose the chain — only the drawing is directional, so nothing reads backwards.
      if (thr) {
        if (thr.connected) {
          const CO = '#9c3d22'; // one honest colour = "a mention"
          const pts = thr.nodes.map(i => this.nodeScreen(i));
          const len = thr.nodes.length;
          const head = (fromP, toP, toIdx) => {
            const ang = Math.atan2(toP[1] - fromP[1], toP[0] - fromP[0]);
            const back = this.nodeR(N[toIdx]) + 3.5; // sit the tip just off the target star
            this.arrowHead(ctx, toP[0] - Math.cos(ang) * back, toP[1] - Math.sin(ang) * back, ang, CO, 8);
          };
          for (let p = 0; p < len - 1; p++) {
            const sg = Math.max(0, Math.min(1, threadReveal * (len - 1) - p));
            if (sg <= 0) break; // reveal marches forward — nothing past here is lit yet
            const u = thr.nodes[p], v = thr.nodes[p + 1];
            const uv = c.adjOut[u].some(e => e[0] === v); // u mentions v
            const vu = c.adjOut[v].some(e => e[0] === u); // v mentions u
            const between = (p + 1 > thr.aPos) && (p < thr.bPos); // on the A↔B bridge → heavier line
            const lw = between ? 2.6 : 1.5, al = between ? 0.8 : 0.55;
            if (uv && vu) {
              // mutual mention: static line (no flow implies no single direction), grows in chain order
              const gx = pts[p][0] + (pts[p + 1][0] - pts[p][0]) * sg, gy = pts[p][1] + (pts[p + 1][1] - pts[p][1]) * sg;
              ctx.strokeStyle = CO; ctx.globalAlpha = al; ctx.lineWidth = lw;
              ctx.setLineDash([9, 7]); ctx.lineDashOffset = 0;
              ctx.beginPath(); ctx.moveTo(pts[p][0], pts[p][1]); ctx.lineTo(gx, gy); ctx.stroke();
              ctx.setLineDash([]); ctx.globalAlpha = 1;
            } else {
              // one-way: grow + flow from the real source toward the real target
              const src = uv ? pts[p] : pts[p + 1], dst = uv ? pts[p + 1] : pts[p];
              this.arrow(ctx, src[0], src[1], dst[0], dst[1], CO, al, lw, sg, true);
            }
            if (sg >= 0.9) { if (uv) head(pts[p], pts[p + 1], v); if (vu) head(pts[p + 1], pts[p], u); }
          }
        }
        for (const ep of [thr.a, thr.b]) {
          const [ex, ey] = this.nodeScreen(ep);
          ctx.beginPath(); ctx.arc(ex, ey, this.nodeR(N[ep]) + 5, 0, 7);
          ctx.strokeStyle = this.genreCol(N[ep]); ctx.globalAlpha = 0.9; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
        }
      }

      if (this.state.focus >= 0) {
        const lp = this.leafPositions(this.state.focus);
        const [fx, fy] = this.nodeScreen(this.state.focus);
        for (const p of lp) {
          const [sx, sy] = this.toScreen(p.x, p.y);
          this.arrow(ctx, fx, fy, sx, sy, '#9c3d22', 0.45, 0.9, seg1, true);
          if (seg1 >= 0.98) {                       // dot appears once the line reaches the leaf
            ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, 7);
            ctx.fillStyle = '#fdfcfa'; ctx.fill();
            ctx.strokeStyle = '#9c3d22'; ctx.lineWidth = 1; ctx.stroke();
          }
        }
        // leaf *labels* are drawn later (in the label pass) so they respect the collision set
      }

      const hovChain = hasFocus && this.state.focus >= 0 && this.hover >= 0 && this.hover !== focus && c.neigh[focus].has(this.hover) ? this.hover : -1;
      this.hop2Lit = hovChain >= 0 ? new Set(c.adjOut[hovChain].map(e => e[0])) : null;
      if (hasFocus && seg2 > 0) {
        const flow = this.reduceMotion ? 0 : (performance.now() / 55) % 14;
        ctx.setLineDash([4, 10]); ctx.lineDashOffset = -flow;
        for (const j of c.neigh[focus]) {
          ctx.strokeStyle = '#a04a2a';
          ctx.globalAlpha = (j === hovChain ? 0.7 : hovChain >= 0 ? 0.08 : 0.28) * seg2;
          ctx.lineWidth = j === hovChain ? 1.4 : 0.8;
          ctx.beginPath();
          const [jx, jy] = this.nodeScreen(j);
          for (const [j2] of c.adjOut[j]) {
            if (j2 === focus || c.neigh[focus].has(j2)) continue;
            const [kx, ky] = this.nodeScreen(j2);
            ctx.moveTo(jx, jy); ctx.lineTo(jx + (kx - jx) * seg2, jy + (ky - jy) * seg2); // grow outward from j
          }
          ctx.stroke();
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      if (hasFocus) {
        const [fx, fy] = this.nodeScreen(focus);
        let strongJ = -1, strongW = -1;
        for (const [j, wt] of c.adjOut[focus]) if (wt > strongW) { strongW = wt; strongJ = j; }
        for (const [j, wt] of c.adjOut[focus]) {
          const [jx, jy] = this.nodeScreen(j);
          const em = j === strongJ;
          this.arrow(ctx, fx, fy, jx, jy, '#9c3d22', em ? 0.85 : 0.6, Math.min(4, 0.8 + wt * 0.5) + (em ? 0.8 : 0), seg1, true);
        }
        for (const [j, wt] of c.adjIn[focus]) {
          const [jx, jy] = this.nodeScreen(j);
          this.arrow(ctx, jx, jy, fx, fy, '#2f5590', 0.6, Math.min(4, 0.8 + wt * 0.5), seg1, false); // grow from focus end
        }
      }

      const nowS = performance.now() / 1000;
      for (let i = 0; i < N.length; i++) {
        const n = N[i];
        const [sx, sy] = this.nodeScreen(i);
        if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
        const tw = this.reduceMotion ? 1 : 1 + Math.sin(nowS * c.sTwFq[i] + c.sTwPh[i]) * 0.12; // twinkle
        const r = this.nodeR(n) * tw;
        const isF = i === focus;
        const conn = hasFocus && c.neigh[focus].has(i);
        const inHop2 = hasFocus && hop2.has(i);
        const lit2 = inHop2 && this.hop2Lit && this.hop2Lit.has(i);
        const gc = this.genreCol(n);
        // popular stars get a soft breathing halo (at rest, zoomed in enough to read as glow)
        if (!hasFocus && !thr && !morph && !this.reduceMotion && refK > 0.55) {
          const glow = Math.max(0, Math.min(1, ((n.ls || 0) - 15) / 60));
          if (glow > 0) {
            ctx.globalAlpha = glow * 0.2 * (0.7 + 0.3 * Math.sin(nowS * c.sTwFq[i] + c.sTwPh[i]));
            ctx.beginPath(); ctx.arc(sx, sy, r * 2.4, 0, 7); ctx.fillStyle = gc; ctx.fill();
          }
        }
        // focus lighting ramps outward with the ignition (seg1 for 1-hop, seg2 for 2-hop);
        // storyline mode overrides: chain books light up in sequence, everything else dims right down.
        const inThread = thr && threadPos.has(i);
        let ga;
        if (thr) ga = inThread ? 0.12 + 0.88 * threadLit(i) : 0.09;
        else if (!hasFocus) ga = 1;
        else if (isF) ga = 1;
        else if (conn) ga = 0.12 + 0.88 * seg1;
        else if (lit2) ga = 0.12 + 0.88 * seg2;
        else if (inHop2) ga = (this.hop2Lit ? 0.15 : 0.45) * seg2;
        else ga = 0.12;
        if (morph && morph.fadeIn[i]) ga *= mp; // new-lens-only stars fade in during the morph
        ctx.globalAlpha = ga;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7);
        const hovered = i === this.hover && !mob && !thr;
        if (inThread) {
          const end = i === thr.a || i === thr.b;
          ctx.fillStyle = end ? gc : '#fdfcfa'; ctx.fill();
          ctx.strokeStyle = gc; ctx.lineWidth = end ? 1.8 : 1.3; ctx.stroke();
        } else {
          ctx.fillStyle = isF ? gc : hovered ? gc : '#fdfcfa'; ctx.fill();
          ctx.strokeStyle = (isF || hovered) ? gc : '#141414'; ctx.lineWidth = isF ? 1.5 : 1.1; ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // leaving stars (books not in the new lens) fade out as ghosts during a morph
      if (morph && morph.leaving.length) {
        ctx.fillStyle = '#141414';
        for (const g of morph.leaving) {
          const [sx, sy] = this.toScreen(g.x, g.y);
          if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
          ctx.globalAlpha = 0.5 * (1 - mp);
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, g.r * Math.sqrt(refK)), 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      if (this.pulseOn && !hasFocus && !thr && !this.reduceMotion && c.spotlight >= 0) {
        const t = performance.now();
        if (!this.pulseT0) this.pulseT0 = t;
        const PULSE_MS = 1600, MAX_PULSES = 10;
        const elapsed = t - this.pulseT0;
        if (elapsed >= PULSE_MS * MAX_PULSES) {
          this.pulseOn = false;   // hand off to the ambient tour, uncontested
        } else {
          const top = c.spotlight;
          const [px, py] = this.nodeScreen(top);
          const ph = (elapsed % PULSE_MS) / PULSE_MS;
          const pr = this.nodeR(N[top]) + 6 + ph * 26;
          ctx.beginPath(); ctx.arc(px, py, pr, 0, 7);
          ctx.strokeStyle = 'rgba(156,61,34,' + (0.55 * (1 - ph)).toFixed(3) + ')';
          ctx.lineWidth = 2; ctx.stroke();
        }
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
      if (thr) {
        // label every book on the storyline (chain is short) — endpoints emphasised
        thr.nodes.forEach((idx, p) => {
          if (threadLit(idx) < 0.5) return; // wait for the reveal to reach this book
          const n = N[idx];
          const [sx, sy] = this.nodeScreen(idx);
          if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) return;
          const end = idx === thr.a || idx === thr.b;
          const fs = end ? 15 : 11.5;
          ctx.font = 'italic ' + (end ? '700 ' : '600 ') + fs + 'px "Instrument Serif", Georgia, serif';
          let label = n.n; if (label.length > 30) label = label.slice(0, 28) + '…';
          const twd = ctx.measureText(label).width;
          const ly = place(sx, sy, twd, fs, this.nodeR(n), 14, 8);
          if (ly === null) return;
          ctx.fillStyle = 'rgba(247,245,240,0.9)'; ctx.fillRect(sx - twd / 2 - 3, ly - fs, twd + 6, fs + 4);
          ctx.fillStyle = end ? this.genreCol(n) : '#141414';
          ctx.fillText(label, sx, ly);
        });
      } else if (hasFocus) {
        let nb = [...c.neigh[focus]].sort((a, b) => (N[b].ls || 0) - (N[a].ls || 0));
        let h2list;
        if (this.hop2Lit) h2list = [...this.hop2Lit];
        else { h2list = [...hop2].sort((a, b) => (N[b].ls || 0) - (N[a].ls || 0)).slice(0, 8); }
        if (mob) { nb = nb.slice(0, 12); h2list = h2list.slice(0, 4); }
        const list = [[focus, 1], ...nb.map(i => [i, 0]), ...h2list.map(i => [i, 2])];
        for (const [i, tier] of list) {
          const n = N[i];
          const [sx, sy] = this.nodeScreen(i);
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
          if (lp2.length <= 40 || refK > 1.4) {
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
        const drawLabel = (i) => {
          const n = N[i];
          const [sx, sy] = this.nodeScreen(i);
          if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) return false;
          const fs = Math.max(mob ? 12 : 10.5, Math.min(17, 9 + Math.sqrt(n.o + n.i) * 0.75));
          ctx.font = 'italic 600 ' + fs + 'px "Instrument Serif", Georgia, serif';
          let label = n.n; if (label.length > 30) label = label.slice(0, 28) + '…';
          const twd = ctx.measureText(label).width;
          const ly = sy - this.nodeR(n) - 6;
          if (!tryPlace(sx, ly - fs / 2, twd + 44, fs + 26)) return false;
          ctx.fillStyle = 'rgba(247,245,240,0.88)'; ctx.fillRect(sx - twd / 2 - 3, ly - fs, twd + 6, fs + 4);
          ctx.fillStyle = 'rgba(20,20,20,0.78)';
          ctx.fillText(label, sx, ly);
          return true;
        };
        // the single always-on "spotlight" book — see prep()'s `c.spotlight`: normally
        // labelOrder[0] (PageRank-style `ls`, rewards being *cited*, so a book-about-books
        // can't win just by out-citing everything), but falls back to order[0] (raw degree)
        // when that pick sits outside the well-connected inner band (visually off at the rim).
        const top = c.spotlight;
        if (top >= 0) drawLabel(top);
        // everything else ramps up from ~nothing at the default fit zoom as the user zooms in
        const zoomBudget = refK < 0.6 ? 0 : refK < 0.9 ? 4 : refK < 1.3 ? 10 : refK < 1.8 ? 24 : Math.min(70, (w * h) / 60000 * 1.5);
        const zoomRankCap = refK < 0.6 ? 0 : refK < 0.9 ? 12 : refK < 1.3 ? 30 : refK < 1.8 ? 60 : N.length;
        const budget = Math.round(zoomBudget * density);
        const rankCap = Math.round(zoomRankCap * density);
        let count = 0, rank = 0;
        if (!morph) for (const i of c.labelOrder) {
          if (i === top) continue;
          rank++;
          if (count >= budget || rank > rankCap) break;
          if (drawLabel(i)) count++;
        }
      }

      // ambient constellation tour (drawn last so its labels stay readable)
      if (!hasFocus && !thr && this.props.ambientTours && !morph) {
        const ti = this.tourInfo(c);
        if (ti && ti.a > 0.01) {
          const a = ti.a, path = ti.path;
          const pts = path.map(i => this.nodeScreen(i));
          ctx.strokeStyle = '#9c3d22'; ctx.globalAlpha = a * 0.55; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
          for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
          ctx.stroke();
          for (let p = 0; p < pts.length; p++) {
            const rr = this.nodeR(N[path[p]]);
            ctx.beginPath(); ctx.arc(pts[p][0], pts[p][1], rr, 0, 7);
            ctx.fillStyle = '#9c3d22'; ctx.strokeStyle = '#9c3d22'; ctx.lineWidth = 1.1;
            ctx.globalAlpha = a; ctx.fill(); ctx.stroke();
          }
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
      let best = -1, bd = 1e9;
      for (let i = 0; i < c.G.nodes.length; i++) {
        const n = c.G.nodes[i];
        const [sx, sy] = this.nodeScreen(i); // match the displaced (drift/gravity) star, not the baked spot
        const d = Math.hypot(sx - mx, sy - my);
        const tol = this.nodeR(n) + (touch ? 20 : 8);
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
        const [bxM, byM] = this.axisScales();
        this.view.x -= dx / (bxM * this.view.k); this.view.y -= dy / (byM * this.view.k);
        this.lastMX = e.clientX; this.lastMY = e.clientY;
        this.tween = null; this.dirty = true;
      } else {
        this.mouse = { mx: e.clientX - r.left, my: e.clientY - r.top }; // drives the gravitational cursor
        const hv = this.pick(this.mouse.mx, this.mouse.my);
        if (hv !== this.hover) { this.hover = hv; this.dirty = true; this.wrapEl.style.cursor = hv >= 0 ? 'pointer' : 'grab'; }
      }
    };
    handleUp = () => { this.dragging = false; };
    handleLeave = () => { this.dragging = false; this.mouse = null; if (this.hover >= 0) { this.hover = -1; this.dirty = true; } };
    handleClick = e => {
      if (this.dragMoved || this.morph) return;
      const r = this.wrapEl.getBoundingClientRect();
      const i = this.pick(e.clientX - r.left, e.clientY - r.top);
      // shift-click (or an armed 2nd pick) on a *different* star, with one already focused →
      // thread the two together instead of re-focusing.
      if ((e.shiftKey || this.armPick) && this.state.focus >= 0 && i >= 0 && i !== this.state.focus) {
        this.buildThread(this.state.focus, i); return;
      }
      if (this.thread) { this.clearThread(); if (i < 0) return; }
      if (i < 0 || i === this.state.focus) { this.clearFocus(); return; }
      this.focusNode(i);
    };

    focusNode(i) {
      this.thread = null; this.threadT0 = 0; this.armPick = false; this.hidePathHint(); // single-select exits storyline mode
      this.pulseOn = false;
      this.igniteT0 = performance.now(); // start the "ignition" reveal (draws connections outward)
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
      const [bx, by] = this.axisScales();
      const padX = mob ? 28 : 90, padT = mob ? 66 : 76, padB = mob ? 235 : 110;
      const availW = Math.max(120, w - padX * 2), availH = Math.max(120, h - padT - padB);
      const bw = Math.max(maxX - minX, 120), bh = Math.max(maxY - minY, 120);
      let k = Math.min(availW / (bw * bx), availH / (bh * by));
      k = Math.max(0.6, Math.min(mob ? 3 : 3.5, k));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const sx0 = padX + availW / 2, sy0 = padT + availH / 2;
      this.flyTo(cx - (sx0 - w / 2) / (bx * k), cy - (sy0 - h / 2) / (by * k), k);
      this.dirty = true;
    }

    // ---------------------------------------------------------------- A↔B storyline (undirected)
    // Shortest undirected route between two backbone nodes (BFS over neigh) — the "between" spine.
    shortestPathUndirected(a, b) {
      if (a === b) return [a];
      const c = this.graph, prev = new Map([[a, -1]]), q = [a];
      for (let h = 0; h < q.length; h++) {
        const u = q[h];
        for (const v of c.neigh[u]) {
          if (prev.has(v)) continue;
          prev.set(v, u);
          if (v === b) { const path = [b]; let x = u; while (x !== -1) { path.push(x); x = prev.get(x); } return path.reverse(); }
          q.push(v);
        }
      }
      return null;
    }
    // Longest simple chain starting at `start` that never enters `forbidden` — the tail that runs
    // INTO A / OUT of B. Longest-simple-path is NP-hard, so this is a depth- and visit-budget-bounded
    // DFS returning the best chain found (not a provable maximum); neighbors are expanded
    // highest-degree-first so tails thread through the more notable books. Bounds keep the click snappy.
    longestTail(start, forbidden) {
      const c = this.graph, N = c.G.nodes, MAX = 8;
      const deg = i => N[i].o + N[i].i;
      let best = [], budget = 20000;
      const seen = new Set(forbidden); seen.add(start);
      const stack = [start];
      const dfs = (u, depth) => {
        if (stack.length > best.length) best = stack.slice();
        if (depth >= MAX || budget <= 0) return;
        const nb = [...c.neigh[u]].filter(v => !seen.has(v)).sort((x, y) => deg(y) - deg(x));
        for (const v of nb) {
          if (budget-- <= 0) return;
          seen.add(v); stack.push(v);
          dfs(v, depth + 1);
          stack.pop(); seen.delete(v);
        }
      };
      dfs(start, 0);
      return best; // [start, ...]  (length ≥ 1)
    }
    // Build the storyline: [longest lead-in into A] → A → [route between] → B → [longest tail-out].
    buildThread(a, b) {
      const N = this.graph.G.nodes;
      const spine = this.shortestPathUndirected(a, b);
      if (!spine) {
        this.thread = { connected: false, a, b, nodes: [a, b], aPos: 0, bPos: 1 };
        this.threadT0 = performance.now(); this.armPick = false;
        this.showPathHint('No connection between “' + N[a].n + '” and “' + N[b].n + '” in this lens.');
        this.frameNodes([a, b]);
        this.setState({ focus: -1, panelOpen: false }); this.dirty = true;
        return;
      }
      const used = new Set(spine);
      const inTail = this.longestTail(a, used);          // [a, …] grows away from the spine
      for (const i of inTail) used.add(i);
      const outTail = this.longestTail(b, used);         // [b, …]
      const lead = inTail.slice(1).reverse();            // …→ (into A)
      const tail = outTail.slice(1);                     // (out of B) →…
      const nodes = [...lead, ...spine, ...tail];
      const aPos = lead.length;                          // index of A in the chain
      const bPos = lead.length + spine.length - 1;       // index of B in the chain
      this.thread = { connected: true, a, b, nodes, aPos, bPos };
      this.threadT0 = performance.now(); this.armPick = false; this.hidePathHint();
      this.frameNodes(nodes);
      this.setState({ focus: -1, panelOpen: false }); this.dirty = true;
    }
    // Fly the camera to frame an arbitrary set of nodes (generalises focusNode's bbox math).
    frameNodes(idxs) {
      const c = this.graph, N = c.G.nodes;
      const xs = idxs.map(i => N[i].x), ys = idxs.map(i => N[i].y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = this.wrapEl.clientWidth, h = this.wrapEl.clientHeight, mob = this.state.isMobile;
      const [bx, by] = this.axisScales();
      const padX = mob ? 28 : 90, padT = mob ? 66 : 76, padB = mob ? 235 : 110;
      const availW = Math.max(120, w - padX * 2), availH = Math.max(120, h - padT - padB);
      const bw = Math.max(maxX - minX, 120), bh = Math.max(maxY - minY, 120);
      let k = Math.min(availW / (bw * bx), availH / (bh * by));
      k = Math.max(0.5, Math.min(mob ? 3 : 3.2, k));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const sx0 = padX + availW / 2, sy0 = padT + availH / 2;
      this.flyTo(cx - (sx0 - w / 2) / (bx * k), cy - (sy0 - h / 2) / (by * k), k);
    }
    showPathHint(msg) { if (this.pathHintEl) { this.pathHintEl.textContent = msg; this.pathHintEl.style.display = 'block'; } }
    hidePathHint() { if (this.pathHintEl) this.pathHintEl.style.display = 'none'; }
    clearThread() {
      const had = this.thread || this.armPick;
      this.thread = null; this.threadT0 = 0; this.armPick = false; this.hidePathHint();
      this.tourT0 = 0; this.dirty = true;
      if (had) this.renderChrome(); // focus is already -1 in thread mode → hides the storyline chip
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
      if (this.thread && this.thread.connected) {
        if (st.panelOpen) { chip.style.display = 'none'; chip.innerHTML = ''; this.buildThreadPanel(panel, this.thread); panel.style.display = 'flex'; }
        else { panel.style.display = 'none'; panel.innerHTML = ''; this.buildThreadChip(chip, this.thread); chip.style.display = 'block'; }
        return;
      }
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
      html += '<button class="details" data-act="thread" title="Shift-click another star, or tap one now">THREAD ↔</button>';
      const url = this.bookUrl(fn);
      if (url) html += '<button class="open" data-act="open">OPEN PAGE ↗</button>';
      html += '</div>';
      chip.innerHTML = html;
      chip.querySelector('[data-act="close"]').onclick = () => this.clearFocus();
      const s = chip.querySelector('[data-act="strong"]'); if (s) s.onclick = () => { if (d.strong) this.focusNode(d.strong.idx); };
      chip.querySelector('[data-act="details"]').onclick = () => this.setState({ panelOpen: true });
      chip.querySelector('[data-act="thread"]').onclick = () => { this.armPick = true; this.showPathHint('Now pick a second star to thread it to “' + fn.n + '”.'); };
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

    buildThreadChip(chip, t) {
      const N = this.graph.G.nodes, A = N[t.a], B = N[t.b];
      const between = t.bPos - t.aPos;
      let html = '<div class="top"><div class="name" style="font-size:17px;line-height:1.2;">' + esc(A.n) + ' <span style="opacity:.45;">↔</span> ' + esc(B.n) + '</div><button class="x" data-act="close">✕</button></div>';
      html += '<div class="sub">STORYLINE · ' + t.nodes.length + ' BOOKS · ' + between + (between === 1 ? ' HOP' : ' HOPS') + ' BETWEEN</div>';
      html += '<div class="btns"><button class="details" data-act="list">SEE CHAIN</button></div>';
      chip.innerHTML = html;
      chip.querySelector('[data-act="close"]').onclick = () => this.clearThread();
      chip.querySelector('[data-act="list"]').onclick = () => this.setState({ panelOpen: true });
    }

    buildThreadPanel(panel, t) {
      const N = this.graph.G.nodes, A = N[t.a], B = N[t.b];
      const region = i => i < t.aPos ? 'lead' : i > t.bPos ? 'tail' : 'between';
      let html = '<div class="head"><div class="top"><div class="name" style="font-size:19px;">' + esc(A.n) + ' ↔ ' + esc(B.n) + '</div><button class="x" data-act="close">✕</button></div>';
      html += '<div class="sub">LONGEST STORYLINE THROUGH BOTH · ' + t.nodes.length + ' BOOKS</div></div><div class="body">';
      let last = null;
      t.nodes.forEach((idx, i) => {
        const rg = region(i);
        if (rg !== last) {
          const lbl = rg === 'lead' ? 'LEADS IN' : rg === 'between' ? 'BETWEEN' : 'LEADS OUT';
          const col = rg === 'between' ? '#2f5590' : '#9c3d22';
          html += '<div class="seclabel" style="color:' + col + '">' + lbl + '</div>';
          last = rg;
        }
        const n = N[idx];
        const mark = (idx === t.a || idx === t.b) ? ' ●' : '';
        html += '<div class="item" data-idx="' + idx + '"><div class="n">' + esc(n.n) + mark + '</div><div class="w">' + esc(n.a || '') + '</div></div>';
      });
      html += '</div>';
      panel.innerHTML = html;
      panel.querySelector('[data-act="close"]').onclick = () => this.setState({ panelOpen: false });
      panel.querySelectorAll('.item').forEach(el => { el.onclick = () => this.focusNode(+el.getAttribute('data-idx')); });
    }

    clearFocus() { this.thread = null; this.threadT0 = 0; this.armPick = false; this.hidePathHint(); this.setState({ focus: -1, panelOpen: false }); this.tourT0 = 0; this.igniteT0 = 0; this.dirty = true; }

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
