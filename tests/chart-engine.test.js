const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const engine = require("../public/chart-engine.js");

function candle(date, close = 102) {
  return { date, open: 100, high: Math.max(105, close), low: 98, close, volume: 123, openInterest: 1000 };
}

test("exchange wall time and daily business dates never drift with client timezone", () => {
  assert.equal(engine.chartTime("2026-10-02 21:00:00", "1h"), Date.UTC(2026, 9, 2, 21) / 1000);
  assert.equal(engine.chartTime("2026-10-02 09:30", "1h"), Date.UTC(2026, 9, 2, 9, 30) / 1000);
  assert.equal(engine.chartTime("2026-10-02", "1d"), "2026-10-02");
  assert.equal(engine.chartTime("2026-02-30", "1d"), null);
  assert.equal(engine.chartTime("2026-10-02 25:00", "1h"), null);
});

test("unordered duplicate and invalid candles become one ascending, valid stream", () => {
  const source = [candle("2026-10-02"), candle("2026-10-01"), candle("2026-10-02", 103),
    { ...candle("2026-10-03"), close: null }, { ...candle("2026-10-04"), high: 50 }, candle("bad")];
  const normalized = engine.normalizeCandles(source, "1d");
  assert.deepEqual(normalized.map((row) => [row.date, row.close]), [["2026-10-01", 102], ["2026-10-02", 103]]);
  assert.equal(source.length, 6);
  assert.deepEqual(engine.normalizeCandles(null, "1d"), []);
});

test("indicator warmup and missing values stay whitespace while a real zero is retained", () => {
  const rows = [candle("2026-10-01"), candle("2026-10-02"), candle("2026-10-03")];
  assert.deepEqual(engine.lineData(rows, [null, 0, Number.NaN], "1d"), [
    { time: "2026-10-01" }, { time: "2026-10-02", value: 0 }, { time: "2026-10-03" }
  ]);
});

test("signal labels and directions survive chronological marker conversion", () => {
  const rows = [candle("2026-10-01"), candle("2026-10-02")];
  const markers = engine.markerData(rows, [
    { index: 1, type: "sell", dy: -8, label: "平多开空" },
    { index: 0, type: "buy", dy: 16, label: "开多" },
    { index: 0, type: "position", dy: -8, label: "空增" },
    { index: 4, type: "buy", dy: 16, label: "invalid" }
  ], "1d");
  assert.deepEqual(markers.map((marker) => [marker.time, marker.text, marker.shape, marker.position]), [
    ["2026-10-01", "开多", "arrowUp", "belowBar"],
    ["2026-10-01", "空增", "circle", "aboveBar"],
    ["2026-10-02", "平多开空", "arrowDown", "aboveBar"]
  ]);
});

function mockLibrary() {
  const charts = [];
  const lib = {
    CandlestickSeries: "candles", HistogramSeries: "volume", LineSeries: "line",
    createChart(container, initialOptions) {
      const chart = {
        allSeries: [], range: null, removed: false, initialOptions, sizes: [],
        resize(width, height) { this.sizes.push({ width, height }); this.range = { from: -1000, to: -990 }; },
        applyOptions(options) { this.options = options; },
        addSeries(type, options, pane = 0) {
          const series = {
            type, options, pane, data: [],
            setData(data) { this.data = data; },
            applyOptions(options) { this.options = { ...this.options, ...options }; },
            priceScale() { return { applyOptions() {} }; }
          };
          this.allSeries.push(series);
          return series;
        },
        removeSeries(series) { this.allSeries = this.allSeries.filter((item) => item !== series); },
        panes: () => [{}, { setStretchFactor() {} }],
        subscribeCrosshairMove(callback) { this.crosshair = callback; },
        timeScale() {
          return {
            getVisibleLogicalRange: () => this.range,
            setVisibleLogicalRange: (range) => { this.range = range; },
            fitContent: () => { this.range = { from: 0, to: this.allSeries[0].data.length - 1 }; }
          };
        },
        priceScale: () => ({ applyOptions() {} }),
        remove() { this.removed = true; }
      };
      charts.push(chart);
      return chart;
    },
    createSeriesMarkers(series) {
      return { setMarkers(markers) { series.markers = markers; } };
    }
  };
  return { lib, charts };
}

