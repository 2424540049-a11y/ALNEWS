const params = new URLSearchParams(window.location.search);
const rawUrl = params.get("url") || "";
const title = params.get("title") || "新闻详情";
const originalTitle = params.get("originalTitle") || "";
const source = params.get("source") || "";
const time = params.get("time") || "";
const description = params.get("description") || "";
const descriptionZh = params.get("descriptionZh") || "";
const titleZh = params.get("titleZh") || "";
const section = params.get("section") || "";

const els = {
  title: document.querySelector("#readerTitle"),
  meta: document.querySelector("#readerMeta"),
  url: document.querySelector("#readerUrl"),
  frame: document.querySelector("#articleFrame"),
  origin: document.querySelector("#originLink"),
  originalInSummary: document.querySelector("#summaryOriginalLink"),
  status: document.querySelector("#readerStatus"),
  summary: document.querySelector("#articleSummary"),
  summaryText: document.querySelector("#summaryText"),
  summaryMeta: document.querySelector("#summaryZhText"),
  translation: document.querySelector("#articleTranslation"),
  translationText: document.querySelector("#translationText"),
  translationMeta: document.querySelector("#translationMeta"),
  embedNotice: document.querySelector("#embedNotice"),
  back: document.querySelector("#backButton")
};

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function openOriginal(event) {
  event.preventDefault();
  const popup = window.open(event.currentTarget.href, "_blank", "noopener,noreferrer");
  if (popup) popup.opener = null;
  else window.location.assign(event.currentTarget.href);
}

function localFallbackSummary() {
  const basis = descriptionZh || description || titleZh || title;
  const text = basis
    ? `${title}。${basis} 当前先根据标题和可读摘要给出临时说明。阅读这条新闻时，建议重点核对文章里的时间、价格、涨跌幅、产量、库存、公司经营、项目进展和政策表述等具体信息，并结合沪铝盘面、美元指数、伦铝或美铝表现、成交量和持仓变化判断它对铝价情绪与供需预期的影响。完整信息请打开原文核对。`
    : `${title}。当前只能读取到标题，完整内容请打开原文查看。阅读时建议重点寻找文章里的关键数字、公司名称、发布时间、价格或涨跌幅信息，再结合沪铝盘面和产业链基本面判断影响。`;
  return text;
}

function isAlcoaRequest() {
  const combined = [section, source, title, titleZh, originalTitle, rawUrl].join(" ").toLowerCase();
  return (
    section === "alcoa" ||
    combined.includes("yahoo finance") ||
    combined.includes("alcoa") ||
    combined.includes("美铝") ||
    /\baa\b/.test(combined)
  );
}

async function loadAiSummary(targetUrl) {
  els.summary.hidden = false;
  els.summaryText.textContent = "正在生成中文总结...";
  els.summaryMeta.textContent = "";
  els.summaryMeta.hidden = true;
  els.translation.hidden = true;
  els.translationText.textContent = "";
  els.translationMeta.textContent = "";
  els.embedNotice.hidden = true;

  try {
    const response = await fetch("/api/article-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: targetUrl.toString(),
        title,
        originalTitle,
        source,
        time,
        description,
        descriptionZh,
        titleZh,
        section
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }

    els.summaryText.textContent = payload.summary || localFallbackSummary();
    els.summaryMeta.textContent = payload.usedAi
      ? `已整理 · ${payload.articleChars || 0} 字符正文`
      : `临时摘要 · ${payload.articleChars || 0} 字符正文`;
    els.summaryMeta.hidden = false;

    if (payload.translationZh) {
      els.translation.hidden = false;
      els.translationText.textContent = payload.translationZh;
      els.translationMeta.textContent = payload.usedTranslationAi
        ? `已翻译 · ${payload.articleChars || 0} 字符正文`
        : "已显示可用中文译文";
    }

    els.embedNotice.hidden = false;
  } catch (error) {
    els.summaryText.textContent = localFallbackSummary();
    els.summaryMeta.textContent = `临时摘要 · ${error.message}`;
    els.summaryMeta.hidden = false;
    els.translation.hidden = true;
    els.embedNotice.hidden = false;
  }
}

const targetUrl = safeUrl(rawUrl);
els.title.textContent = title;
document.title = title;
els.meta.textContent = [source, time].filter(Boolean).join(" · ") || "新闻详情";

els.back.addEventListener("click", () => {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/");
});

if (targetUrl) {
  els.url.textContent = targetUrl.hostname;
  els.origin.href = targetUrl.toString();
  els.originalInSummary.href = targetUrl.toString();
  els.originalInSummary.textContent = `原文链接：${targetUrl.toString()}`;
  els.origin.addEventListener("click", openOriginal);
  els.originalInSummary.addEventListener("click", openOriginal);
  els.frame.hidden = true;
  loadAiSummary(targetUrl);
} else {
  els.url.textContent = "--";
  els.origin.hidden = true;
  els.originalInSummary.hidden = true;
  els.frame.hidden = true;
  els.status.hidden = false;
  els.status.textContent = "链接不可用。";
}
