const els = {
  status: document.querySelector("#labStatus"),
  reload: document.querySelector("#reloadButton"),
  section: document.querySelector("#articleSection"),
  title: document.querySelector("#articleTitle"),
  meta: document.querySelector("#articleMeta"),
  link: document.querySelector("#articleLink"),
  summaryInfo: document.querySelector("#summaryInfo"),
  summaryText: document.querySelector("#summaryText"),
  translationCard: document.querySelector("#translationCard"),
  translationInfo: document.querySelector("#translationInfo"),
  translationText: document.querySelector("#translationText")
};

function newsTimeLabel(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return value.includes(":") ? `${mm}/${dd} ${hh}:${mi}` : value.slice(0, 10);
  }
  return String(value);
}

function displayTitle(section, item) {
  return section.id === "alcoa" && item.titleZh ? item.titleZh : item.title || "新闻详情";
}

function findFirstNews(payload) {
  for (const section of payload?.sections || []) {
    if (section.items?.length) return { section, item: section.items[0] };
  }
  return null;
}

function setLoading(message) {
  els.status.textContent = message;
  els.summaryInfo.textContent = "--";
  els.summaryText.textContent = "等待生成...";
  els.translationCard.hidden = true;
  els.translationText.textContent = "";
  els.translationInfo.textContent = "--";
}

async function loadFirstSummary() {
  setLoading("正在读取第一条快讯...");
  els.reload.disabled = true;

  try {
    const newsResponse = await fetch(`/api/news?t=${Date.now()}`, { cache: "no-store" });
    const newsPayload = await newsResponse.json().catch(() => ({}));
    if (!newsResponse.ok) {
      throw new Error(newsPayload.detail || newsPayload.error || `新闻接口 HTTP ${newsResponse.status}`);
    }

    const target = findFirstNews(newsPayload);
    if (!target) throw new Error("当前没有可用快讯");

    const { section, item } = target;
    const title = displayTitle(section, item);
    const time = newsTimeLabel(item.time);
    els.section.textContent = `栏目：${section.title || section.id} · 第一条`;
    els.title.textContent = title;
    els.meta.textContent = [item.source || section.sourceLabel, time].filter(Boolean).join(" · ");
    els.link.href = item.url || "/";
    els.link.textContent = `原文链接：${item.url || "--"}`;

    setLoading("正在生成第一条快讯总结...");
    const summaryResponse = await fetch("/api/article-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: item.url,
        title,
        originalTitle: item.title,
        source: item.source || section.sourceLabel,
        time,
        description: item.description,
        descriptionZh: item.descriptionZh,
        titleZh: item.titleZh,
        section: section.id,
        noCache: true
      })
    });
    const summaryPayload = await summaryResponse.json().catch(() => ({}));
    if (!summaryResponse.ok) {
      throw new Error(summaryPayload.detail || summaryPayload.error || `总结接口 HTTP ${summaryResponse.status}`);
    }

    els.status.textContent = "已加载第一条样板";
    els.summaryText.textContent = summaryPayload.summary || "没有返回总结。";
    els.summaryInfo.textContent = summaryPayload.usedAi
      ? `已整理 · 正文 ${summaryPayload.articleChars || 0} 字符`
      : `临时摘要 · 正文 ${summaryPayload.articleChars || 0} 字符`;

    if (summaryPayload.translationZh) {
      els.translationCard.hidden = false;
      els.translationText.textContent = summaryPayload.translationZh;
      els.translationInfo.textContent = summaryPayload.usedTranslationAi
        ? `已翻译 · 正文 ${summaryPayload.articleChars || 0} 字符`
        : `可用译文 · 正文 ${summaryPayload.articleChars || 0} 字符`;
    } else {
      els.translationCard.hidden = true;
    }
  } catch (error) {
    els.status.textContent = `加载失败：${error.message}`;
    els.summaryText.textContent = error.message;
  } finally {
    els.reload.disabled = false;
  }
}

els.reload.addEventListener("click", loadFirstSummary);
loadFirstSummary();
