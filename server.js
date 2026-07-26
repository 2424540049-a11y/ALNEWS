const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "DATA");
const LOCAL_AL_DAILY_PATH = path.join(DATA_DIR, "aluminum_AL0_daily_2005_20260622.json");
const LOCAL_AL_DAILY_END = "2026-06-22";
const SINA_QUOTE_ENDPOINT = "https://hq.sinajs.cn/list=";
const SINA_KLINE_ENDPOINT =
  "https://stock2.finance.sina.com.cn/futures/api/jsonp.php";
const SINA_REFERER = "https://finance.sina.com.cn/";
const YAHOO_CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_AA_NEWS_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=AA&region=US&lang=en-US";
const SMM_SEARCH_ENDPOINT = "https://news.smm.cn/search";
const SHFE_NOTICE_URL = "https://www.shfe.com.cn/publicnotice/notice/";
const KLINE_MIN_DATE = "2005-01-01";
const KLINE_MAX_BARS = 30000;
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const TRANSLATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const ARTICLE_SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ARTICLE_TEXT_MAX_CHARS = 9000;
const REQUEST_BODY_MAX_BYTES = 512 * 1024;
const ALLOWED_NEWS_HOSTS = new Set([
  "news.smm.cn",
  "www.shfe.com.cn",
  "shfe.com.cn",
  "finance.yahoo.com",
  "247wallst.com",
  "www.247wallst.com",
  "investorshub.advfn.com",
  "www.mining-technology.com",
  "mining-technology.com",
  "stocktwits.com",
  "www.stocktwits.com"
]);
const NEWS_FALLBACKS = {
  today: [
    {
      title: "沪铝震荡整理 社库继续去化【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103985114",
      source: "文华财经",
      time: "2026-07-02"
    },
    {
      title: "沪铝修复力欠佳 铝合金相对抗跌【机构评论】",
      url: "https://news.smm.cn/news/103985112",
      source: "国信期货",
      time: "2026-07-02"
    },
    {
      title: "地缘冲突溢价消退 内外铝价连续下跌【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103982665",
      source: "文华财经",
      time: "2026-07-01"
    },
    {
      title: "沪铝继续下跌 弱势明显【机构评论】",
      url: "https://news.smm.cn/news/103982663",
      source: "宝城期货",
      time: "2026-07-01"
    },
    {
      title: "金属普涨 伦锡涨超2% 沪铝铅镍、沪金跌超1% 碳酸锂飙升逾8%【SMM日评】",
      url: "https://news.smm.cn/news/103979751",
      source: "SMM",
      time: "2026-06-30"
    },
    {
      title: "沪铝增仓下跌 创年内新低【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103980198",
      source: "文华财经",
      time: "2026-06-30"
    },
    {
      title: "金属涨跌互现 碳酸锂涨近5% 沪铝、沪镍领跌 沪金、沪银铂跌超2%【SMM午评】",
      url: "https://news.smm.cn/news/103979171",
      source: "SMM",
      time: "2026-06-30"
    },
    {
      title: "期铝触及四个月新低后反弹收升，因疲软非农数据拖累美元走弱【7月2日LME收盘】",
      url: "https://news.smm.cn/news/103985255",
      source: "文华财经",
      time: "2026-07-02"
    },
    {
      title: "美元走软 基本金属普跌 伦铝锌镍、沪锌跌超1% 铂涨逾5%【SMM日评】",
      url: "https://news.smm.cn/news/103984712",
      source: "SMM",
      time: "2026-07-02"
    },
    {
      title: "阿联酋环球铝业：阿尔塔维拉项目复产进度快于预期",
      url: "https://news.smm.cn/news/103985124",
      source: "文华财经",
      time: "2026-07-02"
    }
  ],
  close: [
    {
      title: "沪铝震荡整理 社库继续去化【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103985114",
      source: "文华财经",
      time: "2026-07-02"
    },
    {
      title: "地缘冲突溢价消退 内外铝价连续下跌【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103982665",
      source: "文华财经",
      time: "2026-07-01"
    },
    {
      title: "沪铝增仓下跌 创年内新低【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103980198",
      source: "文华财经",
      time: "2026-06-30"
    },
    {
      title: "沪铝小幅上涨 社库继续下滑【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103977694",
      source: "文华财经",
      time: "2026-06-29"
    },
    {
      title: "市场情绪修复 沪铝震荡运行【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103975074",
      source: "文华财经",
      time: "2026-06-26"
    },
    {
      title: "沪铝低开下行 创年内新低【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103972651",
      source: "文华财经",
      time: "2026-06-25"
    },
    {
      title: "地缘溢价出清 沪铝震荡下跌【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103967710",
      source: "文华财经",
      time: "2026-06-23"
    },
    {
      title: "海外供应短缺局面未改 沪铝震荡运行【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103960251",
      source: "文华财经",
      time: "2026-06-17"
    },
    {
      title: "地缘风险溢价被挤出 沪铝震荡下跌【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103958099",
      source: "文华财经",
      time: "2026-06-16"
    },
    {
      title: "沪铝震荡运行 社库继续下滑【沪铝收盘评论】",
      url: "https://news.smm.cn/news/103955799",
      source: "文华财经",
      time: "2026-06-15"
    }
  ],
  exchange: [
    {
      title: "关于同意云南其亚金属有限公司“QY”牌铝锭注册的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202607/t20260701_832360.html",
      source: "上海期货交易所",
      time: "2026-07-01"
    },
    {
      title: "关于调整黄金等期货相关合约涨跌停板幅度和交易保证金比例的通知",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260630_832357.html",
      source: "上海期货交易所",
      time: "2026-06-30"
    },
    {
      title: "上海国际能源交易中心发布关于调整国际铜期货相关合约涨跌停板幅度和交易保证金比例的通知",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260630_832356.html",
      source: "上海期货交易所",
      time: "2026-06-30"
    },
    {
      title: "关于对部分客户采取限制开仓监管措施的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260630_832349.html",
      source: "上海期货交易所",
      time: "2026-06-30"
    },
    {
      title: "关于同意深圳市中金岭南有色金属股份有限公司“NH”牌银锭注册的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260630_832348.html",
      source: "上海期货交易所",
      time: "2026-06-30"
    },
    {
      title: "关于同意山东省港口集团有限公司及下属青岛港国际物流有限公司增加集团交割业务的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260630_832336.html",
      source: "上海期货交易所",
      time: "2026-06-30"
    },
    {
      title: "关于对部分客户采取限制开仓监管措施的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260629_832331.html",
      source: "上海期货交易所",
      time: "2026-06-29"
    },
    {
      title: "关于对部分客户采取限制开仓监管措施的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260626_832311.html",
      source: "上海期货交易所",
      time: "2026-06-26"
    },
    {
      title: "关于对部分客户采取限制开仓监管措施的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260625_832296.html",
      source: "上海期货交易所",
      time: "2026-06-25"
    },
    {
      title: "上海国际能源交易中心发布关于20号胶期货境外地区升贴水的公告",
      url: "https://www.shfe.com.cn/publicnotice/notice/202606/t20260625_832285.html",
      source: "上海期货交易所",
      time: "2026-06-25"
    }
  ]
};

