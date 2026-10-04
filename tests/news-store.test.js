const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { NewsStore, publicationTime } = require("../lib/news-store");
const { NewsCollector } = require("../lib/news-collector");

const source = { id: "fixture", label: "Test source", section: "today", url: "https://example.com" };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "alnews-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = () => new Date("2026-10-04T00:00:00Z");
  const store = await new NewsStore({ directory, now }).init();
  return { directory, store, now };
}
function article(id, time, extra = {}) { return { title: `Fixture ${id}`, url: `https://example.com/news/${id}`, time, ...extra }; }

test("deduplication updates records, keeps original firstSeenAt, publication time and all sections", async (t) => {
  const { store } = await fixture(t);
  store.merge([article(1, "2026-10-01 12:30:00", { sections: ["close"] })], source, "2026-10-02T00:00:00Z");
  store.merge([article(1, "刚刚", { title: "Corrected title", url: "https://example.com/news/1?utm_source=feed#section" })], source, "2026-10-03T00:00:00Z");
  const result = store.query();
  assert.equal(result.total, 1);
  assert.equal(result.items[0].title, "Corrected title");
  assert.equal(result.items[0].publishedAt, "2026-10-01T04:30:00.000Z");
  assert.equal(result.items[0].firstSeenAt, "2026-10-02T00:00:00Z");
  assert.equal(result.items[0].lastSeenAt, "2026-10-03T00:00:00Z");
  assert.deepEqual(result.items[0].sections, ["close", "today"]);
});

test("sorts publication times, excludes unknown/future times from latest, keeps all history beyond five", async (t) => {
  const { store } = await fixture(t);
  store.merge(Array.from({ length: 12 }, (_, i) => article(i, `2026-09-${String(i + 1).padStart(2, "0")}`)), source);
  store.merge([article("unknown", "17小时前"), article("future", "2027-01-01"), article("newest", "2026-10-03T23:00:00Z")], source);
  const latest = store.query({ latest: true, pageSize: 5 });
  assert.equal(latest.items.length, 5);
  assert.equal(latest.total, 13);
  assert.equal(latest.items[0].title, "Fixture newest");
  assert.equal(store.query({ pageSize: 100 }).total, 15);
  assert.equal(store.query({ pageSize: 100 }).items.at(-1).timePrecision, "unknown");
});

test("query filters dates as Beijing whole days, sections/search and stable pages", async (t) => {
  const { store } = await fixture(t);
  store.merge([
    article(1, "2026-10-01T15:59:59Z", { title: "铝库存", sections: ["close"] }),
    article(2, "2026-10-01T16:00:00Z", { title: "铝库存", sections: ["close"] }),
    article(3, "2026-10-02T15:59:59Z", { title: "铝库存", sections: ["close"] }),
    article(4, "2026-10-02T16:00:00Z", { title: "铝库存", sections: ["close"] }),
    article(5, "2026-10-02T05:00:00Z", { title: "铜价格", sections: ["exchange"] })
  ], source);
  const options = { section: "close", q: "库存", from: "2026-10-02", to: "2026-10-02", pageSize: 1 };
  const first = store.query(options);
  const second = store.query({ ...options, page: 2 });
  assert.equal(first.total, 2);
  assert.equal(first.hasMore, true);
  assert.match(first.items[0].url, /\/3$/);
  assert.match(second.items[0].url, /\/2$/);
  assert.equal(second.hasMore, false);
});

test("atomic file archive restores articles/source state on restart", async (t) => {
  const { store, directory, now } = await fixture(t);
  store.merge(Array.from({ length: 21 }, (_, i) => article(i, "2026-10-02")), source);
  store.sources = [{ ...source, status: "error", error: "Fixture network failure" }];
  store.checkedAt = now().toISOString();
  assert.equal(await store.save(), true);
  const restored = await new NewsStore({ directory, now }).init();
  assert.equal(restored.query().total, 21);
  assert.equal(restored.sources[0].status, "error");
  assert.equal(restored.checkedAt, store.checkedAt);
  assert.deepEqual(await fs.readdir(directory), ["news.json"]);
  assert.equal(restored.storage.writable, true);
});

test("old archives gain publisher regions without losing ids, dates or history", async (t) => {
  const { store, directory, now } = await fixture(t);
  store.merge([article("smm", "2026-10-02", { title: "SMM 报道海外市场" })], { id: "smm-al", label: "SMM", section: "today" });
  store.merge([article("aa", "2026-09-30")], { id: "yahoo-aa", label: "Yahoo", section: "alcoa" });
  const before = store.query().items;
  await store.save();
  const file = path.join(directory, "news.json");
  const archive = JSON.parse(await fs.readFile(file, "utf8"));
  for (const entry of archive.items) delete entry.region;
  await fs.writeFile(file, JSON.stringify(archive));
  const restored = await new NewsStore({ directory, now }).init();
  assert.equal(restored.query().total, 2);
  const domestic = restored.query({ region: "domestic" }).items;
  const international = restored.query({ region: "international" }).items;
  assert.equal(domestic.length, 1);
  assert.equal(international.length, 1);
  assert.equal(domestic[0].title, "SMM 报道海外市场");
  assert.equal(domestic[0].id, before[0].id);
  assert.equal(international[0].publishedAt, before[1].publishedAt);
  assert.equal(domestic[0].firstSeenAt, before[0].firstSeenAt);
});

