const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const engine = require("../public/chart-engine.js");

function harness({ bootstrap = false, fullStorage = false } = {}) {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const nodes = new Map();
  const makeNode = () => ({ textContent: "", innerHTML: "", style: {}, dataset: {}, value: "",
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(name, value) { if (name === "data-active-view") this.dataset.activeView = value; },
    querySelectorAll: () => [], addEventListener() {} });
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, makeNode());
  const storage = new Map();
  const requests = [];
  const renders = [];
  const window = {
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, addEventListener() {},
    matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn) => fn(), scrollTo() {},
    ALChart: { ...engine, isActive: () => Boolean(renders.length), clear() {}, render(options) { renders.push(options); return true; } }
  };
  const context = vm.createContext({ window, console, Intl, Date, URLSearchParams, AbortController,
    requestAnimationFrame: window.requestAnimationFrame,
    navigator: {}, location: { hash: "" }, history: { replaceState() {} },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) { if (fullStorage && key.startsWith("lastKlinePayload")) throw new Error("Quota exceeded"); storage.set(key, value); },
      removeItem: (key) => storage.delete(key)
    },
    document: { querySelector: (selector) => selector.startsWith("#") ? nodes.get(selector.slice(1)) || null : makeNode(),
      querySelectorAll: () => [], addEventListener() {}, hidden: false },
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    }
  });
  const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  vm.runInContext((bootstrap ? app : app.slice(0, app.indexOf("els.refreshInterval.value ="))) +
    "\nthis.chartFetch = fetchKline; this.appState = state;", context);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const reply = (request, symbol, close = 101) => {
    const url = new URL(request.url, "http://localhost");
    request.resolve({ ok: true, json: async () => ({ symbol, code: symbol.replace(/^(nf_|us_)/, ""),
      productLabel: symbol === "us_AA" ? "美铝" : "沪铝", interval: "1d", priceUnit: symbol === "us_AA" ? "美元/股" : "元/吨",
      requestedStart: url.searchParams.get("start"), requestedEnd: url.searchParams.get("end"), fetchedAt: new Date().toISOString(),
      candles: [{ date: "2026-10-02", open: 100, high: Math.max(103, close), low: 99, close, volume: 100 }] }) });
  };
  return { context, requests, renders, nodes, settle, reply };
}

test("full app bootstrap requests its chart once and renders it before quotes are available", async () => {
  const h = harness({ bootstrap: true });
  assert.equal(h.requests.filter((r) => r.url.startsWith("/api/kline")).length, 1);
  assert.equal(h.requests.filter((r) => r.url.startsWith("/api/quote")).length, 1);
  h.reply(h.requests.find((r) => r.url.startsWith("/api/kline")), "nf_AL0");
  await h.settle();
  assert.equal(h.renders.length, 1);
  assert.equal(h.nodes.get("contractBadge").textContent, "AL0");
  assert.match(h.nodes.get("marketState").textContent, /K 线收盘.*报价不可用/);
});

test("identical requests are deduplicated and stale A → B → A replies cannot overwrite the current chart", async () => {
  const h = harness();
  const oldA = h.context.chartFetch();
  await h.context.chartFetch();
  assert.equal(h.requests.length, 1);
  h.context.appState.selectedSymbol = "us_AA";
  const pendingB = h.context.chartFetch();
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.context.appState.selectedSymbol = "nf_AL0";
  const newA = h.context.chartFetch();
  assert.equal(h.requests[1].options.signal.aborted, true);
  h.reply(h.requests[2], "nf_AL0", 102);
  await newA;
  h.reply(h.requests[0], "nf_AL0", 100);
  h.reply(h.requests[1], "us_AA", 105);
  await Promise.all([oldA, pendingB]);
  assert.equal(h.renders.length, 1);
  assert.equal(h.context.appState.klinePayload.candles[0].close, 102);
});

