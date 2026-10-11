/**
 * Writes the llm-inference-webgpu speed figures on this page from that
 * project's golden/measurements.json, so none of them is typed by hand. Same
 * pattern as tools/tensor-compiler-figures.mjs.
 *
 *   node tools/llm-inference-figures.mjs            # rewrite index.html
 *   node tools/llm-inference-figures.mjs --check    # exit 1 if any differ
 *   node tools/llm-inference-figures.mjs [--check] <path or URL of measurements.json>
 *
 * The comparison is the report's own: ONNX Runtime on the CPU and the engine,
 * run alternately in one session under one Windows power mode, medians of the
 * session's readings, rounded the way the report rounds them. The power mode
 * is itself a figure, so it is written next to every timing from the same
 * file. An element carrying data-figure="llm-..." gets the value below; an
 * unknown key is an error.
 */
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT = "https://abho7.github.io/llm-inference-webgpu/golden/measurements.json";
const args = process.argv.slice(2);
const check = args.includes("--check");
const source = args.find((a) => !a.startsWith("--")) ?? DEFAULT;

const data = source.startsWith("http")
  ? await (await fetch(source, { cache: "no-store" })).json()
  : JSON.parse(readFileSync(source, "utf8"));

// As the report computes them (its index.html, "Speed, against a real
// inference runtime"): the median of the session's readings, one decimal.
const median = (a) => {
  const v = [].concat(a).sort((x, y) => x - y);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
};
const ms = (v) => `${Number(v).toFixed(1)} ms`;
const times = (v) => `${v.toFixed(1)}×`;

function figures({ decodeOverhead: D }) {
  const S = D.sameSession;
  const ortDecode = median(S.onnxRuntime.decodeMedianMs);
  const ourDecode = median(S.currentEngine.decodeMedianMs);
  const ortPrefill = median(S.onnxRuntime.prefillMs);
  const ourPrefill = median(S.currentEngine.prefillMs);
  return {
    "llm-mode": D.powerModes[S.powerMode].label,
    "llm-decode-engine": ms(ourDecode),
    "llm-decode-ort": ms(ortDecode),
    "llm-decode-ratio": times(ortDecode / ourDecode),
    "llm-prefill-engine": ms(ourPrefill),
    "llm-prefill-ort": ms(ortPrefill),
    "llm-prefill-ratio": times(ourPrefill / ortPrefill),
    "llm-prompt-tokens": String(S.promptTokens),
  };
}

const F = figures(data);
const path = new URL("../index.html", import.meta.url);
const html = readFileSync(path, "utf8");

const unknown = [], differ = [];
const used = new Set();
const pattern = /(<(span|tspan|b|dd)\b[^>]*\bdata-figure="(llm-[a-z0-9-]+)"[^>]*>)([^<]*)(<\/\2>)/g;
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
