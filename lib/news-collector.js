class NewsCollector {
  constructor({ store, sources, intervalMs = 60000, timeoutMs = 15000, now = () => new Date() }) {
    this.store = store;
    this.sources = sources;
    this.intervalMs = Math.max(10000, Number(intervalMs) || 60000);
    this.timeoutMs = Math.max(100, Number(timeoutMs) || 15000);
    this.now = now;
    this.inFlight = null;
    this.timer = null;
    this.stopped = true;
    const prior = new Map(store.sources.map((source) => [source.id, source]));
    store.sources = sources.map((source) => ({
      id: source.id, label: source.label, url: source.url,
      status: source.disabled ? "disabled" : "pending", checkedAt: null,
      lastSuccessAt: null, itemCount: 0, error: source.disabled || "", ...prior.get(source.id),
      region: source.region || "domestic",
      ...(source.disabled ? { status: "disabled", error: source.disabled } : {})
    }));
  }

  collect() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async run() {
    await Promise.all(this.sources.map(async (source, index) => {
      if (source.disabled) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("新闻源请求超时")), this.timeoutMs);
      const previous = this.store.sources[index];
      let next;
      try {
        // Adapters also receive the abort signal. The race bounds a misbehaving adapter.
        const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
        const items = await Promise.race([source.load({ signal: controller.signal }), aborted]);
        if (!Array.isArray(items)) throw new Error("新闻源返回格式不正确");
        const checkedAt = this.now().toISOString();
        const itemCount = this.store.merge(items, source, checkedAt);
        next = { ...previous, status: "ok", checkedAt, lastSuccessAt: checkedAt, itemCount, error: "" };
      } catch (error) {
        next = { ...previous, status: "error", checkedAt: this.now().toISOString(), error: String(error.message || error).slice(0, 300) };
      } finally { clearTimeout(timeout); }
      this.store.sources[index] = next;
    }));
    this.store.checkedAt = this.now().toISOString();
    await this.store.save();
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      try { await this.collect(); }
      finally {
        if (!this.stopped) {
          this.timer = setTimeout(tick, this.intervalMs);
          this.timer.unref?.();
        }
      }
    };
    void tick();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.inFlight) await this.inFlight;
  }

  status() {
    return { checkedAt: this.store.checkedAt, collecting: Boolean(this.inFlight), refreshIntervalMs: this.intervalMs, sources: this.store.sources, storage: this.store.storage };
  }
}

module.exports = { NewsCollector };
