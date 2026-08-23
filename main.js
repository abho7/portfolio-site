/* =============================================================================
   Portfolio behaviour.

   Four things happen here:
     1. the rotating identity line under the name
     2. live hero numbers, fetched from the deployed raft-chaos-testing
        report's results.json rather than copied into this page
     3. renderTimeline(), the leader-band/fault-window drawer -- exposed on
        window so raft-sim.js's live in-browser cluster simulator can draw
        in the exact same visual language instead of duplicating it
     4. reveal-on-scroll for the numbered sections

   The raft report serves Access-Control-Allow-Origin: *, so its results.json
   can be read cross-origin. That means the hero figures on this page are the
   ones its CI actually produced on its last run -- if a future run
   regresses, this page says so on its own. Every network call degrades to a
   sane static fallback, so the page is fully readable offline; raft-sim.js
   and hnsw-viz.js need no network at all.
============================================================================= */

// Set before anything else can throw: the reveal styles are scoped to .js, so
// content stays visible if this script never runs. Nothing below may be moved
// above this line.
document.documentElement.classList.add("js");

/* --------------------------------------------------------------- rotator */
const IDENTITIES = [
  "Systems Engineer",
  "AI Researcher",
  "Cricket Captain",
  "Nonprofit Co-Founder",
];

function startRotator() {
  const slot = document.getElementById("rotator-slot");
  if (!slot) return;
  let i = 0;

  const paint = () => {
    const word = document.createElement("span");
    word.className = "word";
    word.textContent = IDENTITIES[i];
    slot.replaceChildren(word);
  };

  paint();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  setInterval(() => { i = (i + 1) % IDENTITIES.length; paint(); }, 2600);
}

/* ------------------------------------------------------------ live stats */
const REPORT = "https://abho7.github.io/raft-chaos-testing/";

async function loadRaftStats() {
  // Headline figures only (scenarios/violations, both driven by the deployed
  // report's own last CI run). The in-page timeline is owned by the live
  // in-browser simulator (raft-sim.js) instead of this fetch -- see
  // renderRaftTimeline below, which raft-sim.js calls directly.
  //
  // Keyed by data-stat rather than id so the same figure can appear in more
  // than one place (headline band and project block) and stay in sync.
  const setStat = (key, value) => {
    for (const el of document.querySelectorAll(`[data-stat="${key}"]`)) {
      el.textContent = value;
    }
  };

  try {
    const res = await fetch(REPORT + "results.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const s = data.summary;
    setStat("scenarios", `${s.passed}/${s.scenarios}`);
    setStat("violations", String(s.violations));
  } catch (err) {
    // The markup already carries the figures from the run at the time this
    // page was written, so there is nothing to do on failure -- leaving them
    // untouched is the fallback.
  }
}

function renderTimeline(host, sc) {
  const total = sc.total_ticks || 1;
  const pct = (v) => (v / total) * 100;

  const rows = sc.nodes.map(node => {
    const bands = sc.leader_intervals
      .filter(i => i.node === node)
      .map(i => `<div class="mini-band lead" style="left:${pct(i.start)}%;width:${Math.max(pct(i.end - i.start), 1)}%"
                   title="${node} led term ${i.term} · ticks ${i.start}–${i.end}"></div>`)
      .join("");
    return `<div class="mini-row"><div class="mini-name">${node}</div><div class="mini-track">${bands}</div></div>`;
  }).join("");

  const faults = sc.fault_windows
    .map(w => `<div class="mini-band fault" style="left:${pct(w.start)}%;width:${Math.max(pct(w.end - w.start), 1)}%"
                 title="${(w.label || w.kind)} · ticks ${w.start}–${w.end}"></div>`)
    .join("");

  host.innerHTML = `
    <p class="loading" style="margin:0 0 .7rem">
      ${sc.name}: ${sc.leader_intervals.length} leadership handovers,
      ${sc.fault_windows.length} injected faults, ${sc.check.acked_writes} acknowledged writes
    </p>
    <div class="mini">
      ${rows}
      <div class="mini-row"><div class="mini-name f">faults</div><div class="mini-track">${faults}</div></div>
    </div>
    <div class="mini-axis"><div></div><div class="t"><span>t0</span><span>t${total}</span></div></div>
    <div class="mini-key">
      <span><i class="lead"></i> leadership</span>
      <span><i class="fault"></i> active fault</span>
      <span>hover a band for its term and tick range</span>
    </div>`;
}
// Exposed so raft-sim.js can draw the live in-browser simulator in the same
// leader-band/fault-window visual language as this fetched-report renderer.
window.renderRaftTimeline = renderTimeline;

/* -------------------------------------------------------------- reveals */
/* This must fail OPEN. The reveal styles hide content until it is observed, so
   any path where the observer does not deliver leaves a blank page -- and that
   is not hypothetical: a backgrounded or occluded tab has rendering suspended,
   which suspends IntersectionObserver and requestAnimationFrame along with it.
   Three independent guarantees, cheapest first. */
function startReveals() {
  const targets = [...document.querySelectorAll(".reveal")];

  // Stagger siblings that reveal together (project cards, leadership
  // entries, contact cards) instead of letting them pop in as one block.
  // Grouped by parentElement so each container's own .reveal children get
  // their own 0,1,2... sequence -- a section header next to 3 cards ends up
  // as {header:0, card:0, card:1, card:2} in two independent cohorts, which
  // is exactly the "header leads, cards cascade after" order already implied
  // by the markup, with no section-specific logic needed here.
  const STAGGER_MS = 65;
  const STAGGER_MAX_STEPS = 5; // cap so a long list (6 leadership entries) doesn't drag out the tail
  const cohortCounts = new Map();
  const delayFor = new Map();
  for (const el of targets) {
    const parent = el.parentElement;
    const i = cohortCounts.get(parent) || 0;
    cohortCounts.set(parent, i + 1);
    delayFor.set(el, Math.min(i, STAGGER_MAX_STEPS) * STAGGER_MS);
  }

  const show = (el) => {
    el.style.setProperty("--reveal-delay", `${delayFor.get(el) || 0}ms`);
    el.classList.add("in");
  };

  // 1. Anything already on screen is revealed synchronously, from geometry
  //    alone -- no observer, no frame, no network.
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  };
  targets.forEach(el => { if (onScreen(el)) show(el); });

  // 2. The observer handles everything scrolled to later.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { show(entry.target); io.unobserve(entry.target); }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: .06 });
    targets.forEach(el => { if (!el.classList.contains("in")) io.observe(el); });
  } else {
    targets.forEach(show);
    return;
  }

  // 3. Backstop: if anything is still hidden shortly after load, reveal it
  //    unconditionally. Losing an animation is trivial; losing the content is not.
  setTimeout(() => targets.forEach(show), 2500);
}

startRotator();
startReveals();
loadRaftStats();
if (typeof window.initRaftSim === "function") window.initRaftSim();
if (typeof window.initHnswViz === "function") window.initHnswViz();
if (typeof window.initNlpCompare === "function") window.initNlpCompare();
if (typeof window.initUiPolish === "function") window.initUiPolish();
