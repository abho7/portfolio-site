# portfolio-site

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The source of **[abho7.github.io/portfolio-site](https://abho7.github.io/portfolio-site/)**.

A static site: no framework, no bundler, no build step, and nothing to install. The
deployed bytes are the files in this repository, which is why there is no `dist/` and no
CI job — GitHub Pages serves `main` directly.

---

## What runs in the browser

Three panels on the page execute the real algorithm rather than replaying a recording:

| | what it does |
|---|---|
| `raft-sim.js` | A Raft cluster you can partition and kill nodes in. A direct port of `raft-kv-store`'s Python engine — same tick-driven design, same Figure-8 commit rule — so it stays checkable against the source it mirrors. |
| `hnsw-viz.js` | An HNSW index built and searched live. A port of the Python `HNSWIndex`, keeping the `SELECT-NEIGHBORS-HEURISTIC` diversity rule rather than the simpler nearest-M version, since that rule is what keeps the graph from collapsing. Each node's position on screen *is* its vector, so the lit search path is the algorithm's real geometry. |
| `nlp-compare.js` | A keyword matcher, client-side and deliberately dumb, against the deployed model at `crisis-nlp-demo.onrender.com/predict` and its real per-token attributions. |

`main.js` and `ui-polish.js` carry the scroll, reveal and keyboard behaviour.

Exactly two requests leave the page, both to things this account publishes:

- On load, `main.js` re-reads the headline Raft figures from the deployed
  `raft-chaos-testing` report, whose `results.json` is served with
  `Access-Control-Allow-Origin: *`. The scenario and violation counts here are therefore
  the ones that project's CI last produced — if a future run regresses, this page says
  so on its own. If the fetch fails, the figures already in the markup stand.
- When you ask it to classify something, `nlp-compare.js` posts to the deployed
  classifier.

Both degrade to a static fallback, so the page reads correctly offline. `raft-sim.js`
and `hnsw-viz.js` need no network at all.

## No third parties

The three typefaces (Instrument Serif, Space Grotesk, JetBrains Mono) are served from
`fonts/` rather than from a font CDN, so there is no connection to warm and no request
that leaks a visitor's address. The site sets no cookies and loads no analytics; see
[privacy.html](privacy.html) and [cookies.html](cookies.html), which say the same thing
in more detail.

## Generated assets

Two files in `tools/` produce the images that cannot be written by hand:

- `tools/og-card.html` renders `og.png`, the 1200x630 link-preview card. It pulls the
  real `styles.css`, so the card uses the same faces, palette and gradient as the page
  it advertises and cannot drift from them.
- `tools/icon.html` rasterises `favicon.svg` into `favicon.ico` and
  `apple-touch-icon.png`, neither of which can be SVG.

Each file's header comment carries the exact command that regenerates it.

## Layout

```
index.html        the whole page; sections are commented by name
styles.css        one stylesheet, design tokens on :root
main.js           scroll, reveal, navigation
ui-polish.js      focus handling and keyboard affordances
raft-sim.js       live Raft cluster
hnsw-viz.js       live HNSW index
nlp-compare.js    keyword matcher vs. the deployed classifier
privacy.html      what the site collects, which is nothing
terms.html        what the material may be used for
cookies.html      why there is no consent banner
fonts/            self-hosted woff2
tools/            generators for og.png and the icons
```

## Licence

MIT.
