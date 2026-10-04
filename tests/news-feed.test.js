const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness() {
  const elements = new Map();
  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const listeners = new Map();
    const classes = new Set();
    const node = {
      innerHTML: "", textContent: "", value: "", hidden: false, disabled: false,
      addEventListener: (type, handler) => listeners.set(type, handler),
      setAttribute() {},
      classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
      emit: type => listeners.get(type)?.({ preventDefault() {} }),
      reset() { for (const field of ["#nf-region", "#nf-section", "#nf-query", "#nf-from", "#nf-to"]) element(field).value = ""; }
    };
    elements.set(selector, node);
    return node;
  }
  const root = { innerHTML: "", querySelector: element };
  const document = {
    hidden: false, getElementById: () => root,
    addEventListener: (name, fn) => { document[name] = fn; }
  };
  const calls = [];
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  const context = {
    window: {}, document, URL, URLSearchParams, AbortController, Intl, Date,
    setInterval: (fn, delay) => { const id = ++timerId; intervals.set(id, { fn, delay }); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: fn => { const id = ++timerId; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id),
    fetch(url, options) {
      return new Promise((resolve, reject) => calls.push({ url, options, reject,
        resolve: payload => resolve({ ok: true, json: async () => payload })
      }));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/news-feed.js"), "utf8"), context);
  return { feed: context.window.ALNewsFeed, element, calls, intervals, timeouts, document, root };
}

function item(title, overrides = {}) {
  return { title, url: "https://example.com/news", source: "新闻来源", section: "today",
    publishedAt: "2026-10-04T01:02:00Z", publishedDate: "2026-10-04", timePrecision: "minute", ...overrides };
}

function payload(items, overrides = {}) {
  return { items, total: items.length, page: 1, pageSize: 20, hasMore: false,
    checkedAt: "2026-10-04T02:03:00Z", collecting: false,
    sources: [{ id: "example", label: "来源", status: "ok", lastSuccessAt: "2026-10-04T02:03:00Z", itemCount: items.length }],
    storage: { mode: "file", configured: false, persistent: false, writable: true }, ...overrides };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("latest is limited to five, safely links the reader, and does not use check time as publication time", async () => {
  const h = harness();
  h.feed.activate();
  h.feed.activate();
  assert.equal(h.calls.length, 1, "re-activation must not duplicate an in-flight request");
  assert.equal(h.intervals.size, 1);
  assert.equal([...h.intervals.values()][0].delay, 30000);
  h.calls[0].resolve(payload([
    item("English", { titleZh: "中文标题<script>alert(1)</script>" }),
    item("时间未知", { publishedAt: null, timePrecision: "unknown" }),
    item("无效链接", { url: "javascript:alert(1)" }),
    item("只有日期", { publishedAt: null, timePrecision: "day" }),
    item("第五条"), item("第六条"), item("第七条")
  ]));
  await settle();
  const html = h.element(".nf-list").innerHTML;
  assert.equal((html.match(/class="nf-card"/g) || []).length, 5);
  assert.match(html, /中文标题&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|第六条|第七条|javascript:|target=/);
  assert.match(html, /href="\/news-reader\.html\?/);
  assert.match(html, /2026\/10\/04 09:02/);
  assert.match(html, /发布时间未标明/);
  assert.doesNotMatch(html, /10:03/);
  assert.match(html, /仅提供日期/);
  assert.match(h.element(".nf-storage").textContent, /尚未启用持久磁盘/);
});

test("archive stays stable during polling and rejects stale responses from older filters", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([item("最新") ]));
  await settle();
  h.element('[data-nf-mode="history"]').emit("click");
  assert.match(h.calls[1].url, /\/api\/news\/history\?/);
  assert.match(h.calls[1].url, /pageSize=20/);
  h.calls[1].resolve(payload([item("原有历史") ]));
  await settle();
  const before = h.element(".nf-list").innerHTML;
  [...h.intervals.values()][0].fn();
  h.calls[2].resolve(payload([item("刷新后的最新") ]));
  await settle();
  assert.equal(h.element(".nf-list").innerHTML, before);
  h.element("#nf-query").value = "旧条件";
  h.element(".nf-filters").emit("submit");
  h.element("#nf-query").value = "新条件";
  h.element(".nf-filters").emit("submit");
  assert.equal(h.calls[3].options.signal.aborted, true);
  h.calls[4].resolve(payload([item("新条件结果") ]));
  await settle();
  h.calls[3].resolve(payload([item("过期响应") ]));
  await settle();
  assert.match(h.element(".nf-list").innerHTML, /新条件结果/);
  assert.doesNotMatch(h.element(".nf-list").innerHTML, /过期响应/);
});

test("failed refresh preserves content and hidden pages stop polling", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([item("保留的新闻") ]));
  await settle();
  const before = h.element(".nf-list").innerHTML;
  h.feed.refresh();
  h.calls[1].reject(new Error("Network unavailable"));
  await settle();
  assert.equal(h.element(".nf-list").innerHTML, before);
  assert.match(h.element(".nf-error").textContent, /已保留上次结果/);
  assert.equal(h.element(".nf-error").hidden, false);
  h.feed.refresh();
  h.document.hidden = true;
  h.document.visibilitychange();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.calls[2].options.signal.aborted, true);
  h.feed.refresh();
  assert.equal(h.calls.length, 3);
  h.document.hidden = false;
  h.document.visibilitychange();
  assert.equal(h.calls.length, 4);
  assert.equal(h.intervals.size, 1);
  h.feed.deactivate();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.calls[3].options.signal.aborted, true);
});

