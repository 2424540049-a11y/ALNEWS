const params = new URLSearchParams(window.location.search);
const rawUrl = params.get("url") || "";
const title = params.get("title") || "新闻详情";
const originalTitle = params.get("originalTitle") || "";
const source = params.get("source") || "";
const time = params.get("time") || "";
const description = params.get("description") || "";
const descriptionZh = params.get("descriptionZh") || "";
const titleZh = params.get("titleZh") || "";

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
  return [
    `一句话总结：${title}`,
    "",
    basis ? `可读摘要：${basis}` : "当前只能读取到标题，完整内容请打开原文查看。",
    "",
    "说明：ChatGPT 总结暂时不可用时，会先显示这段本地兜底摘要。"
  ].join("\n");
}

async function loadAiSummary(targetUrl) {
  els.summary.hidden = false;
  els.summaryText.textContent = "正在调用 ChatGPT 生成中文总结...";
  els.summaryMeta.textContent = "";
  els.summaryMeta.hidden = true;
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
        titleZh
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    }

    els.summaryText.textContent = payload.summary || localFallbackSummary();
    els.summaryMeta.textContent = payload.usedAi
      ? `由 ${payload.model || "ChatGPT"} 生成 · ${payload.articleChars || 0} 字符正文`
      : `ChatGPT 总结暂不可用：${payload.warning || "请检查服务端配置"}。已显示本地兜底摘要。`;
    els.summaryMeta.hidden = false;
    els.embedNotice.hidden = false;
  } catch (error) {
    els.summaryText.textContent = localFallbackSummary();
    els.summaryMeta.textContent = `ChatGPT 总结暂不可用：${error.message}`;
    els.summaryMeta.hidden = false;
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
