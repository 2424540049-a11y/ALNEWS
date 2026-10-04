const { publicationTime } = require("./news-store");

const SMM_AL_URL = "https://news.smm.cn/keywords/%E9%93%9D";
const SMM_SHAL_URL = "https://news.smm.cn/keywords/%E6%B2%AA%E9%93%9D";
const SHFE_URL = "https://www.shfe.com.cn/publicnotice/notice/";
const ALCOA_RSS = "https://news.alcoa.com/rss/pressrelease.aspx";
const YAHOO_RSS = "https://feeds.finance.yahoo.com/rss/2.0/headline?s=AA&region=US&lang=en-US";
const FED_MONETARY_RSS = "https://www.federalreserve.gov/feeds/press_monetary.xml";
const FED_SPEECHES_RSS = "https://www.federalreserve.gov/feeds/speeches.xml";
const LME_NEWS_URL = "https://www.lme.com/News";

function cleanText(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ").trim();
}

async function fetchPublicText(url, { signal, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    signal: signal || AbortSignal.timeout(12000),
    headers: { "User-Agent": "SHFE-Aluminum-PWA/1.0", Accept: "application/rss+xml,application/xml,text/html;q=0.9,*/*;q=0.5" }
  });
  if (!response.ok) throw new Error(`新闻源 HTTP ${response.status}`);
  const maxBytes = 4 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("新闻源响应过大");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("新闻源响应过大");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (/safeline_bot_challenge|cf-chl-|captcha-container|访问验证|人机验证/i.test(text)) {
    throw new Error("新闻源要求浏览器验证，已停止本次采集");
  }
  return text;
}

function parseSmmPage(html) {
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error("SMM 页面结构已变化，未找到新闻数据");
  const data = JSON.parse(match[1]);
  const list = data?.props?.pageProps?.keywordsListProps?.newsListList;
  if (!Array.isArray(list)) throw new Error("SMM 新闻字段已变化");
  return list.map((item) => {
    const title = cleanText(item.title);
    const sections = ["today"];
    if (/收盘|日评|机构评论/.test(title)) sections.push("close");
    return {
      title, url: item.newsUrl || item.url || (item.newsId ? `https://news.smm.cn/news/${item.newsId}` : ""),
      source: cleanText(item.source) || "上海有色网", sections,
      // pubDate is the publisher's Unix timestamp. updateTime and relative display text are not publication times.
      time: item.pubDate ? String(item.pubDate) : "",
      description: cleanText(item.profile).slice(0, 1000)
    };
  }).filter((item) => item.title && item.url);
}

function xmlTag(block, tag) {
  return cleanText(block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

function parseRss(xml, sourceLabel, { sections = [] } = {}) {
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml)) throw new Error("新闻源未返回有效 RSS");
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => ({
    title: xmlTag(match[1], "title"), url: xmlTag(match[1], "link"),
    source: sourceLabel, time: xmlTag(match[1], "pubDate"),
    description: xmlTag(match[1], "description").slice(0, 1000), sections: [...sections]
  })).filter((item) => item.title && item.url);
}

function parseShfeNotices(html) {
  const items = [];
  const matcher = /<div\s+class=["']table_item_info["'][\s\S]*?<a\s+href=["']([^"']+)["'][^>]*title=["']([^"']+)["'][\s\S]*?<\/a>[\s\S]*?<div\s+class=["']info_item_date["']>\s*([^<]+)\s*<\/div>/gi;
  for (const match of html.matchAll(matcher)) {
    const time = cleanText(match[3]);
    items.push({ title: cleanText(match[2]), url: new URL(match[1], SHFE_URL).toString(), source: "上海期货交易所", time, timePrecision: publicationTime(time).timePrecision, sections: ["exchange"] });
  }
  if (!items.length) throw new Error("上期所页面未找到公告，可能暂不可用或页面结构已变化");
  return items;
}

function createNewsSources({ fetchText = fetchPublicText } = {}) {
  return [
    { id: "smm-al", label: "上海有色网 · 铝", region: "domestic", section: "today", url: SMM_AL_URL, load: async (options) => parseSmmPage(await fetchText(SMM_AL_URL, options)) },
    { id: "smm-shal", label: "上海有色网 · 沪铝", region: "domestic", section: "today", url: SMM_SHAL_URL, load: async (options) => parseSmmPage(await fetchText(SMM_SHAL_URL, options)) },
    { id: "shfe", label: "上期所公告", region: "domestic", section: "exchange", url: SHFE_URL, load: async (options) => parseShfeNotices(await fetchText(SHFE_URL, options)) },
    { id: "alcoa", label: "美铝官方新闻", region: "international", section: "alcoa", url: ALCOA_RSS, load: async (options) => parseRss(await fetchText(ALCOA_RSS, options), "Alcoa 官方", { sections: ["alcoa"] }) },
    { id: "yahoo-aa", label: "Yahoo Finance · 美铝", region: "international", section: "alcoa", url: YAHOO_RSS, load: async (options) => parseRss(await fetchText(YAHOO_RSS, options), "Yahoo Finance", { sections: ["alcoa"] }) },
    { id: "fed-monetary", label: "美联储 · 货币政策", region: "international", section: "macro", url: FED_MONETARY_RSS, load: async (options) => parseRss(await fetchText(FED_MONETARY_RSS, options), "美联储 · 货币政策", { sections: ["macro"] }) },
    { id: "fed-speeches", label: "美联储 · 官员讲话", region: "international", section: "macro", url: FED_SPEECHES_RSS, load: async (options) => parseRss(await fetchText(FED_SPEECHES_RSS, options), "美联储 · 官员讲话", { sections: ["macro"] }) },
    { id: "lme", label: "LME 官方公告", region: "international", section: "exchange", url: LME_NEWS_URL, disabled: "LME 官网要求浏览器验证，自动采集暂不可用；请通过官方公告入口查看。" }
  ];
}

module.exports = { createNewsSources, fetchPublicText, parseSmmPage, parseRss, parseShfeNotices };
