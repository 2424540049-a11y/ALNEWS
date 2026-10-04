const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createNewsSources, parseSmmPage, parseRss, parseShfeNotices, fetchPublicText } = require("../lib/news-sources");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

test("SMM reads publisher timestamps from embedded data and never the relative display clock", () => {
  const data = { props: { pageProps: { keywordsListProps: { newsListList: Array.from({ length: 12 }, (_, i) => ({ newsId: i + 1, title: `Fixture 沪铝收盘 ${i}`, pubDate: 1790902028 + i, updateTime: 1890902028, source: "Fixture", profile: "Fixture summary" })) } } } };
  const html = `<span>刚刚</span><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  const items = parseSmmPage(html);
  assert.equal(items.length, 12);
  assert.equal(items[0].time, "1790902028");
  assert.deepEqual(items[0].sections, ["today", "close"]);
  assert.throws(() => parseSmmPage("<html>changed markup</html>"), /结构/);
});

test("RSS uses pubDate, preserves original title and does not use lastBuildDate", () => {
  const items = parseRss('<rss><channel><lastBuildDate>Sat, 03 Oct 2026 16:04:00 -0400</lastBuildDate><item><title><![CDATA[Fixture Alcoa &amp; aluminum]]></title><link>https://example.com/article?a=1&amp;b=2</link><pubDate>Wed, 23 Sep 2026 16:15:00 -0400</pubDate></item></channel></rss>', "Fixture source");
  assert.equal(items[0].title, "Fixture Alcoa & aluminum");
  assert.equal(items[0].time, "Wed, 23 Sep 2026 16:15:00 -0400");
  assert.equal(items[0].url, "https://example.com/article?a=1&b=2");
  assert.deepEqual(items[0].sections, []);
  assert.throws(() => parseRss("<html>Error</html>"), /RSS/);
});

test("RSS without a publisher timestamp never substitutes the feed update time", () => {
  const items = parseRss('<rss><channel><lastBuildDate>Sat, 03 Oct 2026 16:04:00 -0400</lastBuildDate><item><title>Undated article</title><link>https://example.com/undated</link></item></channel></rss>', "Fixture source");
  assert.equal(items[0].time, "");
  assert.throws(() => parseRss("<feed>Unsupported Atom document</feed>"), /RSS/);
});

test("official Federal Reserve fixtures preserve dates and use macro categorization", async () => {
  const requests = [];
  const sources = createNewsSources({ fetchText: async (url) => {
    requests.push(url);
    if (url.endsWith("/press_monetary.xml")) return fixture("fed-monetary.xml");
    if (url.endsWith("/speeches.xml")) return fixture("fed-speeches.xml");
    throw new Error("Unexpected request");
  } });
  const monetary = await sources.find((source) => source.id === "fed-monetary").load();
  const speeches = await sources.find((source) => source.id === "fed-speeches").load();
  assert.equal(monetary[0].title, "Federal Reserve issues FOMC statement");
  assert.equal(monetary[0].time, "Wed, 16 Sep 2026 18:00:00 GMT");
  assert.equal(monetary[0].url, "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm");
  assert.equal(speeches[0].time, "Thu, 1 Oct 2026 19:00:00 GMT");
  assert.match(speeches[0].description, /CEO & Senior Management/);
  assert.deepEqual(monetary[0].sections, ["macro"]);
  assert.deepEqual(speeches[0].sections, ["macro"]);
  assert.equal(requests.length, 2);
});

test("sources define domestic/international origin and keep blocked LME as a link only", () => {
  const sources = createNewsSources({ fetchText: async () => { throw new Error("Must not fetch"); } });
  assert.deepEqual(sources.filter((source) => source.region === "domestic").map((source) => source.id), ["smm-al", "smm-shal", "shfe"]);
  assert.deepEqual(sources.filter((source) => source.region === "international").map((source) => source.id), ["alcoa", "yahoo-aa", "fed-monetary", "fed-speeches", "lme"]);
  const lme = sources.find((source) => source.id === "lme");
  assert.equal(lme.url, "https://www.lme.com/News");
  assert.match(lme.disabled, /浏览器验证/);
  assert.equal(lme.load, undefined);
});

test("failed Federal Reserve responses propagate instead of producing fabricated news", async () => {
  const sources = createNewsSources({ fetchText: async () => { throw new Error("新闻源 HTTP 503"); } });
  for (const source of sources.filter((entry) => entry.id.startsWith("fed-"))) {
    await assert.rejects(source.load(), /HTTP 503/);
  }
  const changed = createNewsSources({ fetchText: async () => "<html>Service unavailable</html>" });
  await assert.rejects(changed.find((source) => source.id === "fed-monetary").load(), /RSS/);
});

test("SHFE preserves date-only precision and full result list", () => {
  const items = parseShfeNotices('<div class="table_item_info"><a href="202609/fixture.html" title="Fixture notice">Fixture</a><div class="info_item_date">2026-09-30</div>');
  assert.equal(items[0].timePrecision, "day");
  assert.equal(items[0].time, "2026-09-30");
  assert.match(items[0].url, /shfe.com.cn\/publicnotice\/notice\/202609\/fixture.html/);
});

test("challenge response is reported without retries or challenge solving", async () => {
  let requests = 0;
  await assert.rejects(fetchPublicText("https://example.com", { fetchImpl: async () => {
    requests += 1;
    return new Response('<html>safeline_bot_challenge</html>', { status: 200 });
  } }), /浏览器验证/);
  assert.equal(requests, 1);
});

test("HTTP denied response stops the source request without retrying", async () => {
  let requests = 0;
  await assert.rejects(fetchPublicText("https://example.com", { fetchImpl: async () => {
    requests += 1;
    return new Response("Denied", { status: 403 });
  } }), /HTTP 403/);
  assert.equal(requests, 1);
});
