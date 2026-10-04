/* News list and archive. Source collection runs on the server; this view polls its cache. */
(() => {
  "use strict";

  const POLL_MS = 30000;
  const PAGE_SIZE = 20;
  const sections = { today: "产业快讯", close: "收盘评论", exchange: "交易所公告", alcoa: "美铝动态", macro: "宏观政策" };
  const regions = { domestic: "国内", international: "国外" };
  const state = {
    active: false,
    mode: "latest",
    latest: null,
    history: null,
    metadata: null,
    latestError: "",
    historyError: "",
    filters: { region: "", section: "", q: "", from: "", to: "" },
    historyPage: 1,
    historyDirty: false,
    requests: { latest: null, history: null },
    serial: 0,
    timer: null
  };
  let root;
  let ui;

  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);

  function dateTime(value, seconds = false) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false
    }).format(date);
  }

  function publicationTime(item) {
    if (item.timePrecision === "day" && /^\d{4}-\d{2}-\d{2}$/.test(item.publishedDate || "")) {
      return `${item.publishedDate.replace(/-/g, "/")} · 仅提供日期`;
    }
    if (item.timePrecision === "minute" || item.timePrecision === "second") {
      const formatted = dateTime(item.publishedAt, item.timePrecision === "second");
      if (formatted) return formatted;
    }
    return "发布时间未标明";
  }

  function readerUrl(item) {
    try {
      const url = new URL(item.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const params = new URLSearchParams({
        url: url.toString(), title: item.titleZh || item.title || "新闻详情",
        originalTitle: item.title || "", titleZh: item.titleZh || "",
        section: item.section || "", source: item.source || "",
        time: publicationTime(item), description: String(item.description || "").slice(0, 240)
      });
      return `/news-reader.html?${params.toString()}`;
    } catch {
      return null;
    }
  }

  function scaffold() {
    root = document.getElementById("news-feed-root");
    if (!root) return false;
    root.innerHTML = `
      <div class="nf-toolbar">
        <div class="nf-tabs" aria-label="快讯视图">
          <button type="button" class="nf-tab is-active" data-nf-mode="latest" aria-pressed="true">最新快讯</button>
          <button type="button" class="nf-tab" data-nf-mode="history" aria-pressed="false">历史档案</button>
        </div>
        <button type="button" class="nf-button" data-nf-refresh>刷新列表</button>
      </div>
      <p class="nf-status" role="status" aria-live="polite"></p>
      <form class="nf-filters" hidden>
        <label class="nf-field" for="nf-region">地区<select id="nf-region" class="nf-input" name="region">
          <option value="">全部地区</option>
          ${Object.entries(regions).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select></label>
        <label class="nf-field" for="nf-section">分类<select id="nf-section" class="nf-input" name="section">
          <option value="">全部分类</option>
          ${Object.entries(sections).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select></label>
        <label class="nf-field nf-field-search" for="nf-query">关键词<input id="nf-query" class="nf-input" name="q" type="search" placeholder="搜索标题、摘要或来源" maxlength="200"></label>
        <label class="nf-field" for="nf-from">开始日期<input id="nf-from" class="nf-input" name="from" type="date"></label>
        <label class="nf-field" for="nf-to">结束日期<input id="nf-to" class="nf-input" name="to" type="date"></label>
        <div class="nf-actions">
          <button type="submit" class="nf-button is-primary">查找</button>
          <button type="button" class="nf-button" data-nf-reset>重置</button>
        </div>
      </form>
      <p class="nf-context">按新闻来源分为国内与国外，时间均为北京时间；更新速度受原始来源影响。</p>
      <p class="nf-error" role="alert" hidden></p>
      <div class="nf-list" aria-label="新闻列表" aria-busy="false"></div>
      <div class="nf-pagination" hidden>
        <span class="nf-page-info"></span>
        <div class="nf-actions">
          <button type="button" class="nf-button" data-nf-prev>上一页</button>
          <button type="button" class="nf-button" data-nf-next>下一页</button>
        </div>
      </div>
      <p class="nf-official-link"><a href="https://www.lme.com/News" target="_blank" rel="noopener noreferrer">LME 官方公告 <span aria-hidden="true">↗</span></a><span>官网查看 · 自动采集暂不可用</span></p>
      <section class="nf-upgrade" aria-labelledby="nf-eodhd-title">
        <div class="nf-upgrade-main">
          <div class="nf-upgrade-heading"><h3 id="nf-eodhd-title">可选新闻源 · EODHD</h3><span class="nf-plan-state">未启用</span></div>
          <p>海外公司新闻 · 个人套餐 <strong>19.99 美元/月</strong>，或 <strong>199 美元/年</strong></p>
          <p class="nf-plan-note">另有低额度免费版。对外展示需商业方案；以官网最新报价为准，购买后需另行配置接入。</p>
        </div>
        <a class="nf-button" href="https://eodhd.com/pricing" target="_blank" rel="noopener noreferrer">查看套餐与付费 <span aria-hidden="true">↗</span></a>
      </section>
      <details class="nf-source-details">
        <summary>来源与存储状态</summary>
        <div class="nf-source-list"></div>
        <p class="nf-storage"></p>
      </details>`;
    ui = {
      latestTab: root.querySelector('[data-nf-mode="latest"]'),
      historyTab: root.querySelector('[data-nf-mode="history"]'),
      refresh: root.querySelector("[data-nf-refresh]"),
      form: root.querySelector(".nf-filters"),
      region: root.querySelector("#nf-region"), section: root.querySelector("#nf-section"), query: root.querySelector("#nf-query"),
      from: root.querySelector("#nf-from"), to: root.querySelector("#nf-to"),
      reset: root.querySelector("[data-nf-reset]"), status: root.querySelector(".nf-status"),
      error: root.querySelector(".nf-error"), list: root.querySelector(".nf-list"),
      pagination: root.querySelector(".nf-pagination"), pageInfo: root.querySelector(".nf-page-info"),
      previous: root.querySelector("[data-nf-prev]"), next: root.querySelector("[data-nf-next]"),
      sourceList: root.querySelector(".nf-source-list"), storage: root.querySelector(".nf-storage")
    };
    ui.latestTab.addEventListener("click", () => switchMode("latest"));
    ui.historyTab.addEventListener("click", () => switchMode("history"));
    ui.refresh.addEventListener("click", refresh);
    ui.form.addEventListener("submit", event => {
      event.preventDefault();
      if (ui.from.value && ui.to.value && ui.from.value > ui.to.value) {
        state.historyError = "开始日期不能晚于结束日期，请调整后重新查找。";
        renderStatus();
        return;
      }
      state.filters = { region: ui.region.value, section: ui.section.value, q: ui.query.value.trim(), from: ui.from.value, to: ui.to.value };
      state.historyPage = 1;
      load("history", true);
    });
    ui.reset.addEventListener("click", () => {
      ui.form.reset();
      state.filters = { region: "", section: "", q: "", from: "", to: "" };
      state.historyPage = 1;
      load("history", true);
    });
    ui.previous.addEventListener("click", () => changePage(-1));
    ui.next.addEventListener("click", () => changePage(1));
    render();
    return true;
  }

  function switchMode(mode) {
    state.mode = mode;
    render();
    if (mode === "history" && (!state.history || state.historyDirty)) load("history");
    if (mode === "latest") load("latest");
  }

  function changePage(direction) {
    if (!state.history || state.requests.history) return;
    const currentPage = Math.max(1, Number(state.history.page) || 1);
    if (direction < 0 && currentPage <= 1) return;
    if (direction > 0 && !state.history.hasMore) return;
    state.historyPage = currentPage + direction;
    load("history", true);
  }

  function itemRegion(item) {
    if (Object.hasOwn(regions, item.region)) return item.region;
    // Older servers omit region. Keep their existing stories visible during an update.
    if (item.section === "alcoa" || /^(?:alcoa|yahoo|fed|lme)(?:-|$)/i.test(item.sourceId || "")
      || /Alcoa|Yahoo|Federal Reserve|美联储|美铝官方|LME/i.test(item.source || "")) return "international";
    return "domestic";
  }

  function emptyMessage(payload) {
    if (!payload) return state[`${state.mode}Error`] ? "列表尚未加载成功，请稍后刷新。" : "正在读取快讯…";
    if (state.mode === "history" && Object.values(state.filters).some(Boolean)) {
      return "没有符合筛选条件的记录，可以调整地区、分类、关键词或日期再试。";
    }
    if (payload.collecting || (state.metadata && state.metadata.sources || []).some(source => source.status === "pending")) {
      return "正在等待采集，采集完成后即可查看。";
    }
    return state.mode === "latest"
      ? "暂无标注明确发布时间的快讯，可前往历史档案查看已收录内容。"
      : "档案暂时为空，采集到的快讯将自动归档。";
  }

  function cardsHtml(items) {
    return items.map(item => {
      const url = readerUrl(item);
      const title = escapeHtml(item.titleZh || item.title || "未提供标题");
      const published = publicationTime(item);
      const section = sections[item.section] || "快讯";
      const heading = state.mode === "latest" ? "h4" : "h3";
      return `<article class="nf-card">
        <div class="nf-meta"><span class="nf-source">${escapeHtml(item.source || "来源未标明")}</span>
          ${state.mode === "history" ? `<span class="nf-region-label">${regions[itemRegion(item)]}</span>` : ""}
          <span class="nf-section">${escapeHtml(section)}</span>
          <span class="nf-time">${escapeHtml(published)}</span></div>
        <${heading} class="nf-title">${url ? `<a href="${escapeHtml(url)}">${title}</a>` : title}</${heading}>
        ${item.description ? `<p class="nf-summary">${escapeHtml(String(item.description).slice(0, 240))}${String(item.description).length > 240 ? "…" : ""}</p>` : ""}
      </article>`;
    }).join("");
  }

  function renderCards() {
    const payload = state[state.mode];
    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    const latest = state.mode === "latest";
    ui.list.classList.toggle("nf-list-grouped", latest);
    if (latest) {
      ui.list.innerHTML = Object.entries(regions).map(([region, label]) => {
        const group = payload && payload.groups && payload.groups[region];
        const stories = (group && Array.isArray(group.items) ? group.items : items.filter(item => itemRegion(item) === region)).slice(0, 5);
        return `<section class="nf-region-group" aria-labelledby="nf-heading-${region}">
          <div class="nf-group-heading"><h3 id="nf-heading-${region}">${label}快讯</h3><span>${stories.length ? `最新 ${stories.length} 条` : payload ? "暂无快讯" : state.latestError ? "暂未加载" : "读取中"}</span></div>
          <div class="nf-group-items">${stories.length ? cardsHtml(stories) : `<div class="nf-empty">${escapeHtml(emptyMessage(payload))}</div>`}</div>
        </section>`;
      }).join("");
      return;
    }
    ui.list.innerHTML = items.length ? cardsHtml(items.slice(0, PAGE_SIZE))
      : `<div class="nf-empty">${escapeHtml(emptyMessage(payload))}</div>`;
  }

  function renderSources() {
    const payload = state.metadata;
    if (!payload) {
      ui.sourceList.innerHTML = "<p class=\"nf-empty\">等待获取来源状态。</p>";
      ui.storage.textContent = "等待获取存储状态。";
      return;
    }
    const labels = { pending: "等待采集", ok: "采集正常", error: "采集失败", disabled: "未启用" };
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    ui.sourceList.innerHTML = sources.map(source => `<div class="nf-source-row">
      <div><strong>${escapeHtml(source.label || source.id || "新闻源")}</strong>
        <span class="nf-source-state${source.status === "error" ? " nf-warning" : ""}">${escapeHtml(labels[source.status] || "状态未知")}</span></div>
      <p>${escapeHtml(source.lastSuccessAt ? `最近成功采集 ${dateTime(source.lastSuccessAt)}` : "尚无成功采集记录")}${Number.isFinite(source.itemCount) ? ` · ${source.itemCount} 条` : ""}</p>
      ${source.error ? `<p class="nf-warning">${escapeHtml(source.error)}</p>` : ""}
    </div>`).join("") || "<p>暂无来源状态。</p>";
    const storage = payload.storage;
    const persistent = storage && storage.persistent === true && storage.writable;
    ui.storage.classList.toggle("nf-warning", !persistent);
    if (!storage) ui.storage.textContent = "尚未取得存储状态，不能确认历史记录是否持久保存。";
    else if (!storage.writable) ui.storage.textContent = `历史存储不可写。${storage.error || storage.warning || "请检查服务器数据目录权限。"}`;
    else if (!storage.configured || storage.persistent === false) ui.storage.textContent = `尚未启用持久磁盘，重新部署或重启后历史可能丢失。${storage.warning || ""}`;
    else if (storage.persistent === null) ui.storage.textContent = `历史保存在服务器文件中，是否跨重启保留取决于部署磁盘配置。${storage.warning || ""}`;
    else ui.storage.textContent = storage.lastSavedAt
      ? `历史记录已保存至持久存储 · 最近保存 ${dateTime(storage.lastSavedAt)}`
      : "已配置持久存储，等待保存采集结果。";
    if (storage && storage.error && storage.writable) ui.storage.textContent += ` 保存异常：${storage.error}`;
  }

  function renderStatus() {
    const history = state.mode === "history";
    const payload = state[state.mode];
    const loading = Boolean(state.requests[state.mode]);
    const error = state[`${state.mode}Error`];
    const checkedAt = dateTime(state.metadata && state.metadata.checkedAt, true);
    const collecting = state.metadata && state.metadata.collecting;
    const failedSources = state.metadata && Array.isArray(state.metadata.sources)
      ? state.metadata.sources.filter(source => source.status === "error").length : 0;
    let message = loading ? "正在更新列表…" : history ? "历史记录按发布时间排序 · 每页 20 条" : "国内、国外各显示最新 5 条 · 页面可见时每 30 秒检查更新";
    if (collecting) message += " · 来源采集中";
    if (failedSources) message += ` · ${failedSources} 个来源暂时异常，详见来源状态`;
    if (checkedAt) message += ` · 最近检查 ${checkedAt}（北京时间）`;
    ui.status.textContent = message;
    ui.error.hidden = !error;
    ui.error.textContent = error;
    ui.refresh.disabled = loading;
    ui.refresh.textContent = loading ? "更新中…" : "刷新列表";
    ui.list.setAttribute("aria-busy", String(loading));
    ui.pagination.hidden = !history || !payload || !payload.total;
    if (history && payload) {
      const page = Math.max(1, Number(payload.page) || 1);
      const total = Math.max(0, Number(payload.total) || 0);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      ui.pageInfo.textContent = `共 ${total} 条 · 第 ${page} / ${pages} 页`;
      ui.previous.disabled = loading || page <= 1;
      ui.next.disabled = loading || !payload.hasMore;
    }
  }

  function render() {
    if (!ui) return;
    const history = state.mode === "history";
    ui.form.hidden = !history;
    ui.latestTab.classList.toggle("is-active", !history);
    ui.latestTab.setAttribute("aria-pressed", String(!history));
    ui.historyTab.classList.toggle("is-active", history);
    ui.historyTab.setAttribute("aria-pressed", String(history));
    renderCards();
    renderStatus();
    renderSources();
  }

  async function load(kind, replace = false) {
    if (!state.active || document.hidden) return;
    if (state.requests[kind]) {
      if (!replace) return;
      state.requests[kind].controller.abort();
    }
    const request = { controller: new AbortController(), id: ++state.serial, timedOut: false };
    if (kind === "history") state.historyDirty = true;
    state.requests[kind] = request;
    state[`${kind}Error`] = "";
    if (!state[kind] && state.mode === kind) renderCards();
    renderStatus();
    const parameters = kind === "latest" ? new URLSearchParams({ limit: "5" })
      : new URLSearchParams({ ...state.filters, page: String(state.historyPage), pageSize: String(PAGE_SIZE) });
    const timeout = setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, 25000);
    try {
      const response = await fetch(`/api/news/${kind === "latest" ? "latest" : "history"}?${parameters}`, {
        cache: "no-store", signal: request.controller.signal
      });
      if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.items)) throw new Error("服务器返回的数据格式不正确");
      if (state.requests[kind] !== request) return;
      state[kind] = payload;
      if (kind === "history") state.historyDirty = false;
      // A slow archive query must not replace fresher source status from the latest poll.
      if (!state.metadata || (Date.parse(payload.checkedAt) || 0) >= (Date.parse(state.metadata.checkedAt) || 0)) state.metadata = payload;
      if (state.mode === kind) renderCards();
      renderSources();
    } catch (error) {
      if (state.requests[kind] !== request || (error.name === "AbortError" && !request.timedOut)) return;
      state[`${kind}Error`] = `${request.timedOut ? "更新请求超时" : "暂时无法更新列表"}，${state[kind] ? "已保留上次结果。" : "请稍后点击刷新列表重试。"}`;
      if (!state[kind] && state.mode === kind) renderCards();
    } finally {
      clearTimeout(timeout);
      if (state.requests[kind] === request) {
        state.requests[kind] = null;
        renderStatus();
      }
    }
  }

  function stop() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    for (const kind of ["latest", "history"]) {
      if (state.requests[kind]) state.requests[kind].controller.abort();
      state.requests[kind] = null;
    }
    if (ui) renderStatus();
  }

  function start() {
    if (!state.active || document.hidden) return;
    if (!state.timer) state.timer = setInterval(() => load("latest"), POLL_MS);
    load("latest");
    if (state.mode === "history" && (!state.history || state.historyDirty)) load("history");
  }

  function activate() {
    if (!ui && !scaffold()) return;
    state.active = true;
    start();
  }

  function deactivate() {
    state.active = false;
    stop();
  }

  function refresh() {
    return load(state.mode);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  window.ALNewsFeed = { activate, deactivate, refresh };
})();
