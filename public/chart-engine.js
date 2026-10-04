/* Interactive chart adapter. Strategy calculations remain in app.js. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ALChart = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const UP = "#e15a62";
  const DOWN = "#169c85";
  const LINE_COLORS = { up: "#6d77d8", fast: "#6d77d8", mid: "#e3a33c", slow: "#e3a33c", low: "#4fa9b8" };
  let active = null;

  // API dates already represent exchange-local wall time (SHFE +08:00, or the
  // Yahoo exchange timezone). Encode those digits as UTC for the chart, which
  // otherwise applies no timezone. Never parse them in the browser's timezone.
  function chartTime(value, interval) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return null;
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
    const stamp = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
    const parsed = new Date(stamp);
    if (parsed.getUTCFullYear() !== +year || parsed.getUTCMonth() !== +month - 1 ||
        parsed.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) return null;
    return /h$/.test(interval) ? stamp / 1000 : `${year}-${month}-${day}`;
  }

  function timeKey(value) {
    if (value && typeof value === "object") {
      return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
    }
    return String(value);
  }

  function normalizeCandles(candles, interval) {
    const unique = new Map();
    for (const item of Array.isArray(candles) ? candles : []) {
      if (!item) continue;
      const time = chartTime(item.date, interval);
      if (time === null) continue;
      const prices = [item.open, item.high, item.low, item.close];
      if (prices.some((value) => value === null || value === "" || !Number.isFinite(Number(value)))) continue;
      const [open, high, low, close] = prices.map(Number);
      if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) continue;
      unique.set(time, { ...item, open, high, low, close });
    }
    return [...unique.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item);
  }

  function lineData(candles, values, interval) {
    return candles.map((candle, index) => {
      const time = chartTime(candle.date, interval);
      const value = values?.[index];
      // Null warmup points are whitespace, never zero-price indicators.
      return Number.isFinite(value) ? { time, value } : { time };
    });
  }

  function markerData(candles, signals, interval) {
    return (signals || []).filter((signal) => candles[signal.index]).map((signal) => ({
      time: chartTime(candles[signal.index].date, interval),
      position: signal.dy > 0 ? "belowBar" : "aboveBar",
      color: signal.type === "buy" ? UP : signal.type === "sell" ? DOWN : "#8290a8",
      shape: signal.type === "buy" ? "arrowUp" : signal.type === "sell" ? "arrowDown" : "circle",
      text: signal.label,
      size: signal.type === "position" ? 0.5 : 1
    })).sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  }

  function chartOptions(theme, interval) {
    const dark = theme === "dark";
    return {
      // Own resizing so hidden tabs never collapse the time scale to zero width.
      autoSize: false,
      layout: {
        background: { type: "solid", color: dark ? "#141c2c" : "#ffffff" },
        textColor: dark ? "#a6b1c3" : "#727e91",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: dark ? "#293347" : "#edf0f5", separatorHoverColor: "#d9e2f4", enableResize: true }
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: dark ? "#222d40" : "#f0f3f7" }
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: {
        borderVisible: false,
        timeVisible: /h$/.test(interval),
        secondsVisible: false,
        rightOffset: 5,
        minBarSpacing: 0.1,
        shiftVisibleRangeOnNewBar: false
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#8794a8", labelBackgroundColor: "#586c9c" },
        horzLine: { color: "#8794a8", labelBackgroundColor: "#586c9c" }
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      kineticScroll: { mouse: true, touch: true },
      localization: {
        locale: "zh-CN",
        timeFormatter: (time) => typeof time === "number"
          ? new Date(time * 1000).toISOString().slice(0, 16).replace("T", " ")
          : timeKey(time)
      }
    };
  }

  function formatValue(value) {
    return Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
  }

  function updateLegend(entry, index) {
    if (!entry.legend) return;
    const candle = entry.candles[index];
    if (!candle) {
      entry.legend.textContent = "暂无可用 K 线";
      return;
    }
    const items = [candle.date, `开 ${formatValue(candle.open)}`, `高 ${formatValue(candle.high)}`,
      `低 ${formatValue(candle.low)}`, `收 ${formatValue(candle.close)}`, `量 ${formatValue(candle.volume)}`];
    for (const line of entry.lines.values()) {
      items.push(`${line.label} ${formatValue(line.values[index])}`);
    }
    entry.legend.textContent = items.join("   ");
    entry.legend.dataset.direction = candle.close >= candle.open ? "up" : "down";
  }

  function clear() {
    if (!active) return;
    active.resizeObserver?.disconnect();
    if (active.resizeListener) root.removeEventListener?.("resize", active.resizeListener);
    active.chart.remove();
    delete active.container.dataset.chartEngine;
    active = null;
  }

  function render(options) {
    const lib = root.LightweightCharts;
    if (!lib?.createChart || !lib?.CandlestickSeries || !options.container) return false;
    const { container, candles, maValues, maPeriod, strategy, interval, theme, key, legend } = options;
    if (active && active.container !== container) clear();
    if (!active) {
      container.replaceChildren();
      // Charts may initially load while the News tab is visible. A real initial
      // size keeps fit/range calculations meaningful until the first reveal.
      const initialWidth = container.clientWidth || 800;
      const initialHeight = container.clientHeight || 430;
      const chart = lib.createChart(container, {
        ...chartOptions(theme, interval), width: initialWidth, height: initialHeight
      });
      const candleSeries = chart.addSeries(lib.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
        priceLineStyle: 2, priceLineWidth: 1, priceFormat: { type: "price", precision: 2, minMove: 0.01 }
      });
      const volumeSeries = chart.addSeries(lib.HistogramSeries, {
        priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false
      }, 1);
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 }, borderVisible: false });
      chart.panes()[1]?.setStretchFactor(0.23);
      active = { container, chart, candleSeries, volumeSeries, lines: new Map(), candles: [], key: null,
        markers: lib.createSeriesMarkers(candleSeries, [], { autoScale: false }), legend };
      const entry = active;
      let lastWidth = initialWidth;
      let lastHeight = initialHeight;
      const resize = () => {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (active !== entry || !width || !height || (width === lastWidth && height === lastHeight)) return;
        const range = chart.timeScale().getVisibleLogicalRange();
        chart.resize(width, height);
        // Preserve the user's historical window across hide/show, orientation
        // changes and fullscreen, rather than preserving pixel bar spacing.
        if (range) chart.timeScale().setVisibleLogicalRange(range);
        lastWidth = width;
        lastHeight = height;
      };
      if (root.ResizeObserver) {
        entry.resizeObserver = new root.ResizeObserver(resize);
        entry.resizeObserver.observe(container);
      } else {
        entry.resizeListener = resize;
        root.addEventListener?.("resize", resize);
      }
      chart.subscribeCrosshairMove((param) => {
        if (!active || active.chart !== chart) return;
        const index = param.time === undefined ? -1 : active.indexByTime.get(timeKey(param.time));
        updateLegend(active, index === undefined || index < 0 ? active.candles.length - 1 : index);
      });
      container.dataset.chartEngine = "lightweight";
    }

    const entry = active;
    const sameDataset = entry.key === key;
    const range = sameDataset ? entry.chart.timeScale().getVisibleLogicalRange() : null;
    entry.chart.applyOptions(chartOptions(theme, interval));
    entry.candles = candles;
    entry.legend = legend;
    entry.indexByTime = new Map(candles.map((candle, index) => [timeKey(chartTime(candle.date, interval)), index]));
    entry.markers.setMarkers([]);
    entry.candleSeries.setData(candles.map((candle) => ({
      time: chartTime(candle.date, interval), open: candle.open, high: candle.high, low: candle.low, close: candle.close
    })));
    entry.volumeSeries.setData(candles.map((candle) => ({
      time: chartTime(candle.date, interval), value: Math.max(0, Number(candle.volume) || 0),
      color: candle.close >= candle.open ? "rgba(225, 90, 98, 0.38)" : "rgba(22, 156, 133, 0.38)"
    })));

    const required = [];
    if (maPeriod > 0) required.push({ name: "average", label: `MA${maPeriod}`, color: "#cd8c2d", values: maValues });
    for (const line of strategy?.lines || []) required.push({ ...line, color: LINE_COLORS[line.name] || "#6d77d8" });
    const names = new Set(required.map((line) => line.name));
    for (const [name, line] of entry.lines) {
      if (!names.has(name)) {
        entry.chart.removeSeries(line.series);
        entry.lines.delete(name);
      }
    }
    for (const line of required) {
      let current = entry.lines.get(line.name);
      if (!current) {
        current = { series: entry.chart.addSeries(lib.LineSeries, {
          color: line.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerRadius: 3
        }) };
        entry.lines.set(line.name, current);
      }
      current.label = line.label;
      current.values = line.values;
      current.series.applyOptions({ color: line.color });
      current.series.setData(lineData(candles, line.values, interval));
    }
    entry.markers.setMarkers(markerData(candles, strategy?.signals, interval));
    entry.key = key;
    if (range && candles.length) entry.chart.timeScale().setVisibleLogicalRange(range);
    else showBars(options.defaultBars || 90);
    updateLegend(entry, candles.length - 1);
    return true;
  }

  function showBars(count = 90) {
    if (!active?.candles.length) return;
    const length = active.candles.length;
    if (count === "all") active.chart.timeScale().fitContent();
    else {
      const bars = Math.max(5, Math.min(length, Number(count) || 90));
      active.chart.timeScale().setVisibleLogicalRange({ from: length - bars - 0.5, to: length - 1 + 4 });
    }
    active.chart.priceScale("right").applyOptions({ autoScale: true });
  }

  function zoom(factor) {
    const range = active?.chart.timeScale().getVisibleLogicalRange();
    if (!range || !Number.isFinite(factor) || factor <= 0) return;
    const center = (range.from + range.to) / 2;
    const width = Math.max(5, Math.min(active.candles.length * 1.5, (range.to - range.from) / factor));
    active.chart.timeScale().setVisibleLogicalRange({ from: center - width / 2, to: center + width / 2 });
  }

  if (root.document) {
    const syncFullscreenButton = () => {
      const wrap = root.document.querySelector("#chartWrap");
      const expanded = Boolean(root.document.fullscreenElement || wrap?.classList.contains("is-expanded"));
      root.document.querySelector("#chartFullScreen")?.setAttribute("aria-pressed", String(expanded));
    };
    const exitFullscreen = () => {
      root.document.querySelector("#chartWrap")?.classList.remove("is-expanded");
      if (root.document.fullscreenElement && root.document.exitFullscreen) {
        root.document.exitFullscreen().catch(() => {});
      }
      syncFullscreenButton();
      root.document.querySelector("#chartFullScreen")?.focus();
    };
    root.document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-chart-bars], [data-chart-exit], #chartResetView, #chartFullScreen");
      if (!button) return;
      if (button.hasAttribute("data-chart-exit")) exitFullscreen();
      else if (button.id === "chartResetView") showBars(90);
      else if (button.dataset.chartBars) showBars(button.dataset.chartBars);
      else if (button.id === "chartFullScreen") {
        const wrap = root.document.querySelector("#chartWrap");
        if (!wrap) return;
        const focusExit = () => wrap.querySelector("[data-chart-exit]")?.focus();
        const expandFallback = () => {
          wrap.classList.add("is-expanded");
          syncFullscreenButton();
          focusExit();
        };
        if (root.document.fullscreenElement || wrap.classList.contains("is-expanded")) exitFullscreen();
        else if (wrap.requestFullscreen) wrap.requestFullscreen().then(focusExit).catch(expandFallback);
        else expandFallback();
      }
    });
    root.document.addEventListener("fullscreenchange", syncFullscreenButton);
    root.document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.document.querySelector("#chartWrap")?.classList.contains("is-expanded")) exitFullscreen();
    });
  }

  return { render, clear, zoom, showBars, normalizeCandles, chartTime, lineData, markerData,
    isActive: () => Boolean(active) };
});
