/* =============================================================================
   UI polish pass: custom pointer, command palette, cursor-reactive particle
   background. All three are pure decoration/navigation convenience layered
   on top of a fully working page -- each is independently guarded so a
   failure in one never blocks the others or the content underneath.
============================================================================= */

(function () {
  "use strict";

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --------------------------------------------------------- custom pointer */
  function initCustomPointer() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (reducedMotion()) return;

    const dot = document.createElement("div");
    dot.className = "pointer-dot";

    const box = document.createElement("div");
    box.className = "pointer-box";
    box.innerHTML = "<i></i><i></i><i></i><i></i>";
    const tag = document.createElement("span");
    tag.className = "pointer-tag";
    box.appendChild(tag);

    // Soft pool of light trailing the pointer, behind all content.
    const glow = document.createElement("div");
    glow.className = "spotlight";
    document.body.append(glow, dot, box);
    document.body.classList.add("pointer-ready");

    /* What the box names when it locks on. Ordered most specific first, since
       the first match wins: .ch-row is also an <a>, and reporting it as a
       generic "link" would throw away the more useful label. */
    const TARGETS = [
      [".pcard", "project"],
      [".ch-row", "channel"],
      [".ide-tab", "tab"],
      [".ctl", "control"],
      [".tag", "tag"],
      [".tlink", "link"],
      ["summary", "expand"],
      ["button", "button"],
      ["input", "input"],
      ["a", "link"],
    ];
    const SELECTOR = TARGETS.map((t) => t[0]).join(",");
    const labelFor = (el) => {
      for (const [sel, label] of TARGETS) if (el.matches(sel)) return label;
      return el.tagName.toLowerCase();
    };

    const IDLE = 26; // px; the box's size when it is not locked to anything
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let locked = null;

    // Written from the pointer OR from the locked element's rect, never both:
    // the two are different origins (centre vs top-left) and interleaving them
    // is what makes an inspector box jitter.
    function place() {
      if (locked) {
        const r = locked.getBoundingClientRect();
        // 3px of air so the brackets sit outside the element's own border
        // rather than on top of it.
        box.style.width = `${r.width + 6}px`;
        box.style.height = `${r.height + 6}px`;
        box.style.transform = `translate3d(${r.left - 3}px, ${r.top - 3}px, 0)`;
      } else {
        box.style.width = `${IDLE}px`;
        box.style.height = `${IDLE}px`;
        box.style.transform = `translate3d(${mx - IDLE / 2}px, ${my - IDLE / 2}px, 0)`;
      }
    }

    window.addEventListener("mousemove", (e) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%,-50%)`;
      if (!locked) place();
    });

    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest && e.target.closest(SELECTOR);
      if (!el || el === locked) return;
      locked = el;
      tag.textContent = labelFor(el);
      box.classList.add("is-locked");
      place();
    });

    document.addEventListener("mouseout", (e) => {
      if (!locked) return;
      // relatedTarget is where the pointer went. Staying inside the locked
      // element (crossing onto one of its own children) must not release the
      // lock, or the box flickers off and on across every span in a card.
      const to = e.relatedTarget;
      if (to && locked.contains(to)) return;
      locked = null;
      box.classList.remove("is-locked");
      place();
    });

    // A locked box is positioned from a viewport rect, so it has to be
    // repositioned when that rect moves under it.
    window.addEventListener("scroll", () => { if (locked) place(); }, { passive: true });
    window.addEventListener("resize", place);

    let gx = mx, gy = my;
    function tick() {
      // The glow lags well behind the pointer, so the layers read as one
      // object with weight rather than several things chasing the cursor.
      gx += (mx - gx) * 0.06;
      gy += (my - gy) * 0.06;
      glow.style.transform = `translate3d(${gx}px, ${gy}px, 0) translate(-50%,-50%)`;
      requestAnimationFrame(tick);
    }
    place();
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ command palette */
  function initCommandPalette() {
    const trigger = document.getElementById("cmdk-trigger");
    const overlay = document.getElementById("cmdk-overlay");
    const input = document.getElementById("cmdk-input");
    const list = document.getElementById("cmdk-list");
    if (!trigger || !overlay || !input || !list) return;

    const ITEMS = [
      { group: "Sections", label: "About", note: "↵", href: "#about" },
      { group: "Sections", label: "Work", note: "↵", href: "#work" },
      { group: "Sections", label: "Live Systems", note: "↵", href: "#systems" },
      { group: "Sections", label: "Research", note: "↵", href: "#research" },
      { group: "Sections", label: "Internship", note: "↵", href: "#internship" },
      { group: "Sections", label: "Cricket", note: "↵", href: "#cricket" },
      { group: "Sections", label: "Awards", note: "↵", href: "#awards" },
      { group: "Sections", label: "Contact", note: "↵", href: "#contact" },
      { group: "Projects", label: "raft-chaos-testing · live Raft simulator", note: "↵", href: "#proj-raft" },
      { group: "Projects", label: "crisis-nlp-demo · keyword vs. semantic", note: "↵", href: "#proj-nlp" },
      { group: "Projects", label: "mcp-memory-server · live HNSW visualizer", note: "↵", href: "#proj-mcp" },
      { group: "Projects", label: "fluid-sim · Navier-Stokes on WebGPU", note: "↵", href: "#proj-fluid" },
      { group: "Projects", label: "llm-inference-webgpu · transformer inference engine", note: "↵", href: "#proj-llm" },
      { group: "Links", label: "GitHub", note: "↗", href: "https://github.com/abho7", external: true },
      { group: "Links", label: "LinkedIn", note: "↗", href: "https://www.linkedin.com/in/abhineeth-duddela-6b2a90319/", external: true },
      { group: "Links", label: "Email", note: "↵", href: "mailto:abhineeth78@gmail.com" },
    ];

    let filtered = ITEMS.slice();
    let activeIndex = 0;
    let lastFocused = null;

    function render() {
      const q = input.value.trim().toLowerCase();
      filtered = q ? ITEMS.filter((it) => it.label.toLowerCase().includes(q)) : ITEMS.slice();
      activeIndex = 0;

      if (!filtered.length) {
        list.innerHTML = `<div class="cmdk-empty">No matches</div>`;
        return;
      }

      let html = "";
      let lastGroup = null;
      filtered.forEach((it, i) => {
        if (it.group !== lastGroup) {
          html += `<div class="cmdk-group">${it.group}</div>`;
          lastGroup = it.group;
        }
        html += `<div class="cmdk-item${i === activeIndex ? " active" : ""}" data-index="${i}">
          <span>${it.label}</span><span class="cmdk-item-note">${it.note}</span>
        </div>`;
      });
      list.innerHTML = html;
    }

    function setActive(i) {
      if (!filtered.length) return;
      activeIndex = (i + filtered.length) % filtered.length;
      [...list.querySelectorAll(".cmdk-item")].forEach((el) => {
        el.classList.toggle("active", Number(el.dataset.index) === activeIndex);
      });
      const activeEl = list.querySelector(".cmdk-item.active");
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    }

    function choose(item) {
      if (!item) return;
      close();
      if (item.external) {
        window.open(item.href, "_blank", "noopener");
      } else if (item.href.startsWith("mailto:")) {
        window.location.href = item.href;
      } else {
        const target = document.querySelector(item.href);
        if (target) target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      }
    }

    function open() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      input.value = "";
      render();
      input.focus();
    }

    function close() {
      overlay.hidden = true;
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    }

    trigger.addEventListener("click", open);

    document.addEventListener("keydown", (e) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        overlay.hidden ? open() : close();
      } else if (e.key === "Escape" && !overlay.hidden) {
        close();
      }
    });

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(activeIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(activeIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(filtered[activeIndex]);
      }
    });

    list.addEventListener("click", (e) => {
      const el = e.target.closest(".cmdk-item");
      if (el) choose(filtered[Number(el.dataset.index)]);
    });
  }

  /* --------------------------------------------------------- ambient field
     A loss landscape with optimizers running on it.

     The surface is a real scalar function: a shallow quadratic bowl plus a
     handful of Gaussian wells, with the pointer adding a Gaussian *hill*. The
     contour lines are its true level sets, extracted by marching squares, and
     the moving points are gradient descent with momentum on the analytic
     gradient of that same function. Nothing here is a scripted path: move the
     pointer into a basin and the optimizers genuinely steer around it, because
     the hill is part of the function they are differentiating.

     A single fixed, viewport-sized canvas behind the whole document. Because
     it is fixed it never needs to know about scroll position or page height:
     the field simply persists as sections move past it. */
  function initLossField() {
    const canvas = document.getElementById("ambient");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const WELLS = 7;
    const LEVELS = 11;
    const CELL = 22;            // px between field samples for the contour grid
    // Weak on purpose. A stronger quadratic dominates the Gaussians and the
    // level sets collapse into concentric circles round the viewport centre,
    // which reads as radar rings rather than as a loss surface. This is just
    // enough to keep walkers from drifting off the edges.
    const BOWL = 5.5e-7;
    const HILL_A = 0.85;        // pointer hill amplitude
    const HILL_S = 130;         // pointer hill width
    const TRAIL = 22;           // points retained per optimizer
    const LR = 105;             // descent step scale
    const MOMENTUM = 0.87;
    const VMAX = 2.2;           // px/frame, keeps the integrator stable
    const DENSITY = 1 / 26000;
    const COUNT_MIN = 26, COUNT_MAX = 64;

    /* Real lines from the three projects this site is about, drifting behind
       the surface. Not decorative lorem: each one is the actual expression the
       write-up further down the page describes, so the background is the code
       rather than a stock "matrix" effect. */
    const SNIPPETS = [
      "if (votes >= quorum) becomeLeader(term)",
      "commitIndex = max{ n : count(matchIndex >= n) > N/2 }",
      "AppendEntries{ term, prevLogIndex, prevLogTerm }",
      "assert leaders_in_term(t) <= 1",
      "layer = floor(-ln(U) * mL)",
      "M_max0 = 2 * M   // base layer",
      "while (candidates && best.d < W.top.d)",
      "cosine(a, b) = dot(a, b)   // L2-normalized",
      "SELECT-NEIGHBORS-HEURISTIC(q, C, M)",
      "phi_j = w_j * (x_j - E[x_j])",
      "base + sum(phi) == logit(x)",
      "ef_construction = 200",
      "v = momentum * v - lr * grad(x, y)",
      "drop_prob, delay_ticks = link[a][b]",
    ];
    const CODE_SPEED = 0.13;    // px/frame, slower than the walkers
    // Canvas needs a real font stack string; it cannot resolve a CSS custom
    // property, so the value is read off the document once at startup and
    // falls back to a generic monospace if the token is ever renamed.
    const MONO = (getComputedStyle(document.documentElement)
      .getPropertyValue("--mono") || "").trim() || "ui-monospace, monospace";

    let w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let wells = [];
    let walkers = [];
    let code = [];
    let mouse = { x: -9999, y: -9999, active: false };

    // Contours only change when the pointer moves, so they are drawn once onto
    // their own canvas and blitted each frame. Re-extracting level sets at
    // 60fps to get an identical result would dominate the frame budget.
    const contourCanvas = document.createElement("canvas");
    const cctx = contourCanvas.getContext("2d");
    let lastBuildX = -9999, lastBuildY = -9999, lastBuildAt = 0;

    let running = false, rafId = null;

    /* ------------------------------------------------------------ the field */
    function f(x, y) {
      let v = BOWL * ((x - w / 2) * (x - w / 2) + (y - h / 2) * (y - h / 2));
      for (const g of wells) {
        const dx = x - g.x, dy = y - g.y;
        v -= g.a * Math.exp(-(dx * dx + dy * dy) / (2 * g.s * g.s));
      }
      if (mouse.active) {
        const dx = x - mouse.x, dy = y - mouse.y;
        v += HILL_A * Math.exp(-(dx * dx + dy * dy) / (2 * HILL_S * HILL_S));
      }
      return v;
    }

    // Analytic, not finite-difference: the wells and the hill are Gaussians,
    // so the exact gradient costs the same exp() the value already needs.
    function grad(x, y, out) {
      let gx = 2 * BOWL * (x - w / 2);
      let gy = 2 * BOWL * (y - h / 2);
      for (const g of wells) {
        const dx = x - g.x, dy = y - g.y;
        const e = g.a * Math.exp(-(dx * dx + dy * dy) / (2 * g.s * g.s)) / (g.s * g.s);
        gx += dx * e;
        gy += dy * e;
      }
      if (mouse.active) {
        const dx = x - mouse.x, dy = y - mouse.y;
        const e = HILL_A * Math.exp(-(dx * dx + dy * dy) / (2 * HILL_S * HILL_S)) / (HILL_S * HILL_S);
        gx -= dx * e;
        gy -= dy * e;
      }
      out[0] = gx; out[1] = gy;
    }

    /* ------------------------------------------------------- marching squares
       Standard 16-case lookup. Corners are indexed clockwise from top-left and
       packed into a bitmask; each case names the pair(s) of cell edges the
       contour crosses, and the crossing point on an edge is found by linear
       interpolation between its two corner values. Cases 5 and 10 are the
       saddle ambiguities; both diagonals are emitted, which can only ever add
       a hairline where the surface genuinely pinches. */
    const EDGES = [
      [], [[3, 2]], [[2, 1]], [[3, 1]], [[1, 0]], [[3, 0], [2, 1]], [[2, 0]], [[3, 0]],
      [[0, 3]], [[0, 2]], [[0, 1], [2, 3]], [[0, 1]], [[1, 3]], [[1, 2]], [[2, 3]], [],
    ];

    function buildContours() {
      const cols = Math.ceil(w / CELL) + 1;
      const rows = Math.ceil(h / CELL) + 1;
      const vals = new Float32Array(cols * rows);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const v = f(i * CELL, j * CELL);
          vals[j * cols + i] = v;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }

      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.clearRect(0, 0, contourCanvas.width, contourCanvas.height);
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx.lineWidth = 1;

      for (let l = 1; l <= LEVELS; l++) {
        const t = l / (LEVELS + 1);
        const level = lo + (hi - lo) * t;
        // Deeper level sets (nearer the minima) are drawn slightly stronger, so
        // the basins read as basins instead of as uniform noise.
        cctx.strokeStyle = `rgba(167,139,250,${0.055 + 0.075 * (1 - t)})`;
        cctx.beginPath();

        for (let j = 0; j < rows - 1; j++) {
          for (let i = 0; i < cols - 1; i++) {
            const v0 = vals[j * cols + i];
            const v1 = vals[j * cols + i + 1];
            const v2 = vals[(j + 1) * cols + i + 1];
            const v3 = vals[(j + 1) * cols + i];
            const code = (v0 > level ? 8 : 0) | (v1 > level ? 4 : 0) |
                         (v2 > level ? 2 : 0) | (v3 > level ? 1 : 0);
            const segs = EDGES[code];
            if (!segs.length) continue;

            const x = i * CELL, y = j * CELL;
            const mix = (a, b) => (level - a) / (b - a || 1e-9);
            // edge 0 = top, 1 = right, 2 = bottom, 3 = left
            const px = [x + CELL * mix(v0, v1), x + CELL, x + CELL * mix(v3, v2), x];
            const py = [y, y + CELL * mix(v1, v2), y + CELL, y + CELL * mix(v0, v3)];

            for (const [a, b] of segs) {
              cctx.moveTo(px[a], py[a]);
              cctx.lineTo(px[b], py[b]);
            }
          }
        }
        cctx.stroke();
      }

      lastBuildX = mouse.x;
      lastBuildY = mouse.y;
      lastBuildAt = performance.now();
    }

    /* --------------------------------------------------------- the optimizers */
    function spawn() {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        vx: 0, vy: 0,
        age: 0,
        trail: [],
      };
    }

    function seed() {
      wells = Array.from({ length: WELLS }, () => ({
        x: (0.12 + Math.random() * 0.76) * w,
        y: (0.12 + Math.random() * 0.76) * h,
        a: 0.7 + Math.random() * 0.7,
        s: 70 + Math.random() * 80,
      }));
      const n = Math.round(Math.max(COUNT_MIN, Math.min(COUNT_MAX, w * h * DENSITY)));
      walkers = Array.from({ length: n }, spawn);

      // Each line gets its own depth: further-back lines are smaller, fainter
      // and slower, which reads as parallax without needing a scroll handler.
      code = SNIPPETS.map((text, i) => {
        const depth = 0.35 + ((i * 0.618) % 1) * 0.65; // 1 = nearest
        return {
          text,
          x: Math.random() * w,
          y: (i / SNIPPETS.length) * h + Math.random() * 40,
          size: 9 + depth * 5,
          alpha: 0.028 + depth * 0.045,
          vx: CODE_SPEED * depth * (i % 2 ? 1 : -1),
        };
      });

      buildContours();
    }

    function resize() {
      // documentElement.clientWidth, not window.innerWidth: the latter includes
      // the scrollbar gutter, and sizing to it makes the canvas wider than the
      // content area, which puts a horizontal scrollbar on the whole page.
      // Canvas is a replaced element, so inset:0 alone will not stretch it.
      const nw = document.documentElement.clientWidth;
      const nh = document.documentElement.clientHeight;
      // Mobile browsers fire resize on every URL-bar show/hide during a scroll;
      // reseeding on those would re-randomize the whole surface mid-scroll.
      if (Math.abs(nw - w) < 24 && Math.abs(nh - h) < 120) return;
      w = nw; h = nh;
      for (const c of [canvas, contourCanvas]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    const g = [0, 0];

    function step() {
      // Rebuild the level sets only when the pointer has actually moved the
      // surface, and at most ~8x a second: this is the expensive half.
      if (mouse.active) {
        const moved = Math.hypot(mouse.x - lastBuildX, mouse.y - lastBuildY);
        if (moved > 14 && performance.now() - lastBuildAt > 120) buildContours();
      }

      ctx.clearRect(0, 0, w, h);

      // Code first: it sits behind the surface, so the contours and the
      // optimizers both read on top of it rather than competing with it.
      ctx.textBaseline = "middle";
      for (const c of code) {
        c.x += c.vx;
        // Font before measureText: measureText uses whatever font is currently
        // set on the context, so measuring first returns the width of the
        // previous line at the previous size.
        ctx.font = `${c.size}px ${MONO}`;
        // Measured, not assumed: the wrap must happen once the line is fully
        // off-screen, and these lines differ in width by more than 3x.
        const wide = ctx.measureText(c.text).width;
        if (c.vx > 0 && c.x > w) c.x = -wide;
        if (c.vx < 0 && c.x < -wide) c.x = w;
        ctx.fillStyle = `rgba(167,139,250,${c.alpha})`;
        ctx.fillText(c.text, c.x, c.y);
      }

      ctx.drawImage(contourCanvas, 0, 0, w, h);

      for (const p of walkers) {
        grad(p.x, p.y, g);
        p.vx = MOMENTUM * p.vx - LR * g[0];
        p.vy = MOMENTUM * p.vy - LR * g[1];
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > VMAX) { p.vx = (p.vx / sp) * VMAX; p.vy = (p.vy / sp) * VMAX; }
        p.x += p.vx;
        p.y += p.vy;
        p.age++;

        p.trail.push(p.x, p.y);
        if (p.trail.length > TRAIL * 2) p.trail.splice(0, 2);

        // Converged, stalled, or wandered off: restart somewhere else so the
        // field keeps showing descent rather than settling into stillness.
        if (p.age > 900 || sp < 0.03 || p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) {
          Object.assign(p, spawn());
        }
      }

      // Trails first, then heads, so a head is never buried under another
      // walker's tail.
      ctx.lineWidth = 1;
      for (const p of walkers) {
        const n = p.trail.length / 2;
        for (let i = 1; i < n; i++) {
          const a = i / n;
          ctx.strokeStyle = `rgba(167,139,250,${0.32 * a})`;
          ctx.beginPath();
          ctx.moveTo(p.trail[(i - 1) * 2], p.trail[(i - 1) * 2 + 1]);
          ctx.lineTo(p.trail[i * 2], p.trail[i * 2 + 1]);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "rgba(74,222,128,.75)";
      for (const p of walkers) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
      if (!running) return;
      step();
      rafId = requestAnimationFrame(loop);
    }
    function start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    resize();
    window.addEventListener("resize", resize);

    // The canvas is fixed to the viewport, so client coordinates are already
    // canvas coordinates: no rect offset to subtract.
    window.addEventListener("mousemove", (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
    });
    document.addEventListener("mouseleave", () => { mouse.active = false; });

    if (reducedMotion()) {
      // One static frame: the surface and where the optimizers currently are,
      // with no descent animation and no pointer-driven rebuilds.
      step();
      return;
    }

    start();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
  }

  /* ------------------------------------------------- scroll rail + dimming
     One rAF-throttled pass handles both: the right-edge progress readout
     (real geometry -- position through the document and the section it lands
     in) and pulling the ambient field back once the hero is behind us, so
     nothing anyone actually reads competes with it. */
  function initScrollRail() {
    const hero = document.querySelector(".hero");
    const fill = document.getElementById("progress-fill");

    let ticking = false;
    const paint = () => {
      ticking = false;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      if (fill) fill.style.width = pct + "%";

      if (hero) {
        const past = hero.getBoundingClientRect().bottom < window.innerHeight * 0.55;
        document.documentElement.classList.toggle("past-hero", past);
      }
      // Final taper: the ambient field steps down again over the closing
      // section so the page winds down rather than stopping mid-energy.
      document.documentElement.classList.toggle("near-end", pct >= 86);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(paint);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    paint();
  }

  /* --------------------------------------------------------- waking panels
     Each instrument settles in and starts itself the first time it scrolls
     into view, so the page feels like it comes alive rather than presenting
     a row of dormant widgets. Everything stays fully interactive afterwards;
     this only decides *when* the first run happens. Fires once per panel. */
  function initPanelWake() {
    const panels = [...document.querySelectorAll(".panel[data-wake]")];
    if (!panels.length) return;

    // Arm the hidden state only now that this code is definitely running.
    document.documentElement.classList.add("panels-armed");

    // Two separate concerns, deliberately not merged:
    //   reveal() only makes the panel visible. It is safe to call for any
    //     reason, including the fail-open backstop.
    //   start() actually runs the instrument, and must only happen on a real
    //     intersection -- otherwise every instrument fires while still far
    //     below the fold and the scroll-tied effect is lost entirely.
    const reveal = (panel) => panel.classList.add("is-awake");

    const start = (panel) => {
      if (panel.dataset.started) return;
      panel.dataset.started = "1";
      const kind = panel.dataset.wake;
      // Let the panel's settle transition land before the instrument inside
      // it starts moving -- two motions at once reads as noise.
      setTimeout(() => {
        if (kind === "hnsw" && typeof window.hnswAutoQuery === "function") window.hnswAutoQuery();
        if (kind === "nlp" && typeof window.nlpAutoCompare === "function") window.nlpAutoCompare();
      }, reducedMotion() ? 0 : 620);
    };

    // Geometry checked on scroll rather than an IntersectionObserver. IO only
    // reports an element's state at delivery time, so a fast scroll (or an
    // anchor jump) that skips clean past a panel never reports it as
    // intersecting and its instrument silently never starts. Testing the rect
    // every frame is deterministic: anything at or above the trigger line has
    // been reached, whether we glided past it or jumped.
    let ticking = false;
    const check = () => {
      ticking = false;
      const line = window.innerHeight * 0.88;
      for (const p of panels) {
        if (p.dataset.started) continue;
        if (p.getBoundingClientRect().top < line) {
          reveal(p);
          start(p);
        }
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(check);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();

    // Fail-open: if rendering is suspended (occluded tab) and no frame ever
    // runs, un-hide everything anyway. Visibility only -- the instruments
    // still wait for the panel to actually be reached.
    setTimeout(() => panels.forEach(reveal), 4000);
  }

  /* ------------------------------------------------------------------ clock
     Real local time in Frisco, TX, formatted in that zone rather than the
     visitor's, so it reads as "where he is" regardless of who is looking. */
  function initClock() {
    const el = document.getElementById("rail-clock");
    if (!el) return;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const tick = () => { el.textContent = fmt.format(new Date()) + " CST"; };
    tick();
    setInterval(tick, 1000);
  }

  /* ------------------------------------------------------------- rail height
     The hero sizes itself to the viewport minus the sticky rail above it.
     Measuring rather than hardcoding keeps that exact once the webfonts land
     (which changes the rail's line box) and across breakpoints. */
  function trackRailHeight() {
    const rail = document.querySelector(".rail");
    if (!rail) return;
    const apply = () =>
      document.documentElement.style.setProperty("--rail-h", `${Math.round(rail.getBoundingClientRect().height)}px`);
    apply();
    if ("ResizeObserver" in window) new ResizeObserver(apply).observe(rail);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply);
  }

  /* ------------------------------------------------------ pointer spotlight
     One delegated listener for the whole page rather than one per card.

     The two writes go straight through rather than being batched into a
     requestAnimationFrame: setting a custom property does not force a
     synchronous layout, and the browser already coalesces style recalculation
     until just before it paints, so batching here would buy a recalc the
     engine was going to skip anyway -- while adding a path where the final
     pointer position is dropped because its frame never arrives. */
  function initCardSpotlight() {
    if (!document.querySelector(".spot")) return;
    // Cached: this cannot change for the lifetime of the page, and matchMedia
    // on every pointermove is measurable work for a constant answer.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse) return; // touch has no hover to track; the glow would stick under the last tap

    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest && e.target.closest(".spot");
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    }, { passive: true });
  }

  /* --------------------------------------------------------- rail telemetry
     A live readout of the Raft cluster running further down the page: current
     term and current leader, read from the simulator's own published state.
     This is real -- it moves when an election happens, and it goes to "no
     leader" during one -- so it is an instrument, not an ornament. It stays
     hidden until the simulator has actually published a term, so a visitor
     with JS partially failing never sees an empty widget. */
  function initRailTelemetry() {
    const host = document.getElementById("rail-telemetry");
    if (!host) return;
    const termEl = host.querySelector("[data-t=term]");
    const leadEl = host.querySelector("[data-t=leader]");
    let shown = false;

    let lastTerm = null;

    const paint = () => {
      const s = window.__raftState;
      if (!s) return;
      if (typeof s.term === "number") lastTerm = s.term;

      // Reveal only once a term has actually been observed. Publishing state
      // is not enough: the cluster starts leaderless with term null, and
      // showing a bare placeholder as the first thing a visitor sees reads as a broken
      // widget rather than as a cluster mid-election. Once it is up, a null
      // term is a real state and the readout stays put and says "electing".
      if (!shown) {
        if (lastTerm === null) return;
        host.hidden = false;
        shown = true;
      }
      termEl.textContent = lastTerm;

      const leader = s.leader || null;
      leadEl.textContent = leader || "electing";
      leadEl.classList.toggle("is-vacant", !leader);
      // The simulator suspends itself when scrolled off-screen. Saying so is
      // more honest than showing a frozen number as though it were live.
      host.classList.toggle("is-idle", !s.running);
    };

    paint();
    setInterval(paint, 400);
  }

  /* -------------------------------------------------------- footer readout
     A build-info line, except every number is measured here rather than typed
     into the markup -- so it reports what the page actually contains and can
     never go stale when a project is added or a simulator is removed. */
  function initFooterSignature() {
    const host = document.getElementById("footer-signature");
    if (!host) return;

    const projects = document.querySelectorAll(".pcard").length;
    const sims = ["__raftState", "hnswAutoQuery", "nlpAutoCompare"]
      .filter((k) => window[k] !== undefined).length;

    const paint = () => {
      const parts = [
        `${projects} projects`,
        `${sims}/3 simulators live`,
        // "no frameworks", not "zero dependencies": the page does pull a
        // webfont, so the stronger claim would not be true.
        "no frameworks",
        "rendered client-side",
      ];
      host.textContent = parts.join(" · ");
    };

    // Deferred one beat: raft-sim publishes __raftState on its first render,
    // which has not happened yet at the moment this runs.
    paint();
    setTimeout(paint, 1200);
  }

  /* ------------------------------------------------------------ nav preview
     Hovering a rail link opens a panel listing what is actually inside that
     section, each entry a real anchor.

     Every entry is harvested from the live DOM at startup rather than written
     out here: a hand-authored menu is a second copy of the page's structure
     that silently goes stale the first time a project is added or renamed.
     Anchors are minted from the headings' own text when they have no id. */
  function initNavPreview() {
    const rail = document.querySelector(".rail");
    const links = [...document.querySelectorAll('.rail nav a[href^="#"]')];
    if (!rail || !links.length) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const MAX_ROWS = 8;

    // Section-specific selectors first; the fallback covers anything without
    // an entry here, so a new section still gets a usable menu.
    const HARVEST = {
      work:     { row: ".pcard",     title: "h3",            meta: ".pcard-cat" },
      systems:  { row: ".showcase",  title: "h3",            meta: ".showcase-meta" },
      awards:   { row: ".index-row", title: ".index-title",  meta: ".index-meta" },
      contact:  { row: ".ch-row",    title: ".ch-addr",      meta: ".ch-proto" },
    };

    const slug = (s) =>
      "nv-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

    const firstSentence = (s) => {
      const t = (s || "").replace(/\s+/g, " ").trim();
      const stop = t.search(/\.\s|\.$/);
      return stop > 0 ? t.slice(0, stop + 1) : t;
    };

    function harvest(section) {
      const cfg = HARVEST[section.id];
      const rows = [];

      if (cfg) {
        for (const el of section.querySelectorAll(cfg.row)) {
          const t = el.querySelector(cfg.title);
          if (!t) continue;
          // If the row is itself a link (the contact channels are), send the
          // menu entry where the row goes. Minting an id and scrolling to it
          // would strand the visitor next to a mailto: they still have to
          // click.
          let href, external = false;
          if (el.tagName === "A" && el.getAttribute("href")) {
            href = el.getAttribute("href");
            external = !href.startsWith("#");
          } else {
            if (!el.id) el.id = slug(t.textContent);
            href = "#" + el.id;
          }
          rows.push({
            href,
            external,
            title: t.textContent.trim(),
            meta: (el.querySelector(cfg.meta) || {}).textContent || "",
          });
        }
      } else {
        for (const el of section.querySelectorAll("h3, h4")) {
          if (!el.id) el.id = slug(el.textContent);
          const org = el.parentElement && el.parentElement.querySelector(".dossier-org");
          rows.push({ href: "#" + el.id, external: false, title: el.textContent.trim(), meta: org ? org.textContent : "" });
        }
      }

      const lede = section.querySelector(".sec-lede, .dossier-lede, .closing-lede, .about-prose p");
      return { rows, note: firstSentence(lede && lede.textContent) };
    }

    /* One shared panel, repositioned under whichever link is active, rather
       than one panel per link: eight parallel subtrees would all have to be
       kept in sync, and only ever one can be visible. */
    const panel = document.createElement("div");
    panel.className = "navmenu";
    panel.hidden = true;
    rail.appendChild(panel);

    const cache = new Map();
    let active = null, openT = null, closeT = null;

    function build(link) {
      const sec = document.querySelector(link.getAttribute("href"));
      if (!sec) return null;
      if (!cache.has(sec)) cache.set(sec, harvest(sec));
      const { rows, note } = cache.get(sec);
      if (!rows.length && !note) return null;

      const shown = rows.slice(0, MAX_ROWS);
      let html = "";
      if (note) html += `<p class="navmenu-note">${note}</p>`;
      if (shown.length) {
        html += '<div class="navmenu-rows">';
        for (const r of shown) {
          const ext = r.external ? ' target="_blank" rel="noopener"' : "";
          html += `<a class="navmenu-row" href="${r.href}"${ext}>
            <span class="navmenu-title">${r.title}${r.external ? ' <em aria-hidden="true">↗</em>' : ""}</span>
            ${r.meta ? `<span class="navmenu-meta">${r.meta.trim()}</span>` : ""}
          </a>`;
        }
        html += "</div>";
      }
      if (rows.length > shown.length) {
        html += `<a class="navmenu-all" href="${link.getAttribute("href")}">
          View all ${rows.length} <span aria-hidden="true">→</span></a>`;
      }
      return html;
    }

    function open(link) {
      const html = build(link);
      if (!html) return close();
      panel.innerHTML = html;
      panel.hidden = false;

      // Positioned after unhiding: a hidden element has no width, so clamping
      // against the viewport before it is measurable pins it to the gutter.
      const r = link.getBoundingClientRect();
      const railR = rail.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const gut = 16;
      let left = r.left - railR.left;
      const maxLeft = railR.width - pw - gut;
      panel.style.left = `${Math.max(gut, Math.min(left, maxLeft))}px`;

      links.forEach((l) => l.setAttribute("aria-expanded", String(l === link)));
      active = link;
    }

    function close() {
      panel.hidden = true;
      links.forEach((l) => l.setAttribute("aria-expanded", "false"));
      active = null;
    }

    const scheduleOpen = (link) => {
      clearTimeout(closeT);
      clearTimeout(openT);
      // Instant if a menu is already open: sweeping across the rail should
      // switch panels immediately, not re-wait the intent delay each time.
      openT = setTimeout(() => open(link), active ? 0 : 110);
    };
    const scheduleClose = () => {
      clearTimeout(openT);
      clearTimeout(closeT);
      // Long enough to cross the gap between the link and the panel below it.
      closeT = setTimeout(close, 180);
    };

    for (const link of links) {
      link.setAttribute("aria-haspopup", "true");
      link.setAttribute("aria-expanded", "false");
      link.addEventListener("mouseenter", () => scheduleOpen(link));
      link.addEventListener("mouseleave", scheduleClose);
      link.addEventListener("focus", () => open(link));
    }
    panel.addEventListener("mouseenter", () => clearTimeout(closeT));
    panel.addEventListener("mouseleave", scheduleClose);
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    // A panel is positioned from a viewport rect, so it cannot survive the
    // page moving underneath it.
    window.addEventListener("scroll", () => { if (active) close(); }, { passive: true });
    window.addEventListener("resize", close);
  }

  /* ------------------------------------------------------------- word split
     Wraps each word of the section titles so the CSS scroll-linked animation
     can offset them individually.

     The gradient-italic accent is wrapped WHOLE, never split: `.ital` paints
     through `background-clip: text`, and the background box is per-element, so
     splitting it into one span per word would restart the gradient inside each
     word and destroy the sweep across the phrase. */
  function initWordSplit() {
    if (!CSS.supports("animation-timeline: view()")) return;
    if (reducedMotion()) return;

    for (const title of document.querySelectorAll(".sec-title, .closing-title")) {
      const out = [];
      let i = 0;
      const push = (node) => {
        const w = document.createElement("span");
        w.className = "w";
        w.style.setProperty("--i", i++);
        w.appendChild(node);
        out.push(w, document.createTextNode(" "));
      };

      for (const node of [...title.childNodes]) {
        if (node.nodeType === 3) {
          for (const word of node.textContent.split(/\s+/)) {
            if (word) push(document.createTextNode(word));
          }
        } else {
          push(node);
        }
      }
      // Trailing separator would add a stray space before any punctuation.
      if (out[out.length - 1] && out[out.length - 1].nodeType === 3) out.pop();
      title.replaceChildren(...out);
    }
  }

  /* ---------------------------------------------------------- number count-up
     Figures count from zero to the value already in the markup when they reach
     the viewport. The end state is parsed from the DOM, so the animation can
     only ever land on the number that was published; nothing here can invent a
     figure. Anything that is not cleanly numeric is left alone. */
  function initCountUp() {
    const targets = [];
    for (const el of document.querySelectorAll(".figbox .n, .ctile .v")) {
      const raw = el.textContent.trim();
      // prefix (>, +, ~, $) then digits with optional separators, then suffix
      const m = /^([^\d]*)([\d][\d,.]*)(.*)$/.exec(raw);
      if (!m) continue;

      // A number has to be the *whole* figure, not a digit buried in a label.
      // "U19 / #31" would otherwise tick through "U0 / #31", and "1e-8" through
      // "0e-8": technically animating, visibly broken.
      if (/[A-Za-z]/.test(m[1])) continue;          // letters before the digits
      if (/^e[-+]?\d/i.test(m[3])) continue;        // scientific notation
      // A bare year counting up from zero reads as a bug, not an effect.
      if (!m[1] && !m[3] && /^(19|20)\d\d$/.test(m[2])) continue;

      const value = parseFloat(m[2].replace(/,/g, ""));
      if (!isFinite(value)) continue;
      const decimals = (m[2].split(".")[1] || "").length;
      const grouped = m[2].includes(",");
      targets.push({ el, pre: m[1], post: m[3], value, decimals, grouped, done: false });
    }
    if (!targets.length || !("IntersectionObserver" in window)) return;
    if (reducedMotion()) return;

    const fmt = (t, v) => {
      const s = v.toFixed(t.decimals);
      return t.pre + (t.grouped ? Number(s).toLocaleString("en-US", {
        minimumFractionDigits: t.decimals, maximumFractionDigits: t.decimals,
      }) : s) + t.post;
    };

    const run = (t) => {
      if (t.done) return;
      t.done = true;
      const DUR = 900;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / DUR);
        // easeOutExpo: fast start, long settle, so the last digits are readable
        const e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
        t.el.textContent = fmt(t, t.value * e);
        if (k < 1) requestAnimationFrame(tick);
        else t.el.textContent = fmt(t, t.value); // exact, never a rounding artefact
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const t = targets.find((x) => x.el === e.target);
        if (t) run(t);
        io.unobserve(e.target);
      }
    }, { threshold: 0.4 });

    // Backstop, same principle as the reveals: if a frame or an observer never
    // arrives, the published number must still be on screen.
    setTimeout(() => targets.forEach((t) => { if (!t.done) { t.done = true; t.el.textContent = fmt(t, t.value); } }), 4000);
    targets.forEach((t) => io.observe(t.el));
  }

  /* ------------------------------------------------------- sticky section bar
     The section's own label chip is MOVED (not copied) into a slim bar pinned
     under the rail. It rides along for the whole section, carries a live
     count and a percentage of how far through you are, and its underline
     fills as you read. When the next section arrives its bar takes over: the
     handoff is the transition.

     Moving rather than duplicating matters. A second copy of the label would
     read twice to a screen reader and give the page two "About" headings that
     have to be kept in step. */
  function initSectionBars() {
    const bars = [];

    // Only where a countable unit genuinely exists. A made-up unit ("1 about")
    // is worse than no unit.
    // Plurals are spelled out rather than built by appending "s", which turned
    // "entry" into "entrys".
    const UNITS = {
      work:    [".pcard", "project", "projects"],
      systems: [".showcase", "live instrument", "live instruments"],
      awards:  [".index-row", "entry", "entries"],
      contact: [".ch-row", "channel", "channels"],
    };

    for (const sec of document.querySelectorAll("main > section")) {
      const chip = sec.querySelector(".sec-eyebrow");
      if (!chip) continue;

      const bar = document.createElement("div");
      bar.className = "secbar";
      bar.appendChild(chip); // move, not clone

      const meta = document.createElement("span");
      meta.className = "secbar-meta";
      const unit = UNITS[sec.id];
      if (unit) {
        const n = sec.querySelectorAll(unit[0]).length;
        if (n) meta.textContent = `${n} ${n === 1 ? unit[1] : unit[2]}`;
      }

      const pct = document.createElement("span");
      pct.className = "secbar-pct";

      const fill = document.createElement("i");
      fill.className = "secbar-fill";

      bar.append(meta, pct, fill);
      sec.insertBefore(bar, sec.firstChild);
      bars.push({ sec, bar, pct });
    }
    if (!bars.length) return;

    /* Progress is read from geometry on scroll, not from a view timeline: it
       has to be a number on screen as well as a width, and this is the same
       reason the scrollspy reads rects -- it always answers for right now. */
    let last = 0;
    const paint = () => {
      const railH = document.querySelector(".rail");
      const top = railH ? railH.getBoundingClientRect().height : 0;
      for (const b of bars) {
        const r = b.sec.getBoundingClientRect();
        // How far the section has travelled past the pin line, over the
        // distance it can travel: 0 when its top reaches the bar, 1 when its
        // bottom does.
        const total = r.height - (window.innerHeight - top);
        const p = total > 0 ? Math.min(1, Math.max(0, (top - r.top) / total)) : (r.top <= top ? 1 : 0);
        b.bar.style.setProperty("--p", p.toFixed(4));
        const shown = Math.round(p * 100);
        if (b.pct.textContent !== shown + "%") b.pct.textContent = shown + "%";
      }
    };

    const onScroll = () => {
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      paint();
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", paint);
  }

  /* ----------------------------------------------------------------- scrollspy
     Marks the rail link for whichever section currently owns the middle of the
     viewport. The band is deliberately narrow (a horizontal slice at 45% of
     the viewport height) rather than "most visible": with sections running from
     2x to 8x the viewport height, an area-based rule leaves the tallest section
     marked current long after it has scrolled past. */
  function initScrollSpy() {
    const pairs = [];
    for (const a of document.querySelectorAll('.rail nav a[href^="#"]')) {
      const sec = document.querySelector(a.getAttribute("href"));
      if (sec) pairs.push([sec, a]);
    }
    if (!pairs.length) return;

    /* Geometry read on scroll rather than an IntersectionObserver. IO reports
       state as of delivery time, and it is the observer -- not the geometry --
       that gets suspended when a tab is backgrounded or occluded, so the
       highlight can come back wrong after the tab is restored. A direct rect
       test always answers for right now, and eight rects on a throttled
       handler is nothing.

       The probe is a single horizontal line at 45% of the viewport, not "most
       visible area": these sections run from 2x to nearly 8x the viewport
       height, and an area rule leaves the tallest one marked current long
       after it has scrolled by. */
    let last = 0;
    const paint = () => {
      const probe = window.innerHeight * 0.45;
      let current = null;
      for (const [sec] of pairs) {
        const r = sec.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) { current = sec; break; }
      }
      for (const [sec, a] of pairs) a.classList.toggle("is-current", sec === current);
    };

    const onScroll = () => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      paint();
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", paint);
  }

  /* ------------------------------------------------------------ pinned steps
     The numbered breakdowns in the dossiers stop being a list you scroll past
     and become a sequence you scroll THROUGH: the block pins to the viewport
     and advances one step at a time, then releases and the page carries on.

     Built entirely here rather than in the markup, so with JS off, under
     reduced motion, or on a viewport too short to hold a step, the same <ol>
     renders as an ordinary list. The effect is additive; nothing depends on it.

     Driven by geometry on scroll rather than a view timeline, for the same
     reason as the scrollspy: this needs an answer for right now, and it is the
     only form I can actually verify. */
  function initPinnedSteps() {
    if (reducedMotion()) return;

    const lists = [...document.querySelectorAll(".dossier .steps")];
    if (!lists.length) return;

    const rail = document.querySelector(".rail");
    const railH = rail ? rail.getBoundingClientRect().height : 72;
    const GAP = 18;

    const pins = [];

    for (const ol of lists) {
      const items = [...ol.children];
      if (items.length < 3) continue;

      const wrap = document.createElement("div");
      wrap.className = "pinwrap";
      const stage = document.createElement("div");
      stage.className = "pinstage";

      const head = document.createElement("div");
      head.className = "pinhead";
      head.innerHTML =
        '<span class="pin-idx">01</span>' +
        `<span class="pin-of">of ${String(items.length).padStart(2, "0")}</span>` +
        '<i class="pin-bar"><b></b></i>';

      ol.parentNode.insertBefore(wrap, ol);
      stage.append(head, ol);
      wrap.appendChild(stage);
      ol.classList.add("steps-pinned");
      items.forEach((li, i) => { li.dataset.step = i; });

      pins.push({ wrap, stage, ol, head, items, active: -1 });
    }
    if (!pins.length) return;

    /* Heights are measured, never assumed. The stage has to hold the WHOLE
       list, since the steps build up rather than replacing each other, and a
       list that will not fit the viewport is unwound completely rather than
       pinned into something that scrolls inside itself.

       The measurement is taken with the pinned class off: `future` steps are
       translated and would otherwise report a displaced box. */
    function layout() {
      for (const p of pins) {
        /* The section's own sticky bar is already parked under the rail, so a
           stage pinned at railH slides underneath it and its head disappears.
           Measured per section rather than assumed: the bar is only present
           once initSectionBars has run, and its height depends on the chip. */
        const bar = p.wrap.closest("section").querySelector(".secbar");
        const barH = bar ? bar.getBoundingClientRect().height : 0;
        const pinTop = railH + barH + GAP;
        const avail = window.innerHeight - pinTop - GAP;
        p.ol.classList.remove("steps-pinned");
        const listH = p.ol.getBoundingClientRect().height;
        const headH = p.head.getBoundingClientRect().height;
        const need = listH + headH + GAP;

        if (need > avail || window.innerWidth < 900) {
          p.enabled = false;
          p.wrap.classList.add("is-off");
          p.wrap.style.height = "";
          p.stage.style.height = "";
          p.items.forEach((li) => delete li.dataset.state);
          continue;
        }

        p.enabled = true;
        p.active = -1; // force a repaint of the step states
        p.wrap.classList.remove("is-off");
        p.ol.classList.add("steps-pinned");
        p.stageH = need;
        p.pinTop = pinTop;
        p.stage.style.height = `${p.stageH}px`;
        p.stage.style.top = `${pinTop}px`;
        // A full screen of scroll per step is a slog for a two-line item.
        p.stepScroll = Math.round(window.innerHeight * 0.4);
        p.wrap.style.height = `${p.stageH + p.items.length * p.stepScroll}px`;
      }
      paint();
    }

    function paint() {
      for (const p of pins) {
        if (!p.enabled) continue;
        const r = p.wrap.getBoundingClientRect();
        const travel = r.height - p.stageH;
        // Must match the sticky `top` exactly, or progress reads as non-zero
        // before the stage has actually pinned.
        const scrolled = p.pinTop - r.top;
        const t = travel > 0 ? Math.min(1, Math.max(0, scrolled / travel)) : 0;

        // n slots across the track; the last one has to include t === 1 or the
        // final step never becomes active.
        const idx = Math.min(p.items.length - 1, Math.floor(t * p.items.length));
        if (idx !== p.active) {
          p.active = idx;
          p.items.forEach((li, i) => {
            li.dataset.state = i < idx ? "past" : i === idx ? "active" : "future";
          });
          p.head.querySelector(".pin-idx").textContent = String(idx + 1).padStart(2, "0");
        }
        p.head.querySelector(".pin-bar b").style.width =
          `${((idx + 1) / p.items.length) * 100}%`;
      }
    }

    let last = 0;
    window.addEventListener("scroll", () => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      paint();
    }, { passive: true });

    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(layout, 150); });
    layout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  }

  window.initUiPolish = function () {
    trackRailHeight();
    initClock();
    initCustomPointer();
    initCommandPalette();
    initLossField();
    initScrollRail();
    initPanelWake();
    initCardSpotlight();
    initRailTelemetry();
    initFooterSignature();
    initNavPreview();
    initWordSplit();
    initCountUp();
    initSectionBars();
    initScrollSpy();
    initPinnedSteps();
  };
})();
