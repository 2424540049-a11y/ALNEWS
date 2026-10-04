(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(navigator.platform || "") && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const wechat = /MicroMessenger/i.test(ua);
  const mac = !ios && /Mac/i.test(navigator.platform || ua);
  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua);
  const actualDevice = ios || android || /Mobile/i.test(ua) ? "mobile" : "desktop";
  const requested = new URLSearchParams(location.search).get("device");
  let selected = requested === "mobile" || requested === "desktop" ? requested : actualDevice;
  let deferredPrompt = null;
  let prompting = false;
  let accepted = false;
  const standalone = window.matchMedia("(display-mode: standalone)");
  let installed = standalone.matches || navigator.standalone === true;
  const phoneUrl = new URL("/install.html?device=mobile", location.origin).toString();
  byId("localPreviewNotice").hidden = !["localhost", "127.0.0.1", "[::1]"].includes(new URL(location.origin).hostname);
  const status = byId("installStatus");
  const installButton = byId("nativeInstall");

  function render() {
    for (const device of ["mobile", "desktop"]) {
      const card = byId(`${device}Card`);
      card.classList.toggle("is-selected", selected === device);
      if (selected === device) card.setAttribute("aria-current", "true");
      else card.removeAttribute("aria-current");
    }
    byId("installHeading").textContent = installed ? "应用已安装，可以随时打开" : selected === "mobile" ? "安装到手机或平板" : "安装到电脑";
    byId("platformLabel").textContent = wechat ? "微信内置浏览器" : ios ? "iPhone / iPad" : android ? "Android" : mac ? "macOS" : "电脑浏览器";
    byId("deviceContext").textContent = selected !== actualDevice
      ? selected === "mobile" ? "当前正在电脑上浏览。请复制下方手机版链接，在手机浏览器中打开后安装。" : "当前正在手机上浏览。请在电脑浏览器中打开本页，再按下方步骤安装。"
      : "同一应用为当前设备调整布局，安装后可从应用图标打开。";
    byId("browserNotice").hidden = !wechat;
    byId("browserNotice").textContent = "请点击微信右上角“…” → 在浏览器中打开。iPhone 请使用 Safari；Android 请使用 Chrome 或 Edge。";
    const canPrompt = Boolean(deferredPrompt && !installed && !accepted && !wechat && selected === actualDevice);
    installButton.hidden = !canPrompt;
    installButton.disabled = prompting;
    installButton.textContent = prompting ? "等待系统确认…" : selected === "mobile" ? "安装到这台手机" : "安装到这台电脑";
    byId("guideLink").hidden = canPrompt || installed || accepted;
    byId("openApp").textContent = installed ? "打开 ALNEWS" : "直接打开工作台";
    if (installed) status.textContent = "已检测到安装完成或独立应用模式，可从主屏幕、程序坞或桌面图标打开。";
    renderGuide();
  }

  function renderGuide() {
    let heading;
    let steps;
    if (selected === "mobile" && ios) {
      heading = "iPhone / iPad · Safari";
      steps = ["在 Safari 中打开此安装链接。", "点击浏览器的分享按钮，选择“添加到主屏幕”。", "如出现“作为网页 App 打开”，保持开启，再点击“添加”。"];
    } else if (selected === "mobile" && android) {
      heading = "Android · Chrome / Edge";
      steps = ["使用 Chrome 或 Edge 打开此安装链接。", "点击本页可用的安装按钮，或打开浏览器右上角菜单，选择“安装应用”或“添加到主屏幕”。", "按系统提示确认；完成后在手机主屏幕或应用列表打开 ALNEWS。"];
    } else if (selected === "mobile") {
      heading = "在手机浏览器中安装";
      steps = ["复制下方手机版链接，在手机浏览器中打开。", "iPhone / iPad：Safari 分享 → 添加到主屏幕 → 添加。", "Android：Chrome / Edge 菜单 → 安装应用或添加到主屏幕 → 确认。"];
    } else if (mac && safari) {
      heading = "Mac · Safari";
      steps = ["在支持网页应用的 macOS 版本中，使用 Safari 打开本页。", "选择 Safari 的“文件”菜单或分享按钮，点击“添加到程序坞”。", "确认名称后点击“添加”，之后可从程序坞或“应用程序”打开。"];
    } else {
      heading = "电脑 · Chrome / Edge";
      steps = ["在电脑上的 Chrome 或 Edge 打开此安装链接。", "点击本页可用的安装按钮，或点击地址栏安装图标；也可在浏览器菜单的“安装应用 / 应用”中安装。", "在系统提示中确认；安装后可从桌面、开始菜单或应用列表打开。Mac Safari 也可使用“添加到程序坞”。"];
    }
    byId("guideHeading").textContent = heading;
    byId("guideSteps").replaceChildren(...steps.map(text => {
      const node = document.createElement("li");
      node.textContent = text;
      return node;
    }));
  }

  for (const device of ["mobile", "desktop"]) byId(`${device}Card`).addEventListener("click", event => {
    event.preventDefault();
    selected = device;
    history.replaceState(null, "", `/install.html?device=${device}`);
    render();
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if (installed) return;
    deferredPrompt = event;
    accepted = false;
    status.textContent = "浏览器已准备好安装。点击安装按钮后，请在系统提示中确认。";
    render();
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt || prompting || installed || wechat || selected !== actualDevice) return;
    const prompt = deferredPrompt;
    prompting = true;
    render();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      accepted = choice && choice.outcome === "accepted";
      status.textContent = accepted
        ? "已确认安装，请等待系统完成。完成后可从应用图标打开。"
        : "已取消这次安装。你可以继续使用网页版，或按下方步骤从浏览器菜单安装。";
    } catch {
      status.textContent = "浏览器未能打开安装提示，请按下方步骤使用浏览器菜单安装。";
    } finally {
      deferredPrompt = null;
      prompting = false;
      render();
    }
  });

  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredPrompt = null;
    render();
  });
  const updateStandalone = event => {
    if (event.matches) { installed = true; render(); }
  };
  if (standalone.addEventListener) standalone.addEventListener("change", updateStandalone);
  else if (standalone.addListener) standalone.addListener(updateStandalone);

  byId("mobileInstallUrl").value = phoneUrl;
  byId("copyMobileLink").addEventListener("click", async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(phoneUrl);
      byId("copyFallback").hidden = true;
      byId("copyStatus").textContent = "手机版安装链接已复制。";
    } catch {
      byId("copyFallback").hidden = false;
      byId("mobileInstallUrl").focus();
      byId("mobileInstallUrl").select();
      byId("copyStatus").textContent = "请手动复制已选中的链接。";
    }
  });

  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {
    if (!installed && !accepted) status.textContent = "离线组件暂时未就绪，可刷新后重试；也可先使用网页版或浏览器菜单。";
  });
})();
