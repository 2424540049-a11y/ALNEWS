const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { NewsStore } = require("../lib/news-store");
const { createNewsSources } = require("../lib/news-sources");

async function startServer(t, directory) {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", NEWS_DATA_DIR: directory, NEWS_COLLECTION_DISABLED: "true" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const done = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await done;
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Server start timeout: ${output}`)); }, 5000);
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
}

test("HTTP APIs restore the entire archive, return latest five and paginate/filter history", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "alnews-api-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await new NewsStore({ directory }).init();
  store.merge(Array.from({ length: 12 }, (_, i) => ({ title: `Fixture 铝 ${i}`, url: `https://example.com/${i}`, time: `2026-09-${String(i + 1).padStart(2, "0")}`, sections: ["close"] })), { id: "fixture", label: "Fixture", section: "today" });
  store.merge(Array.from({ length: 6 }, (_, i) => ({ title: `Overseas ${i}`, url: `https://example.com/overseas/${i}`, time: `2026-08-${String(i + 1).padStart(2, "0")}` })), { id: "fed", label: "Fed", section: "macro", region: "international" });
  store.checkedAt = "2026-10-01T12:00:00Z";
  await store.save();
  const base = await startServer(t, directory);
  const latestResponse = await fetch(`${base}/api/news/latest?limit=5`);
  const latest = await latestResponse.json();
  assert.equal(latestResponse.status, 200);
  assert.equal(latest.items.length, 5);
  assert.equal(latest.total, 18);
  assert.equal(latest.groups.domestic.items.length, 5);
  assert.equal(latest.groups.international.items.length, 5, "older overseas news must not be crowded out by domestic headlines");
  assert.equal(latest.groups.domestic.total, 12);
  assert.equal(latest.groups.international.total, 6);
  assert.ok(latest.groups.domestic.items.every(item => item.region === "domestic"));
  assert.ok(latest.groups.international.items.every(item => item.region === "international"));
  assert.equal(latest.groups.international.items[0].title, "Overseas 5");
  assert.equal(latest.items[0].title, "Fixture 铝 11");
  assert.equal(latest.checkedAt, "2026-10-01T12:00:00Z");
  assert.equal(latest.storage.writable, true);
  const history = await (await fetch(`${base}/api/news/history?section=close&q=%E9%93%9D&from=2026-09-01&to=2026-09-06&page=2&pageSize=4`)).json();
  assert.equal(history.total, 6);
  assert.equal(history.items.length, 2);
  assert.equal(history.hasMore, false);
  assert.equal(history.page, 2);
  assert.equal((await fetch(`${base}/api/news/history?from=2026-02-30`)).status, 400);
  assert.equal((await fetch(`${base}/api/news/history?section=unknown`)).status, 400);
  assert.equal((await fetch(`${base}/api/news/history?region=unknown`)).status, 400);
  const overseas = await (await fetch(`${base}/api/news/history?region=international&section=macro&page=2&pageSize=4`)).json();
  assert.equal(overseas.total, 6);
  assert.equal(overseas.items.length, 2);
  assert.equal(overseas.items[0].title, "Overseas 1");
  const domesticMacro = await (await fetch(`${base}/api/news/history?region=domestic&section=macro`)).json();
  assert.equal(domesticMacro.total, 0);
  const legacy = await (await fetch(`${base}/api/news`)).json();
  assert.equal(legacy.sections.length, 5);
  assert.equal(legacy.sections[1].items.length, 10);
  assert.equal(legacy.fetchedAt, latest.checkedAt);
  assert.equal((await fetch(`${base}/news.json`)).status, 404);
});

test("HTTP first-run empty archive returns explicit state, no invented news", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "alnews-empty-api-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const base = await startServer(t, directory);
  const payload = await (await fetch(`${base}/api/news/latest`)).json();
  assert.deepEqual(payload.items, []);
  assert.equal(payload.total, 0);
  assert.equal(payload.checkedAt, null);
  assert.deepEqual(payload.groups.domestic.items, []);
  assert.deepEqual(payload.groups.international.items, []);
  assert.equal(payload.sources.length, createNewsSources().length);
  assert.ok(payload.sources.every((source) => ["pending", "disabled"].includes(source.status)));
});
