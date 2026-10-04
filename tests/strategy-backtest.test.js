const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizeCandles } = require("../public/chart-engine.js");
const { computeChannel20Strategy } = require("../research/candidate-channel.js");

const ROOT = path.join(__dirname, "..");
const RETAINED_STRATEGIES = ["al_update_1", "al_best_1"];
const REMOVED_STRATEGIES = [
  "al_volume_price", "al_research_trend", "al_research_stable_5", "al_research_defensive"
];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Load only the state and calculation declarations; no browser startup, timers,
// network requests, or event handlers execute in these calculation tests.
function loadCalculations(relativePath = "public/app.js", saved = {}) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const boundary = source.indexOf("els.refreshInterval.value =");
  assert.ok(boundary > 0, "app bootstrap boundary is present");
  const version = source.match(/const APP_STATE_VERSION = "([^"]+)";/)?.[1];
  assert.ok(version, "app storage version is available");
  const storage = new Map(Object.entries({ appStateVersion: version, ...saved }));
  const context = vm.createContext({
    console, Intl, Date, URLSearchParams,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key)
    },
    document: { querySelector: () => ({}), querySelectorAll: () => [] }
  });
  vm.runInContext(source.slice(0, boundary) + `
    this.calculations = {
      state, computeStrategy, computeBacktest, backtestPrice,
      calendarMonthsBefore: typeof calendarMonthsBefore === "function" ? calendarMonthsBefore : null,
      closeEquityDrawdown: typeof closeEquityDrawdown === "function" ? closeEquityDrawdown : null,
      strategyPeriodComparison: typeof strategyPeriodComparison === "function" ? strategyPeriodComparison : null
    };
  `, context, { filename: relativePath, timeout: 3000 });
  return { ...context.calculations, storage };
}

function syntheticCandles(length = 420) {
  return Array.from({ length }, (_, index) => {
    const close = 20000 + Math.sin(index / 9) * 850 + Math.cos(index / 37) * 450 + index * 2;
    const open = close + Math.sin(index * 2) * 100;
    return {
      date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      open, high: Math.max(open, close) + 75, low: Math.min(open, close) - 90,
      close, volume: 100000 + index * 29, openInterest: 200000 + index * 11
    };
  });
}

for (const strategyKey of RETAINED_STRATEGIES) {
  test(`${strategyKey}: signals, indicator lines and closed-trade results match the original application`, () => {
    const current = loadCalculations();
    const original = loadCalculations("research/original-app-v2.js");
    const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "research/al0-daily-snapshot.json"), "utf8"));
    const candles = snapshot.candles;
    assert.ok(candles.length > 1000, "comparison uses the saved real market history");
    const actualStrategy = current.computeStrategy(candles, strategyKey);
    const originalStrategy = original.computeStrategy(candles, strategyKey);
    assert.deepEqual(plain(actualStrategy), plain(originalStrategy));
    assert.ok(actualStrategy.signals.length > 10, "comparison includes meaningful signal history");

    const end = candles.at(-1).date;
    const endDate = new Date(`${end}T00:00:00Z`);
    for (const months of [1, 3, 6, 12]) {
      const startDate = new Date(endDate);
      startDate.setUTCMonth(startDate.getUTCMonth() - months);
      const start = startDate.toISOString().slice(0, 10);
      for (const direction of ["both", "long", "short"]) {
        for (const app of [current, original]) {
          Object.assign(app.state, {
            backtestStart: `${start}T00:00`, backtestEnd: `${end}T23:59`,
            backtestPriceMode: "ideal", backtestDirection: direction
          });
        }
        const actual = current.computeBacktest(candles, actualStrategy);
        const expected = original.computeBacktest(candles, originalStrategy);
        assert.deepEqual(plain(actual), plain(expected), `${months} months / ${direction}`);
      }
    }
  });

  test(`${strategyKey}: appending future candles cannot change earlier signals or indicator values`, () => {
    const app = loadCalculations();
    const candles = syntheticCandles();
    const full = app.computeStrategy(candles, strategyKey);
    assert.ok(full.signals.length > 5);
    for (const prefixLength of [60, 121, 247, 350]) {
      const prefix = app.computeStrategy(candles.slice(0, prefixLength), strategyKey);
      assert.deepEqual(plain(prefix.signals), plain(full.signals.filter((signal) => signal.index < prefixLength)));
      assert.deepEqual(plain(prefix.lines), plain(full.lines.map((line) => ({
        ...line, values: line.values.slice(0, prefixLength)
      }))));
    }
  });
}