const DEFAULT_PRODUCT = "al";
const US_ALUMINUM_SYMBOL = "us_AA";
const PRODUCT_CONFIGS = {
  al: {
    key: "al",
    code: "AL",
    label: "沪铝",
    product: "沪铝期货",
    defaultSymbol: "nf_AL0",
    contractUnit: "5吨/手",
    priceUnit: "元/吨",
    sourceUrl: "https://gu.sina.cn/ft/hq/nf.php?symbol=AL0"
  },
  rb: {
    key: "rb",
    code: "RB",
    label: "螺纹钢",
    product: "螺纹钢期货",
    defaultSymbol: "nf_RB0",
    contractUnit: "10吨/手",
    priceUnit: "元/吨",
    sourceUrl: "https://gu.sina.cn/ft/hq/nf.php?symbol=RB0"
  }
};

const PRODUCT_ALIASES = {
  aluminum: "al",
  alu: "al",
  "沪铝": "al",
  "铝": "al",
  rebar: "rb",
  "螺纹": "rb",
  "螺纹钢": "rb"
};

const KLINE_INTERVALS = {
  "1h": { label: "1小时", source: "minute", type: 60, limit: 120 },
  "3h": { label: "3小时", source: "minute", type: 180, limit: 120 },
  "5h": { label: "5小时", source: "minute-aggregate", type: 60, hours: 5, limit: 120 },
  "1d": { label: "日线", source: "daily", limit: 120 },
  "1w": { label: "周线", source: "daily-aggregate", period: "week", limit: 120 },
  "1mo": { label: "月线", source: "daily-aggregate", period: "month", limit: 120 }
};

const INTERVAL_ALIASES = {
  hour: "1h",
  "1hour": "1h",
  "3hour": "3h",
  "5hour": "5h",
  day: "1d",
  daily: "1d",
  week: "1w",
  weekly: "1w",
  month: "1mo",
  monthly: "1mo"
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

let localAlDailyCache = null;
let newsCache = null;
let translationCache = new Map();
let articleSummaryCache = new Map();

function pad2(value) {
  return String(value).padStart(2, "0");
}

function normalizeProduct(product, fallback = DEFAULT_PRODUCT) {
  const clean = String(product || "").trim();
  const lower = clean.toLowerCase();
  if (PRODUCT_CONFIGS[lower]) return lower;
  if (PRODUCT_ALIASES[lower]) return PRODUCT_ALIASES[lower];

  const upper = clean.toUpperCase();
  const matched = Object.values(PRODUCT_CONFIGS).find((item) => item.code === upper);
  return matched?.key || fallback;
}

function productKeyForCode(code) {
  const clean = String(code || "").toUpperCase();
  const matched = Object.values(PRODUCT_CONFIGS).find((item) => item.code === clean);
  return matched?.key || "";
}

function productKeyFromSymbol(symbol) {
  const clean = String(symbol || "").trim().toUpperCase().replace(/^NF_/, "");
  const prefix = clean.match(/^([A-Z]+)/)?.[1] || "";
  return productKeyForCode(prefix);
}

function productConfig(productKey) {
  return PRODUCT_CONFIGS[productKey] || PRODUCT_CONFIGS[DEFAULT_PRODUCT];
}

function cacheControlForStatic(ext) {
  if (ext === ".html" || ext === ".js" || ext === ".css" || ext === ".webmanifest") {
    return "no-store";
  }
  return "public, max-age=3600";
}

function buildDefaultSymbols(productKey = DEFAULT_PRODUCT, now = new Date()) {
  const product = productConfig(productKey);
  const symbols = [product.defaultSymbol];
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  // SHFE futures contracts are monthly. After the 15th, the nearby
  // delivery month is usually expired, so start from the next month.
  if (now.getDate() > 15) {
    month += 1;
  }

  const contractYear = year + Math.floor((month - 1) / 12);
  const contractMonth = ((month - 1) % 12) + 1;
  const yy = String(contractYear).slice(-2);
  symbols.push(`nf_${product.code}${yy}${pad2(contractMonth)}`);

  if (productKey === "al") symbols.push(US_ALUMINUM_SYMBOL);

  return symbols;
}

function normalizeSymbol(symbol, productKey = "") {
  if (!symbol) return "";
  const clean = symbol.trim().toUpperCase();
  const usMatch = clean.match(/^US[_:-]?([A-Z.]+)$/) || clean.match(/^(AA)$/);
  if (usMatch) return `us_${usMatch[1]}`;

  const match = clean.match(/^NF_([A-Z]+)(0|\d{4})$/) || clean.match(/^([A-Z]+)(0|\d{4})$/);
  if (!match) return "";

  const inferredProduct = productKeyForCode(match[1]);
  if (!inferredProduct || (productKey && inferredProduct !== productKey)) return "";
  return `nf_${match[1]}${match[2]}`;
}

function normalizeInterval(interval) {
  const clean = String(interval || "1d").trim().toLowerCase();
  return KLINE_INTERVALS[clean] ? clean : INTERVAL_ALIASES[clean] || "1d";
}

function cleanSymbols(input, productKey = DEFAULT_PRODUCT) {
  const requested = input
    ? input.split(",").map((item) => item.trim()).filter(Boolean)
    : buildDefaultSymbols(productKey);

  return Array.from(new Set(requested.map((item) => normalizeSymbol(item, productKey)).filter(Boolean)));
}

function isUsEquitySymbol(symbol) {
  return /^us_[A-Z.]+$/i.test(String(symbol || ""));
}

function yahooTickerFromSymbol(symbol) {
  return isUsEquitySymbol(symbol) ? symbol.replace(/^us_/i, "").toUpperCase() : "";
}

function symbolToSinaCode(symbol) {
  if (isUsEquitySymbol(symbol)) return "";
  const normalized = normalizeSymbol(symbol);
  return normalized ? normalized.replace(/^nf_/, "") : "";
}

function isAlContinuousSymbol(symbol) {
  return symbolToSinaCode(symbol).toUpperCase() === "AL0";
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(raw) {
  if (!raw || raw.length < 6) return "";
  return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
}

function parseDateParts(date) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

function chinaTimestamp(value) {
  const normalized = value.includes(" ") ? value.replace(" ", "T") : `${value}T00:00:00`;
  return new Date(`${normalized}+08:00`).getTime();
}

function dateValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseRangeTimestamp(value, boundary = "start") {
  const clean = String(value || "").trim();
  if (!clean) return null;

  const dateOnly = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const time = boundary === "end" ? "23:59:59" : "00:00:00";
    return chinaTimestamp(`${clean} ${time}`);
  }

  const dateTime = clean.match(/^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateTime) return null;

  const seconds = dateTime[6] || "00";
  return chinaTimestamp(`${dateTime[1]}-${dateTime[2]}-${dateTime[3]} ${dateTime[4]}:${dateTime[5]}:${seconds}`);
}

function filterCandlesByRange(candles, startTs, endTs) {
  return candles.filter((candle) => {
    const ts = chinaTimestamp(candle.date);
    return (
      Number.isFinite(ts) &&
      (startTs === null || ts >= startTs) &&
      (endTs === null || ts <= endTs)
    );
  });
}

function isoWeekKey(date) {
  const { year, month, day } = parseDateParts(date);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayOfWeek);
  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNo = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  return `${weekYear}-W${pad2(weekNo)}`;
}