function loadAppCalculations() {
  const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const storage = new Map();
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    document: { querySelector: () => ({}), querySelectorAll: () => [] }
  });
  vm.runInContext(app.slice(0, app.indexOf("els.refreshInterval.value =")) +
    "\nthis.compute = computeStrategy; this.average = movingAverage; this.keys = Object.keys(STRATEGY_CONFIGS);", context);
  return context;
}

test("interactive refresh keeps the user's viewport and the three selected strategies", () => {
  const { lib, charts } = mockLibrary();
  globalThis.LightweightCharts = lib;
  const container = { dataset: {}, replaceChildren() {} };
  const legend = { dataset: {} };
  const calculations = loadAppCalculations();
  const rows = Array.from({ length: 160 }, (_, index) => {
    const close = 100 + Math.sin(index / 7) * 20 + index / 4;
    return { date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 + index,
      openInterest: 5000 + Math.round(Math.cos(index) * 500) };
  });
  const base = { container, legend, candles: rows, maValues: calculations.average(rows, 5),
    maPeriod: 5, interval: "1d", theme: "light", key: "al:1d" };
  try {
    assert.deepEqual(Array.from(calculations.keys), ["al_update_1", "al_best_1", "al_channel_20"]);
    engine.render(base);
    const chart = charts[0];
    assert.equal(chart.allSeries.find((series) => series.type === "volume").pane, 1);
    chart.range = { from: 18, to: 43 };
    for (const strategyKey of calculations.keys) {
      const strategy = calculations.compute(rows, strategyKey);
      engine.render({ ...base, strategy, theme: "dark" });
      assert.equal(charts.length, 1);
      assert.deepEqual(chart.range, { from: 18, to: 43 });
      assert.equal(chart.allSeries.filter((series) => series.type === "line").length, 1 + strategy.lines.length);
      assert.deepEqual(Array.from(chart.allSeries[0].markers, (marker) => marker.text).sort(), Array.from(strategy.signals, (signal) => signal.label).sort());
      assert.equal(chart.options.layout.background.color, "#141c2c");
    }
    chart.crosshair({ time: { year: 2026, month: 1, day: 2 } });
    assert.match(legend.textContent, /^2026-01-02/);
    assert.match(legend.textContent, /开 .*高 .*低 .*收 .*量/);
    chart.crosshair({});
    assert.match(legend.textContent, new RegExp(rows.at(-1).date));
    engine.render({ ...base, key: "rb:1d" });
    assert.notDeepEqual(chart.range, { from: 18, to: 43 });
    engine.showBars("all");
    assert.deepEqual(chart.range, { from: 0, to: 159 });
    engine.render({ ...base, candles: [], maValues: [], key: "empty" });
    assert.equal(legend.textContent, "暂无可用 K 线");
    assert.deepEqual(chart.allSeries[0].data, []);
  } finally {
    engine.clear();
    delete globalThis.LightweightCharts;
  }
});

test("loading in a hidden tab and resizing to mobile never collapses or loses the selected viewport", () => {
  const { lib, charts } = mockLibrary();
  const callbacks = [];
  let disconnected = false;
  globalThis.LightweightCharts = lib;
  globalThis.ResizeObserver = class {
    constructor(callback) { callbacks.push(callback); }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const container = { dataset: {}, clientWidth: 0, clientHeight: 0, replaceChildren() {} };
  const rows = Array.from({ length: 100 }, (_, index) => candle(new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10)));
  try {
    engine.render({ container, candles: rows, maValues: [], maPeriod: 0, interval: "1d", theme: "light", key: "hidden" });
    const chart = charts[0];
    assert.equal(chart.initialOptions.autoSize, false);
    assert.ok(chart.initialOptions.width > 0);
    const firstRange = { ...chart.range };
    callbacks[0]();
    assert.equal(chart.sizes.length, 0);
    container.clientWidth = 360;
    container.clientHeight = 360;
    callbacks[0]();
    assert.deepEqual(chart.sizes, [{ width: 360, height: 360 }]);
    assert.deepEqual(chart.range, firstRange);
    chart.range = { from: 12, to: 37 };
    container.clientWidth = 0;
    callbacks[0]();
    container.clientWidth = 900;
    callbacks[0]();
    assert.deepEqual(chart.range, { from: 12, to: 37 });
    assert.equal(chart.sizes.length, 2);
  } finally {
    engine.clear();
    delete globalThis.LightweightCharts;
    delete globalThis.ResizeObserver;
  }
  assert.equal(disconnected, true);
});