test("a saved average-price preference is migrated to low-for-buy and high-for-sell ideal prices", () => {
  const app = loadCalculations("public/app.js", {
    backtestPriceMode: "average", strategy: "al_update_1"
  });
  assert.equal(app.state.backtestPriceMode, "ideal");
  assert.equal(app.state.strategy, "al_update_1", "this migration preserves a supported strategy");
  const candle = { date: "2026-01-02", open: 110, high: 170, low: 70, close: 130 };
  assert.equal(app.backtestPrice(candle, "buy", "average"), 70);
  assert.equal(app.backtestPrice(candle, "sell", "average"), 170);
  const result = app.computeBacktest([candle, { ...candle, date: "2026-01-03", high: 210 }], {
    signals: [{ index: 0, type: "buy" }, { index: 1, type: "sell" }]
  });
  assert.equal(result.trades[0].entryPrice, 70);
  assert.equal(result.trades[0].exitPrice, 210);
  assert.equal(result.totalReturn, 2);
});

test("date windows include boundary signals, start without a carried position, and exclude an unclosed position from returns", () => {
  const app = loadCalculations();
  const candles = [
    { date: "2026-01-01", open: 90, high: 120, low: 80, close: 100 },
    { date: "2026-01-02", open: 110, high: 170, low: 70, close: 130 },
    { date: "2026-01-03", open: 100, high: 130, low: 80, close: 110 },
    { date: "2026-01-04", open: 130, high: 200, low: 100, close: 180 },
    { date: "2026-01-05", open: 1000, high: 9999, low: 1, close: 9000 }
  ];
  const strategy = {
    signals: candles.map((_, index) => ({ index, type: index % 2 ? "sell" : "buy" }))
  };
  Object.assign(app.state, { backtestStart: "2026-01-02T00:00", backtestEnd: "2026-01-04T00:00" });
  const result = app.computeBacktest(candles, strategy);
  assert.equal(result.trades.length, 2);
  assert.deepEqual(plain(result.trades.map((trade) => [trade.side, trade.entryDate, trade.exitDate, trade.entryPrice, trade.exitPrice])), [
    ["short", "2026-01-02", "2026-01-03", 170, 80],
    ["long", "2026-01-03", "2026-01-04", 80, 200]
  ]);
  const expectedReturn = (1 + (170 - 80) / 170) * (1 + (200 - 80) / 80) - 1;
  assert.equal(result.totalReturn, expectedReturn);
  assert.deepEqual(plain(result.openPosition), { side: "short", entryDate: "2026-01-04", entryPrice: 200 });

  app.state.backtestEnd = "2026-01-02T00:00";
  const unclosed = app.computeBacktest(candles, strategy);
  assert.equal(unclosed.trades.length, 0);
  assert.equal(unclosed.totalReturn, 0);
  assert.equal(unclosed.winRate, null);
  assert.equal(unclosed.openPosition.entryPrice, 170);

  app.state.backtestEnd = "2026-01-01T00:00";
  assert.equal(app.computeBacktest(candles, strategy).status, "invalid-range");
});

test("cached deleted strategies fall back to none and remain safe to calculate", () => {
  for (const strategy of REMOVED_STRATEGIES) {
    const app = loadCalculations("public/app.js", { strategy });
    assert.equal(app.state.strategy, "none", strategy);
    assert.equal(app.computeStrategy(syntheticCandles(60), app.state.strategy), null);
    assert.equal(app.computeStrategy(syntheticCandles(60), strategy), null);
    assert.deepEqual(plain(app.computeBacktest(syntheticCandles(60), null)), { status: "no-strategy", trades: [] });
  }
});

test("the production channel strategy matches the research pure function after chart normalization", () => {
  const app = loadCalculations();
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "research/al0-daily-snapshot.json"), "utf8"));
  const candles = normalizeCandles(snapshot.candles, "1d");
  const expected = computeChannel20Strategy(candles);
  const actual = app.computeStrategy(candles, "al_channel_20");
  assert.ok(actual.signals.length > 10);
  assert.deepEqual(plain(actual), plain(expected));
});

test("the channel strategy never rewrites earlier signals or bands after future candles arrive", () => {
  const app = loadCalculations();
  const candles = syntheticCandles();
  // Extreme new values exercise the prefix boundary, not just smooth price data.
  const future = syntheticCandles(3).map((candle, index) => ({
    ...candle,
    date: new Date(Date.UTC(2024, 0, 421 + index)).toISOString().slice(0, 10),
    open: index % 2 ? 1000 : 100000,
    close: index % 2 ? 1000 : 100000,
    high: index % 2 ? 1010 : 100010,
    low: index % 2 ? 990 : 99990
  }));
  const full = app.computeStrategy([...candles, ...future], "al_channel_20");
  assert.ok(full.signals.length > 5);
  for (const length of [19, 20, 21, 120, 300, candles.length]) {
    const prefix = app.computeStrategy(candles.slice(0, length), "al_channel_20");
    assert.deepEqual(plain(prefix.signals), plain(full.signals.filter((signal) => signal.index < length)));
    assert.deepEqual(plain(prefix.lines), plain(full.lines.map((line) => ({
      ...line, values: line.values.slice(0, length)
    }))));
  }
});