function parseSinaPayload(text) {
  const quotes = [];
  const matcher = /var\s+hq_str_([A-Za-z0-9_]+)="([^"]*)";/g;
  let match;

  while ((match = matcher.exec(text)) !== null) {
    const symbol = match[1];
    const fields = match[2].split(",");
    if (!fields[0] || fields.length < 18) continue;

    const last = numberOrNull(fields[8]) ?? numberOrNull(fields[5]);
    const previousSettlement = numberOrNull(fields[10]);
    const change = last !== null && previousSettlement !== null ? last - previousSettlement : null;
    const changePct =
      change !== null && previousSettlement ? (change / previousSettlement) * 100 : null;
    const date = fields[17] || "";
    const time = formatTime(fields[1]);

    quotes.push({
      symbol,
      code: symbol.replace(/^nf_/, ""),
      name: fields[0],
      exchange: fields[15] || "沪",
      product: fields[16] || "铝",
      date,
      time,
      timestamp: date && time ? `${date} ${time}` : "",
      isContinuous: /0$/i.test(symbol),
      isMain: fields[18] === "1",
      open: numberOrNull(fields[2]),
      high: numberOrNull(fields[3]),
      low: numberOrNull(fields[4]),
      close: numberOrNull(fields[5]),
      bid: numberOrNull(fields[6]),
      ask: numberOrNull(fields[7]),
      last,
      settlement: numberOrNull(fields[9]),
      previousSettlement,
      bidVolume: numberOrNull(fields[11]),
      askVolume: numberOrNull(fields[12]),
      volume: numberOrNull(fields[13]),
      openInterest: numberOrNull(fields[14]),
      averagePrice: numberOrNull(fields[27]),
      change,
      changePct,
      raw: fields
    });
  }

  return quotes;
}

function parseKlinePayload(text, mode = "daily") {
  const match = text.match(/=\s*\((\[[\s\S]*\])\)\s*;?\s*$/);
  if (!match) {
    throw new Error("K-line source returned an unexpected format.");
  }

  const rows = JSON.parse(match[1]);
  return rows
    .map((row) => {
      const base = {
        date: row.d,
        open: numberOrNull(row.o),
        high: numberOrNull(row.h),
        low: numberOrNull(row.l),
        close: numberOrNull(row.c),
        settlement: numberOrNull(row.s)
      };

      if (mode === "minute") {
        return {
          ...base,
          volume: numberOrNull(row.v),
          cumulativeVolume: numberOrNull(row.p),
          openInterest: null
        };
      }

      return {
        ...base,
        openInterest: numberOrNull(row.v),
        volume: numberOrNull(row.p)
      };
    })
    .filter(
      (row) =>
        row.date &&
        row.open !== null &&
        row.high !== null &&
        row.low !== null &&
        row.close !== null
    )
    .sort((a, b) => chinaTimestamp(a.date) - chinaTimestamp(b.date));
}

async function loadLocalAlDailyCandles() {
  if (localAlDailyCache) return localAlDailyCache;

  const raw = await fsp.readFile(LOCAL_AL_DAILY_PATH, "utf-8");
  const payload = JSON.parse(raw);
  const candles = Array.isArray(payload.candles) ? payload.candles : [];
  localAlDailyCache = candles
    .map((row) => ({
      date: row.date,
      open: numberOrNull(row.open),
      high: numberOrNull(row.high),
      low: numberOrNull(row.low),
      close: numberOrNull(row.close),
      volume: numberOrNull(row.volume),
      openInterest: numberOrNull(row.openInterest),
      settlement: numberOrNull(row.settlement),
      source: "local"
    }))
    .filter(
      (row) =>
        row.date &&
        row.open !== null &&
        row.high !== null &&
        row.low !== null &&
        row.close !== null
    )
    .sort((a, b) => chinaTimestamp(a.date) - chinaTimestamp(b.date));

  return localAlDailyCache;
}

function mergeCandlesByDate(...groups) {
  const byDate = new Map();
  for (const candles of groups) {
    for (const candle of candles) {
      byDate.set(candle.date, candle);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => chinaTimestamp(a.date) - chinaTimestamp(b.date));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(decodeHtml(href), baseUrl).toString();
  } catch (error) {
    return decodeHtml(href || "");
  }
}

function cleanNewsTitle(value) {
  return stripHtml(value)
    .replace(/\s*\|\s*[^|]+$/g, "")
    .trim();
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA",
      "Accept-Encoding": "identity",
      ...headers
    }
  });

  if (!response.ok) throw new Error(`News source returned HTTP ${response.status}`);
  return response.text();
}

function isAllowedNewsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return isPublicNewsHostname(url.hostname);
  } catch (error) {
    return false;
  }
}

