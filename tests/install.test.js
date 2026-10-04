const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const publicDirectory = path.join(__dirname, "../public");

function installHarness(options = {}) {
  const elements = new Map();
  function node(id) {
    if (elements.has(id)) return elements.get(id);
    const events = {};
    const classes = new Set();
    const result = { textContent: "", value: "", hidden: false, children: [],
      classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) },
      setAttribute() {}, removeAttribute() {},
      addEventListener: (type, fn) => { events[type] = fn; },
      emit: type => events[type]?.({ preventDefault() {} }),
      replaceChildren(...children) { this.children = children; }, focus() {}, select() { this.selected = true; }
    };
    elements.set(id, result);
    return result;
  }
  const events = {};
  const media = { matches: Boolean(options.standalone), addEventListener() {} };
  let registered;
  const context = {
    URL, URLSearchParams,
    document: { getElementById: node, createElement: () => ({ textContent: "" }) },
    navigator: {
      userAgent: options.ua || "Mozilla/5.0 Chrome/140 Safari/537.36", platform: options.platform || "Win32",
      maxTouchPoints: options.touch || 0, standalone: options.navigatorStandalone || false,
      ...(options.clipboard ? { clipboard: options.clipboard } : {}),
      serviceWorker: { register: async value => { registered = value; } }
    },
    location: { origin: options.origin || "https://market.example.com", search: options.search || "" },
    history: { replaceState() {} },
    window: { matchMedia: () => media, addEventListener: (type, fn) => { events[type] = fn; } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(publicDirectory, "install.js"), "utf8"), context);
  return { node, events, registered: () => registered };
}

test("iOS, desktop Safari, Android and WeChat provide honest platform instructions", () => {
  const ios = installHarness({ ua: "iPhone Safari/604.1", platform: "iPhone" });
  assert.match(ios.node("guideHeading").textContent, /iPhone/);
  assert.match(ios.node("guideSteps").children.map(n => n.textContent).join(""), /分享.*添加到主屏幕/);
  assert.equal(ios.node("nativeInstall").hidden, true);
  const ipad = installHarness({ ua: "Macintosh Safari/605.1", platform: "MacIntel", touch: 5 });
  assert.match(ipad.node("guideHeading").textContent, /iPad/);
  const mac = installHarness({ ua: "Macintosh Safari/605.1", platform: "MacIntel" });
  assert.match(mac.node("guideSteps").children.map(n => n.textContent).join(""), /添加到程序坞/);
  const android = installHarness({ ua: "Android Chrome/140 Mobile Safari/537.36" });
  assert.match(android.node("guideHeading").textContent, /Android/);
  const wechat = installHarness({ ua: "iPhone MicroMessenger Safari/604.1", platform: "iPhone" });
  assert.equal(wechat.node("browserNotice").hidden, false);
  assert.match(wechat.node("browserNotice").textContent, /右上角.*在浏览器中打开/);
  assert.equal(wechat.registered(), "/sw.js");
});

test("installation prompts are user-triggered, one-use, and distinguish accepted from installed", async () => {
  const h = installHarness();
  let prompted = 0;
  let prevented = false;
  h.events.beforeinstallprompt({ preventDefault() { prevented = true; }, prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: "accepted" }) });
  assert.equal(prevented, true);
  assert.equal(prompted, 0);
  assert.equal(h.node("nativeInstall").hidden, false);
  await h.node("nativeInstall").emit("click");
  assert.equal(prompted, 1);
  assert.match(h.node("installStatus").textContent, /已确认安装，请等待/);
  assert.doesNotMatch(h.node("installHeading").textContent, /已安装/);
  await h.node("nativeInstall").emit("click");
  assert.equal(prompted, 1);
  h.events.appinstalled();
  assert.match(h.node("installHeading").textContent, /已安装/);
  assert.equal(h.node("nativeInstall").hidden, true);
});

test("cancelled prompts show a cancellation and standalone mode does not offer another installation", async () => {
  const h = installHarness();
  h.events.beforeinstallprompt({ preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) });
  await h.node("nativeInstall").emit("click");
  assert.match(h.node("installStatus").textContent, /已取消/);
  assert.equal(h.node("guideLink").hidden, false);
  const installed = installHarness({ navigatorStandalone: true });
  assert.match(installed.node("installHeading").textContent, /已安装/);
  assert.equal(installed.node("nativeInstall").hidden, true);
});

