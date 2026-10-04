const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { NewsStore, SECTIONS, REGIONS, publicationTime } = require("./lib/news-store");
const { NewsCollector } = require("./lib/news-collector");
const { createNewsSources, fetchPublicText } = require("./lib/news-sources");

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
const SHFE_NOTICE_URL = "https://www.shfe.com.cn/publicnotice/notice/";
const KLINE_MIN_DATE = "2005-01-01";
const KLINE_MAX_BARS = 30000;
const TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const JINA_READER_PREFIX = "https://r.jina.ai/http://r.jina.ai/http://";
const TRANSLATION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const ARTICLE_SUMMARY_PROMPT_VERSION = "briefing-v3";
const ARTICLE_SUMMARY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ARTICLE_TEXT_MAX_CHARS = 30000;
const ARTICLE_TRANSLATION_TEXT_MAX_CHARS = 22000;
const OPENAI_SUMMARY_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_SUMMARY_MAX_OUTPUT_TOKENS || 3200);
const OPENAI_TRANSLATION_MAX_OUTPUT_TOKENS = Number(
  process.env.OPENAI_TRANSLATION_MAX_OUTPUT_TOKENS || 9000
);
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
    .replace(/&ldquo;|&#8220;/g, "“")
    .replace(/&rdquo;|&#8221;/g, "”")
    .replace(/&lsquo;|&#8216;/g, "‘")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&nbsp;/g, " ")
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

function cleanReaderArticleText(text) {
  return markdownToPlainText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !isReaderNoiseLine(line)
    )
    .join("\n");
}

function markdownToPlainText(text) {
  return normalizeArticleText(text)
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\s+([，。；：！？、,.!?%％])/g, "$1")
    .replace(/([（(])\s+/g, "$1")
    .replace(/\s+([）)])/g, "$1")
    .trim();
}

function isReaderNoiseLine(line) {
  return (
    /^(Title|URL Source|Published Time|Markdown Content|Warning|Images?|Links?|Buttons?)\s*:/i.test(line) ||
    /^This page maybe not yet fully loaded/i.test(line) ||
    /^Oops, something went wrong$/i.test(line) ||
    /^Skip to /i.test(line) ||
    /^Yahoo Finance$/i.test(line) ||
    /^Tip: Try a valid symbol/i.test(line) ||
    /^Trending Tickers$/i.test(line) ||
    /^Trade Alcoa on Coinbase$/i.test(line) ||
    /^Learn more$/i.test(line) ||
    /^Playback speed$/i.test(line) ||
    /^Quality$/i.test(line) ||
    /^Auto$/i.test(line) ||
    /^Back$/i.test(line) ||
    /^(\d+(\.\d+)?x|1080p|720p|360p|240p|144p|\/)$/i.test(line) ||
    /^[A-Z0-9^=-]{1,12}\s+[-+]?\d[\d,.]*\s*\([-+]?\d/.test(line) ||
    /^\d+$/.test(line)
  );
}

function titleFromReaderText(text) {
  return normalizeArticleText(text).match(/^Title:\s*(.+)$/im)?.[1]?.trim() || "";
}

function cropReaderMarkdownToArticle(text, url) {
  const normalized = normalizeArticleText(text);
  const host = url.hostname.toLowerCase();
  const title = titleFromReaderText(normalized);
  let start = -1;
  let end = normalized.length;

  if (title) {
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const heading = new RegExp(`\\n#{1,3}\\s*${escapedTitle}\\s*\\n`, "i");
    const match = heading.exec(normalized.slice(300));
    if (match) start = 300 + match.index;
  }

  if (host === "finance.yahoo.com") {
    const yahooStarts = [
      /\nInvestors in \*\*Alcoa Corporation\*\*/i,
      /\nInvestors in Alcoa Corporation/i,
      /\nClearly, options traders/i,
      /\nWhat is Implied Volatility\?/i
    ];
    for (const pattern of yahooStarts) {
      const match = pattern.exec(normalized);
      if (match) {
        start = match.index;
        break;
      }
    }
  }

  if (start < 0 && host.includes("proactiveinvestors.com")) {
    const proactiveStart = /\n\[[^\]]+]\([^)]+\)\s+has strengthened/i.exec(normalized);
    if (proactiveStart) start = proactiveStart.index;
  }

  const cropped = start >= 0 ? normalized.slice(start) : normalized;
  const endPatterns = [
    /\nView comments/i,
    /\nRelated Quotes/i,
    /\nRecommended Stories/i,
    /\nMost Read/i,
    /\nAdvertisement/i,
    /\nShare this article/i,
    /\nWatch/i,
    /\nSign in/i,
    /\nWant the latest/i,
    /\nThis article originally appeared/i
  ];
  for (const pattern of endPatterns) {
    const match = pattern.exec(cropped);
    if (match && match.index > 300) {
      end = Math.min(end, match.index);
    }
  }

  return cropped.slice(0, end);
}