test("publisher region combines with category/date/search filters and remains across restart", async (t) => {
  const { store, directory, now } = await fixture(t);
  store.merge([article("shfe", "2026-10-01", { title: "铝交易公告" })], { id: "shfe", label: "SHFE", section: "exchange", region: "domestic" });
  store.merge([article("lme", "2026-10-02", { title: "铝交易公告" })], { id: "lme", label: "LME", section: "exchange", region: "international" });
  store.merge([article("fed", "2026-10-03", { title: "Policy statement" })], { id: "fed-policy", label: "Fed", section: "macro", region: "international" });
  const options = { region: "international", section: "exchange", q: "铝", from: "2026-10-02", to: "2026-10-03" };
  assert.equal(store.query(options).total, 1);
  assert.equal(store.query(options).items[0].sourceId, "lme");
  await store.save();
  const restored = await new NewsStore({ directory, now }).init();
  assert.deepEqual(restored.query(options), store.query(options));
  assert.equal(restored.query({ region: "international", section: "macro" }).total, 1);
});

test("a source failure retains history and prior success time; first empty archive stays empty", async (t) => {
  const { store, now } = await fixture(t);
  let fail = false;
  const collector = new NewsCollector({ store, now, sources: [{ ...source, load: async () => {
    if (fail) throw new Error("Fixture source offline");
    return [article(1, "2026-10-01")];
  } }] });
  assert.equal(store.query().total, 0);
  await collector.collect();
  const success = store.sources[0].lastSuccessAt;
  fail = true;
  await collector.collect();
  assert.equal(store.query().total, 1);
  assert.equal(store.sources[0].status, "error");
  assert.equal(store.sources[0].lastSuccessAt, success);
  assert.match(store.sources[0].error, /offline/);
});

test("all unavailable sources leave an honest empty archive and never inject fallback items", async (t) => {
  const { store, now } = await fixture(t);
  const collector = new NewsCollector({ store, now, sources: [{ ...source, load: async () => { throw new Error("offline"); } }] });
  await collector.collect();
  assert.equal(store.query({ latest: true }).total, 0);
  assert.equal(collector.status().sources[0].status, "error");
});

test("collector is single-flight and source timeouts do not block successful sources", async (t) => {
  const { store } = await fixture(t);
  let calls = 0;
  const collector = new NewsCollector({ store, timeoutMs: 100, sources: [
    { ...source, load: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return [article(1, "2026-10-01")]; } },
    { ...source, id: "timeout", load: () => new Promise(() => {}) }
  ] });
  const first = collector.collect();
  assert.equal(first, collector.collect());
  await first;
  assert.equal(calls, 1);
  assert.equal(store.query().total, 1);
  assert.equal(store.sources[1].status, "error");
  assert.equal(collector.status().collecting, false);
});

test("invalid/corrupt archive is protected and write failure is exposed", async (t) => {
  const { directory, now } = await fixture(t);
  await fs.writeFile(path.join(directory, "news.json"), "corrupt fixture");
  const store = await new NewsStore({ directory, now }).init();
  assert.equal(store.storage.writable, false);
  assert.equal(await store.save(), false);
  assert.equal(await fs.readFile(path.join(directory, "news.json"), "utf8"), "corrupt fixture");
  const blocked = path.join(directory, "not-a-directory");
  await fs.writeFile(blocked, "fixture");
  const failed = await new NewsStore({ directory: blocked, now }).init();
  assert.equal(failed.storage.writable, false);
  assert.ok(failed.storage.error);
});

test("timestamp parsing rejects invented relative/invalid dates and preserves day precision", () => {
  assert.equal(publicationTime("昨天").publishedAt, null);
  assert.equal(publicationTime("2026-02-30").publishedAt, null);
  assert.equal(publicationTime("2026-09-30").publishedAt, "2026-09-29T16:00:00.000Z");
  assert.equal(publicationTime("2026-09-30").timePrecision, "day");
  assert.equal(publicationTime("1790902028").timePrecision, "second");
  assert.equal(publicationTime("Wed, 23 Sep 2026 16:15:00 -0400").publishedAt, "2026-09-23T20:15:00.000Z");
});

test("archive cannot be configured inside the served public directory", () => {
  assert.throws(() => new NewsStore({ directory: "/tmp/app/public/news", publicDirectory: "/tmp/app/public" }), /outside public/);
});
