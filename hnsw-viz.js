/* =============================================================================
   Live HNSW graph-search visualizer.

   A direct port of mcp-memory-server/hnsw-engine/src/hnsw/index.py's
   HNSWIndex -- same _search_layer bounded best-first search, same
   SELECT-NEIGHBORS-HEURISTIC diversity rule (not the simpler nearest-M
   version; the project's own README calls the heuristic out as what
   prevents graph collapse, and dropping it here would misrepresent the
   actual project) -- generalized to also record a trace of every node it
   visits/accepts, which is what drives the step-by-step animation.

   Points are generated directly in 2D and used AS the vectors (Euclidean
   distance), not high-dimensional vectors projected down afterward: a
   node's on-screen position IS its vector, so the search path lighting up
   is the algorithm's actual geometric behaviour, not a layout artifact.
============================================================================= */

(function () {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------------------------------------- hnsw index */
  class HNSWIndex {
    constructor(dim, opts) {
      opts = opts || {};
      this.dim = dim;
      this.M = opts.M || 5;
      this.mMax0 = 2 * this.M;
      this.efConstruction = opts.efConstruction || 32;
      this.mL = 1 / Math.log(this.M);
      this._rng = mulberry32(opts.seed || 1);

      this.vectors = {};
      this.layers = []; // layers[l] = { id: [neighborId, ...] }
      this.entryPoint = null;
      this.maxLayer = -1;
    }

    size() {
      return Object.keys(this.vectors).length;
    }

    _dist(a, b) {
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    }

    _randomLevel() {
      return Math.floor(-Math.log(this._rng()) * this.mL);
    }

    // Port of Algorithm 2 (SEARCH-LAYER). `trace`, when passed, records
    // {type:'visit', id} and {type:'accept', id, from} events in the exact
    // order the search performs them -- this is the sole extra behaviour
    // beyond the Python original, and it drives the animation only; insert()
    // and search() call this without a trace and pay nothing extra for it.
    _searchLayer(query, entryPoints, ef, layer, trace) {
      const visited = new Set(entryPoints);
      let candidates = [];
      let results = [];
      for (const ep of entryPoints) {
        const d = this._dist(query, this.vectors[ep]);
        candidates.push({ d, id: ep });
        results.push({ d, id: ep });
      }
      candidates.sort((a, b) => a.d - b.d);
      results.sort((a, b) => a.d - b.d);

      while (candidates.length) {
        const c = candidates.shift();
        if (trace) trace.push({ type: "visit", id: c.id });
        const furthest = results.length ? results[results.length - 1].d : Infinity;
        if (c.d > furthest && results.length >= ef) break;

        const neighbors = (this.layers[layer] && this.layers[layer][c.id]) || [];
        for (const nb of neighbors) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          const nd = this._dist(query, this.vectors[nb]);
          const fr = results.length ? results[results.length - 1].d : Infinity;
          if (nd < fr || results.length < ef) {
            candidates.push({ d: nd, id: nb });
            candidates.sort((a, b) => a.d - b.d);
            results.push({ d: nd, id: nb });
            results.sort((a, b) => a.d - b.d);
            if (results.length > ef) results.pop();
            if (trace) trace.push({ type: "accept", id: nb, from: c.id });
          }
        }
      }
      return results.slice().sort((a, b) => a.d - b.d);
    }

    // Port of SELECT-NEIGHBORS-HEURISTIC (Algorithm 4): only accept a
    // candidate that is closer to the query than to every neighbor already
    // selected. This is what forces long-range "bridge" edges instead of
    // every node's neighbor list collapsing onto its own tight cluster.
    _selectNeighborsHeuristic(candidates, m) {
      const result = [];
      const discarded = [];
      for (const cand of candidates) {
        if (result.length >= m) break;
        const candVec = this.vectors[cand.id];
        const dominated = result.some((rId) => this._dist(candVec, this.vectors[rId]) < cand.d);
        if (!dominated) result.push(cand.id);
        else discarded.push(cand);
      }
      if (result.length < m) {
        for (const cand of discarded) {
          if (result.length >= m) break;
          result.push(cand.id);
        }
      }
      return result;
    }

    insert(nodeId, vector) {
      this.vectors[nodeId] = vector;
      const level = this._randomLevel();
      while (this.layers.length <= level) this.layers.push({});
      for (let l = 0; l <= level; l++) {
        if (!this.layers[l][nodeId]) this.layers[l][nodeId] = [];
      }

      if (this.entryPoint === null) {
        this.entryPoint = nodeId;
        this.maxLayer = level;
        return;
      }

      let ep = this.entryPoint;
      for (let lc = this.maxLayer; lc > level; lc--) {
        const nearest = this._searchLayer(vector, [ep], 1, lc);
        if (nearest.length) ep = nearest[0].id;
      }

      let entryPoints = [ep];
      for (let lc = Math.min(this.maxLayer, level); lc >= 0; lc--) {
        const candidates = this._searchLayer(vector, entryPoints, this.efConstruction, lc);
        const mTarget = lc > 0 ? this.M : this.mMax0;
        const neighbors = this._selectNeighborsHeuristic(candidates, mTarget);

        this.layers[lc][nodeId] = neighbors.slice();
        for (const nbId of neighbors) {
          this.layers[lc][nbId].push(nodeId);
          const conns = this.layers[lc][nbId];
          const mMax = lc === 0 ? this.mMax0 : this.M;
          if (conns.length > mMax) {
            const connDists = conns
              .map((c) => ({ d: this._dist(this.vectors[nbId], this.vectors[c]), id: c }))
              .sort((a, b) => a.d - b.d);
            this.layers[lc][nbId] = this._selectNeighborsHeuristic(connDists, mMax);
          }
        }
        entryPoints = candidates.map((c) => c.id);
      }

      if (level > this.maxLayer) {
        this.entryPoint = nodeId;
        this.maxLayer = level;
      }
    }

    // Traced descent for the visualizer: entry point at the top layer,
    // greedy ef=1 search down through each layer (exactly search()'s loop),
    // then a bounded best-first search at layer 0 for the real k nearest.
    // Returns an ordered list of frames the UI steps through.
    searchTraced(query, k) {
      if (this.entryPoint === null) return { frames: [], results: [] };
      let ep = this.entryPoint;
      const frames = [{ type: "entry", layer: this.maxLayer, id: ep }];

      for (let lc = this.maxLayer; lc > 0; lc--) {
        const trace = [];
        const found = this._searchLayer(query, [ep], 1, lc, trace);
        frames.push({ type: "layer-search", layer: lc, trace });
        if (found.length) ep = found[0].id;
        if (lc > 1) frames.push({ type: "entry", layer: lc - 1, id: ep });
      }

      const ef = Math.max(this.efConstruction, k);
      const trace0 = [];
      const found0 = this._searchLayer(query, [ep], ef, 0, trace0);
      frames.push({ type: "layer-search", layer: 0, trace: trace0 });
      const results = found0.slice(0, k);
      frames.push({ type: "result", layer: 0, ids: results.map((r) => r.id) });
      return { frames, results };
    }
  }

  /* ------------------------------------------------------------------- UI */
  const VBW = 340,
    VBH = 200,
    PAD = 16;
  const N_POINTS = 40,
    N_BLOBS = 4;
  const FRAME_MS = 90;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function genPoints(rng) {
    const centers = Array.from({ length: N_BLOBS }, () => [
      PAD + 20 + rng() * (VBW - 2 * (PAD + 20)),
      PAD + 20 + rng() * (VBH - 2 * (PAD + 20)),
    ]);
    const pts = [];
    for (let i = 0; i < N_POINTS; i++) {
      const c = centers[i % N_BLOBS];
      const x = clamp(c[0] + (rng() - 0.5) * 70, PAD, VBW - PAD);
      const y = clamp(c[1] + (rng() - 0.5) * 70, PAD, VBH - PAD);
      pts.push([x, y]);
    }
    return pts;
  }

  function buildIndex(seed) {
    const rng = mulberry32(seed);
    const idx = new HNSWIndex(2, { M: 5, efConstruction: 32, seed: seed + 1 });
    genPoints(rng).forEach((p, i) => idx.insert(i, p));
    return idx;
  }

  function edgeKey(a, b) {
    const x = Number(a),
      y = Number(b);
    return x < y ? `${x}-${y}` : `${y}-${x}`;
  }

  function initHnswViz() {
    const root = document.getElementById("hnsw-viz");
    const caption = document.getElementById("hnsw-caption");
    const queryBtn = document.getElementById("hnsw-query");
    const insertBtn = document.getElementById("hnsw-insert");
    const resetBtn = document.getElementById("hnsw-reset");
    if (!root) return;

    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let idx, nextId, panels, playToken;

    function buildDOM() {
      root.innerHTML = "";
      panels = {};
      for (let layer = idx.maxLayer; layer >= 0; layer--) {
        const nodeIds = Object.keys(idx.layers[layer] || {});
        const seen = new Set();
        let edgesSvg = "";
        for (const id of nodeIds) {
          const [x1, y1] = idx.vectors[id];
          for (const nb of idx.layers[layer][id] || []) {
            const key = edgeKey(id, nb);
            if (seen.has(key)) continue;
            seen.add(key);
            const [x2, y2] = idx.vectors[nb];
            edgesSvg += `<line id="hnsw-e${layer}-${key}" class="hnsw-edge" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"></line>`;
          }
        }
        let nodesSvg = "";
        for (const id of nodeIds) {
          const [x, y] = idx.vectors[id];
          nodesSvg += `<circle id="hnsw-n${layer}-${id}" class="hnsw-node" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4"></circle>`;
        }

        const wrap = document.createElement("div");
        wrap.className = "hnsw-panel";
        wrap.innerHTML =
          `<div class="hnsw-panel-label">layer ${layer} · ${nodeIds.length} node${nodeIds.length === 1 ? "" : "s"}</div>` +
          `<svg class="hnsw-svg" viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet">` +
          `<g class="hnsw-edges">${edgesSvg}</g><g class="hnsw-nodes">${nodesSvg}</g>` +
          `<g class="hnsw-query-layer" id="hnsw-query-${layer}"></g>` +
          `</svg>`;
        root.appendChild(wrap);
        panels[layer] = wrap.querySelector("svg");
      }

      const topSvg = panels[idx.maxLayer];
      if (topSvg) topSvg.addEventListener("click", onTopLayerClick);
    }

    function svgPoint(svg, evt) {
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const local = pt.matrixTransform(ctm.inverse());
      return [clamp(local.x, PAD, VBW - PAD), clamp(local.y, PAD, VBH - PAD)];
    }

    function onTopLayerClick(evt) {
      const p = svgPoint(panels[idx.maxLayer], evt);
      if (p) dropQuery(p);
    }

    function clearDynamicClasses() {
      root.querySelectorAll(".hnsw-node, .hnsw-edge").forEach((el) => {
        el.classList.remove("is-visited", "is-path", "is-entry", "is-result", "is-current");
      });
      root.querySelectorAll(".hnsw-query-layer").forEach((g) => (g.innerHTML = ""));
    }

    function placeQueryMarkers(point) {
      for (const layer of Object.keys(panels)) {
        const g = document.getElementById(`hnsw-query-${layer}`);
        if (g) g.innerHTML = `<circle class="hnsw-query" cx="${point[0].toFixed(1)}" cy="${point[1].toFixed(1)}" r="4.2"></circle>`;
      }
    }

    function captionFor(frame) {
      if (frame.type === "entry") return `layer ${frame.layer}: entering at the previous layer's nearest hop`;
      if (frame.type === "layer-search" && frame.layer > 0) return `layer ${frame.layer}: greedy hop across long-range edges toward the query`;
      if (frame.type === "layer-search" && frame.layer === 0) return `layer 0: bounded best-first search among the true near neighbors`;
      if (frame.type === "result") return `done: ${frame.ids.length} nearest neighbors found at layer 0`;
      return "";
    }

    function applyFrame(frame) {
      if (caption) caption.textContent = captionFor(frame);
      if (frame.type === "entry") {
        const el = document.getElementById(`hnsw-n${frame.layer}-${frame.id}`);
        if (el) el.classList.add("is-entry");
      } else if (frame.type === "layer-search") {
        for (const ev of frame.trace) {
          const node = document.getElementById(`hnsw-n${frame.layer}-${ev.id}`);
          if (node) node.classList.add("is-visited");
          if (ev.type === "accept" && ev.from !== undefined) {
            const edge = document.getElementById(`hnsw-e${frame.layer}-${edgeKey(ev.from, ev.id)}`);
            if (edge) edge.classList.add("is-path");
          }
        }
      } else if (frame.type === "result") {
        for (const id of frame.ids) {
          const node = document.getElementById(`hnsw-n0-${id}`);
          if (node) node.classList.add("is-result");
        }
      }
    }

    function dropQuery(point) {
      playToken++;
      const token = playToken;
      clearDynamicClasses();
      placeQueryMarkers(point);

      const { frames } = idx.searchTraced(point, 4);
      if (reduced) {
        frames.forEach(applyFrame);
        return;
      }
      let i = 0;
      const step = () => {
        if (token !== playToken || i >= frames.length) return;
        applyFrame(frames[i]);
        i++;
        setTimeout(step, FRAME_MS);
      };
      step();
    }

    function randomQueryPoint() {
      return [PAD + Math.random() * (VBW - 2 * PAD), PAD + Math.random() * (VBH - 2 * PAD)];
    }

    function reset() {
      idx = buildIndex(20260813);
      nextId = idx.size();
      playToken = 0;
      buildDOM();
      if (caption) caption.textContent = "click the top layer, or drop a random query, to watch the search descend";
    }

    // Exposed so ui-polish.js can run one descent the first time the panel
    // scrolls into view -- the graph introduces itself instead of sitting
    // dormant until clicked. Everything stays interactive after.
    window.hnswAutoQuery = () => dropQuery(randomQueryPoint());

    if (queryBtn) queryBtn.addEventListener("click", () => dropQuery(randomQueryPoint()));
    if (insertBtn)
      insertBtn.addEventListener("click", () => {
        idx.insert(nextId, randomQueryPoint());
        nextId++;
        playToken++; // invalidate any in-flight animation before the DOM it targets is replaced
        buildDOM();
      });
    if (resetBtn) resetBtn.addEventListener("click", reset);

    reset();
  }

  window.HNSW = { HNSWIndex };
  window.initHnswViz = initHnswViz;
})();