test("date validation and pagination use explicit archive actions, and interrupted searches resume", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([item("最新") ]));
  await settle();
  h.element('[data-nf-mode="history"]').emit("click");
  h.calls[1].resolve(payload([item("第一页面") ], { total: 42, hasMore: true }));
  await settle();
  h.element("[data-nf-next]").emit("click");
  assert.match(h.calls[2].url, /page=2(?:&|$)/);
  h.calls[2].resolve(payload([item("第二页面") ], { total: 42, page: 2, hasMore: true }));
  await settle();
  assert.match(h.element(".nf-page-info").textContent, /第 2 \/ 3 页/);
  h.element("#nf-from").value = "2026-10-04";
  h.element("#nf-to").value = "2026-10-01";
  h.element(".nf-filters").emit("submit");
  assert.equal(h.calls.length, 3);
  assert.match(h.element(".nf-error").textContent, /开始日期不能晚于/);
  h.element("#nf-to").value = "2026-10-05";
  h.element(".nf-filters").emit("submit");
  assert.match(h.calls[3].url, /page=1(?:&|$)/);
  h.document.hidden = true;
  h.document.visibilitychange();
  h.document.hidden = false;
  h.document.visibilitychange();
  assert.match(h.calls[5].url, /from=2026-10-04&to=2026-10-05/);
  h.calls[5].resolve(payload([item("恢复的筛选结果") ]));
  await settle();
  assert.match(h.element(".nf-list").innerHTML, /恢复的筛选结果/);
});

test("long Chinese summaries keep reader links below common request-header limits", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([item("市场资讯标题", { description: "铝价市场快讯".repeat(400) })]));
  await settle();
  const html = h.element(".nf-list").innerHTML;
  const href = html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&");
  assert.ok(href.length < 6000);
  const query = new URL(href, "https://example.com").searchParams;
  assert.equal(query.get("description").length, 240);
  assert.ok(html.match(/<p class="nf-summary">(.*?)<\/p>/)[1].length <= 241);
});

test("latest displays independent domestic and international groups with five stories each", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([item("旧的混合列表不应显示")], {
    groups: {
      domestic: { items: Array.from({ length: 7 }, (_, index) => item(`国内消息${index + 1}`, { region: "domestic" })) },
      international: { items: Array.from({ length: 6 }, (_, index) => item(`国外消息${index + 1}`, { region: "international", section: "macro" })) }
    }
  }));
  await settle();
  const html = h.element(".nf-list").innerHTML;
  assert.equal((html.match(/class="nf-region-group"/g) || []).length, 2);
  assert.equal((html.match(/class="nf-card"/g) || []).length, 10);
  const [domestic, international] = html.split('aria-labelledby="nf-heading-international"');
  assert.match(domestic, /国内快讯.*?国内消息1/s);
  assert.doesNotMatch(domestic, /国外消息|国内消息6|国内消息7/);
  assert.match(international, /国外快讯.*?国外消息1/s);
  assert.match(international, /宏观政策/);
  assert.doesNotMatch(international, /国内消息|国外消息6/);
  assert.doesNotMatch(html, /旧的混合列表不应显示/);
  assert.match(h.element(".nf-status").textContent, /国内、国外各显示最新 5 条/);
});

