const KLINE_INTERVAL_LABELS = {
  "1h": "小时线",
  "3h": "3小时",
  "5h": "5小时",
  "1d": "日线",
  "1w": "周线",
  "1mo": "月线"
};
const AVAILABLE_KLINE_INTERVALS = new Set(["1d", "1h"]);

const PRODUCT_CONFIGS = {
  al: {
    label: "沪铝",
    mark: "AL",
    title: "沪铝期货行情",
    subtitle: "SHFE Aluminum Futures",
    description: "沪铝、螺纹钢期货行情，可安装到手机和电脑的 PWA 应用。",
    defaultSymbol: "nf_AL0",
    strategyPrefix: "铝",
    spec: "交易品种：铝；交易单位：5 吨/手；报价单位：元/吨；最小变动价位：5 元/吨。"
  },
  rb: {
    label: "螺纹钢",
    mark: "RB",
    title: "螺纹钢期货行情",
    subtitle: "SHFE Rebar Futures",
    description: "沪铝、螺纹钢期货行情，可安装到手机和电脑的 PWA 应用。",
    defaultSymbol: "nf_RB0",
    strategyPrefix: "螺纹钢",
    spec: "交易品种：螺纹钢；交易单位：10 吨/手；报价单位：元/吨；最小变动价位：1 元/吨。"
  }
};

const STRATEGY_SUFFIXES = {
  none: "不叠加策略",
  al_update_1: "更新1",
  al_best_1: "-1Best",
  al_channel_20: "双轨20（研究）"
};

const BACKTEST_DIRECTION_LABELS = {
  both: "双边",
  long: "单边做多",
  short: "单边做空"
};

const KLINE_MIN_DATE = "2005-01-01";
const KLINE_ZOOM_LEVELS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12];
const KLINE_DEFAULT_ZOOM = 0.01;
const KLINE_MAX_CHART_WIDTH = 90000;
const APP_STATE_VERSION = "2026-06-27-watchlist-three-symbols-v1";
const NEWS_REFRESH_MS = 5 * 60 * 1000;

const STRATEGY_CONFIGS = {
  al_update_1: {
    period: 24,
    deviationPeriod: 24,
    deviationMultiple: 1.8,
    buyThreshold: "mid",
    sellThreshold: "low",
    lines: ["mid", "low"]
  },
  al_best_1: {
    period: 24,
    deviationPeriod: 24,
    deviationMultiple: 1.3,
    buyThreshold: "up",
    sellThreshold: "mid",
    lines: ["up", "mid"]
  },
  al_channel_20: { type: "closeChannel" }
};

if (localStorage.getItem("appStateVersion") !== APP_STATE_VERSION) {
  localStorage.setItem("appStateVersion", APP_STATE_VERSION);
  localStorage.removeItem("strategy");
  localStorage.removeItem("klineTheme");
  localStorage.removeItem("klineStart");
  localStorage.removeItem("klineInterval");
  localStorage.removeItem("product");
  localStorage.removeItem("selectedSymbol");
  localStorage.removeItem("selectedSymbol:al");
  localStorage.removeItem("selectedSymbol:rb");
  localStorage.removeItem("klineEnd");
  localStorage.removeItem("backtestEnd");
  localStorage.removeItem("klineZoom");
}

const savedStrategy = localStorage.getItem("strategy") || "none";
const savedTheme = localStorage.getItem("klineTheme") || "light";
const savedProduct = PRODUCT_CONFIGS[localStorage.getItem("product")] ? localStorage.getItem("product") : "al";
localStorage.removeItem("backtestPriceMode");
const savedBacktestDirection = localStorage.getItem("backtestDirection") || "both";
const savedKlineStart = localStorage.getItem("klineStart") || daysAgoDateValue(180);
const savedKlineEnd = localStorage.getItem("klineEnd") || todayDateValue();
const savedKlineZoom = Number(localStorage.getItem("klineZoom") || KLINE_DEFAULT_ZOOM);

function productConfig(productKey = savedProduct) {
  return PRODUCT_CONFIGS[productKey] || PRODUCT_CONFIGS.al;
}

function selectedSymbolStorageKey(productKey) {
  return `selectedSymbol:${productKey}`;
}