function extractSmmArticleText(html) {
  const blocks = [];
  const matcher =
    /<div\s+class=["'][^"']*newsDetailArticleContent[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = matcher.exec(String(html || ""))) !== null) {
    const text = htmlToArticleText(match[1]);
    if (text.length > 80 && !/扫码|会议|广告|下载/.test(text.slice(0, 80))) {
      blocks.push(text);
    }
  }
  return blocks[0] || "";
}

async function fetchArticleText(rawUrl) {
  if (!isAllowedNewsUrl(rawUrl)) return "";
  const url = new URL(rawUrl);
  let directText = "";

  try {
    const html = url.hostname.endsWith("shfe.com.cn")
      ? await fetchShfeText(url.toString())
      : await fetchText(url.toString(), {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: `${url.protocol}//${url.hostname}/`
        });
    const smmText = url.hostname === "news.smm.cn" ? extractSmmArticleText(html) : "";
    if (smmText) return smmText.slice(0, ARTICLE_TEXT_MAX_CHARS);
    directText = htmlToArticleText(html).slice(0, ARTICLE_TEXT_MAX_CHARS);
  } catch (error) {
    directText = "";
  }

  if (directText.length >= 1200) return directText;

  try {
    const rawReaderText = await fetchText(`${JINA_READER_PREFIX}${url.toString()}`, {
        Accept: "text/plain, text/markdown, */*"
      });
    const readerText = cleanReaderArticleText(cropReaderMarkdownToArticle(rawReaderText, url)).slice(
      0,
      ARTICLE_TEXT_MAX_CHARS
    );
    return readerText.length > directText.length ? readerText : directText;
  } catch (error) {
    return directText;
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

async function fallbackArticleSummary(payload, articleText = "") {
  const title = payload.titleZh || payload.title || payload.originalTitle || "这条新闻";
  const description = payload.descriptionZh || payload.description || "";
  const isAlcoa = isAlcoaArticlePayload(payload);
  const leadSummary = isAlcoa
    ? await translateAlcoaFallbackText(buildFallbackLeadSummary(payload, articleText, description))
    : buildFallbackLeadSummary(payload, articleText, description);
  const rawDataPoints = extractArticleDataPoints(payload, articleText);
  const dataPoints = isAlcoa
    ? await Promise.all(rawDataPoints.map((point) => translateAlcoaFallbackText(point)))
    : rawDataPoints;
  return ensureDetailedSummary(
    [
      "文章总结：",
      leadSummary,
      "",
      "主要数据与信息点：",
      dataPoints.length
        ? dataPoints.map((point) => `- ${point}`).join("\n")
        : "- 当前可读内容没有提取到明确数字，需打开原文核对价格、涨跌幅、库存、产量、公司经营或政策表述。",
      "",
      "交易解读：",
      "这条信息需要结合沪铝盘面、伦铝或美铝相关资产表现、美元指数、库存变化、现货升贴水和政策口径一起观察。重点不是只看标题方向，而是把文章中提到的时间、价格、涨跌幅、产量、库存、订单、政策或公司经营数据放回铝价供需逻辑里判断。",
      "",
      "后续关注：",
      "- 继续跟踪盘面成交量、持仓变化、库存数据、现货升贴水、美元走势和官方公告。"
    ]
      .filter(Boolean)
      .join("\n"),
    payload,
    articleText
  );
}

function articleSentences(text) {
  return normalizeArticleText(text)
    .replace(/([。！？!?])\s*/g, "$1\n")
    .split(/\n+/)
    .map((line) => cleanChineseSentence(line).trim())
    .filter(Boolean)
    .filter((line) => line.length >= 14)
    .filter((line) => !isArticleNoiseSentence(line))
    .map((line) => `${line}。`);
}

function buildFallbackLeadSummary(payload, articleText = "", description = "") {
  const title = payload.titleZh || payload.title || payload.originalTitle || "这条新闻";
  const sentences = articleSentences(articleText || description);
  if (!sentences.length) {
    return `${title}。当前只能读取到标题或摘要，完整正文需打开原文核对。`;
  }

  const selected = sentences.slice(0, isAlcoaArticlePayload(payload) ? 4 : 5);
  if (isAlcoaArticlePayload(payload)) {
    for (const sentence of sentences) {
      if (!/Zacks|Rank|Bottom|60 days|earnings|analysts|implied volatility|\$\d|Call|Strong Sell/i.test(sentence)) {
        continue;
      }
      if (!selected.includes(sentence)) selected.push(sentence);
      if (selected.length >= 8) break;
    }
  }
  const lead = selected.join("");
  const context =
    "从交易角度看，这类信息需要拆成宏观风险、供应扰动、需求韧性、库存变化和资金情绪几条线索观察，不能只按标题判断方向。";
  return `${title}。${lead}${lead.length < 220 ? context : ""}`;
}

function normalizeSummaryText(value) {
  return normalizeArticleText(value)
    .replace(/^(一句话总结|摘要|总结|中文总结)\s*[:：]\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractArticleDataPoints(payload, articleText = "") {
  const sourceText = normalizeArticleText(
    [
      payload.titleZh,
      payload.title,
      payload.originalTitle,
      payload.descriptionZh,
      payload.description,
      articleText
    ]
      .filter(Boolean)
      .join("\n")
  );
  const titleKeys = [
    payload.titleZh,
    payload.title,
    payload.originalTitle
  ]
    .filter(Boolean)
    .map((item) => cleanChineseSentence(item).toLowerCase());
  const candidates = splitTextToInfoLines(sourceText)
    .map((line, index) => ({
      text: cleanChineseSentence(line).trim(),
      index
    }))
    .filter((item) => item.text)
    .filter((item) => !titleKeys.includes(item.text.toLowerCase()))
    .map((item) => ({
      ...item,
      score: articleDataPointScore(item.text)
    }))
    .filter(Boolean)
    .filter((item) => item.text.length >= 12 && item.text.length <= 360)
    .filter((item) => !isArticleNoiseSentence(item.text))
    .filter((item) =>
      /(\d|%|％|美元|美金|元|吨|万吨|手|股|库存|产量|价格|涨|跌|成交|持仓|公司|项目|公告|政策|关税|期权|Alcoa|AA|沪铝|伦铝|LME|SHFE)/i.test(
        item.text
      )
    )
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const line = item.text;
    const key = line.toLowerCase().replace(/\s+/g, " ").slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
    if (unique.length >= 10) break;
  }
  return unique;
}

function splitTextToInfoLines(text) {
  return normalizeArticleText(text)
    .replace(/(\d)\.(\d)/g, "$1__DOT__$2")
    .replace(/\b(Sept|Sep|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Oct|Nov|Dec)\./gi, "$1__DOT__")
    .split(/[\n。！？!?；;]+|\.\s+(?=[A-Z])/)
    .map((line) => line.replace(/__DOT__/g, ".").trim())
    .filter(Boolean);
}

function articleDataPointScore(line) {
  let score = 0;
  if (/[%％]|\$\d|美元|元\/吨|万吨|吨|个百分点|basis points?/i.test(line)) score += 5;
  if (/\b(20\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|days?|日|月|年)\b/i.test(line)) {
    score += 3;
  }
  if (/Zacks|Rank|Strong Sell|Bottom|analysts?|earnings|estimate|implied volatility|options?|Call|Put/i.test(line)) {
    score += 4;
  }
  if (/库存|产量|供应|需求|开工|进口|出口|社库|复产|关税|冲突|美联储|加息|期权|隐含波动率|评级/i.test(line)) {
    score += 3;
  }
  if (!/\d/.test(line)) score -= 2;
  return score;
}

function isArticleNoiseSentence(line) {
  return /扫码|登录|下载|声明|免责声明|仅供参考|访问TA|暂无简介|Trade Alcoa|Coinbase|Trading disclosure|free report|Free Stock Analysis|download 7 Best|Click to get|Yahoo Finance|Zacks Equity Research|Image \d|Skip to|Oops, something went wrong/i.test(
    String(line || "")
  );
}

function ensureDetailedSummary(summary, payload, articleText = "") {
  const text = normalizeSummaryText(summary);
  if (text.length >= 200) return text;

  const title = payload.titleZh || payload.title || payload.originalTitle || "这条新闻";
  const sourceText = normalizeArticleText(
    articleText || [payload.descriptionZh, payload.description].filter(Boolean).join("\n")
  ).slice(0, 700);
  const extra = sourceText
    ? `\n\n补充信息：文章可读内容还包括：${sourceText}。整理这条新闻时，应重点留意其中出现的时间、价格、涨跌幅、公司名称、项目进展、库存、产量、政策或市场预期等信息，并把这些信息放到沪铝、美铝和铝产业链供需逻辑里判断。`
    : ` ${title}目前可读信息有限，详情页需要打开原文继续核对。后续应重点关注原文中的时间、价格、涨跌幅、产量、库存、公司经营、项目进展、政策表述、成交量和持仓变化等信息，再判断它对沪铝、美铝和产业链情绪的影响。`;
  return normalizeSummaryText(`${text} ${extra}`);
}

async function translateFallbackSummaryIfNeeded(payload, summary) {
  const text = normalizeSummaryText(summary);
  if (!isAlcoaArticlePayload(payload)) return text;
  const englishLetters = (text.match(/[a-z]/gi) || []).length;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (englishLetters < 80 || chineseChars > englishLetters * 1.2) return text;

  try {
    const translated = await translateTextDynamic(text, "en", "fallback-summary");
    return hasChineseText(translated) ? normalizeSummaryText(translated) : text;
  } catch (error) {
    return text;
  }
}

async function translateAlcoaFallbackText(text) {
  const cleanText = normalizeSummaryText(text);
  const englishLetters = (cleanText.match(/[a-z]/gi) || []).length;
  if (englishLetters < 8) return cleanText;

  try {
    const translated = await translateTextDynamic(cleanText, "en", "alcoa-fallback-line");
    return polishAlcoaTranslation(hasChineseText(translated) ? translated : cleanText);
  } catch (error) {
    return cleanText;
  }
}

function polishAlcoaTranslation(text) {
  return normalizeSummaryText(text)
    .replace(/美国铝业 \(Alcoa\)/g, "美铝")
    .replace(/美国铝业公司/g, "美铝")
    .replace(/强劲销售/g, "强烈卖出")
    .replace(/巨大的隐含波动可能意味着贸易正在发展/g, "较高的隐含波动率可能意味着新的交易机会正在形成")
    .replace(/巨大的隐含波动可能意味着交易正在发展/g, "较高的隐含波动率可能意味着新的交易机会正在形成")
    .replace(/它捕捉到了衰退/g, "它试图赚取波动率回落带来的期权溢价")
    .replace(/金属产品 - 分销/g, "金属产品-分销")
    .replace(/美铝\s+在/g, "美铝在")
    .replace(/AA股/g, "AA 股票")
    .replace(/当前季度的 Zacks 共识估计从每股 ([\d.]+) 美元增至该时期的 ([\d.]+) 美元/g, (match, from, to) =>
      Number(from) > Number(to)
        ? `当前季度的 Zacks 一致预期从每股 ${from} 美元降至 ${to} 美元`
        : match
    )
    .replace(/从每股 ([\d.]+) 美元增至(?:该时期的 )?([\d.]+) 美元/g, (match, from, to) =>
      Number(from) > Number(to) ? `从每股 ${from} 美元降至 ${to} 美元` : match
    )
    .replace(/\bAA 股\b/g, "AA 股票")
    .replace(/\s+([，。；：！？、])/g, "$1");
}

function isAlcoaArticlePayload(payload) {
  const section = String(payload.section || "").toLowerCase();
  const source = String(payload.source || "").toLowerCase();
  const combined = [
    payload.title,
    payload.titleZh,
    payload.originalTitle,
    payload.description,
    payload.url
  ]
    .join(" ")
    .toLowerCase();
  return (
    section === "alcoa" ||
    source.includes("yahoo finance") ||
    combined.includes("alcoa") ||
    combined.includes("美铝") ||
    /\baa\b/.test(combined)
  );
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
    "请把下面这条有色金属/铝行业相关新闻整理成一份给期货交易者看的中文精读。",
    "要求：",
    "1. 不要编造正文没有的信息。",
    "2. 不是写短摘要，而是要像研究员读完文章后做信息整理，适合期货交易者快速判断。",
    "3. 若正文不足，就明确说明基于标题/摘要判断。",
    "4. 必须按下面四个栏目输出，栏目名必须保留：文章总结、主要数据与信息点、交易解读、后续关注。",
    "5. 文章总结必须不少于 200 个中文字符，可以写 300-800 字；先讲清楚文章发生了什么，再讲为什么重要。",
    "6. 主要数据与信息点必须列出原文出现的重要数字、价格、百分比、日期、公司名、项目名、地点、产量、库存、成交/持仓、政策或市场预期；如果原文没有明确数据，要写“原文未披露明确数字”。",
    "7. 交易解读要说明这条新闻可能怎样影响沪铝、美铝或铝产业链情绪，不能泛泛而谈，要围绕供给、需求、库存、成本、宏观风险或资金情绪。",
    "8. 后续关注列出 2-5 个需要继续跟踪的变量。",
    "9. 不要输出免责声明，不要说自己是 AI，不要添加原文没有的数据。",
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
      max_output_tokens: OPENAI_SUMMARY_MAX_OUTPUT_TOKENS
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || `OpenAI API HTTP ${response.status}`);
  }

  const summary = extractOpenAIText(result);
  if (!summary) throw new Error("OpenAI API 未返回总结文本");
  return ensureDetailedSummary(summary, payload, articleText);
}

async function translateArticleWithOpenAI(payload, articleText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("未配置 OPENAI_API_KEY");

  const context = normalizeArticleText(articleText || payload.description || payload.descriptionZh || "");
  if (!context) return "";

  const title = payload.originalTitle || payload.title || payload.titleZh || "Alcoa news";
  const prompt = [
    "请把下面这篇美铝/铝行业英文新闻的可读正文完整翻译成中文。",
    "要求：",
    "1. 这是全文翻译，不是摘要，不要省略文章中的主要段落。",
    "2. 保留所有数字、百分比、金额、日期、股票代码、公司名称、项目名称和地点信息。",
    "3. 遇到明显的导航、广告、订阅提示、版权提示、按钮文字或无关网页噪音，可以忽略。",
    "4. 只输出中文译文，不要添加小标题、点评或免责声明。",
    "",
    `标题：${title}`,
    "",
    `正文：\n${context.slice(0, ARTICLE_TRANSLATION_TEXT_MAX_CHARS)}`
  ].join("\n");

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
            "你是专业金融新闻译者，擅长把英文铝行业、上市公司和大宗商品新闻准确翻译成中文。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_output_tokens: OPENAI_TRANSLATION_MAX_OUTPUT_TOKENS
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || `OpenAI API HTTP ${response.status}`);
  }

  return normalizeArticleText(extractOpenAIText(result));
}