test("legacy payloads keep region-aware stories visible and an empty region does not hide the other", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([
    item("上期所通知", { sourceId: "shfe", section: "exchange" }),
    item("美铝快讯", { sourceId: "yahoo-aa", section: "alcoa" }),
    item("海外经济数据", { region: "international", section: "macro" })
  ]));
  await settle();
  let [domestic, international] = h.element(".nf-list").innerHTML.split('aria-labelledby="nf-heading-international"');
  assert.match(domestic, /上期所通知/);
  assert.doesNotMatch(domestic, /美铝快讯|海外经济数据/);
  assert.match(international, /美铝快讯/);
  assert.match(international, /海外经济数据/);
  h.feed.refresh();
  h.calls[1].resolve(payload([], { groups: {
    domestic: { items: [] }, international: { items: [item("国外保留", { region: "international" })] }
  }}));
  await settle();
  [domestic, international] = h.element(".nf-list").innerHTML.split('aria-labelledby="nf-heading-international"');
  assert.match(domestic, /暂无标注明确发布时间/);
  assert.match(international, /国外保留/);
});

test("region, category, search and date filters survive archive pagination and clear together", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].resolve(payload([]));
  await settle();
  h.element('[data-nf-mode="history"]').emit("click");
  h.calls[1].resolve(payload([]));
  await settle();
  h.element("#nf-region").value = "international";
  h.element("#nf-section").value = "macro";
  h.element("#nf-query").value = " 利率 ";
  h.element("#nf-from").value = "2026-10-01";
  h.element(".nf-filters").emit("submit");
  let query = new URL(h.calls[2].url, "https://example.com").searchParams;
  assert.equal(query.get("region"), "international");
  assert.equal(query.get("section"), "macro");
  assert.equal(query.get("q"), "利率");
  assert.equal(query.get("from"), "2026-10-01");
  h.calls[2].resolve(payload([item("讲话", { region: "international", section: "macro" })], { total: 21, hasMore: true }));
  await settle();
  assert.doesNotMatch(h.element(".nf-list").innerHTML, /nf-region-group/);
  assert.match(h.element(".nf-list").innerHTML, /nf-region-label">国外/);
  h.element("[data-nf-next]").emit("click");
  query = new URL(h.calls[3].url, "https://example.com").searchParams;
  assert.equal(query.get("page"), "2");
  assert.equal(query.get("region"), "international");
  assert.equal(query.get("section"), "macro");
  assert.equal(query.get("q"), "利率");
  h.calls[3].resolve(payload([item("第二页")], { total: 21, page: 2 }));
  await settle();
  h.element("[data-nf-reset]").emit("click");
  query = new URL(h.calls[4].url, "https://example.com").searchParams;
  for (const field of ["region", "section", "q", "from", "to"]) assert.equal(query.get(field), "");
  assert.equal(query.get("page"), "1");
});

test("initial request failures keep both sections and EODHD only offers an external purchase link", async () => {
  const h = harness();
  h.feed.activate();
  h.calls[0].reject(new Error("Network unavailable"));
  await settle();
  assert.equal((h.element(".nf-list").innerHTML.match(/class="nf-region-group"/g) || []).length, 2);
  assert.match(h.element(".nf-list").innerHTML, /列表尚未加载成功/);
  assert.match(h.root.innerHTML, /可选新闻源 · EODHD/);
  assert.match(h.root.innerHTML, /19\.99 美元\/月/);
  assert.match(h.root.innerHTML, /199 美元\/年/);
  assert.match(h.root.innerHTML, /未启用/);
  assert.match(h.root.innerHTML, /href="https:\/\/eodhd\.com\/pricing" target="_blank" rel="noopener noreferrer"/);
  assert.match(h.root.innerHTML, /href="https:\/\/www\.lme\.com\/News" target="_blank" rel="noopener noreferrer"/);
  assert.match(h.root.innerHTML, /官网查看 · 自动采集暂不可用/);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /^\/api\/news\/latest\?/);
  h.feed.refresh();
  assert.match(h.element(".nf-list").innerHTML, /正在读取快讯/);
  assert.doesNotMatch(h.element(".nf-list").innerHTML, /列表尚未加载成功/);
});
