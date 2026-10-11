/**
 * Writes every tensor-compiler-webgpu figure on this page from that project's
 * golden/measurements.json, so none of them is typed by hand.
 *
 *   node tools/tensor-compiler-figures.mjs            # rewrite index.html
 *   node tools/tensor-compiler-figures.mjs --check    # exit 1 if any differ
 *   node tools/tensor-compiler-figures.mjs [--check] <path or URL of measurements.json>
 *
 * The default source is the deployed report's file. In index.html a figure is
 * any element carrying data-figure="tc-..."; its text is replaced with the
 * value computed below. An unknown key is an error, so a typo cannot leave a
 * stale figure standing.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT = "https://abho7.github.io/tensor-compiler-webgpu/golden/measurements.json";
const args = process.argv.slice(2);
const check = args.includes("--check");
const source = args.find((a) => !a.startsWith("--")) ?? DEFAULT;

const data = source.startsWith("http")
  ? await (await fetch(source, { cache: "no-store" })).json()
  : JSON.parse(readFileSync(source, "utf8"));

const n = (v) => Number(v).toLocaleString("en-US");
const of = (a, b) => `${n(a)} of ${n(b)}`;

function figures({ m2 }) {
  const bugs = m2.sabotage.filter((s) => s.bug);
  const missed = m2.sabotage.find((s) => s.name === "elementwise-no-bounds-check");
  const affected = missed.fuzz.general.containing + missed.fuzz.targeted.containing;
  const caughtByFuzz = missed.fuzz.general.caught + missed.fuzz.targeted.caught;
  return {
    "tc-direct": of(m2.direct.pass, m2.direct.cases),
    "tc-bugs": of(bugs.filter((s) => s.direct.caught > 0).length, bugs.length),
    "tc-fuzz-runs": of(m2.fuzz.passed, m2.fuzz.runs),
    "tc-fuzz-programs": n(m2.fuzz.programs),
    "tc-safety": n(m2.budget.safetyFactor),
    "tc-first-run": of(m2.firstRun.pass, m2.firstRun.cases),
    "tc-missed": of(caughtByFuzz, affected),
    "tc-missed-affected": n(affected),
    "tc-adapter": `${m2.adapter.vendor} ${m2.adapter.architecture}`.trim(),
  };
}

const F = figures(data);
const path = new URL("../index.html", import.meta.url);
const html = readFileSync(path, "utf8");

const unknown = [], differ = [];
const used = new Set();
const pattern = /(<(span|tspan|b|dd)\b[^>]*\bdata-figure="(tc-[a-z0-9-]+)"[^>]*>)([^<]*)(<\/\2>)/g;
const next = html.replace(pattern, (all, open, tag, key, text, close) => {
  if (!(key in F)) { unknown.push(key); return all; }
  used.add(key);
  if (text !== F[key]) differ.push(`${key}: page "${text}", file "${F[key]}"`);
  return open + F[key] + close;
});

// process.exitCode rather than process.exit(): exiting straight after a fetch
// trips a libuv assertion on Windows and reports 127 instead of 1.
if (unknown.length) {
  console.error(`unknown figure keys in index.html: ${[...new Set(unknown)].join(", ")}`);
  process.exitCode = 1;
} else if (used.size === 0) {
  console.error("no data-figure elements found in index.html");
  process.exitCode = 1;
} else if (check) {
  if (differ.length) {
    console.error(`figures that differ from ${source}:\n  ${differ.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log(`${used.size} figure keys on the page match ${source}`);
  }
} else {
  writeFileSync(path, next);
  console.log(`wrote ${used.size} figure keys from ${source} (${differ.length} changed)`);
}