function strategyLabel(strategyKey, productKey = savedProduct) {
  if (strategyKey === "none") return STRATEGY_SUFFIXES.none;
  const suffix = STRATEGY_SUFFIXES[strategyKey] || "";
  return `${productConfig(productKey).strategyPrefix}${suffix}`;
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDateValue() {
  return dateInputValue(new Date());
}

function daysAgoDateValue(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateInputValue(date);
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function clampDateValue(value, minValue, maxValue) {
  if (!isDateValue(value)) return "";
  if (value < minValue) return minValue;
  if (value > maxValue) return maxValue;
  return value;
}

function zoomIndex(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return KLINE_ZOOM_LEVELS.indexOf(KLINE_DEFAULT_ZOOM);

  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  KLINE_ZOOM_LEVELS.forEach((level, index) => {
    const distance = Math.abs(level - normalized);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });
  return closestIndex;
}

function normalizeZoom(value) {
  return KLINE_ZOOM_LEVELS[zoomIndex(value)] || KLINE_DEFAULT_ZOOM;
}

function zoomLabel(value) {
  return `${String(value).replace(/\.0$/, "")}x`;
}

const state = {
  payload: null,
  product: savedProduct,
  selectedSymbol:
    localStorage.getItem(selectedSymbolStorageKey(savedProduct)) ||
    (savedProduct === "al" ? localStorage.getItem("selectedSymbol") : "") ||
    productConfig(savedProduct).defaultSymbol,
  refreshMs: Number(localStorage.getItem("refreshMs") || 15000),
  klineStart: clampDateValue(savedKlineStart, KLINE_MIN_DATE, todayDateValue()) || KLINE_MIN_DATE,
  klineEnd: clampDateValue(savedKlineEnd, KLINE_MIN_DATE, todayDateValue()) || todayDateValue(),
  klineInterval: AVAILABLE_KLINE_INTERVALS.has(localStorage.getItem("klineInterval"))
    ? localStorage.getItem("klineInterval")
    : "1d",
  maPeriod: Number(localStorage.getItem("maPeriod") || 5),
  strategy: STRATEGY_SUFFIXES[savedStrategy] ? savedStrategy : "none",
  klineTheme: savedTheme === "dark" ? "dark" : "light",
  klineZoom: normalizeZoom(savedKlineZoom),
  backtestStart: localStorage.getItem("backtestStart") || "",
  backtestEnd: localStorage.getItem("backtestEnd") || "",
  backtestPriceMode: "ideal",
  backtestDirection: BACKTEST_DIRECTION_LABELS[savedBacktestDirection]
    ? savedBacktestDirection
    : "both",
  klinePayload: null,
  klineCacheMode: false,
  klineSymbol: null,
  klineIntervalLoaded: null,
  newsPayload: null,
  newsFetchedAtMs: 0,
  newsExpanded: new Set(),
  newsLoading: false,
  timer: null,
  installPrompt: null,
  cacheMode: false
};

const els = {
  appShell: document.querySelector("#appShell"),
  appViews: document.querySelectorAll(".app-view"),
  navButtons: document.querySelectorAll(".bottom-nav [data-nav]"),
  brandMark: document.querySelector("#brandMark"),
  brandTitle: document.querySelector("#brandTitle"),
  brandSubtitle: document.querySelector("#brandSubtitle"),
  installButton: document.querySelector("#installButton"),
  refreshButton: document.querySelector("#refreshButton"),
  openMenuButton: document.querySelector("#openMenuButton"),
  chartBackButton: document.querySelector("#chartBackButton"),
  quickZoomButton: document.querySelector("#quickZoomButton"),
  quickThemeButton: document.querySelector("#quickThemeButton"),
  quickMenuButton: document.querySelector("#quickMenuButton"),
  sideMenu: document.querySelector("#sideMenu"),
  sideMenuBackdrop: document.querySelector("#sideMenuBackdrop"),
  closeMenuButton: document.querySelector("#closeMenuButton"),
  dismissTipButton: document.querySelector("#dismissTipButton"),
  menuIntervalLabel: document.querySelector("#menuIntervalLabel"),
  tickerName: document.querySelector("#tickerName"),
  tickerPrice: document.querySelector("#tickerPrice"),
  tickerChange: document.querySelector("#tickerChange"),
  tickerPct: document.querySelector("#tickerPct"),
  productSelect: document.querySelector("#productSelect"),
  refreshInterval: document.querySelector("#refreshInterval"),
  contractBadge: document.querySelector("#contractBadge"),
  marketState: document.querySelector("#marketState"),
  contractName: document.querySelector("#contractName"),
  lastPrice: document.querySelector("#lastPrice"),
  changeLine: document.querySelector("#changeLine"),
  quoteTime: document.querySelector("#quoteTime"),
  dataStatus: document.querySelector("#dataStatus"),
  openPrice: document.querySelector("#openPrice"),
  highPrice: document.querySelector("#highPrice"),
  lowPrice: document.querySelector("#lowPrice"),
  previousSettlement: document.querySelector("#previousSettlement"),
  bidLabel: document.querySelector("#bidLabel"),
  bidPrice: document.querySelector("#bidPrice"),
  askLabel: document.querySelector("#askLabel"),
  askPrice: document.querySelector("#askPrice"),
  volume: document.querySelector("#volume"),
  openInterestLabel: document.querySelector("#openInterestLabel"),
  openInterest: document.querySelector("#openInterest"),
  contractsBody: document.querySelector("#contractsBody"),
  fetchStamp: document.querySelector("#fetchStamp"),
  klineTitle: document.querySelector("#klineTitle"),
  klineSubtitle: document.querySelector("#klineSubtitle"),
  klineStatus: document.querySelector("#klineStatus"),
  klineInterval: document.querySelector("#klineInterval"),
  klineStart: document.querySelector("#klineStart"),
  klineEnd: document.querySelector("#klineEnd"),
  maPeriod: document.querySelector("#maPeriod"),
  klineTheme: document.querySelector("#klineTheme"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomResetButton: document.querySelector("#zoomResetButton"),
  zoomValue: document.querySelector("#zoomValue"),
  strategySelect: document.querySelector("#strategySelect"),
  backtestStart: document.querySelector("#backtestStart"),
  backtestEnd: document.querySelector("#backtestEnd"),
  backtestDirection: document.querySelector("#backtestDirection"),
  chartWrap: document.querySelector("#chartWrap"),
  klineChart: document.querySelector("#klineChart"),
  klineMeta: document.querySelector("#klineMeta"),
  backtestMeta: document.querySelector("#backtestMeta"),
  backtestTrades: document.querySelector("#backtestTrades"),
  newsOverallSummary: document.querySelector("#newsOverallSummary"),
  newsFetchTime: document.querySelector("#newsFetchTime"),
  newsSections: document.querySelector("#newsSections"),
  productSpecText: document.querySelector("#productSpecText"),
  toast: document.querySelector("#toast")
};

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatPrice(value) {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPrice(value)}`;
}

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatTerminalNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("zh-CN", {
    useGrouping: false,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatTerminalPrice(value) {
  return formatTerminalNumber(value, Number.isInteger(value) ? 0 : 3);
}

function formatTerminalChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return formatTerminalPrice(value);
}

function formatTerminalPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value.toFixed(2)}%`;
}

function localTime(isoString) {
  if (!isoString) return "--";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function trendClass(value) {
  if (value > 0) return "rise";
  if (value < 0) return "fall";
  return "neutral";
}

function isUsSymbol(symbol) {
  return /^us_/i.test(String(symbol || ""));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isMaEnabled(period) {
  return Number(period) > 0;
}

function findPrimaryQuote(quotes) {
  return (
    quotes.find((quote) => quote.symbol === state.selectedSymbol) ||
    quotes.find((quote) => quote.isContinuous) ||
    quotes[0] ||
    null
  );
}

function findSelectedQuote() {
  return state.payload?.quotes?.find((quote) => quote.symbol === state.selectedSymbol) || null;
}

function setText(id, value) {
  els[id].textContent = value;
}

function showView(viewName = "chart") {
  const nextView = viewName === "news" ? "news" : "chart";
  const previousView = els.appShell?.dataset.activeView;
  showView.positions ||= {};
  if (previousView) showView.positions[previousView] = window.scrollY;
  els.appShell?.setAttribute("data-active-view", nextView);
  els.appViews?.forEach(view => view.classList.toggle("active", view.dataset.view === nextView));
  els.navButtons?.forEach(button => {
    const active = button.dataset.nav === nextView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  els.refreshButton.setAttribute("aria-label", nextView === "news" ? "刷新快讯" : "刷新行情");
  document.querySelector("#pageTitle").innerHTML = `${nextView === "news" ? "新闻快讯" : "K 线研究"}<span class="heading-dot"></span>`;
  if (nextView === "news") window.ALNewsFeed?.activate();
  else window.ALNewsFeed?.deactivate();
  history.replaceState(null, "", nextView === "news" ? "#news" : "#chart");
  if (nextView === "chart" && !state.klinePayload) fetchKline(state.selectedSymbol);
  if (previousView !== nextView) requestAnimationFrame(() => window.scrollTo(0, showView.positions[nextView] || 0));
}

function openSideMenu() {
  els.sideMenu?.classList.add("open");
  els.sideMenu?.setAttribute("aria-hidden", "false");
}

function closeSideMenu() {
  els.sideMenu?.classList.remove("open");
  els.sideMenu?.setAttribute("aria-hidden", "true");
}

function intervalLabel(interval = state.klineInterval) {
  return KLINE_INTERVAL_LABELS[interval] || interval;
}

function quoteCacheKey(productKey = state.product) {
  return `lastQuotePayload:${productKey}`;
}

function klineCacheKey(symbol, interval, startDate, endDate, productKey = state.product) {
  return `lastKlinePayload:${productKey}:${symbol}:${interval}:${startDate}:${endDate}`;
}

function updateStrategyOptions() {
  els.strategySelect.querySelectorAll("option").forEach((option) => {
    option.textContent = strategyLabel(option.value, state.product);
  });
}

function updateProductUi() {
  const product = productConfig(state.product);
  document.title = "ALNEWS · 铝市场研究";
  document.querySelector("meta[name='description']")?.setAttribute("content", product.description);
  els.productSelect.value = state.product;
  els.strategySelect.value = state.strategy;
  els.brandMark.textContent = product.mark;
  els.brandTitle.textContent = "ALNEWS";
  els.brandSubtitle.textContent = "铝市场研究";
  els.productSpecText.textContent = product.spec;
  if (els.menuIntervalLabel) els.menuIntervalLabel.textContent = intervalLabel();
  updateStrategyOptions();
}

function updateTicker(quote) {
  if (!quote || !els.tickerName) return;
  const cls = trendClass(quote.change);
  const ticker = els.tickerName.closest(".ticker-strip");
  ticker?.classList.remove("rise", "fall", "neutral");
  ticker?.classList.add(cls);
  els.tickerName.textContent = quote.name || quote.code;
  els.tickerPrice.textContent = formatTerminalPrice(quote.last);
  els.tickerChange.textContent = formatTerminalChange(quote.change);
  els.tickerPct.textContent = formatTerminalPct(quote.changePct);
}

function renderPrimary(quote) {
  if (!quote) return;
  const cls = trendClass(quote.change);

  setText("contractBadge", quote.code);
  setText("contractName", quote.name || quote.code);
  setText("lastPrice", formatPrice(quote.last));
  document.querySelector("#priceUnit").textContent = isUsSymbol(quote.symbol) ? "美元 / 股" : "元 / 吨";
  setText("quoteTime", quote.timestamp || "--");
  setText("openPrice", formatPrice(quote.open));
  setText("highPrice", formatPrice(quote.high));
  setText("lowPrice", formatPrice(quote.low));
  setText("previousSettlement", formatPrice(quote.previousSettlement));
  if (isUsSymbol(quote.symbol)) {
    els.bidLabel.textContent = "昨收";
    els.askLabel.textContent = "最新";
    els.openInterestLabel.textContent = "成交量";
    setText("bidPrice", formatPrice(quote.previousSettlement));
    setText("askPrice", formatPrice(quote.last));
    setText("openInterest", formatNumber(quote.volume));
  } else {
    els.bidLabel.textContent = "买盘";
    els.askLabel.textContent = "卖盘";
    els.openInterestLabel.textContent = "持仓量";
    setText("bidPrice", formatPrice(quote.bid));
    setText("askPrice", formatPrice(quote.ask));
    setText("openInterest", formatNumber(quote.openInterest));
  }
  setText("volume", formatNumber(quote.volume));

  els.changeLine.className = `change-line ${cls}`;
  els.changeLine.innerHTML = `
    <span>涨跌 ${formatChange(quote.change)}</span>
    <span>涨跌幅 ${formatPct(quote.changePct)}</span>
  `;

  const phase = "最近报价";
  setText("marketState", quote.isMain ? `${phase} · 主力` : phase);
  updateTicker(quote);
}

function quoteRow(quote) {
  const cls = trendClass(quote.change);
  const active = quote.symbol === state.selectedSymbol ? " class=\"active\"" : "";
  return `
    <tr data-symbol="${escapeHtml(quote.symbol)}" tabindex="0" role="button" aria-label="查看${escapeHtml(quote.name || quote.code)}K线"${active}>
      <td>
        <strong>${escapeHtml(quote.name || quote.code)}</strong>
        ${quote.isMain ? "<span class=\"contract-badge\">M</span>" : ""}
      </td>
      <td class="${cls}"><strong>${formatTerminalPrice(quote.last)}</strong></td>
      <td class="${cls}">${formatTerminalChange(quote.change)}</td>
      <td>${formatTerminalNumber(quote.volume)}</td>
    </tr>
  `;
}

function renderTable(quotes) {
  if (!quotes.length) {
    els.contractsBody.innerHTML = "<tr><td colspan=\"4\" class=\"empty-cell\">暂无行情数据</td></tr>";
    return;
  }

  els.contractsBody.innerHTML = quotes.map(quoteRow).join("");
  els.contractsBody.querySelectorAll("tr[data-symbol]").forEach((row) => {
    row.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); row.click(); } });
    row.addEventListener("click", () => {
      state.selectedSymbol = row.dataset.symbol;
      localStorage.setItem(selectedSymbolStorageKey(state.product), state.selectedSymbol);
      if (state.product === "al") localStorage.setItem("selectedSymbol", state.selectedSymbol);
      state.klineSymbol = null;
      render(state.payload);
      showView("chart");
    });
  });
}

function render(payload, cacheMode = false) {
  state.payload = payload;
  state.cacheMode = cacheMode;
  state.product = payload?.productKey || state.product;
  updateProductUi();

  const quotes = payload?.quotes || [];
  const primary = findPrimaryQuote(quotes);
  if (primary && state.selectedSymbol !== primary.symbol && !quotes.some((q) => q.symbol === state.selectedSymbol)) {
    state.selectedSymbol = primary.symbol;
    localStorage.setItem(selectedSymbolStorageKey(state.product), state.selectedSymbol);
    if (state.product === "al") localStorage.setItem("selectedSymbol", state.selectedSymbol);
  }

  renderPrimary(primary);
  renderTable(quotes);

  setText("dataStatus", cacheMode ? "离线缓存" : "已连接");
  setText("fetchStamp", `抓取时间 ${localTime(payload?.fetchedAt)}`);

  if (
    primary &&
    (state.klineSymbol !== primary.symbol || state.klineIntervalLoaded !== state.klineInterval)
  ) {
    fetchKline(primary.symbol);
  }
}

function showToast(message, duration = 3200) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

function scheduleNext() {
  window.clearTimeout(state.timer);
  if (!document.hidden) state.timer = window.setTimeout(fetchQuotes, state.refreshMs);
}

function normalizeKlineRange() {
  const maxDate = todayDateValue();
  let startDate = clampDateValue(state.klineStart, KLINE_MIN_DATE, maxDate) || KLINE_MIN_DATE;
  let endDate = clampDateValue(state.klineEnd, KLINE_MIN_DATE, maxDate) || maxDate;

  if (startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  state.klineStart = startDate;
  state.klineEnd = endDate;
  localStorage.setItem("klineStart", startDate);
  localStorage.setItem("klineEnd", endDate);

  if (els.klineStart && els.klineEnd) {
    els.klineStart.min = KLINE_MIN_DATE;
    els.klineStart.max = maxDate;
    els.klineStart.value = startDate;
    els.klineEnd.min = KLINE_MIN_DATE;
    els.klineEnd.max = maxDate;
    els.klineEnd.value = endDate;
  }

  return { startDate, endDate };
}

function formatKlineRange(startDate = state.klineStart, endDate = state.klineEnd) {
  return `${startDate} 至 ${endDate}`;
}

async function fetchQuotes() {
  setText("dataStatus", "刷新中");
  const productAtRequest = state.product;
  const cacheKey = quoteCacheKey(productAtRequest);

  try {
    const response = await fetch(
      `/api/quote?product=${encodeURIComponent(productAtRequest)}&t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.detail || errorPayload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.quotes?.length) throw new Error("没有返回可用行情");
    if (productAtRequest !== state.product) return;
    localStorage.setItem(cacheKey, JSON.stringify(payload));
    render(payload, false);
  } catch (error) {
    if (productAtRequest !== state.product) return;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      render(JSON.parse(cached), true);
      showToast(`行情源暂时不可用，已显示最近缓存：${error.message}`);
    } else {
      setText("dataStatus", "连接失败");
      showToast(`行情获取失败：${error.message}`);
    }
  } finally {
    scheduleNext();
  }
}

let activeKlineRequest = null;

async function fetchKline(symbol = state.selectedSymbol) {
  const quote = findSelectedQuote();
  const interval = state.klineInterval;
  const productAtRequest = state.product;
  const label = intervalLabel(interval);
  const { startDate, endDate } = normalizeKlineRange();
  const cacheKey = `${klineCacheKey(symbol, interval, startDate, endDate, productAtRequest)}:history-v3`;
  // Input/change events and quote refresh can request the same chart together.
  // Abort superseded requests, and reject old results even after an A → B → A switch.
  if (activeKlineRequest?.key === cacheKey) return;
  activeKlineRequest?.controller.abort();
  const request = { key: cacheKey, controller: new AbortController() };
  activeKlineRequest = request;
  const timeout = window.setTimeout(() => request.controller.abort(new Error("K 线请求超时，请重试")), 45000);
  state.klineSymbol = symbol;
  state.klineIntervalLoaded = interval;
  els.klineTitle.textContent = `${quote?.name || symbol.replace(/^nf_/, "")} ${label} K线`;
  els.klineSubtitle.textContent = `正在加载${label}数据...`;
  els.klineStatus.textContent = "加载中";
  const keepChart = window.ALChart?.isActive() &&
    state.klinePayload?.symbol === symbol &&
    state.klinePayload?.interval === interval &&
    state.klinePayload?.requestedStart === startDate &&
    state.klinePayload?.requestedEnd === endDate;
  if (!keepChart) {
    state.klinePayload = null;
    window.ALChart?.clear();
    els.klineChart.className = "chart-empty";
    resetChartWidth();
    els.klineChart.textContent = "正在加载 K 线...";
    els.klineMeta.innerHTML = "";
    els.backtestMeta.innerHTML = "";
    const comparison = document.querySelector("#strategyComparison");
    if (comparison) comparison.innerHTML = "<p class=\"muted\">正在加载历史，重新计算对照…</p>";
  }

  try {
    const response = await fetch(
      `/api/kline?product=${encodeURIComponent(productAtRequest)}&symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
        interval
      )}&start=${encodeURIComponent(KLINE_MIN_DATE)}&end=${encodeURIComponent(endDate)}&t=${Date.now()}`,
      { cache: "no-store", signal: request.controller.signal }
    );
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.detail || errorPayload.error || `HTTP ${response.status}`);
    }
    const payload = await response.json();
    payload.historyStart = payload.requestedStart;
    payload.requestedStart = startDate;
    payload.requestedEnd = endDate;
    payload.hasIndicatorHistory = true;
    if (window.ALChart) payload.candles = window.ALChart.normalizeCandles(payload.candles, interval);
    if (!payload.candles?.length) throw new Error("没有返回可用K线");
    if (
      activeKlineRequest !== request ||
      productAtRequest !== state.product ||
      interval !== state.klineInterval ||
      startDate !== state.klineStart ||
      endDate !== state.klineEnd ||
      symbol !== state.selectedSymbol
    ) {
      return;
    }
    // A full local cache must not hide a successfully fetched live chart.
    try { localStorage.setItem(cacheKey, JSON.stringify(payload)); } catch (_) { /* Best-effort offline cache. */ }
    renderKline(payload, false);
  } catch (error) {
    if (
      activeKlineRequest !== request ||
      productAtRequest !== state.product ||
      interval !== state.klineInterval ||
      startDate !== state.klineStart ||
      endDate !== state.klineEnd ||
      symbol !== state.selectedSymbol
    ) {
      return;
    }
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch (_) { /* Ignore damaged cache. */ }
    if (cached?.candles?.length) {
      renderKline(cached, true);
      showToast(`K线源暂时不可用，已显示缓存：${error.message}`);
    } else {
      els.klineStatus.textContent = "加载失败";
      els.klineSubtitle.textContent = "K 线数据暂时不可用";
      if (keepChart) {
        els.klineStatus.textContent = "刷新失败 · 保留上次数据";
        showToast(`K 线刷新失败：${error.message}`);
      } else {
        window.ALChart?.clear();
        els.klineChart.className = "chart-empty";
        resetChartWidth();
        els.klineChart.textContent = `K 线获取失败：${error.message}`;
      }
    }
  } finally {
    window.clearTimeout(timeout);
    if (activeKlineRequest === request) activeKlineRequest = null;
  }
}

function movingAverage(candles, period) {
  if (!isMaEnabled(period)) return candles.map(() => null);

  const values = [];
  let sum = 0;

  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) sum -= candles[index - period].close;
    values.push(index >= period - 1 ? sum / period : null);
  }

  return values;
}

function rollingStd(candles, period) {
  const values = [];

  for (let index = 0; index < candles.length; index += 1) {
    if (index < period - 1) {
      values.push(null);
      continue;
    }

    let sum = 0;
    for (let item = index - period + 1; item <= index; item += 1) {
      sum += candles[item].close;
    }

    const mean = sum / period;
    let varianceSum = 0;
    for (let item = index - period + 1; item <= index; item += 1) {
      const distance = candles[item].close - mean;
      varianceSum += distance * distance;
    }

    values.push(Math.sqrt(varianceSum / period));
  }

  return values;
}

function lineValuesForStrategy(config, candles) {
  const mid = movingAverage(candles, config.period);
  const std = rollingStd(candles, config.deviationPeriod);
  const up = mid.map((value, index) =>
    isFiniteNumber(value) && isFiniteNumber(std[index])
      ? value + std[index] * config.deviationMultiple
      : null
  );
  const low = mid.map((value, index) =>
    isFiniteNumber(value) && isFiniteNumber(std[index])
      ? value - std[index] * config.deviationMultiple
      : null
  );

  return { up, mid, low };
}

function strategyThreshold(lineValues, threshold, index) {
  return lineValues[threshold]?.[index] ?? null;
}

function strategySignal(index, label, price, className, dy, type = "position") {
  return {
    index,
    label,
    price,
    className,
    dy,
    type
  };
}

function alternatingSignals(candles, rawBuy, rawSell) {
  const signals = [];
  const noSignalDistance = 1000000;
  let lastBuyDistance = noSignalDistance;
  let lastSellDistance = noSignalDistance;

  for (let index = 0; index < candles.length; index += 1) {
    const preBuyDistance = lastBuyDistance;
    const preSellDistance = lastSellDistance;
    const buy0 = rawBuy[index] && preSellDistance <= preBuyDistance;
    const sell0 = rawSell[index] && preBuyDistance < preSellDistance;
    const buySignal = buy0;
    const sellSignal = sell0 && !buy0;

    if (buySignal) {
      signals.push(strategySignal(index, "升高", candles[index].low, "strategy-buy", 16, "buy"));
    } else if (sellSignal) {
      signals.push(strategySignal(index, "降低", candles[index].high, "strategy-sell", -8, "sell"));
    }

    lastBuyDistance = rawBuy[index] ? 0 : lastBuyDistance + 1;
    lastSellDistance = rawSell[index] ? 0 : lastSellDistance + 1;
  }

  return signals;
}

/**
 * 铝双轨20（研究） — fixed MA20 ± 0.5 population standard deviation.
 * Close-confirmed signals; the current close is available before decision.
 * No date-specific rules, future bars, leverage, stop/target optimization, or exits
 * based on unavailable intrabar ordering. Initial state is flat; thereafter keep
 * the last direction until the opposite band is crossed. A touch is not a cross.
 * The application's ideal LOW/HIGH fills remain a hindsight simulation, distinct
 * from this causal signal rule. See REPORT.md for failed next-open validation.
 */
function computeChannel20Strategy(candles) {
  const period = 20;
  const multiplier = 0.5;
  const mid = [];
  const upper = [];
  const lower = [];
  const signals = [];
  let rollingSum = 0;
  let position = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    rollingSum += candle.close;
    if (index >= period) rollingSum -= candles[index - period].close;
    if (index < period - 1) {
      mid.push(null);
      upper.push(null);
      lower.push(null);
      continue;
    }
    const mean = rollingSum / period;
    let varianceSum = 0;
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      varianceSum += (candles[cursor].close - mean) ** 2;
    }
    const width = multiplier * Math.sqrt(varianceSum / period);
    const upperBand = mean + width;
    const lowerBand = mean - width;
    mid.push(mean);
    upper.push(upperBand);
    lower.push(lowerBand);
    const direction = candle.close > upperBand ? 1 : candle.close < lowerBand ? -1 : position;
    if (direction !== position && direction !== 0) {
      const buy = direction > 0;
      signals.push({
        index,
        label: buy ? '升高' : '降低',
        price: buy ? candle.low : candle.high,
        className: buy ? 'strategy-buy' : 'strategy-sell',
        dy: buy ? 16 : -8,
        type: buy ? 'buy' : 'sell'
      });
      position = direction;
    }
  }
  return {
    key: 'al_channel_20',
    label: '铝双轨20（研究）',
    description: 'MA20 ± 0.5σ；收盘突破上轨做多、跌破下轨做空，轨内保持方向。固定规则研究候选。',
    lines: [
      { name: 'up', label: '上轨', className: 'strategy-line-up', values: upper },
      { name: 'mid', label: '中轨', className: 'strategy-line-mid', values: mid },
      { name: 'low', label: '下轨', className: 'strategy-line-low', values: lower }
    ],
    signals
  };
}

function computeStrategy(candles, strategyKey) {
  const config = STRATEGY_CONFIGS[strategyKey];
  if (!config || !candles.length) return null;
  if (config.type === "closeChannel") return computeChannel20Strategy(candles);

  const lineValues = lineValuesForStrategy(config, candles);
  const rawBuy = candles.map((item, index) => {
    const threshold = strategyThreshold(lineValues, config.buyThreshold, index);
    return isFiniteNumber(threshold) && item.high >= threshold;
  });
  const rawSell = candles.map((item, index) => {
    const threshold = strategyThreshold(lineValues, config.sellThreshold, index);
    return isFiniteNumber(threshold) && item.close <= threshold;
  });

  const lineClassByName = {
    up: "strategy-line-up",
    mid: "strategy-line-mid",
    low: "strategy-line-low"
  };
  const lineLabelByName = {
    up: "上轨",
    mid: "中轨",
    low: "下轨"
  };
  const lines = config.lines.map((name) => ({
    name,
    label: lineLabelByName[name],
    className: lineClassByName[name],
    values: lineValues[name]
  }));
  const signals = alternatingSignals(candles, rawBuy, rawSell);

  return {
    key: strategyKey,
    label: strategyLabel(strategyKey, state.product),
    lines,
    signals
  };
}

function candleTimestamp(date) {
  if (!date) return Number.NaN;
  const normalized = date.includes(" ") ? date.replace(" ", "T") : `${date}T00:00:00`;
  return new Date(`${normalized}+08:00`).getTime();
}

function inputValueFromCandleDate(date) {
  if (!date) return "";
  if (date.includes(" ")) {
    const [day, time] = date.split(" ");
    return `${day}T${time.slice(0, 5)}`;
  }
  return `${date.slice(0, 10)}T00:00`;
}

function inputTimestamp(value) {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const parsed = new Date(`${normalized}+08:00`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRate(value) {
  if (!isFiniteNumber(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatExposure(value) {
  if (!isFiniteNumber(value) || Math.abs(value) < 0.0001) return "空仓";
  const side = value > 0 ? "多" : "空";
  return `${side} ${(Math.abs(value) * 100).toFixed(0)}%`;
}

function standardDeviation(values) {
  const clean = values.filter(isFiniteNumber);
  if (!clean.length) return null;
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const variance =
    clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length;
  return Math.sqrt(variance);
}

function annualizationFactor(interval = state.klineInterval) {
  if (interval === "1w") return 52;
  if (interval === "1mo") return 12;
  if (interval === "1h") return 252 * 4;
  if (interval === "3h") return 252 * 1.35;
  if (interval === "5h") return 252;
  return 252;
}

function backtestPrice(candle, signalType) {
  return signalType === "buy" ? candle.low : candle.high;
}

function syncBacktestRangeControls(candles) {
  if (!candles.length) return;

  const firstValue = inputValueFromCandleDate(candles[0].date);
  const lastValue = inputValueFromCandleDate(candles[candles.length - 1].date);
  const firstTs = inputTimestamp(firstValue);
  const lastTs = inputTimestamp(lastValue);
  const startTs = inputTimestamp(state.backtestStart);
  const endTs = inputTimestamp(state.backtestEnd);

  els.backtestStart.min = firstValue;
  els.backtestStart.max = lastValue;
  els.backtestEnd.min = firstValue;
  els.backtestEnd.max = lastValue;

  if (!state.backtestStart || startTs < firstTs || startTs > lastTs) {
    const requested = `${state.klineStart}T00:00`;
    state.backtestStart = requested >= firstValue && requested <= lastValue ? requested : firstValue;
  }
  if (!state.backtestEnd || endTs < firstTs || endTs > lastTs) {
    state.backtestEnd = lastValue;
  }
  if (inputTimestamp(state.backtestStart) > inputTimestamp(state.backtestEnd)) {
    state.backtestStart = firstValue;
    state.backtestEnd = lastValue;
  }

  els.backtestStart.value = state.backtestStart;
  els.backtestEnd.value = state.backtestEnd;
}

function closeBacktestPosition(position, signal, candle, mode) {
  const exitPrice = backtestPrice(candle, signal.type, mode);
  const returnRate =
    position.side === "long"
      ? (exitPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - exitPrice) / position.entryPrice;

  return {
    side: position.side,
    entryDate: position.entryDate,
    exitDate: candle.date,
    entryPrice: position.entryPrice,
    exitPrice,
    returnRate
  };
}

function computeBacktest(candles, strategy, options = {}) {
  if (!strategy) return { status: "no-strategy", trades: [] };

  const startTs = inputTimestamp(options.start ?? state.backtestStart);
  const endTs = inputTimestamp(options.end ?? state.backtestEnd);
  if (startTs !== null && endTs !== null && startTs > endTs) {
    return { status: "invalid-range", trades: [] };
  }

  const mode = state.backtestPriceMode;
  const direction = options.direction ?? state.backtestDirection;
  const signals = strategy.signals
    .filter((signal) => signal.type === "buy" || signal.type === "sell")
    .filter((signal) => {
      const ts = candleTimestamp(candles[signal.index]?.date);
      if (!Number.isFinite(ts)) return false;
      return (startTs === null || ts >= startTs) && (endTs === null || ts <= endTs);
    });

  const trades = [];
  let position = null;

  const openPosition = (side, signal, candle) => {
    position = {
      side,
      entryDate: candle.date,
      entryPrice: backtestPrice(candle, signal.type, mode)
    };
  };

  for (const signal of signals) {
    const candle = candles[signal.index];
    if (!candle) continue;

    if (direction === "long") {
      if (signal.type === "buy" && !position) openPosition("long", signal, candle);
      if (signal.type === "sell" && position?.side === "long") {
        trades.push(closeBacktestPosition(position, signal, candle, mode));
        position = null;
      }
      continue;
    }

    if (direction === "short") {
      if (signal.type === "sell" && !position) openPosition("short", signal, candle);
      if (signal.type === "buy" && position?.side === "short") {
        trades.push(closeBacktestPosition(position, signal, candle, mode));
        position = null;
      }
      continue;
    }

    if (signal.type === "buy") {
      if (position?.side === "short") {
        trades.push(closeBacktestPosition(position, signal, candle, mode));
        position = null;
      }
      if (!position) openPosition("long", signal, candle);
    }

    if (signal.type === "sell") {
      if (position?.side === "long") {
        trades.push(closeBacktestPosition(position, signal, candle, mode));
        position = null;
      }
      if (!position) openPosition("short", signal, candle);
    }
  }

  const totalReturn = trades.reduce((equity, trade) => equity * (1 + trade.returnRate), 1) - 1;
  const wins = trades.filter((trade) => trade.returnRate > 0).length;
  const averageReturn =
    trades.length > 0
      ? trades.reduce((sum, trade) => sum + trade.returnRate, 0) / trades.length
      : null;
  const bestReturn = trades.length ? Math.max(...trades.map((trade) => trade.returnRate)) : null;
  const worstReturn = trades.length ? Math.min(...trades.map((trade) => trade.returnRate)) : null;

  return {
    status: "ok",
    trades,
    totalReturn,
    winRate: trades.length ? wins / trades.length : null,
    averageReturn,
    bestReturn,
    worstReturn,
    openPosition: position
  };
}

function closeEquityDrawdown(candles, result, startValue, endValue) {
  const start = inputTimestamp(startValue);
  const end = inputTimestamp(endValue);
  let cursor = 0;
  let realized = 1;
  let peak = 1;
  let drawdown = 0;
  for (const candle of candles) {
    const ts = candleTimestamp(candle.date);
    if ((start !== null && ts < start) || (end !== null && ts > end)) continue;
    while (cursor < result.trades.length && candleTimestamp(result.trades[cursor].exitDate) <= ts) {
      realized *= 1 + result.trades[cursor].returnRate;
      cursor += 1;
    }
    const position = result.trades[cursor] || result.openPosition;
    let equity = realized;
    if (position && candleTimestamp(position.entryDate) <= ts) {
      const sign = position.side === "long" ? 1 : -1;
      equity *= 1 + sign * (candle.close / position.entryPrice - 1);
    }
    peak = Math.max(peak, equity);
    drawdown = Math.min(drawdown, equity / peak - 1);
  }
  return drawdown;
}

function calendarMonthsBefore(day, months) {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
}

function strategyPeriodComparison(candles, direction = "both") {
  if (!candles.length) return [];
  const endDay = candles[candles.length - 1].date.slice(0, 10);
  const strategies = Object.keys(STRATEGY_CONFIGS).map(key => computeStrategy(candles, key));
  return [1, 3, 6, 12].map(months => {
    const startDay = calendarMonthsBefore(endDay, months);
    const warmupCount = candles.filter(candle => candle.date.slice(0, 10) < startDay).length;
    const ready = warmupCount >= 24;
    const options = { start: `${startDay}T00:00`, end: `${endDay}T23:59`, direction };
    return { months, startDay, endDay, ready, results: strategies.map(strategy => {
      const result = computeBacktest(candles, strategy, options);
      return { key: strategy.key, label: strategy.label, ...result,
        maxDrawdown: closeEquityDrawdown(candles, result, options.start, options.end) };
    }) };
  });
}

function renderStrategyComparison(candles, payload) {
  const container = document.querySelector("#strategyComparison");
  if (!container) return;
  const periods = strategyPeriodComparison(candles, state.backtestDirection);
  if (!periods.length) { container.innerHTML = ""; return; }
  const labels = periods[0].results.map(result => `<th>${escapeHtml(result.label)}</th>`).join("");
  const rows = periods.map(period => `<tr><th>近 ${period.months} 个月<small>${period.startDay} 起</small></th>${period.results.map(result => `<td>${period.ready ? `<strong class="${trendClass(result.totalReturn)}">${formatRate(result.totalReturn)}</strong><small>回撤 ${formatRate(result.maxDrawdown)} · ${result.trades.length} 笔</small>` : '<span class="muted">历史不足</span>'}</td>`).join("")}</tr>`).join("");
  container.innerHTML = `<div class="section-heading"><h3>四周期对比</h3><span class="muted">截至 ${periods[0].endDay}</span></div><p class="backtest-assumption">${escapeHtml(payload.code || payload.symbol)} · ${escapeHtml(intervalLabel(payload.interval))} · ${BACKTEST_DIRECTION_LABELS[state.backtestDirection]}</p><div class="comparison-table-wrap"><table><thead><tr><th>回测区间</th>${labels}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function formatBacktestRange() {
  const start = state.backtestStart ? state.backtestStart.replace("T", " ") : "--";
  const end = state.backtestEnd ? state.backtestEnd.replace("T", " ") : "--";
  return `${start} 至 ${end}`;
}

function renderBacktestTrades(result) {
  if (!els.backtestTrades) return;
  if (!result?.trades?.length) {
    els.backtestTrades.innerHTML = "";
    return;
  }

  const rows = result.trades
    .slice(-10)
    .reverse()
    .map(
      (trade) => `
        <tr>
          <td>${trade.side === "long" ? "多" : "空"}</td>
          <td>${escapeHtml(trade.entryDate)}</td>
          <td>${formatPrice(trade.entryPrice)}</td>
          <td>${escapeHtml(trade.exitDate)}</td>
          <td>${formatPrice(trade.exitPrice)}</td>
          <td class="${trendClass(trade.returnRate)}">${formatRate(trade.returnRate)}</td>
        </tr>
      `
    )
    .join("");

  els.backtestTrades.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>方向</th>
          <th>开仓时间</th>
          <th>开仓价</th>
          <th>平仓时间</th>
          <th>平仓价</th>
          <th>收益</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderBacktest(candles, strategy) {
  const rangeLabel = document.querySelector("#backtestRangeLabel");
  if (rangeLabel) rangeLabel.textContent = `当前回测：${formatBacktestRange()}`;
  if (candles.length) {
    const endDay = candles[candles.length - 1].date.slice(0, 10);
    document.querySelectorAll("[data-backtest-months]").forEach(button => {
      const startDay = calendarMonthsBefore(endDay, Number(button.dataset.backtestMonths));
      const ready = candles.filter(candle => candle.date.slice(0, 10) < startDay).length >= 24;
      button.disabled = !ready;
      button.title = ready ? `${startDay} 至 ${endDay}` : "当前品种历史不足以覆盖此区间及指标预热";
      button.setAttribute("aria-pressed", String(state.backtestStart?.slice(0, 10) === startDay && state.backtestEnd?.slice(0, 10) === endDay));
    });
  }

  if (!candles.length) {
    els.backtestMeta.innerHTML = "";
    if (els.backtestTrades) els.backtestTrades.innerHTML = "";
    return;
  }

  if (!strategy) {
    els.backtestMeta.innerHTML = `
      <div><span>策略回测</span><strong>选择策略后计算</strong></div>
      <div><span>时间范围</span><strong>${escapeHtml(formatBacktestRange())}</strong></div>
      <div><span>方向</span><strong>${BACKTEST_DIRECTION_LABELS[state.backtestDirection]}</strong></div>
    `;
    if (els.backtestTrades) els.backtestTrades.innerHTML = "";
    return;
  }

  const result = computeBacktest(candles, strategy);
  if (result.status === "invalid-range") {
    els.backtestMeta.innerHTML =
      "<div><span>策略回测</span><strong>开始时间不能晚于结束时间</strong></div>";
    if (els.backtestTrades) els.backtestTrades.innerHTML = "";
    return;
  }

  const openPositionText = result.openPosition
    ? `${result.openPosition.side === "long" ? "多单" : "空单"}未平仓`
    : "无";
  const tradeCount = result.trades.length;
  const drawdown = closeEquityDrawdown(candles, result, state.backtestStart, state.backtestEnd);
  const drawdownText = formatRate(drawdown);

  els.backtestMeta.innerHTML = `
    <div><span>已平仓收益率</span><strong class="${trendClass(result.totalReturn)}">${formatRate(result.totalReturn)}</strong></div>
    <div><span>收盘净值回撤</span><strong class="${trendClass(drawdown)}">${drawdownText}</strong></div>
    <div><span>完成交易</span><strong>${tradeCount} 笔</strong></div>
    <div><span>胜率</span><strong>${result.winRate === null ? "--" : formatRate(result.winRate)}</strong></div>
    <div><span>平均单笔</span><strong class="${trendClass(result.averageReturn)}">${result.averageReturn === null ? "--" : formatRate(result.averageReturn)}</strong></div>
    <div><span>最佳 / 最差</span><strong>${result.bestReturn === null ? "--" : `${formatRate(result.bestReturn)} / ${formatRate(result.worstReturn)}`}</strong></div>
    <div><span>方向</span><strong>${BACKTEST_DIRECTION_LABELS[state.backtestDirection]}</strong></div>
    <div><span>未平仓</span><strong>${openPositionText}</strong></div>
  `;
  renderBacktestTrades(result);
}

function chartWidthForCandles(candles, interval) {
  if (state.klineZoom <= KLINE_DEFAULT_ZOOM) {
    return Math.max(760, Math.round(els.chartWrap?.clientWidth || 760));
  }
  const perCandle = isIntradayInterval(interval) ? 5.5 : interval === "1d" ? 7 : 11;
  const width = 760 + candles.length * perCandle * state.klineZoom;
  return Math.round(clamp(width, 760, KLINE_MAX_CHART_WIDTH));
}

function applyChartWidth(width) {
  els.klineChart.style.width = `${width}px`;
  els.klineChart.style.minWidth = `${width}px`;
}

function resetChartWidth() {
  els.klineChart.style.width = "";
  els.klineChart.style.minWidth = "";
}

function updateZoomUi() {
  const index = zoomIndex(state.klineZoom);
  els.zoomValue.textContent = zoomLabel(state.klineZoom);
  els.zoomOutButton.disabled = index <= 0;
  els.zoomInButton.disabled = index >= KLINE_ZOOM_LEVELS.length - 1;
  els.zoomResetButton.disabled = state.klineZoom === KLINE_DEFAULT_ZOOM;
}

function setKlineZoom(value) {
  if (window.ALChart?.isActive()) {
    const nextZoom = normalizeZoom(value);
    if (nextZoom === KLINE_DEFAULT_ZOOM) window.ALChart.showBars(90);
    else window.ALChart.zoom(nextZoom > state.klineZoom ? 1.4 : 1 / 1.4);
    state.klineZoom = nextZoom;
    localStorage.setItem("klineZoom", String(nextZoom));
    updateZoomUi();
    return;
  }
  const wrap = els.chartWrap;
  const centerRatio =
    wrap && wrap.scrollWidth > 0
      ? (wrap.scrollLeft + wrap.clientWidth / 2) / wrap.scrollWidth
      : 0.5;

  state.klineZoom = normalizeZoom(value);
  localStorage.setItem("klineZoom", String(state.klineZoom));
  updateZoomUi();

  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
    window.requestAnimationFrame(() => {
      if (!els.chartWrap) return;
      els.chartWrap.scrollLeft = Math.max(
        0,
        centerRatio * els.chartWrap.scrollWidth - els.chartWrap.clientWidth / 2
      );
    });
  }
}

function resetKlineViewToFullRange() {
  window.ALChart?.showBars(90);
  state.klineZoom = KLINE_DEFAULT_ZOOM;
  localStorage.setItem("klineZoom", String(state.klineZoom));
  updateZoomUi();
  window.requestAnimationFrame(() => {
    if (els.chartWrap) els.chartWrap.scrollLeft = 0;
  });
}

function applyKlineRangeInputs() {
  if (!isDateValue(els.klineStart.value) || !isDateValue(els.klineEnd.value)) return;

  state.klineStart = els.klineStart.value;
  state.klineEnd = els.klineEnd.value;
  normalizeKlineRange();
  state.backtestStart = `${state.klineStart}T00:00`;
  state.backtestEnd = `${state.klineEnd}T23:59`;
  localStorage.setItem("backtestStart", state.backtestStart);
  localStorage.setItem("backtestEnd", state.backtestEnd);
  resetKlineViewToFullRange();
  state.klineIntervalLoaded = null;
  fetchKline(state.selectedSymbol);
}

function renderKline(payload, cacheMode = false) {
  // Deduplicate and sort before computing indicators so chart, signals and
  // backtest all share exactly the same candle indexes.
  if (window.ALChart) {
    payload = { ...payload, candles: window.ALChart.normalizeCandles(payload.candles, payload.interval) };
  }
  state.klinePayload = payload;
  state.klineCacheMode = cacheMode;

  const quote = state.payload?.quotes?.find((item) => item.symbol === payload.symbol);
  const historyCandles = payload.candles || [];
  const visibleStart = payload.requestedStart || state.klineStart;
  const firstVisible = historyCandles.findIndex(candle => candle.date.slice(0, 10) >= visibleStart);
  const offset = Math.max(0, firstVisible);
  const candles = firstVisible < 0 ? [] : historyCandles.slice(offset);
  const allMaValues = movingAverage(historyCandles, state.maPeriod);
  const allStrategy = computeStrategy(historyCandles, state.strategy);
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const maValues = allMaValues.slice(offset);
  const strategy = allStrategy ? {
    ...allStrategy,
    lines: allStrategy.lines.map(line => ({ ...line, values: line.values.slice(offset) })),
    signals: allStrategy.signals.filter(signal => signal.index >= offset).map(signal => ({ ...signal, index: signal.index - offset }))
  } : null;
  const latestMa = maValues[maValues.length - 1];
  const change = latest && previous ? latest.close - previous.close : null;
  const changePct = change !== null && previous?.close ? (change / previous.close) * 100 : null;
  const label = payload.intervalLabel || intervalLabel(payload.interval);
  const maText = isMaEnabled(state.maPeriod) ? `MA${state.maPeriod}` : "均线 空";
  const strategyText = strategy ? ` · 策略 ${strategy.label}` : "";
  const openInterestLabel = latest?.openInterest === null ? "累计量" : "持仓量";
  const openInterestValue =
    latest?.openInterest === null ? latest?.cumulativeVolume : latest?.openInterest;
  if (!quote && latest) {
    // K-line history can load independently when the quote endpoint is down.
    // Show the selected instrument, but identify the price as a candle close.
    setText("contractBadge", payload.code || payload.symbol);
    setText("contractName", `${payload.productLabel || ""} ${payload.code || payload.symbol}`.trim());
    setText("lastPrice", formatPrice(latest.close));
    setText("marketState", "最近 K 线收盘 · 报价不可用");
    setText("quoteTime", `K线 ${latest.date}`);
    document.querySelector("#priceUnit").textContent = payload.priceUnit || (isUsSymbol(payload.symbol) ? "美元/股" : "元/吨");
    els.changeLine.className = `change-line ${trendClass(change)}`;
    els.changeLine.innerHTML = `<span>K线涨跌 ${formatChange(change)}</span><span>${formatPct(changePct)}</span>`;
    ["openPrice", "highPrice", "lowPrice", "volume", "openInterest"].forEach((id) => setText(id, "—"));
  }
  els.klineTitle.textContent = `${quote?.name || payload.code} ${label} K线`;
  els.klineStatus.textContent = cacheMode ? "离线缓存" : `更新 ${localTime(payload.fetchedAt)}`;
  els.klineSubtitle.textContent = `${label} · ${formatKlineRange(payload.requestedStart || state.klineStart, payload.requestedEnd || state.klineEnd)} · ${candles.length} 根 · ${maText}${strategyText} · ${payload.priceUnit}`;
  els.klineChart.className = `kline-chart theme-${state.klineTheme}`;
  resetChartWidth();
  updateZoomUi();
  let interactive = false;
  try {
    interactive = Boolean(window.ALChart?.render({
      container: els.klineChart,
      legend: document.querySelector("#chartLegend"),
      candles, maValues, maPeriod: state.maPeriod, strategy,
      interval: payload.interval, theme: state.klineTheme,
      key: `${state.product}:${payload.symbol}:${payload.interval}:${payload.requestedStart || state.klineStart}:${payload.requestedEnd || state.klineEnd}`
    }));
  } catch (error) {
    window.ALChart?.clear();
    console.warn("Interactive chart unavailable; using SVG fallback.", error);
  }
  if (!interactive) {
    const chartWidth = chartWidthForCandles(candles, payload.interval);
    applyChartWidth(chartWidth);
    els.klineChart.innerHTML = buildKlineSvg(candles, maValues, state.maPeriod, payload.interval, strategy, chartWidth);
    setupChartPointer(candles);
    if (state.klineZoom <= KLINE_DEFAULT_ZOOM && els.chartWrap) els.chartWrap.scrollLeft = 0;
  }
  syncBacktestRangeControls(historyCandles);
  renderBacktest(historyCandles, allStrategy);
  renderStrategyComparison(historyCandles, payload);
  els.klineMeta.innerHTML = latest
    ? `
      <div><span>时间</span><strong>${escapeHtml(latest.date)}</strong></div>
      <div><span>开盘</span><strong>${formatPrice(latest.open)}</strong></div>
      <div><span>最高</span><strong>${formatPrice(latest.high)}</strong></div>
      <div><span>最低</span><strong>${formatPrice(latest.low)}</strong></div>
      <div><span>收盘</span><strong>${formatPrice(latest.close)}</strong></div>
      <div><span>涨跌</span><strong class="${trendClass(change)}">${formatChange(change)} / ${formatPct(changePct)}</strong></div>
      <div><span>${maText}</span><strong>${isMaEnabled(state.maPeriod) ? formatPrice(latestMa) : "空"}</strong></div>
      <div><span>成交量</span><strong>${formatNumber(latest.volume)}</strong></div>
      <div><span>${openInterestLabel}</span><strong>${formatNumber(openInterestValue)}</strong></div>
    `
    : "";
}

function shortDateLabel(date, interval) {
  if (date.includes(" ")) {
    const [day, time] = date.split(" ");
    return `${day.slice(5)} ${time.slice(0, 5)}`;
  }
  if (interval === "1mo") return date.slice(0, 7);
  return date.slice(5);
}

function isIntradayInterval(interval) {
  return interval === "1h" || interval === "3h" || interval === "5h";
}

function dateLabelParts(date, interval) {
  if (date.includes(" ")) {
    const [day, time] = date.split(" ");
    return isIntradayInterval(interval) ? [day.slice(5), time.slice(0, 5)] : [shortDateLabel(date, interval)];
  }

  if (interval === "1mo") return [date.slice(0, 7)];
  return [date.slice(5)];
}

function dateLabelIndexes(candles, interval) {
  if (candles.length <= 1) return [0];

  const maxLabels = isIntradayInterval(interval) ? 8 : 6;
  const count = Math.min(maxLabels, candles.length);
  const indexes = new Set();

  for (let index = 0; index < count; index += 1) {
    indexes.add(Math.round((index * (candles.length - 1)) / (count - 1)));
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

function linePath(values, xFor, yFor) {
  let path = "";
  let started = false;
  values.forEach((value, index) => {
    if (value === null || value === undefined || Number.isNaN(value)) return;
    path += `${started ? "L" : "M"} ${xFor(index).toFixed(2)} ${yFor(value).toFixed(2)} `;
    started = true;
  });
  return path.trim();
}

function setupChartPointer(candles) {
  const chart = els.klineChart;
  const svg = chart.querySelector("svg");
  const crosshair = svg?.querySelector(".crosshair");
  if (!svg || !crosshair || !candles.length) return;

  const vLine = crosshair.querySelector(".crosshair-v");
  const hLine = crosshair.querySelector(".crosshair-h");
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  chart.appendChild(tooltip);

  const meta = {
    width: Number(svg.dataset.width),
    height: Number(svg.dataset.height),
    left: Number(svg.dataset.left),
    right: Number(svg.dataset.right),
    priceTop: Number(svg.dataset.priceTop),
    priceHeight: Number(svg.dataset.priceHeight),
    yMax: Number(svg.dataset.yMax),
    yMin: Number(svg.dataset.yMin)
  };
  const plotRight = meta.width - meta.right;
  const plotWidth = plotRight - meta.left;
  const priceBottom = meta.priceTop + meta.priceHeight;
  const priceRange = Math.max(meta.yMax - meta.yMin, 1);
  const slot = plotWidth / candles.length;

  const showPointer = (event) => {
    const svgRect = svg.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    const x = ((event.clientX - svgRect.left) / svgRect.width) * meta.width;
    const y = ((event.clientY - svgRect.top) / svgRect.height) * meta.height;
    const pointerX = clamp(x, meta.left, plotRight);
    const pointerY = clamp(y, meta.priceTop, priceBottom);
    const index = clamp(Math.floor((pointerX - meta.left) / slot), 0, candles.length - 1);
    const candle = candles[index];
    const price = meta.yMax - ((pointerY - meta.priceTop) / meta.priceHeight) * priceRange;

    vLine.setAttribute("x1", pointerX);
    vLine.setAttribute("x2", pointerX);
    hLine.setAttribute("y1", pointerY);
    hLine.setAttribute("y2", pointerY);
    crosshair.setAttribute("visibility", "visible");

    tooltip.innerHTML = `
      <strong>${formatPrice(price)} 元/吨</strong>
      <span>${escapeHtml(candle.date)}</span>
      <span>开 ${formatPrice(candle.open)} 高 ${formatPrice(candle.high)}</span>
      <span>低 ${formatPrice(candle.low)} 收 ${formatPrice(candle.close)}</span>
    `;

    const cssX = event.clientX - chartRect.left + 14;
    const cssY = event.clientY - chartRect.top + 14;
    tooltip.style.left = `${clamp(cssX, 8, Math.max(chartRect.width - 188, 8))}px`;
    tooltip.style.top = `${clamp(cssY, 8, Math.max(chartRect.height - 104, 8))}px`;
    tooltip.hidden = false;
  };

  const hidePointer = () => {
    crosshair.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };

  svg.addEventListener("pointermove", showPointer);
  svg.addEventListener("pointerleave", hidePointer);
}

function buildKlineSvg(candles, maValues, maPeriod, interval, strategy, chartWidth = 980) {
  if (!candles.length) return "";

  const width = chartWidth;
  const height = 468;
  const margin = { top: 24, right: 64, bottom: 44, left: 70 };
  const priceTop = margin.top;
  const priceHeight = 286;
  const volumeTop = 342;
  const volumeHeight = 62;
  const plotWidth = width - margin.left - margin.right;
  const highs = candles.map((item) => item.high);
  const lows = candles.map((item) => item.low);
  const maForRange = maValues.filter(isFiniteNumber);
  const strategyLineValues = strategy
    ? strategy.lines.flatMap((line) => line.values.filter(isFiniteNumber))
    : [];
  const strategySignalPrices = strategy
    ? strategy.signals.map((signal) => signal.price).filter(isFiniteNumber)
    : [];
  const maxPrice = Math.max(...highs, ...maForRange, ...strategyLineValues, ...strategySignalPrices);
  const minPrice = Math.min(...lows, ...maForRange, ...strategyLineValues, ...strategySignalPrices);
  const pricePadding = Math.max((maxPrice - minPrice) * 0.08, 10);
  const yMax = maxPrice + pricePadding;
  const yMin = minPrice - pricePadding;
  const priceRange = Math.max(yMax - yMin, 1);
  const volumes = candles.map((item) => item.volume || 0);
  const maxVolume = Math.max(...volumes, 1);
  const slot = plotWidth / candles.length;
  const bodyWidth = clamp(slot * 0.58, 2, 10);

  const xFor = (index) => margin.left + slot * index + slot / 2;
  const yFor = (value) => priceTop + ((yMax - value) / priceRange) * priceHeight;
  const volumeY = (value) => volumeTop + volumeHeight - (value / maxVolume) * volumeHeight;
  const maPath = linePath(maValues, xFor, yFor);
  const strategyLinesSvg = strategy
    ? strategy.lines
        .map((line) => {
          const path = linePath(line.values, xFor, yFor);
          return path
            ? `<path d="${path}" class="strategy-line ${line.className}"><title>${escapeHtml(
                strategy.label
              )} ${escapeHtml(line.label)}</title></path>`
            : "";
        })
        .join("")
    : "";

  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = priceTop + priceHeight * ratio;
    const price = yMax - priceRange * ratio;
    return `
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" class="chart-grid" />
      <text x="${margin.left - 10}" y="${y + 4}" class="axis-label price-axis-left">${formatPrice(price)}</text>
      <text x="${width - margin.right + 10}" y="${y + 4}" class="axis-label">${formatPrice(price)}</text>
    `;
  }).join("");

  const candlesSvg = candles
    .map((item, index) => {
      const x = xFor(index);
      const openY = yFor(item.open);
      const closeY = yFor(item.close);
      const highY = yFor(item.high);
      const lowY = yFor(item.low);
      const isRise = item.close >= item.open;
      const cls = isRise ? "candle-rise" : "candle-fall";
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
      const volY = volumeY(item.volume || 0);
      const volHeight = volumeTop + volumeHeight - volY;
      return `
        <g>
          <title>${escapeHtml(item.date)} 开:${formatPrice(item.open)} 高:${formatPrice(item.high)} 低:${formatPrice(item.low)} 收:${formatPrice(item.close)}</title>
          <line x1="${x}" x2="${x}" y1="${highY}" y2="${lowY}" class="${cls}" />
          <rect x="${x - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" rx="1" class="${cls}" />
          <rect x="${x - bodyWidth / 2}" y="${volY}" width="${bodyWidth}" height="${volHeight}" rx="1" class="${cls} volume-bar" />
        </g>
      `;
    })
    .join("");

  const strategySignalsSvg = strategy
    ? strategy.signals
        .map((signal) => {
          if (!isFiniteNumber(signal.price)) return "";
          const x = xFor(signal.index);
          const y = clamp(
            yFor(signal.price) + signal.dy,
            priceTop + 14,
            priceTop + priceHeight - 4
          );
          const candle = candles[signal.index];
          const labelWidth = Math.max(42, signal.label.length * 16 + 14);
          const labelHeight = 20;
          return `
            <g class="strategy-signal-group ${signal.className}">
              <title>${escapeHtml(candle?.date || "")} ${escapeHtml(signal.label)} ${formatPrice(signal.price)}</title>
              <rect x="${(x - labelWidth / 2).toFixed(2)}" y="${(y - 15).toFixed(2)}" width="${labelWidth}" height="${labelHeight}" rx="5" class="strategy-signal-bg" />
              <text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="strategy-signal">${escapeHtml(signal.label)}</text>
            </g>
          `;
        })
        .join("")
    : "";

  const labelIndexes = dateLabelIndexes(candles, interval);
  const dateLabels = labelIndexes
    .map((index) => {
      const x = xFor(index);
      const parts = dateLabelParts(candles[index].date, interval);
      if (parts.length === 2) {
        return `
          <text x="${x}" y="${height - 28}" class="date-label">
            <tspan x="${x}">${escapeHtml(parts[0])}</tspan>
            <tspan x="${x}" dy="15">${escapeHtml(parts[1])}</tspan>
          </text>
        `;
      }
      return `<text x="${x}" y="${height - 16}" class="date-label">${escapeHtml(parts[0])}</text>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="K线图" data-width="${width}" data-height="${height}" data-left="${margin.left}" data-right="${margin.right}" data-price-top="${priceTop}" data-price-height="${priceHeight}" data-y-max="${yMax}" data-y-min="${yMin}">
      <rect x="0" y="0" width="${width}" height="${height}" class="chart-bg" />
      ${grid}
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${priceTop + priceHeight}" y2="${priceTop + priceHeight}" class="chart-axis" />
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${volumeTop + volumeHeight}" y2="${volumeTop + volumeHeight}" class="chart-axis" />
      <text x="${margin.left}" y="${volumeTop - 10}" class="axis-label">成交量</text>
      ${isMaEnabled(maPeriod) ? `<text x="${margin.left}" y="17" class="ma-label">MA${maPeriod}</text>` : ""}
      ${strategy ? `<text x="${isMaEnabled(maPeriod) ? margin.left + 58 : margin.left}" y="17" class="strategy-legend">${escapeHtml(strategy.label)}</text>` : ""}
      ${candlesSvg}
      ${strategyLinesSvg}
      ${maPath ? `<path d="${maPath}" class="ma-line" />` : ""}
      ${strategySignalsSvg}
      <g class="crosshair" visibility="hidden">
        <line x1="${margin.left}" x2="${margin.left}" y1="${priceTop}" y2="${priceTop + priceHeight}" class="crosshair-line crosshair-v" />
        <line x1="${margin.left}" x2="${width - margin.right}" y1="${priceTop}" y2="${priceTop}" class="crosshair-line crosshair-h" />
      </g>
      ${dateLabels}
    </svg>
  `;
}

function setupInstallButton() {
  if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
    els.installButton.textContent = "安装说明";
  }
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      showToast("离线缓存注册失败，不影响实时行情。");
    });
  });
}

els.refreshInterval.value = String(state.refreshMs);
els.refreshInterval.addEventListener("change", () => {
  state.refreshMs = Number(els.refreshInterval.value);
  localStorage.setItem("refreshMs", String(state.refreshMs));
  scheduleNext();
});

els.productSelect.value = state.product;
els.productSelect.addEventListener("change", () => {
  state.product = PRODUCT_CONFIGS[els.productSelect.value] ? els.productSelect.value : "al";
  localStorage.setItem("product", state.product);
  state.selectedSymbol =
    localStorage.getItem(selectedSymbolStorageKey(state.product)) ||
    productConfig(state.product).defaultSymbol;
  state.klineSymbol = null;
  state.klineIntervalLoaded = null;
  state.klinePayload = null;
  updateProductUi();
  window.clearTimeout(state.timer);
  fetchQuotes();
});

els.klineInterval.value = state.klineInterval;
els.klineInterval.addEventListener("change", () => {
  state.klineInterval = els.klineInterval.value;
  state.klineIntervalLoaded = null;
  localStorage.setItem("klineInterval", state.klineInterval);
  if (els.menuIntervalLabel) els.menuIntervalLabel.textContent = intervalLabel();
  fetchKline(state.selectedSymbol);
});

normalizeKlineRange();
els.klineStart.addEventListener("change", applyKlineRangeInputs);
els.klineStart.addEventListener("input", applyKlineRangeInputs);
els.klineEnd.addEventListener("change", applyKlineRangeInputs);
els.klineEnd.addEventListener("input", applyKlineRangeInputs);

els.maPeriod.value = String(state.maPeriod);
els.maPeriod.addEventListener("change", () => {
  state.maPeriod = Number(els.maPeriod.value);
  localStorage.setItem("maPeriod", String(state.maPeriod));
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.klineTheme.value = state.klineTheme;
els.klineTheme.addEventListener("change", () => {
  state.klineTheme = els.klineTheme.value === "dark" ? "dark" : "light";
  localStorage.setItem("klineTheme", state.klineTheme);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

updateZoomUi();
els.zoomOutButton.addEventListener("click", () => {
  const index = zoomIndex(state.klineZoom);
  setKlineZoom(KLINE_ZOOM_LEVELS[Math.max(0, index - 1)]);
});

els.zoomInButton.addEventListener("click", () => {
  const index = zoomIndex(state.klineZoom);
  setKlineZoom(KLINE_ZOOM_LEVELS[Math.min(KLINE_ZOOM_LEVELS.length - 1, index + 1)]);
});

els.zoomResetButton.addEventListener("click", () => {
  setKlineZoom(KLINE_DEFAULT_ZOOM);
});

els.strategySelect.value = state.strategy;
updateProductUi();
els.strategySelect.addEventListener("change", () => {
  state.strategy = els.strategySelect.value;
  localStorage.setItem("strategy", state.strategy);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

document.querySelectorAll("[data-backtest-months]").forEach(button => {
  button.addEventListener("click", () => {
    const candles = state.klinePayload?.candles;
    if (!candles?.length) return;
    const endDay = candles[candles.length - 1].date.slice(0, 10);
    state.backtestStart = `${calendarMonthsBefore(endDay, Number(button.dataset.backtestMonths))}T00:00`;
    state.backtestEnd = `${endDay}T23:59`;
    localStorage.setItem("backtestStart", state.backtestStart);
    localStorage.setItem("backtestEnd", state.backtestEnd);
    renderKline(state.klinePayload, state.klineCacheMode);
  });
});

els.backtestDirection.value = state.backtestDirection;
els.backtestDirection.addEventListener("change", () => {
  state.backtestDirection = BACKTEST_DIRECTION_LABELS[els.backtestDirection.value]
    ? els.backtestDirection.value
    : "both";
  localStorage.setItem("backtestDirection", state.backtestDirection);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.backtestStart.value = state.backtestStart;
els.backtestStart.addEventListener("change", () => {
  state.backtestStart = els.backtestStart.value;
  localStorage.setItem("backtestStart", state.backtestStart);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.backtestEnd.value = state.backtestEnd;
els.backtestEnd.addEventListener("change", () => {
  state.backtestEnd = els.backtestEnd.value;
  localStorage.setItem("backtestEnd", state.backtestEnd);
  if (state.klinePayload) {
    renderKline(state.klinePayload, state.klineCacheMode);
  }
});

els.refreshButton.addEventListener("click", () => {
  if (els.appShell.dataset.activeView === "news") { window.ALNewsFeed?.refresh(); return; }
  window.clearTimeout(state.timer);
  state.klineSymbol = null;
  fetchQuotes();
});

els.navButtons?.forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.nav));
});

els.chartBackButton?.addEventListener("click", () => {
  showView("market");
});

els.openMenuButton?.addEventListener("click", openSideMenu);
els.quickMenuButton?.addEventListener("click", openSideMenu);
els.sideMenuBackdrop?.addEventListener("click", closeSideMenu);
els.closeMenuButton?.addEventListener("click", closeSideMenu);
els.dismissTipButton?.addEventListener("click", () => {
  els.dismissTipButton.closest(".menu-tip")?.remove();
});

els.quickThemeButton?.addEventListener("click", () => {
  els.klineTheme.value = state.klineTheme === "dark" ? "light" : "dark";
  els.klineTheme.dispatchEvent(new Event("change"));
});

els.quickZoomButton?.addEventListener("click", () => {
  setKlineZoom(state.klineZoom <= KLINE_DEFAULT_ZOOM ? 0.1 : KLINE_DEFAULT_ZOOM);
});

showView(location.hash === "#news" ? "news" : "chart");
setupInstallButton();
setupServiceWorker();
fetchQuotes();

// Range presets control the requested history; chart gestures control the visible window.
document.querySelectorAll("[data-range-days]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-range-days]").forEach(item => item.classList.toggle("active", item === button));
    els.klineStart.value = button.dataset.rangeDays === "all" ? KLINE_MIN_DATE : daysAgoDateValue(Number(button.dataset.rangeDays));
    els.klineEnd.value = todayDateValue();
    applyKlineRangeInputs();
  });
});
[els.klineStart, els.klineEnd].forEach(input => input.addEventListener("change", () => {
  document.querySelectorAll("[data-range-days]").forEach(item => item.classList.remove("active"));
}));
window.setInterval(() => {
  if (document.hidden || els.appShell.dataset.activeView !== "chart") return;
  fetchKline(state.selectedSymbol);
}, 60000);
document.addEventListener("visibilitychange", () => {
  window.clearTimeout(state.timer);
  if (!document.hidden) fetchQuotes();
});