test("calendar month windows clamp month ends and retain leap days and year boundaries", () => {
  const app = loadCalculations();
  for (const [end, months, expected] of [
    ["2026-03-31", 1, "2026-02-28"],
    ["2024-03-31", 1, "2024-02-29"],
    ["2025-05-31", 1, "2025-04-30"],
    ["2024-02-29", 12, "2023-02-28"],
    ["2026-01-31", 3, "2025-10-31"],
    ["2026-09-30", 1, "2026-08-30"],
    ["2026-09-30", 6, "2026-03-30"]
  ]) assert.equal(app.calendarMonthsBefore(end, months), expected, `${end} minus ${months} months`);
});

function assertNear(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected), `${label}: both numbers are finite`);
  assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} equals ${expected} within numerical tolerance`);
}

test("normalized four-window returns, daily drawdowns and trade counts agree with the saved research results", () => {
  const app = loadCalculations();
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "research/al0-daily-snapshot.json"), "utf8"));
  const research = JSON.parse(fs.readFileSync(path.join(ROOT, "research/results.json"), "utf8"));
  const normalized = normalizeCandles(snapshot.candles, "1d");
  const retainedDates = new Set(normalized.map((candle) => candle.date));
  const removedDates = snapshot.candles.filter((candle) => !retainedDates.has(candle.date)).map((candle) => candle.date);
  assert.deepEqual(removedDates, ["2006-01-04", "2006-12-06", "2006-12-22", "2007-03-27"]);
  assert.equal(normalized.length, snapshot.candles.length - 4);

  const candidate = research.candidates.find((item) => item.id === research.retrospectiveSelectedId);
  assert.ok(candidate, "the retrospectively selected research candidate is recorded");
  const expectedByKey = new Map([
    ...research.baselines.map((baseline) => [baseline.key, baseline.windows]),
    ["al_channel_20", candidate.windows]
  ]);
  const actualPeriods = app.strategyPeriodComparison(normalized, "both");
  const rawPeriods = app.strategyPeriodComparison(snapshot.candles, "both");
  assert.deepEqual(plain(actualPeriods.map((period) => period.months)), [1, 3, 6, 12]);
  for (const period of actualPeriods) {
    assert.equal(period.ready, true);
    const rawPeriod = rawPeriods.find((item) => item.months === period.months);
    for (const [key, windows] of expectedByKey) {
      const expectedWindow = windows.find((item) => item.months === period.months);
      const actual = period.results.find((item) => item.key === key);
      const raw = rawPeriod.results.find((item) => item.key === key);
      const label = `${key} / ${period.months} months`;
      assert.ok(actual, `${label}: production comparison contains the strategy`);
      assert.equal(period.startDay, expectedWindow.start);
      assert.equal(period.endDay, expectedWindow.end);
      assertNear(actual.totalReturn, expectedWindow.ideal.return, `${label} / return`);
      assertNear(actual.maxDrawdown, expectedWindow.ideal.markToMarketDrawdown, `${label} / daily MTM drawdown`);
      assert.equal(actual.trades.length, expectedWindow.ideal.trades, `${label} / closed trades`);
      assert.deepEqual(plain(actual), plain(raw), `${label}: four early invalid candles have no effect on recent results`);
    }
  }
});

test("explicit backtest options and four-window comparisons share manual calculations without mutating saved state", () => {
  const app = loadCalculations();
  const candles = syntheticCandles(480);
  const originalInputs = {
    backtestStart: "1999-01-01T00:00", backtestEnd: "1999-01-02T23:59", backtestDirection: "short"
  };
  Object.assign(app.state, originalInputs);
  const originalState = plain(app.state);
  for (const direction of ["both", "long", "short"]) {
    const periods = app.strategyPeriodComparison(candles, direction);
    assert.deepEqual(plain(app.state), originalState, "the table does not overwrite manual input state");
    for (const period of periods) {
      const options = { start: `${period.startDay}T00:00`, end: `${period.endDay}T23:59`, direction };
      for (const tableResult of period.results) {
        const strategy = app.computeStrategy(candles, tableResult.key);
        const explicit = app.computeBacktest(candles, strategy, options);
        assert.deepEqual(plain(app.state), originalState, "explicit options do not change the global date or direction");
        const { key, label, maxDrawdown, ...tableBacktest } = tableResult;
        assert.deepEqual(plain(explicit), plain(tableBacktest));
        assertNear(app.closeEquityDrawdown(candles, explicit, options.start, options.end), maxDrawdown, "manual/table drawdown");

        Object.assign(app.state, { backtestStart: options.start, backtestEnd: options.end, backtestDirection: direction });
        const manual = app.computeBacktest(candles, strategy);
        assert.deepEqual(plain(manual), plain(explicit), `${key}: options and manual global inputs are equivalent`);
        Object.assign(app.state, originalInputs);
      }
    }
  }
  assert.deepEqual(plain(app.strategyPeriodComparison([], "both")), []);
});
