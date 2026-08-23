/* =============================================================================
   Keyword-match vs. semantic-model comparison.

   The keyword side is deliberately dumb: a fixed word list, checked with no
   understanding of context. It runs entirely client-side. The semantic side
   calls the real deployed model (crisis-nlp-demo's /predict, the same one
   embedded in the iframe above) and renders its actual per-token SHAP
   attributions -- not a simulation of what it might say.
============================================================================= */

(function () {
  "use strict";

  const API = "https://crisis-nlp-demo.onrender.com/predict";

  // A naive but honest keyword list: surface-level urgency vocabulary, no
  // context awareness. This is the thing the model above is contrasted against.
  const KEYWORDS = [
    "disaster", "emergency", "urgent", "help", "trapped", "fire", "flood",
    "earthquake", "collapse", "collapsed", "injured", "rescue", "evacuate",
    "explosion", "crisis", "burning", "flooding",
  ];
  const KEYWORD_RE = new RegExp("\\b(" + KEYWORDS.join("|") + ")\\b", "gi");

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderKeyword(host, text) {
    const matches = [...text.matchAll(KEYWORD_RE)].map((m) => m[0]);
    const flagged = matches.length > 0;

    let highlighted = "";
    let cursor = 0;
    for (const m of text.matchAll(KEYWORD_RE)) {
      highlighted += escapeHtml(text.slice(cursor, m.index));
      highlighted += `<span class="nlp-hit">${escapeHtml(m[0])}</span>`;
      cursor = m.index + m[0].length;
    }
    highlighted += escapeHtml(text.slice(cursor));

    host.innerHTML =
      `<div class="nlp-verdict ${flagged ? "flag" : "clear"}">${flagged ? "flagged: disaster-related" : "not flagged"}</div>` +
      `<div>${highlighted || "<em>(empty)</em>"}</div>` +
      `<div class="nlp-note">${flagged ? `matched: ${[...new Set(matches.map((m) => m.toLowerCase()))].join(", ")}` : "no urgency words present; no other signal is considered"}</div>`;
  }

  function renderSemanticLoading(host) {
    host.innerHTML =
      `<div class="nlp-note">calling the live model…</div>` +
      `<div class="nlp-note">first request after idle can take up to ~50s (free-tier cold start)</div>`;
  }

  function renderSemanticError(host) {
    host.innerHTML = `<div class="nlp-note">Couldn't reach the live model just now. Try the demo above, or Compare again in a moment.</div>`;
  }

  function renderSemantic(host, data) {
    const flagged = data.predicted_class === "disaster-related";
    const pct = Math.round(data.confidence * 100);
    const segmentsHtml = data.segments
      .map((seg) => {
        if (!seg.is_token || seg.contribution === 0) return escapeHtml(seg.text);
        const cls = seg.contribution > 0 ? "pos" : "neg";
        return `<span class="nlp-token ${cls}">${escapeHtml(seg.text)}</span>`;
      })
      .join("");

    host.innerHTML =
      `<div class="nlp-verdict ${flagged ? "flag" : "clear"}">${escapeHtml(data.predicted_class)} · ${pct}%</div>` +
      `<div>${segmentsHtml}</div>` +
      `<div class="nlp-note">red = pushed toward disaster-related · green = pushed away · whole sentence weighed, not a word list</div>`;
  }

  function initNlpCompare() {
    const input = document.getElementById("nlp-compare-input");
    const runBtn = document.getElementById("nlp-compare-run");
    const keywordHost = document.getElementById("nlp-compare-keyword");
    const semanticHost = document.getElementById("nlp-compare-semantic");
    if (!input || !runBtn || !keywordHost || !semanticHost) return;

    let requestToken = 0;

    async function compare() {
      const text = input.value.trim();
      if (!text) return;

      renderKeyword(keywordHost, text);

      const token = ++requestToken;
      renderSemanticLoading(semanticHost);
      runBtn.disabled = true;
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (token !== requestToken) return; // a newer request superseded this one
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderSemantic(semanticHost, data);
      } catch (err) {
        if (token === requestToken) renderSemanticError(semanticHost);
      } finally {
        if (token === requestToken) runBtn.disabled = false;
      }
    }

    runBtn.addEventListener("click", compare);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") compare();
    });

    // Deferred rather than run at init: ui-polish.js triggers the first
    // comparison when the panel scrolls into view, so the result appears as
    // you arrive at it. Guarded so it can only ever fire once on its own.
    let autoRan = false;
    window.nlpAutoCompare = () => {
      if (autoRan) return;
      autoRan = true;
      compare();
    };
  }

  window.initNlpCompare = initNlpCompare;
})();
