const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const SECTIONS = ["today", "close", "exchange", "alcoa", "macro"];
const REGIONS = ["domestic", "international"];

// Regions describe the publisher, not the language or subject of a headline.
// The fallback migrates existing archives without changing ids or timestamps.
function newsRegion(item, source = {}) {
  if (REGIONS.includes(source.region)) return source.region;
  if (REGIONS.includes(item.region)) return item.region;
  const sourceId = source.id || item.sourceId || "";
  if (["smm-al", "smm-shal", "shfe"].includes(sourceId)) return "domestic";
  if (["alcoa", "yahoo-aa", "fed", "fed-policy", "fed-speeches", "lme"].includes(sourceId)) return "international";
  try {
    const host = new URL(item.url).hostname.toLowerCase();
    if (/(^|\.)(alcoa\.com|yahoo\.com|federalreserve\.gov|lme\.com)$/.test(host)) return "international";
  } catch { /* Invalid URLs are rejected when normalizing new records. */ }
  return item.section === "alcoa" || item.sections?.includes("alcoa") ? "international" : "domestic";
}

function publicationTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw || /刚刚|刚才|分钟前|小时前|昨天|前天/.test(raw)) {
    return { publishedAt: null, publishedDate: null, timePrecision: "unknown", time: raw };
  }
  let timestamp;
  let precision = "second";
  if (/^\d{10}(?:\.\d+)?$/.test(raw)) timestamp = Number(raw) * 1000;
  else if (/^\d{13}$/.test(raw)) timestamp = Number(raw);
  else {
    const local = raw.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (local) {
      const [, y, m, d, hh, mm, ss] = local;
      const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      const check = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) return publicationTime("");
      timestamp = Date.parse(`${date}T${(hh || "00").padStart(2, "0")}:${mm || "00"}:${ss || "00"}+08:00`);
      precision = !hh ? "day" : ss ? "second" : "minute";
    } else if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) || /(?:GMT|UTC|[+-]\d{4})$/.test(raw)) {
      timestamp = Date.parse(raw);
    }
  }
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(1990, 0, 1)) {
    return { publishedAt: null, publishedDate: null, timePrecision: "unknown", time: raw };
  }
  return {
    publishedAt: new Date(timestamp).toISOString(),
    publishedDate: new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10),
    timePrecision: precision,
    time: raw
  };
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:guccounter|guce_referrer|guce_referrer_sig)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return ""; }
}

function normalizeItem(input, source, now) {
  const url = canonicalUrl(input.url);
  const title = String(input.title || "").trim();
  if (!url || !title) return null;
  const sections = [...new Set([...(input.sections || []), input.section || source.section])].filter((s) => SECTIONS.includes(s));
  const time = publicationTime(input.publishedAt || input.time);
  return {
    id: crypto.createHash("sha256").update(url).digest("hex").slice(0, 24),
    title, titleZh: String(input.titleZh || ""), url,
    source: String(input.source || source.label), sourceId: source.id,
    region: newsRegion(input, source),
    section: sections[0] || "today", sections,
    description: String(input.description || "").slice(0, 2000),
    ...time,
    // Date-only sources keep their honest precision even when reloaded as ISO.
    timePrecision: input.timePrecision || time.timePrecision,
    firstSeenAt: now, lastSeenAt: now
  };
}

function newestFirst(a, b) {
  const left = a.publishedAt ? Date.parse(a.publishedAt) : -Infinity;
  const right = b.publishedAt ? Date.parse(b.publishedAt) : -Infinity;
  return (right - left || 0) || a.id.localeCompare(b.id);
}

class NewsStore {
  constructor({ directory, configured = false, persistent = null, publicDirectory, now = () => new Date() }) {
    this.directory = path.resolve(directory);
    const publicPath = publicDirectory && path.resolve(publicDirectory);
    if (publicPath && (this.directory === publicPath || this.directory.startsWith(`${publicPath}${path.sep}`))) {
      throw new Error("NEWS_DATA_DIR must be outside public/");
    }
    this.file = path.join(this.directory, "news.json");
    this.now = now;
    this.items = new Map();
    this.sources = [];
    this.checkedAt = null;
    this.loadFailed = false;
    this.storage = {
      mode: "file", configured, persistent, writable: false, lastSavedAt: null, error: "",
      warning: persistent === true ? "" : "新闻已保存在服务器文件中；尚未确认持久磁盘，平台重新部署或休眠重建可能清空历史。"
    };
  }

