import {
  buildOrganizedFilename,
  isAllowedSycmUrl,
  isDownloadCandidate,
  makeTask,
  parseReportDateRange,
  reportRangeMatchesTask,
  withLog
} from "./core.js";
import {
  clickDownloadButton,
  dismissGenericDialog,
  inspectSycmPage,
  waitForDownloadButton,
  waitForItemRankShell,
  waitForTabComplete
} from "./automation.js";

const TASK_KEY = "activeTask";
const SNAPSHOT_KEY = "lastSnapshot";
const PROFILE_KEY = "accountProfile";
const DOWNLOAD_TIMEOUT_ALARM = "sycm-download-timeout";
const RETRY_ALARM = "sycm-retry";
let running = false;

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  void (async () => {
    const task = await getTask();
    if (!isDownloadCandidate(item, task) || !task?.accountName) {
      suggest();
      return;
    }
    suggest({
      filename: buildOrganizedFilename(item.filename, task.accountName),
      conflictAction: "uniquify"
    });
  })().catch(() => suggest());
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((value) => sendResponse({ ok: true, value }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.downloads.onCreated.addListener(async (item) => {
  const task = await getTask();
  if (!isDownloadCandidate(item, task)) return;
  const next = withLog({
    ...task,
    download: {
      id: item.id,
      filename: item.filename || "",
      state: item.state || "in_progress",
      startedAt: item.startTime || new Date().toISOString()
    }
  }, `检测到报表下载：${item.filename || `下载任务 ${item.id}`}`);
  await setTask(next);
});

chrome.downloads.onChanged.addListener(async (delta) => {
  const task = await getTask();
  if (!task?.download || task.download.id !== delta.id) return;
  if (delta.state?.current === "complete") {
    const [item] = await chrome.downloads.search({ id: delta.id });
    const filename = item?.filename || task.download.filename;
    const actualRange = parseReportDateRange(filename);
    if (!reportRangeMatchesTask(filename, task)) {
      const actualLabel = actualRange
        ? `${actualRange.startDate} 至 ${actualRange.endDate}`
        : "无法从文件名确认日期";
      const expectedLabel = `${task.range.startDate} 至 ${task.range.endDate}`;
      const message = `平台尚未提供请求日期：请求 ${expectedLabel}，已下载最新可用日期 ${actualLabel}`;
      const next = withLog({
        ...task,
        status: "complete",
        phase: "complete_with_warning",
        download: {
          ...task.download,
          filename,
          state: "complete",
          completedAt: new Date().toISOString()
        },
        error: null,
        warning: message
      }, message, "warning");
      await chrome.alarms.clear(DOWNLOAD_TIMEOUT_ALARM);
      await setTask(next);
      return;
    }
    const next = withLog({
      ...task,
      status: "complete",
      phase: "complete",
      download: {
        ...task.download,
        filename,
        state: "complete",
        completedAt: new Date().toISOString()
      },
      error: null
    }, "商品报表已下载完成");
    await chrome.alarms.clear(DOWNLOAD_TIMEOUT_ALARM);
    await setTask(next);
  } else if (delta.state?.current === "interrupted") {
    await failOrRetry(`下载被浏览器中断：${delta.error?.current || "未知原因"}`);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === RETRY_ALARM) {
    await runTask();
    return;
  }
  if (alarm.name === DOWNLOAD_TIMEOUT_ALARM) {
    const task = await getTask();
    if (task?.phase === "waiting_download" && task.status === "running") {
      await failOrRetry("等待报表下载完成超时");
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const task = await getTask();
  if (task?.status === "running" && task.tabId === tabId && isAllowedSycmUrl(tab.url || "")) {
    void runTask();
  }
});

chrome.runtime.onStartup.addListener(() => void runTask());

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return {
        task: await getTask(),
        profile: (await chrome.storage.local.get(PROFILE_KEY))[PROFILE_KEY] || null,
        snapshot: (await chrome.storage.local.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] || null
      };
    case "START":
      return startTask(message.accountName, message.presetName, message.customDate);
    case "RESUME":
      await runTask();
      return getTask();
    case "CANCEL":
      return cancelTask();
    case "INSPECT":
      return inspectCurrentPage();
    default:
      throw new Error("未知操作");
  }
}

async function startTask(accountName, presetName, customDate) {
  const normalizedAccountName = String(accountName || "").trim();
  if (!normalizedAccountName) throw new Error("请填写账号或店铺名称");
  const tab = await findSycmTab();
  if (!tab?.id) throw new Error("没有找到已打开的生意参谋标签页，请先登录并保持页面打开");
  let task = makeTask({
    id: crypto.randomUUID(),
    tabId: tab.id,
    accountName: normalizedAccountName,
    presetName,
    customDate
  });
  await chrome.storage.local.set({
    [PROFILE_KEY]: { accountName: normalizedAccountName, updatedAt: new Date().toISOString() }
  });
  task = withLog(task, `为“${task.accountName}”创建报表任务：${task.range.startDate} 至 ${task.range.endDate}`);
  await setTask(task);
  void runTask();
  return task;
}

async function runTask() {
  if (running) return;
  running = true;
  try {
    let task = await getTask();
    if (!task || task.status !== "running") return;

    if (["created", "retrying"].includes(task.phase)) {
      task = await updateTask(task, "navigating", `打开商品排行页面（第 ${task.attempt + 1} 次尝试）`);
      await chrome.tabs.update(task.tabId, { url: task.targetUrl, active: false });
      await waitForTabComplete(task.tabId);
    }

    task = await getTask();
    if (!task || task.status !== "running") return;
    if (task.phase === "navigating") {
      await dismissGenericDialog(task.tabId).catch(() => false);
      await waitForItemRankShell(task.tabId);
      task = await updateTask(task, "selecting_period", "已确认商品排行页面");
    }

    if (task.phase === "selecting_period") {
      task = await updateTask(task, "waiting_button", `已通过 URL 设置日期：${task.range.startDate} 至 ${task.range.endDate}`);
      await delay(2500);
    }

    if (task.phase === "waiting_button") {
      await waitForDownloadButton(task.tabId);
      task = await updateTask(task, "waiting_download", "下载按钮已就绪，开始监听下载");
      task.waitingSince = new Date().toISOString();
      await setTask(task);
      await chrome.alarms.create(DOWNLOAD_TIMEOUT_ALARM, { delayInMinutes: 2 });
      await clickDownloadButton(task.tabId);
    }
  } catch (error) {
    await failOrRetry(error.message);
  } finally {
    running = false;
  }
}

async function failOrRetry(message) {
  let task = await getTask();
  if (!task || task.status !== "running") return;
  const attempt = task.attempt + 1;
  if (attempt < task.maxAttempts) {
    task = withLog({
      ...task,
      phase: "retrying",
      attempt,
      download: null,
      error: message
    }, `${message}；准备重新连接并重试`, "warning");
    await setTask(task);
    await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 0.5 });
    return;
  }
  task = withLog({
    ...task,
    status: "failed",
    phase: "failed",
    attempt,
    error: message
  }, `${message}；已达到最大重试次数`, "error");
  await chrome.alarms.clear(DOWNLOAD_TIMEOUT_ALARM);
  await chrome.alarms.clear(RETRY_ALARM);
  await setTask(task);
}

async function inspectCurrentPage() {
  const tab = await findSycmTab();
  if (!tab?.id) throw new Error("没有找到已打开的生意参谋标签页");
  const snapshot = {
    ...(await inspectSycmPage(tab.id)),
    capturedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
  return snapshot;
}

async function cancelTask() {
  const task = await getTask();
  if (!task) return null;
  const next = withLog({ ...task, status: "cancelled", phase: "cancelled" }, "任务已取消", "warning");
  await chrome.alarms.clear(DOWNLOAD_TIMEOUT_ALARM);
  await chrome.alarms.clear(RETRY_ALARM);
  await setTask(next);
  return next;
}

async function updateTask(task, phase, message) {
  const next = withLog({ ...task, phase }, message);
  await setTask(next);
  return next;
}

async function getTask() {
  return (await chrome.storage.local.get(TASK_KEY))[TASK_KEY] || null;
}

async function setTask(task) {
  await chrome.storage.local.set({ [TASK_KEY]: task });
}

async function findSycmTab() {
  const matching = await chrome.tabs.query({ url: "https://sycm.taobao.com/*" });
  if (!matching.length) return null;
  return matching
    .filter((tab) => isAllowedSycmUrl(tab.url || ""))
    .sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0] || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