function isPrivateIpv4(host) {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPublicNewsHostname(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  if (!host) return false;
  if (ALLOWED_NEWS_HOSTS.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (isPrivateIpv4(host)) return false;
  if (host.includes(":")) return false;

  return host.includes(".");
}

function normalizeArticleText(text) {
  return decodeHtml(String(text || ""))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToArticleText(html) {
  return normalizeArticleText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(p|div|br|li|h1|h2|h3|h4|tr|section|article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

async function fetchArticleText(rawUrl) {
  if (!isAllowedNewsUrl(rawUrl)) return "";
  const url = new URL(rawUrl);

  try {
    const html = url.hostname.endsWith("shfe.com.cn")
      ? await fetchShfeText(url.toString())
      : await fetchText(url.toString(), {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: `${url.protocol}//${url.hostname}/`
        });
    return htmlToArticleText(html).slice(0, ARTICLE_TEXT_MAX_CHARS);
  } catch (error) {
    return "";
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > REQUEST_BODY_MAX_BYTES) {
        reject(new Error("请求内容过大"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function extractOpenAIText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const chunks = [];
  for (const output of payload?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function fallbackArticleSummary(payload) {
  const title = payload.titleZh || payload.title || payload.originalTitle || "这条新闻";
  const description = payload.descriptionZh || payload.description || "";
  const basis = description ? `摘要依据：${description}` : "摘要依据：当前只能读取到标题，完整正文需打开原文查看。";
  return [
    `一句话总结：${title}`,
    "",
    basis,
    "",
    "市场关注：请结合原文、沪铝盘面、美元指数、库存和现货升贴水进一步确认。"
  ].join("\n");
}

async function summarizeArticleWithOpenAI(payload, articleText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY");

  const title = payload.title || payload.titleZh || payload.originalTitle || "新闻";
  const originalTitle = payload.originalTitle || "";
  const source = payload.source || "";
  const time = payload.time || "";
  const description = payload.description || "";
  const descriptionZh = payload.descriptionZh || "";
  const context = articleText || [descriptionZh, description].filter(Boolean).join("\n");

  const prompt = [
    "请用中文总结下面这条有色金属/铝行业相关新闻。",
    "要求：",
    "1. 不要编造正文没有的信息。",
    "2. 用中文输出，适合期货交易者快速阅读。",
    "3. 若正文不足，就明确说明基于标题/摘要判断。",
    "4. 输出格式固定为：一句话总结、核心要点、对沪铝/美铝的可能影响、需要继续跟踪。",
    "",
    `中文标题：${title}`,
    originalTitle ? `原标题：${originalTitle}` : "",
    source ? `来源：${source}` : "",
    time ? `时间：${time}` : "",
    description ? `原摘要：${description}` : "",
    descriptionZh ? `已有中文摘要：${descriptionZh}` : "",
    "",
    `正文/可读内容：\n${context || "未能读取到正文。"}`
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "你是专业、谨慎的有色金属期货新闻分析助手。只根据给定材料总结，全部使用中文。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_output_tokens: 900
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || `OpenAI API HTTP ${response.status}`);
  }

  const summary = extractOpenAIText(result);
  if (!summary) throw new Error("OpenAI API 未返回总结文本");
  return summary;
}

function cookieFromSetCookie(headers, name) {
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : String(headers.get("set-cookie") || "").split(/,\s*(?=[^;,]+=)/);
  const prefix = `${name}=`;
  const cookie = cookies.find((item) => item.trim().startsWith(prefix));
  return cookie ? cookie.trim().slice(prefix.length).split(";")[0] : "";
}

function hasLeadingZeroBits(buffer, bitCount) {
  for (let bit = 0; bit < bitCount; bit += 1) {
    const byte = buffer[Math.floor(bit / 8)];
    const mask = 1 << (7 - (bit % 8));
    if (byte & mask) return false;
  }
  return true;
}

function solveSafelineChallenge(prefix, leadingZeroBits) {
  for (let count = 0; count < 1000000; count += 1) {
    const suffix = count.toString(16);
    const hash = crypto.createHash("sha1").update(prefix + suffix).digest();
    if (hasLeadingZeroBits(hash, leadingZeroBits)) return suffix;
  }
  throw new Error("Unable to solve SHFE challenge.");
}

async function fetchShfeText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA",
      "Accept-Encoding": "identity"
    }
  });
  const html = await response.text();
  if (!html.includes("safeline_bot_challenge")) return html;

  const prefix = html.match(/var prefix = '([^']+)'/)?.[1] || "";
  const leadingZeroBits = Number(html.match(/var leading_zero_bit = (\d+)/)?.[1] || 0);
  const challenge = cookieFromSetCookie(response.headers, "safeline_bot_challenge");
  if (!prefix || !leadingZeroBits || !challenge) return html;

  const suffix = solveSafelineChallenge(prefix, leadingZeroBits);
  const verifiedResponse = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA",
      "Accept-Encoding": "identity",
      Cookie: `safeline_bot_challenge=${challenge}; safeline_bot_challenge_ans=${challenge}${suffix}`
    }
  });
  if (!verifiedResponse.ok) throw new Error(`SHFE returned HTTP ${verifiedResponse.status}`);
  return verifiedResponse.text();
}

function uniqueNewsItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function newsItemsWithFallback(sectionId, items) {
  const fallbackItems = NEWS_FALLBACKS[sectionId] || [];
  return uniqueNewsItems([...(items || []), ...fallbackItems]).slice(0, 10);
}

function parseSmmSearch(html) {
  const items = [];
  const matcher =
    /<a\s+target="_blank"\s+href="(https:\/\/news\.smm\.cn\/news\/\d+)">\s*<h3\s+title="([^"]+)"[\s\S]*?search_sourceLabel[^>]*>([\s\S]*?)<\/label>\s*<label>([\s\S]*?)<\/label>/g;
  let match;

  while ((match = matcher.exec(html)) !== null) {
    const title = cleanNewsTitle(match[2]);
    if (!title) continue;
    items.push({
      title,
      url: decodeHtml(match[1]),
      source: stripHtml(match[3]) || "上海有色网",
      time: stripHtml(match[4]),
      description: ""
    });
  }

  return uniqueNewsItems(items).slice(0, 10);
}

async function fetchSmmSearch(keyword) {
  const url = new URL(SMM_SEARCH_ENDPOINT);
  url.searchParams.set("keywords", keyword);
  const html = await fetchText(url.toString());
  return parseSmmSearch(html);
}

async function fetchSmmSearches(keywords) {
  const results = await Promise.allSettled(keywords.map((keyword) => fetchSmmSearch(keyword)));
  return uniqueNewsItems(results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))).slice(0, 10);
}