test("phone links stay on the current origin and clipboard failure provides selected text", async () => {
  let copied;
  const h = installHarness({ search: "?device=mobile", clipboard: { writeText: async value => { copied = value; } } });
  assert.match(h.node("deviceContext").textContent, /当前正在电脑/);
  await h.node("copyMobileLink").emit("click");
  assert.equal(copied, "https://market.example.com/install.html?device=mobile");
  const fallback = installHarness();
  await fallback.node("copyMobileLink").emit("click");
  assert.equal(fallback.node("copyFallback").hidden, false);
  assert.equal(fallback.node("mobileInstallUrl").selected, true);
  assert.match(fallback.node("mobileInstallUrl").value, /^https:\/\/market\.example\.com\//);
  assert.equal(fallback.node("localPreviewNotice").hidden, true);
  const local = installHarness({ origin: "http://127.0.0.1:3000" });
  assert.equal(local.node("localPreviewNotice").hidden, false);
});

function workerHarness() {
  const handlers = {};
  const stores = new Map();
  const removed = [];
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return { match: async key => store.get(key)?.clone(), put: async (key, response) => store.set(key, response) };
  };
  const context = {
    URL, Response, Request: class extends Request { constructor(url, options) { super(new URL(url, "https://market.example.com"), options); } },
    self: { location: { origin: "https://market.example.com" }, addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async name => cache(name), keys: async () => [...stores.keys()], delete: async name => { removed.push(name); return stores.delete(name); } },
    fetch: async () => new Response("ok")
  };
  vm.runInNewContext(fs.readFileSync(path.join(publicDirectory, "sw.js"), "utf8"), context);
  return {
    stores, removed, cache, context, handlers,
    async request(pathname, options = {}) {
      let result;
      const waits = [];
      handlers.fetch({ request: { url: `https://market.example.com${pathname}`, method: "GET", mode: "cors", ...options }, respondWith: promise => { result = promise; }, waitUntil: promise => waits.push(promise) });
      const response = await result;
      await Promise.all(waits);
      return response;
    }
  };
}

test("service worker leaves APIs network-only, limits cache keys, and avoids HTML for offline assets", async () => {
  const h = workerHarness();
  await h.cache("shfe-futures-static-v43").put("/index.html", new Response("<html>home</html>"));
  await h.request("/styles.css?v=43&t=1");
  await h.request("/styles.css?v=43&t=2");
  assert.equal(h.stores.get("shfe-futures-static-v43").size, 2);
  assert.equal(h.stores.get("shfe-futures-static-v43").has("/styles.css?v=43"), true);
  h.context.fetch = async () => new Response("fail", { status: 500 });
  await h.request("/app.js?v=43");
  assert.equal(h.stores.get("shfe-futures-static-v43").has("/app.js?v=43"), false);
  h.context.fetch = async () => { throw new Error("offline"); };
  await assert.rejects(h.request("/api/news/latest?limit=5"), /offline/);
  await assert.rejects(h.request("/api/article-summary", { method: "POST" }), /offline/);
  const asset = await h.request("/app.js?v=43");
  assert.equal(asset.status, 503);
  assert.doesNotMatch(await asset.text(), /<html>/);
  const navigation = await h.request("/any-page", { mode: "navigate" });
  assert.match(await navigation.text(), /<html>home/);
});

test("service worker precaches real current assets and activation preserves unrelated caches", async () => {
  const h = workerHarness();
  const fetched = [];
  h.context.fetch = async request => {
    const pathname = new URL(request.url).pathname;
    assert.equal(fs.existsSync(path.join(publicDirectory, pathname === "/" ? "index.html" : pathname)), true, pathname);
    fetched.push(request.url);
    return new Response("ok");
  };
  let pending;
  h.handlers.install({ waitUntil: promise => { pending = promise; } });
  await pending;
  for (const asset of ["/styles.css?v=43", "/app.js?v=43", "/news-feed.js?v=43", "/chart-engine.js?v=43", "/install.js?v=43"]) assert.ok(fetched.some(url => url.endsWith(asset)), asset);
  h.cache("shfe-futures-static-v32");
  h.cache("shfe-futures-data-v32");
  h.cache("another-app-cache");
  h.handlers.activate({ waitUntil: promise => { pending = promise; } });
  await pending;
  assert.equal(h.stores.has("another-app-cache"), true);
  assert.deepEqual(h.removed.sort(), ["shfe-futures-data-v32", "shfe-futures-static-v32"]);
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDirectory, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.orientation, undefined);
  assert.deepEqual(manifest.shortcuts.map(shortcut => shortcut.url), ["/#chart", "/#news"]);
});