async function fetchShfeText(url) {
  return fetchPublicText(url);
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

function splitTextForTranslation(text, maxLength = 2600) {
  const sentences = normalizeArticleText(text)
    .replace(/([。！？!?])\s*/g, "$1\n")
    .split(/\n+/)
    .filter(Boolean);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxLength) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length > maxLength) {
      if (current) chunks.push(current);
      for (let index = 0; index < sentence.length; index += maxLength) {
        chunks.push(sentence.slice(index, index + maxLength));
      }
      continue;
    }
    current = current ? `${current}\n${sentence}` : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateTextDynamic(text, sourceLang = "auto", cacheNamespace = "text") {
  const cleanText = normalizeArticleText(text);
  if (!cleanText) return "";

  const cacheKey = `${cacheNamespace}:${sourceLang}:${crypto
    .createHash("sha1")
    .update(cleanText)
    .digest("hex")}`;
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const chunks = splitTextForTranslation(cleanText);
  const translatedChunks = [];
  for (const chunk of chunks) {
    const url = new URL(TRANSLATE_ENDPOINT);
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", sourceLang);
    url.searchParams.set("tl", "zh-CN");
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", chunk);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
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
      translatedChunks.push(
        normalizeTranslation(
          Array.isArray(payload?.[0]) ? payload[0].map((part) => part?.[0] || "").join("") : ""
        )
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  const translated = translatedChunks.join("\n").trim();
  translationCache.set(cacheKey, {
    value: translated,
    expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS
  });
  return translated;
}

function cleanChineseSentence(text) {
  return String(text || "")
    .replace(/[。；;.\s]+$/g, "")
    .trim();
}

const newsStore = new NewsStore({
  directory: process.env.NEWS_DATA_DIR || path.join(__dirname, "var", "news"),
  configured: Boolean(process.env.NEWS_DATA_DIR),
  persistent: process.env.NEWS_STORAGE_PERSISTENT === "true" ? true : process.env.RENDER ? false : null,
  publicDirectory: PUBLIC_DIR
});
let newsCollector;
const newsReady = newsStore.init().then(() => {
  newsCollector = new NewsCollector({
    store: newsStore,
    sources: createNewsSources(),
    intervalMs: process.env.NEWS_POLL_INTERVAL_MS || 60000,
    timeoutMs: process.env.NEWS_SOURCE_TIMEOUT_MS || 15000
  });
  if (process.env.NEWS_COLLECTION_DISABLED !== "true") newsCollector.start();
});

async function buildNewsPayload() {
  await newsReady;
  const labels = { today: "铝业资讯", close: "收盘评论", exchange: "交易所公告", alcoa: "美铝", macro: "宏观政策" };
  const urls = { today: "https://news.smm.cn/keywords/%E9%93%9D", close: "https://news.smm.cn/keywords/%E6%B2%AA%E9%93%9D", exchange: SHFE_NOTICE_URL, alcoa: "https://news.alcoa.com/", macro: "https://www.federalreserve.gov/feeds/feeds.htm" };
  const status = newsCollector.status();
  return {
    ...newsStore.query({ latest: true, pageSize: 5 }), ...status,
    fetchedAt: status.checkedAt,
    summary: "新闻按来源发布时间排序；检查时间不代表新闻发布时间。",
    sections: SECTIONS.map((id) => ({
      id, title: labels[id], sourceLabel: labels[id], moreUrl: urls[id], summary: "", summaryZh: "",
      items: newsStore.query({ section: id, pageSize: 10 }).items.map((item) => ({
        ...item,
        time: item.timePrecision === "day" ? item.publishedDate : item.publishedAt || item.time
      }))
    })),
    errors: status.sources.filter((source) => source.status === "error").map((source) => ({ section: source.id, error: source.error }))
  };
}

async function handleNewsQuery(req, res, url) {
  await newsReady;
  const params = url.searchParams;
  const latest = url.pathname === "/api/news/latest";
  const section = params.get("section") || "";
  const region = params.get("region") || "";
  if (region && !REGIONS.includes(region)) {
    sendJson(res, 400, { error: "未知新闻地域" });
    return;
  }
  if (section && !SECTIONS.includes(section)) {
    sendJson(res, 400, { error: "未知新闻分类" });
    return;
  }
  for (const key of ["from", "to"]) {
    const value = params.get(key);
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !publicationTime(value).publishedAt)) {
      sendJson(res, 400, { error: `${key} 日期必须为有效的 YYYY-MM-DD` });
      return;
    }
  }
  if (params.get("from") && params.get("to") && params.get("from") > params.get("to")) {
    sendJson(res, 400, { error: "开始日期不能晚于结束日期" });
    return;
  }
  const result = newsStore.query({
    latest, region, section: latest ? "" : section,
    q: latest ? "" : params.get("q") || "",
    from: latest ? "" : params.get("from") || "", to: latest ? "" : params.get("to") || "",
    page: latest ? 1 : params.get("page") || 1,
    pageSize: latest ? params.get("limit") || 5 : params.get("pageSize") || 20
  });
  const groups = latest ? Object.fromEntries(REGIONS.map((id) => [id,
    newsStore.query({ latest: true, region: id, pageSize: 5 })
  ])) : undefined;
  sendJson(res, 200, { ...result, ...(groups ? { groups } : {}), ...newsCollector.status() });
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

    const cacheKey = `${ARTICLE_SUMMARY_PROMPT_VERSION}:${OPENAI_MODEL}:${originalUrl}:${payload.title || ""}:${payload.description || ""}`;
    const cached = articleSummaryCache.get(cacheKey);
    if (!payload.noCache && cached && cached.expiresAt > Date.now()) {
      sendJson(res, 200, cached.value);
      return;
    }

    const articleText = await fetchArticleText(originalUrl);
    let summary = "";
    let usedAi = true;
    let warning = "";
    let translationZh = "";
    let usedTranslationAi = false;
    let translationWarning = "";
    const needsTranslation = isAlcoaArticlePayload({ ...payload, url: originalUrl });

    try {
      summary = await summarizeArticleWithOpenAI(payload, articleText);
    } catch (error) {
      usedAi = false;
      warning = error.message;
      summary = await fallbackArticleSummary(payload, articleText);
    }

    if (needsTranslation) {
      try {
        translationZh = await translateArticleWithOpenAI(payload, articleText);
        usedTranslationAi = Boolean(translationZh);
      } catch (error) {
        translationWarning = error.message;
      }
    }

    const result = {
      title: payload.title || payload.titleZh || payload.originalTitle || "新闻详情",
      source: payload.source || "",
      time: payload.time || "",
      originalUrl,
      summary,
      translationZh,
      usedAi,
      usedTranslationAi,
      model: OPENAI_MODEL,
      articleChars: articleText.length,
      needsTranslation,
      warning,
      translationWarning,
      fetchedAt: new Date().toISOString()
    };

    if (!payload.noCache) {
      articleSummaryCache.set(cacheKey, {
        value: result,
        expiresAt: Date.now() + ARTICLE_SUMMARY_CACHE_TTL_MS
      });
    }
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

  if (req.method === "GET" && ["/api/news/latest", "/api/news/history"].includes(url.pathname)) {
    handleNewsQuery(req, res, url).catch((error) => sendJson(res, 500, { error: "新闻读取失败", detail: error.message }));
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
  console.log(`SHFE futures app is running at http://localhost:${server.address().port}`);
});

async function shutdownNews() {
  await newsReady;
  await newsCollector.stop();
  server.close();
}
process.once("SIGTERM", shutdownNews);
process.once("SIGINT", shutdownNews);