function parseShfeNotice(html) {
  const items = [];
  const matcher =
    /<div\s+class="table_item_info"[\s\S]*?<a\s+href="([^"]+)"[^>]*title="([^"]+)"[\s\S]*?<\/a>[\s\S]*?<div\s+class="info_item_date">\s*([^<]+)\s*<\/div>/g;
  let match;

  while ((match = matcher.exec(html)) !== null) {
    const title = cleanNewsTitle(match[2]);
    if (!title) continue;
    items.push({
      title,
      url: absoluteUrl(match[1], SHFE_NOTICE_URL),
      source: "上海期货交易所",
      time: stripHtml(match[3]),
      description: ""
    });
  }

  const relevant = items.filter((item) =>
    /铝|有色|金属|保证金|涨跌停|交割|仓库|期货|期权|监管/.test(item.title)
  );
  return uniqueNewsItems(relevant.length >= 5 ? relevant : items).slice(0, 10);
}

async function fetchShfeNotices() {
  return parseShfeNotice(await fetchShfeText(SHFE_NOTICE_URL));
}

function tagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeHtml(match[1]).trim() : "";
}

function excerptText(text, maxLength = 360) {
  const normalized = stripHtml(text).replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength);
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}...`;
}

async function parseYahooRss(xml) {
  const rawItems = [];
  const matcher = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = matcher.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = cleanNewsTitle(tagValue(itemXml, "title"));
    const url = tagValue(itemXml, "link");
    const description = excerptText(tagValue(itemXml, "description"));
    if (!title || !url) continue;
    rawItems.push({
      title,
      url,
      source: "Yahoo Finance",
      time: tagValue(itemXml, "pubDate"),
      description
    });
  }

  const items = await Promise.all(
    rawItems.slice(0, 10).map(async (item) => ({
      ...item,
      titleZh: await translateAlcoaTitleDynamic(item.title),
      descriptionZh: translateAlcoaDescription(item.description)
    }))
  );

  return uniqueNewsItems(items).slice(0, 10);
}

async function fetchAlcoaNews() {
  return await parseYahooRss(await fetchText(YAHOO_AA_NEWS_RSS));
}

function compactTitle(title) {
  return String(title || "")
    .replace(/【[^】]*】/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function displayNewsTitle(sectionId, item) {
  if (sectionId === "alcoa" && item?.titleZh) return item.titleZh;
  return item?.title || "";
}

function buildSectionSummary(title, items, sectionId = "") {
  if (!items.length) return `${title}暂无可用新闻，稍后可刷新重试。`;
  const themes = items
    .slice(0, 3)
    .map((item) => compactTitle(displayNewsTitle(sectionId, item)))
    .filter(Boolean);
  return `${title}最新关注：${themes.join("；")}。`;
}

function hasChineseText(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function normalizeTranslation(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：！？、])/g, "$1")
    .replace(/([（《])\s+/g, "$1")
    .replace(/\s+([）》])/g, "$1")
    .trim();
}

async function translateAlcoaTitleDynamic(title) {
  const text = compactTitle(title);
  if (!text) return "";
  if (hasChineseText(text)) return text;

  const cacheKey = `alcoa-title:${text.toLowerCase()}`;
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fallback = translateAlcoaTitle(text);
  const url = new URL(TRANSLATE_ENDPOINT);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", "zh-CN");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA"
      }
    });
    if (!response.ok) throw new Error(`Translate returned HTTP ${response.status}`);
    const payload = await response.json();
    const translated = normalizeTranslation(
      Array.isArray(payload?.[0]) ? payload[0].map((part) => part?.[0] || "").join("") : ""
    );
    const value = hasChineseText(translated) ? translated : fallback;
    translationCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS
    });
    return value;
  } catch (error) {
    translationCache.set(cacheKey, {
      value: fallback,
      expiresAt: Date.now() + NEWS_CACHE_TTL_MS
    });
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function translateAlcoaTitle(title) {
  const text = compactTitle(title);
  if (!text) return "";
  const companyName = (value) =>
    String(value || "")
      .replace(/\bAlcoa Corporation\b/gi, "美铝公司")
      .replace(/\bAlcoa\b/gi, "美铝")
      .replace(/\bAA\b/g, "美铝")
      .trim();

  const optionQuestion = text.match(/^Do Options Traders Know Something About\s+(.+?)\s+Stock We Don't\??$/i);
  if (optionQuestion) {
    return `期权交易者是否知道一些关于${companyName(optionQuestion[1])}股票的市场信号？`;
  }

  const managementTeam = text.match(/^(.+?)\s+strengthens management team$/i);
  if (managementTeam) {
    return `${companyName(managementTeam[1])}加强管理团队。`;
  }

  const undervalued = text.match(/^(.+?)\s+Stock May Be\s+([\d.]+)%\s+Undervalued As\s+(.+?)\s+Project Starts$/i);
  if (undervalued) {
    return `随着${companyName(undervalued[3])}项目启动，${companyName(undervalued[1])}股票可能被低估 ${undervalued[2]}%。`;
  }

  const supplyChainOrders = text.match(/^Trump Signs Orders On Aluminum And Defense Supply Chains\s+[—-]\s+(.+?)\s+Stocks In Focus$/i);
  if (supplyChainOrders) {
    return `特朗普签署关于铝和国防供应链的命令，${supplyChainOrders[1]} 等股票受到关注。`;
  }

  const companyNews = text.match(/^Company News for\s+(.+)$/i);
  if (companyNews) {
    return `${companyNews[1]}公司新闻。`;
  }

  if (/Acquire South32/i.test(text) || /Buy South32/i.test(text)) {
    return "美铝拟收购 South32 的铝土矿、氧化铝和铝资产，市场关注交易价格与整合影响。";
  }
  if (/South32 agrees/i.test(text)) {
    return "South32 同意向美铝出售铝相关资产，交易将扩大美铝上游资源布局。";
  }
  if (/Strategic Acquisition/i.test(text)) {
    return "美铝宣布战略性收购 South32 铝相关资产，意在增强铝产业链竞争力。";
  }
  if (/Shares Drop|shares fall|AA Stock Falling/i.test(text)) {
    return "美铝股价在收购消息后走弱，投资者正在重新评估交易成本和短期压力。";
  }
  if (/\$4 Trillion|M&A Wave/i.test(text)) {
    return "全球并购活动升温，市场关注大型交易潮对资源和工业板块的影响。";
  }
  if (/Constellium/i.test(text)) {
    return "铝加工企业 Constellium 的航空与交通业务表现强劲，反映铝需求端仍有支撑。";
  }
  if (/premarket/i.test(text)) {
    return "美股盘前异动显示，市场继续消化美铝和相关工业股消息。";
  }
  return text
    .replace(/\bAlcoa Corporation\b/gi, "美铝公司")
    .replace(/\bAlcoa\b/gi, "美铝")
    .replace(/\baluminum\b/gi, "铝")
    .replace(/\baluminium\b/gi, "铝")
    .replace(/\balumina\b/gi, "氧化铝")
    .replace(/\bbauxite\b/gi, "铝土矿")
    .replace(/\bassets\b/gi, "资产")
    .replace(/\bshares\b/gi, "股价");
}

function translateAlcoaDescription(description) {
  const text = stripHtml(description).trim();
  if (!text) return "";
  if (/acquire South32|South32 Limited/i.test(text)) {
    return "美铝宣布收购 South32 的铝土矿、氧化铝和铝资产，交易包含现金、股票及潜在或有对价，重点影响在于上游资源扩张和资产整合。";
  }
  if (/declined|drop|fall/i.test(text)) {
    return "消息公布后，美铝股价承压，市场主要关注收购成本、融资安排以及短期盈利摊薄风险。";
  }
  if (/demand|shipment|revenue/i.test(text)) {
    return "铝需求端仍有支撑，航空、交通和工业应用的出货及收入表现是市场关注点。";
  }
  return translateAlcoaTitle(text);
}

function cleanChineseSentence(text) {
  return String(text || "")
    .replace(/[。；;.\s]+$/g, "")
    .trim();
}

function buildOverallSummary(sections) {
  const parts = sections
    .map(
      (section) =>
        section.items[0]?.title &&
        `${section.title}看点为${compactTitle(displayNewsTitle(section.id, section.items[0]))}`
    )
    .filter(Boolean);
  return parts.length
    ? `今日总览：${parts.join("；")}。`
    : "今日总览暂无可用新闻，稍后可刷新重试。";
}

async function buildNewsPayload() {
  const now = Date.now();
  if (newsCache && now - newsCache.cachedAt < NEWS_CACHE_TTL_MS) return newsCache.payload;

  const [todayResult, closeResult, noticeResult, alcoaResult] = await Promise.allSettled([
    fetchSmmSearches(["沪铝", "铝"]),
    fetchSmmSearch("沪铝 收盘评论"),
    fetchShfeNotices(),
    fetchAlcoaNews()
  ]);

  const sections = [
    {
      id: "today",
      title: "今天",
      sourceLabel: "沪铝相关新闻",
      moreUrl: `${SMM_SEARCH_ENDPOINT}?keywords=${encodeURIComponent("沪铝")}`,
      items: newsItemsWithFallback("today", todayResult.status === "fulfilled" ? todayResult.value : [])
    },
    {
      id: "close",
      title: "收盘评论",
      sourceLabel: "沪铝收盘评论",
      moreUrl: `${SMM_SEARCH_ENDPOINT}?keywords=${encodeURIComponent("沪铝 收盘评论")}`,
      items: newsItemsWithFallback("close", closeResult.status === "fulfilled" ? closeResult.value : [])
    },
    {
      id: "exchange",
      title: "交易所公告",
      sourceLabel: "上期所公告",
      moreUrl: SHFE_NOTICE_URL,
      items: newsItemsWithFallback("exchange", noticeResult.status === "fulfilled" ? noticeResult.value : [])
    },
    {
      id: "alcoa",
      title: "美铝",
      sourceLabel: "Alcoa / AA 新闻",
      moreUrl: "https://finance.yahoo.com/quote/AA/news/",
      items: alcoaResult.status === "fulfilled" ? alcoaResult.value : []
    }
  ].map((section) => ({
    ...section,
    summary: buildSectionSummary(section.title, section.items, section.id),
    summaryZh:
      section.id === "alcoa"
        ? `中文翻译：${[...new Set(section.items
            .slice(0, 3)
            .map((item) => cleanChineseSentence(item.titleZh || translateAlcoaTitle(item.title)))
            .filter(Boolean)
          )].join("；")}。`
        : "",
    items: section.items.slice(0, 10)
  }));

  const payload = {
    fetchedAt: new Date().toISOString(),
    summary: buildOverallSummary(sections),
    sections,
    errors: [
      todayResult,
      closeResult,
      noticeResult,
      alcoaResult
    ]
      .map((result, index) =>
        result.status === "rejected"
          ? { section: ["today", "close", "exchange", "alcoa"][index], error: result.reason.message }
          : null
      )
      .filter(Boolean)
  };

  newsCache = { cachedAt: now, payload };
  return payload;
}

async function loadAlContinuousDailyCandles(symbol) {
  const localCandles = await loadLocalAlDailyCandles();
  let onlineTail = [];

  try {
    const text = await fetchDailyKline(symbol);
    onlineTail = parseKlinePayload(text, "daily")
      .filter((candle) => candle.date > LOCAL_AL_DAILY_END)
      .map((candle) => ({ ...candle, source: "online" }));
  } catch (error) {
    onlineTail = [];
  }

  return mergeCandlesByDate(localCandles, onlineTail);
}

function aggregateCandles(candles, keyFor) {
  const groups = new Map();

  for (const candle of candles) {
    const key = keyFor(candle);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candle);
  }

  return Array.from(groups.values()).map((items) => {
    const first = items[0];
    const last = items[items.length - 1];
    return {
      date: last.date,
      periodStart: first.date,
      periodEnd: last.date,
      open: first.open,
      high: Math.max(...items.map((item) => item.high)),
      low: Math.min(...items.map((item) => item.low)),
      close: last.close,
      volume: items.reduce((sum, item) => sum + (item.volume || 0), 0),
      cumulativeVolume: last.cumulativeVolume ?? null,
      openInterest: last.openInterest ?? null,
      settlement: last.settlement ?? null
    };
  });
}

async function fetchSinaText(url, encoding = "gb18030") {
  const response = await fetch(url, {
    headers: {
      Referer: SINA_REFERER,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA"
    }
  });

  if (!response.ok) {
    throw new Error(`Data source returned HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder(encoding);
  return decoder.decode(buffer);
}

