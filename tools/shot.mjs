/**
 * Screenshot helper: drives a real Chrome over the DevTools protocol, for
 * checking a change to this page actually renders before it is pushed.
 *
 *   # start Chrome once, headless, with the protocol open
 *   chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
 *          --remote-debugging-port=9412 --user-data-dir=<a scratch dir> about:blank
 *
 *   node tools/shot.mjs <url> <out.png> <width> <height> [clickSelector] [waitMs]
 *
 * Three things this exists to get around, each of which has produced a
 * confidently wrong read of a page that was in fact fine:
 *
 *   - `chrome --headless --screenshot --window-size=390,844` does not emulate a
 *     phone. On Windows the window is clamped to about 512 CSS px, so a narrow
 *     size silently crops a wider layout and the result looks broken. This sets
 *     real device metrics through Emulation.setDeviceMetricsOverride instead.
 *   - `--virtual-time-budget` fast-forwards timers but not CSS transitions, so
 *     anything with a transition is captured mid-flight and a working animation
 *     looks broken. This waits in real time after the click.
 *   - A tall `--window-size` quietly fails above roughly 4000 px and writes no
 *     file at all. Shoot a trimmed copy of the section wanted rather than the
 *     whole document.
 *
 * Note that most of this page is hidden until scrolled into view (`.reveal`,
 * and `.panel[data-wake]` which also starts the instrument inside it). For a
 * static shot, copy index.html and inject:
 *
 *   .reveal{opacity:1!important;transform:none!important;filter:none!important}
 *   .panel{opacity:1!important;transform:none!important}
 */
const [url, out, w, h, clickSelector, waitMsRaw] = process.argv.slice(2);
const waitMs = Number(waitMsRaw ?? 1500);
const PORT = 9412;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

const page = (await targets()).find((t) => t.type === "page");
if (!page) throw new Error("no page target; is Chrome running with --remote-debugging-port?");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 2,
  mobile: Number(w) < 700,
});
await send("Page.navigate", { url });
await sleep(2500);

if (clickSelector) {
  const r = await send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)});
                 if (!el) return "missing"; el.click(); return "clicked"; })()`,
    returnByValue: true,
  });
  console.log("click:", r.result?.result?.value);
  await sleep(waitMs);
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
const { writeFileSync } = await import("node:fs");
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("wrote", out);
ws.close();