test("a full offline cache does not prevent displaying a live US chart or mislabel it as aluminum futures", async () => {
  const h = harness({ fullStorage: true });
  h.context.appState.selectedSymbol = "us_AA";
  const pending = h.context.chartFetch();
  h.reply(h.requests[0], "us_AA", 104);
  await pending;
  assert.equal(h.renders.length, 1);
  assert.equal(h.nodes.get("contractName").textContent, "美铝 AA");
  assert.equal(h.nodes.get("priceUnit").textContent, "美元/股");
  assert.equal(h.nodes.get("lastPrice").textContent, "104");
  assert.match(h.nodes.get("marketState").textContent, /报价不可用/);
});

test("the chart has a reachable exit control for native and fallback fullscreen", async () => {
  const handlers = {};
  const classes = new Set();
  let nativeExitCount = 0;
  let focused = "";
  const openButton = { id: "chartFullScreen", dataset: {}, hasAttribute: () => false,
    setAttribute() {}, focus() { focused = "open"; } };
  const exitButton = { dataset: {}, hasAttribute: (key) => key === "data-chart-exit", focus() { focused = "exit"; } };
  const wrap = { classList: { contains: (key) => classes.has(key), add: (key) => classes.add(key), remove: (key) => classes.delete(key) },
    querySelector: () => exitButton };
  const document = {
    fullscreenElement: null,
    querySelector: (selector) => selector === "#chartWrap" ? wrap : openButton,
    addEventListener: (name, handler) => { handlers[name] = handler; },
    exitFullscreen: async () => { nativeExitCount += 1; document.fullscreenElement = null; }
  };
  const context = vm.createContext({ window: { document } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/chart-engine.js"), "utf8"), context);
  const click = (button) => handlers.click({ target: { closest: () => button } });
  click(openButton);
  assert.equal(classes.has("is-expanded"), true);
  assert.equal(focused, "exit");
  click(exitButton);
  assert.equal(classes.has("is-expanded"), false);
  assert.equal(focused, "open");
  document.fullscreenElement = wrap;
  click(exitButton);
  assert.equal(nativeExitCount, 1);
  click(openButton);
  handlers.keydown({ key: "Escape" });
  assert.equal(classes.has("is-expanded"), false);
});


test("short chart ranges retain earlier indicator history without plotting the warmup bars", async () => {
  const h = harness();
  Object.assign(h.context.appState, { klineStart: "2026-09-01", klineEnd: "2026-09-30", strategy: "al_update_1" });
  const pending = h.context.chartFetch();
  const requestUrl = new URL(h.requests[0].url, "http://localhost");
  assert.equal(requestUrl.searchParams.get("start"), "2005-01-01");
  const candles = Array.from({ length: 92 }, (_, index) => {
    const close = 20000 + index * 2 + 200 * Math.sin(index / 7);
    return { date: new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10),
      open: close - 10, high: close + 20, low: close - 20, close, volume: 1000 };
  });
  h.requests[0].resolve({ ok: true, json: async () => ({ symbol: "nf_AL0", code: "AL0", interval: "1d", priceUnit: "元/吨",
    requestedStart: "2005-01-01", requestedEnd: "2026-09-30", fetchedAt: "2026-10-04T00:00:00Z", candles }) });
  await pending;
  const plotted = h.renders.at(-1);
  assert.equal(h.context.appState.klinePayload.candles.length, 92);
  assert.equal(h.context.appState.klinePayload.requestedStart, "2026-09-01");
  assert.equal(plotted.candles[0].date, "2026-09-01");
  assert.equal(plotted.candles.length, 30);
  const startIndex = candles.findIndex(candle => candle.date === "2026-09-01");
  const expectedMA = candles.slice(startIndex - 4, startIndex + 1).reduce((sum, candle) => sum + candle.close, 0) / 5;
  assert.ok(Math.abs(plotted.maValues[0] - expectedMA) < 1e-8);
  assert.ok(plotted.strategy.lines.every(line => Number.isFinite(line.values[0])));
  assert.ok(plotted.strategy.signals.every(signal => signal.index >= 0 && signal.index < 30));
  assert.match(h.nodes.get("strategyComparison").innerHTML, /历史不足/);
});