  async init() {
    try {
      const payload = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (payload.version !== 1 || !Array.isArray(payload.items)) throw new Error("Invalid news archive format");
      for (const item of payload.items) {
        if (!item.id || !item.url || !item.title) throw new Error("Invalid archived news item");
        this.items.set(item.id, { ...item, region: newsRegion(item) });
      }
      this.sources = Array.isArray(payload.sources) ? payload.sources : [];
      this.checkedAt = payload.checkedAt || null;
      this.storage.lastSavedAt = payload.savedAt || null;
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.items.clear();
        this.loadFailed = true;
        this.storage.error = `历史文件读取失败，已停止写入以保护原文件：${error.message}`;
      }
    }
    if (!this.loadFailed) await this.save();
    return this;
  }

  merge(items, source, checkedAt = this.now().toISOString()) {
    let changed = 0;
    for (const input of items) {
      const next = normalizeItem(input, source, checkedAt);
      if (!next) continue;
      const previous = this.items.get(next.id);
      if (previous) {
        next.firstSeenAt = previous.firstSeenAt;
        next.sections = [...new Set([...previous.sections, ...next.sections])];
        // A transient feed omission must not erase a known publication time or translation.
        if (!next.publishedAt && previous.publishedAt) {
          for (const key of ["publishedAt", "publishedDate", "timePrecision", "time"]) next[key] = previous[key];
        }
        if (!next.titleZh) next.titleZh = previous.titleZh;
        if (!next.description) next.description = previous.description;
      }
      this.items.set(next.id, next);
      changed += 1;
    }
    return changed;
  }

  async save() {
    if (this.loadFailed) return false;
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    const savedAt = this.now().toISOString();
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, savedAt, checkedAt: this.checkedAt, sources: this.sources, items: [...this.items.values()] }));
        await handle.sync();
      } finally { await handle.close(); }
      await fs.rename(temp, this.file);
      this.storage.writable = true;
      this.storage.lastSavedAt = savedAt;
      this.storage.error = "";
      return true;
    } catch (error) {
      this.storage.writable = false;
      this.storage.error = `历史保存失败：${error.message}`;
      await fs.unlink(temp).catch(() => {});
      return false;
    }
  }

  query({ region = "", section = "", q = "", from = "", to = "", page = 1, pageSize = 20, latest = false } = {}) {
    page = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page)) || 1) : 1;
    pageSize = Number.isFinite(Number(pageSize)) ? Math.min(100, Math.max(1, Math.floor(Number(pageSize)) || 20)) : 20;
    const needle = String(q).trim().toLocaleLowerCase();
    const start = from ? publicationTime(from).publishedAt : null;
    let end = to ? publicationTime(to).publishedAt : null;
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(to)) end = new Date(Date.parse(end) + 86400000 - 1).toISOString();
    const items = [...this.items.values()].filter((item) => {
      if (region && item.region !== region) return false;
      if (section && !item.sections.includes(section)) return false;
      if (needle && !`${item.title} ${item.titleZh} ${item.description} ${item.source}`.toLocaleLowerCase().includes(needle)) return false;
      if (latest && (!item.publishedAt || Date.parse(item.publishedAt) > this.now().getTime())) return false;
      if ((start || end) && !item.publishedAt) return false;
      if (start && item.publishedAt < start) return false;
      if (end && item.publishedAt > end) return false;
      return true;
    }).sort(newestFirst);
    const offset = (page - 1) * pageSize;
    return { items: items.slice(offset, offset + pageSize), total: items.length, page, pageSize, hasMore: offset + pageSize < items.length };
  }
}

module.exports = { NewsStore, publicationTime, canonicalUrl, newestFirst, newsRegion, SECTIONS, REGIONS };