async function fetchYahooChart(symbol, interval, startTs, endTs) {
  const ticker = yahooTickerFromSymbol(symbol);
  if (!ticker) throw new Error("Invalid Yahoo Finance symbol.");

  const period1 = Math.floor((startTs ?? Date.now() - 30 * 86400000) / 1000);
  const period2 = Math.floor((endTs ?? Date.now()) / 1000);
  const yahooInterval = interval === "1h" ? "60m" : "1d";
  const url = new URL(`${YAHOO_CHART_ENDPOINT}${encodeURIComponent(ticker)}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(Math.max(period2, period1 + 3600)));
  url.searchParams.set("interval", yahooInterval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "history");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 SHFE-Aluminum-PWA"
    }
  });
  if (!response.ok) throw new Error(`Yahoo Finance returned HTTP ${response.status}`);

  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(payload.chart?.error?.description || "Yahoo Finance returned no data.");

  return result;
}

function formatDateInTimeZone(seconds, timeZone, includeTime = false) {
  const date = new Date(seconds * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: includeTime ? "2-digit" : undefined,
    minute: includeTime ? "2-digit" : undefined,
    hour12: false
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return includeTime ? `${day} ${parts.hour}:${parts.minute}` : day;
}

function yahooChartToCandles(result, interval) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const timeZone = result.meta?.exchangeTimezoneName || "America/New_York";
  const includeTime = interval === "1h";

  return timestamps
    .map((timestamp, index) => ({
      date: formatDateInTimeZone(timestamp, timeZone, includeTime),
      open: numberOrNull(quote.open?.[index]),
      high: numberOrNull(quote.high?.[index]),
      low: numberOrNull(quote.low?.[index]),
      close: numberOrNull(quote.close?.[index]),
      volume: numberOrNull(quote.volume?.[index]),
      openInterest: null,
      settlement: null
    }))
    .filter(
      (row) =>
        row.date &&
        row.open !== null &&
        row.high !== null &&
        row.low !== null &&
        row.close !== null
    )
    .sort((a, b) => chinaTimestamp(a.date) - chinaTimestamp(b.date));
}

async function fetchYahooQuote(symbol) {
  const endTs = Date.now();
  const startTs = endTs - 10 * 86400000;
  const result = await fetchYahooChart(symbol, "1d", startTs, endTs);
  const candles = yahooChartToCandles(result, "1d");
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const meta = result.meta || {};
  const last = numberOrNull(meta.regularMarketPrice) ?? latest?.close ?? null;
  const previousClose = previous?.close ?? numberOrNull(meta.chartPreviousClose);
  const change = last !== null && previousClose !== null ? last - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;

  return {
    symbol,
    code: yahooTickerFromSymbol(symbol),
    name: "美铝",
    exchange: meta.fullExchangeName || meta.exchangeName || "NYSE",
    product: "Alcoa Corporation",
    date: latest?.date || "",
    time: "",
    timestamp: latest?.date || "",
    isContinuous: false,
    isMain: false,
    open: latest?.open ?? null,
    high: numberOrNull(meta.regularMarketDayHigh) ?? latest?.high ?? null,
    low: numberOrNull(meta.regularMarketDayLow) ?? latest?.low ?? null,
    close: latest?.close ?? null,
    bid: null,
    ask: null,
    last,
    settlement: null,
    previousSettlement: previousClose,
    bidVolume: null,
    askVolume: null,
    volume: numberOrNull(meta.regularMarketVolume) ?? latest?.volume ?? null,
    openInterest: null,
    averagePrice: null,
    change,
    changePct,
    priceUnit: "美元/股",
    raw: []
  };
}

async function fetchQuotes(symbols) {
  const list = symbols.map((symbol) => encodeURIComponent(symbol)).join(",");
  return fetchSinaText(`${SINA_QUOTE_ENDPOINT}${list}`);
}

async function fetchDailyKline(symbol) {
  const code = symbolToSinaCode(symbol);
  if (!code) throw new Error("Invalid futures symbol.");

  const variableName = `_${code}_day`;
  const url = `${SINA_KLINE_ENDPOINT}/var%20${encodeURIComponent(
    variableName
  )}=/InnerFuturesNewService.getDailyKLine?symbol=${encodeURIComponent(code)}`;

  return fetchSinaText(url, "utf-8");
}

async function fetchMinuteKline(symbol, type) {
  const code = symbolToSinaCode(symbol);
  if (!code) throw new Error("Invalid futures symbol.");

  const variableName = `_${code}_${type}`;
  const url = `${SINA_KLINE_ENDPOINT}/var%20${encodeURIComponent(
    variableName
  )}=/InnerFuturesNewService.getFewMinLine?symbol=${encodeURIComponent(
    code
  )}&type=${encodeURIComponent(type)}`;

  return fetchSinaText(url, "utf-8");
}

async function loadKline(symbol, intervalKey, startTs = null, endTs = null) {
  const config = KLINE_INTERVALS[intervalKey];

  if (isUsEquitySymbol(symbol)) {
    const result = await fetchYahooChart(symbol, intervalKey, startTs, endTs);
    return yahooChartToCandles(result, intervalKey);
  }

  if (config.source === "minute") {
    const text = await fetchMinuteKline(symbol, config.type);
    return parseKlinePayload(text, "minute");
  }

  if (config.source === "minute-aggregate") {
    const text = await fetchMinuteKline(symbol, config.type);
    const candles = parseKlinePayload(text, "minute");
    const bucketMs = config.hours * 60 * 60 * 1000;
    return aggregateCandles(candles, (candle) => Math.floor(chinaTimestamp(candle.date) / bucketMs));
  }

  const candles = isAlContinuousSymbol(symbol)
    ? await loadAlContinuousDailyCandles(symbol)
    : parseKlinePayload(await fetchDailyKline(symbol), "daily");

  if (config.source === "daily-aggregate" && config.period === "week") {
    return aggregateCandles(candles, (candle) => isoWeekKey(candle.date));
  }

  if (config.source === "daily-aggregate" && config.period === "month") {
    return aggregateCandles(candles, (candle) => candle.date.slice(0, 7));
  }

  return candles;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function handleQuote(req, res, url) {
  try {
    const productKey = normalizeProduct(url.searchParams.get("product"));
    const product = productConfig(productKey);
    const symbols = cleanSymbols(url.searchParams.get("symbols"), productKey);
    if (symbols.length === 0) {
      sendJson(res, 400, { error: "No valid symbols requested." });
      return;
    }

    const futuresSymbols = symbols.filter((symbol) => !isUsEquitySymbol(symbol));
    const usSymbols = symbols.filter(isUsEquitySymbol);
    const futuresQuotes = futuresSymbols.length
      ? parseSinaPayload(await fetchQuotes(futuresSymbols)).map((quote, index) => ({
          ...quote,
          name:
            quote.symbol === product.defaultSymbol
              ? productKey === "al"
                ? "铝主连"
                : `${product.label}主连`
              : quote.name || quote.code,
          priceUnit: product.priceUnit,
          watchOrder: symbols.indexOf(quote.symbol) >= 0 ? symbols.indexOf(quote.symbol) : index
        }))
      : [];
    const usQuotes = await Promise.all(
      usSymbols.map(async (symbol) => ({
        ...(await fetchYahooQuote(symbol)),
        watchOrder: symbols.indexOf(symbol)
      }))
    );
    const quotes = [...futuresQuotes, ...usQuotes].sort((a, b) => a.watchOrder - b.watchOrder);

    sendJson(res, 200, {
      productKey,
      product: product.product,
      productLabel: product.label,
      defaultSymbol: product.defaultSymbol,
      exchange: "上海期货交易所",
      contractUnit: product.contractUnit,
      priceUnit: product.priceUnit,
      source: "新浪财经期货行情接口",
      sourceUrl: product.sourceUrl,
      fetchedAt: new Date().toISOString(),
      requestedSymbols: symbols,
      quotes
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "行情源暂时不可用",
      detail: error.message
    });
  }
}

async function handleKline(req, res, url) {
  try {
    const requestedSymbol = url.searchParams.get("symbol");
    const productKey = normalizeProduct(
      url.searchParams.get("product"),
      productKeyFromSymbol(requestedSymbol) || DEFAULT_PRODUCT
    );
    const product = productConfig(productKey);
    const symbol = normalizeSymbol(requestedSymbol || product.defaultSymbol, productKey);
    const normalizedInterval = normalizeInterval(url.searchParams.get("interval"));
    const interval = normalizedInterval === "1h" ? "1h" : "1d";
    const config = KLINE_INTERVALS[interval];
    const today = dateValue(new Date());
    const startTs =
      parseRangeTimestamp(url.searchParams.get("start"), "start") ??
      parseRangeTimestamp(KLINE_MIN_DATE, "start");
    const endTs =
      parseRangeTimestamp(url.searchParams.get("end"), "end") ??
      parseRangeTimestamp(today, "end");
    const requestedLimit = Number(url.searchParams.get("limit") || KLINE_MAX_BARS);
    const limit = clamp(Number.isFinite(requestedLimit) ? requestedLimit : KLINE_MAX_BARS, 30, KLINE_MAX_BARS);
    const usesLocalAlDaily =
      isAlContinuousSymbol(symbol) &&
      (config.source === "daily" || config.source === "daily-aggregate");

    if (!symbol) {
      sendJson(res, 400, { error: "No valid futures symbol requested." });
      return;
    }

    const candles = await loadKline(symbol, interval, startTs, endTs);
    const rangedCandles = filterCandlesByRange(candles, startTs, endTs);
    const limitedCandles = rangedCandles.slice(-limit);
    const isUsEquity = isUsEquitySymbol(symbol);
    sendJson(res, 200, {
      productKey,
      product: isUsEquity ? "Alcoa Corporation" : product.product,
      productLabel: isUsEquity ? "美铝" : product.label,
      symbol,
      code: isUsEquity ? yahooTickerFromSymbol(symbol) : symbolToSinaCode(symbol),
      interval,
      intervalLabel: config.label,
      priceUnit: isUsEquity ? "美元/股" : product.priceUnit,
      source:
        isUsEquity
          ? "Yahoo Finance 美股图表接口"
          : usesLocalAlDaily
          ? "本地 DATA 沪铝历史日线 + 新浪财经增量 K 线接口"
          : config.source.includes("aggregate")
          ? "新浪财经期货 K 线接口，服务端聚合"
          : "新浪财经期货 K 线接口",
      localDataEnd: usesLocalAlDaily ? LOCAL_AL_DAILY_END : "",
      fetchedAt: new Date().toISOString(),
      total: candles.length,
      rangeTotal: rangedCandles.length,
      limit,
      requestedStart: url.searchParams.get("start") || KLINE_MIN_DATE,
      requestedEnd: url.searchParams.get("end") || today,
      availableStart: candles[0]?.date || "",
      availableEnd: candles[candles.length - 1]?.date || "",
      candles: limitedCandles
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "K线数据暂时不可用",
      detail: error.message
    });
  }
}

async function handleNews(req, res) {
  try {
    sendJson(res, 200, await buildNewsPayload());
  } catch (error) {
    sendJson(res, 502, {
      error: "新闻源暂时不可用",
      detail: error.message
    });
  }
}

async function handleArticleSummary(req, res) {
  try {
    const rawBody = await readRequestBody(req);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const originalUrl = String(payload.url || "").trim();

    if (!isAllowedNewsUrl(originalUrl)) {
      sendJson(res, 400, {
        error: "不支持的新闻链接",
        detail: "只能总结快讯页内已知新闻源的 http/https 链接。"
      });
      return;
    }

    const cacheKey = `${OPENAI_MODEL}:${originalUrl}:${payload.title || ""}:${payload.description || ""}`;
    const cached = articleSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      sendJson(res, 200, cached.value);
      return;
    }

    const articleText = await fetchArticleText(originalUrl);
    let summary = "";
    let usedAi = true;
    let warning = "";

    try {
      summary = await summarizeArticleWithOpenAI(payload, articleText);
    } catch (error) {
      usedAi = false;
      warning = error.message;
      summary = fallbackArticleSummary(payload);
    }

    const result = {
      title: payload.title || payload.titleZh || payload.originalTitle || "新闻详情",
      source: payload.source || "",
      time: payload.time || "",
      originalUrl,
      summary,
      usedAi,
      model: OPENAI_MODEL,
      articleChars: articleText.length,
      warning,
      fetchedAt: new Date().toISOString()
    };

    articleSummaryCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + ARTICLE_SUMMARY_CACHE_TTL_MS
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, {
      error: "新闻总结失败",
      detail: error.message
    });
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const ext = path.extname(finalPath).toLowerCase();
    const stream = fs.createReadStream(finalPath);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      "Cache-Control": cacheControlForStatic(ext)
    });
    stream.pipe(res);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "shfe-futures-app",
      time: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/quote") {
    handleQuote(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/kline") {
    handleKline(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/news") {
    handleNews(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/article-summary") {
    handleArticleSummary(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`SHFE futures app is running at http://localhost:${PORT}`);
});
