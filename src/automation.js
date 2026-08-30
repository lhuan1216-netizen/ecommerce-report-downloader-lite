export async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await sleep(500);
  }
  throw new Error("页面加载超时");
}

export async function inspectSycmPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };
      const interactive = [...document.querySelectorAll("button,a,[role='button'],input,select,[tabindex]")]
        .filter(visible)
        .slice(0, 250)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: (element.innerText || element.value || "").trim().replace(/\s+/g, " ").slice(0, 160),
          ariaLabel: element.getAttribute("aria-label") || "",
          className: typeof element.className === "string" ? element.className.slice(0, 200) : ""
        }));
      return {
        title: document.title,
        url: location.href,
        bodyText: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 4000),
        interactive
      };
    }
  });
  return result;
}

export async function dismissGenericDialog(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const selector = [
        "[class*='-dialog'] [class*='-close']",
        "[class*='dialog-'] [class*='close-']",
        "[class*='-modal'] [class*='-close']",
        "[class*='modal-'] [class*='close-']"
      ].join(",");
      const element = document.querySelector(selector);
      if (!element) return false;
      element.click();
      return true;
    }
  });
  return result;
}

export async function waitForItemRankShell(tabId, timeoutMs = 25000) {
  return pollInPage(tabId, timeoutMs, () => {
    const text = document.body?.innerText || "";
    return text.includes("商品排行") || Boolean(document.querySelector(".sycm-cc-item-rank-download"));
  }, "未识别到商品排行页面；可能尚未登录、店铺无权限或页面结构已变化");
}

export async function choosePeriod(tabId, label) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [label],
    func: (targetLabel) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const exactText = (element) => (element.textContent || "").trim() === targetLabel;
      const scoped = [...document.querySelectorAll(
        "[class*='date-picker'] button,[class*='date-picker'] span,[class*='date-picker'] li," +
        "[class*='oui-date'] button,[class*='oui-date'] span,[class*='oui-date'] li," +
        "[class*='sycm-date'] button,[class*='sycm-date'] span,[class*='sycm-date'] li," +
        "[class*='dateCycle'] button,[class*='dateCycle'] span,[class*='dateCycle'] li"
      )].find((element) => visible(element) && exactText(element));
      const fallback = [...document.querySelectorAll("button,span,li,[role='button']")]
        .find((element) => visible(element) && exactText(element));
      const target = scoped || fallback;
      if (!target) return { clicked: false };
      target.scrollIntoView({ block: "center" });
      target.click();
      return { clicked: true, tag: target.tagName, className: String(target.className || "").slice(0, 160) };
    }
  });
  return result;
}

export async function waitForDownloadButton(tabId, timeoutMs = 30000) {
  return pollInPage(tabId, timeoutMs, () => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const classMatch = document.querySelector(".sycm-cc-item-rank-download,[class*='sycm-cc-item-rank-download']");
    if (classMatch && visible(classMatch)) return true;
    return [...document.querySelectorAll("button,a,span,[role='button']")]
      .some((element) => visible(element) && (element.textContent || "").trim() === "下载");
  }, "商品排行的下载按钮没有出现");
}

export async function clickDownloadButton(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };
      const stable = document.querySelector(".sycm-cc-item-rank-download,[class*='sycm-cc-item-rank-download']");
      const fallback = [...document.querySelectorAll("button,a,span,[role='button']")]
        .find((element) => visible(element) && (element.textContent || "").trim() === "下载");
      const target = stable && visible(stable) ? stable : fallback;
      if (!target) return { clicked: false };
      target.scrollIntoView({ block: "center" });
      target.click();
      return { clicked: true, tag: target.tagName, className: String(target.className || "").slice(0, 160) };
    }
  });
  if (!result?.clicked) throw new Error("无法点击商品报表下载按钮");
  return result;
}

async function pollInPage(tabId, timeoutMs, predicate, errorMessage) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: predicate });
    if (result) return true;
    await sleep(750);
  }
  throw new Error(errorMessage);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
