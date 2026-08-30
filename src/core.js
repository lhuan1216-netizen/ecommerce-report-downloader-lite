export const SYCM_ORIGIN = "https://sycm.taobao.com";
export const ITEM_RANK_PATH = "/cc/item_rank";

export const PRESETS = Object.freeze({
  yesterday: { label: "日", dateType: "day", days: 1 },
  recent7: { label: "7天", dateType: "recent7", days: 7 },
  recent30: { label: "30天", dateType: "recent30", days: 30 }
});

export function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getPresetRange(presetName, now = new Date()) {
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`不支持的周期：${presetName}`);

  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - preset.days + 1);

  return {
    presetName,
    label: preset.label,
    dateType: preset.dateType,
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

export function getCustomRange(customDate, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(customDate || ""))) {
    throw new Error("自定义日期格式无效");
  }
  const [year, month, day] = customDate.split("-").map(Number);
  const selected = new Date(year, month - 1, day);
  if (
    selected.getFullYear() !== year ||
    selected.getMonth() !== month - 1 ||
    selected.getDate() !== day
  ) {
    throw new Error("自定义日期不存在");
  }
  const latest = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  latest.setDate(latest.getDate() - 1);
  if (selected > latest) throw new Error("最多只能选择昨天");
  return {
    presetName: "custom",
    label: "自定义日期",
    dateType: "day",
    startDate: customDate,
    endDate: customDate
  };
}

export function buildItemRankUrl(range) {
  const dateRange = encodeURIComponent(`${range.startDate}|${range.endDate}`);
  return `${SYCM_ORIGIN}${ITEM_RANK_PATH}?dateRange=${dateRange}&dateType=${range.dateType}`;
}

export function isAllowedSycmUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "sycm.taobao.com";
  } catch {
    return false;
  }
}

export function isItemRankUrl(value) {
  if (!isAllowedSycmUrl(value)) return false;
  return new URL(value).pathname === ITEM_RANK_PATH;
}

export function makeTask({ id, tabId, accountName, presetName, customDate, now = new Date() }) {
  const range = presetName === "custom"
    ? getCustomRange(customDate, now)
    : getPresetRange(presetName, now);
  return {
    id,
    kind: "tmall_product_rank",
    tabId,
    accountName: String(accountName || "").trim(),
    presetName,
    range,
    targetUrl: buildItemRankUrl(range),
    status: "running",
    phase: "created",
    attempt: 0,
    maxAttempts: 3,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    download: null,
    error: null,
    logs: []
  };
}

export function buildOrganizedFilename(filename, accountName) {
  const base = String(filename || "report.xls").split(/[\\/]/).pop() || "report.xls";
  const safeAccount = String(accountName || "未命名账号")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 60) || "未命名账号";
  return `生意参谋报表/${safeAccount}/${base}`;
}

export function withLog(task, message, level = "info", now = new Date()) {
  const logs = [...(task.logs || []), {
    at: now.toISOString(),
    level,
    message
  }].slice(-200);
  return { ...task, logs, updatedAt: now.toISOString() };
}

export function isDownloadCandidate(item, task) {
  if (!task || task.phase !== "waiting_download") return false;
  const start = Date.parse(item.startTime || "");
  const waitingSince = Date.parse(task.waitingSince || task.updatedAt || "");
  if (Number.isFinite(start) && Number.isFinite(waitingSince) && start < waitingSince - 2000) {
    return false;
  }
  const source = `${item.url || ""} ${item.finalUrl || ""} ${item.filename || ""}`.toLowerCase();
  return source.includes("taobao") || source.includes("sycm") || /\.xlsx?$/.test(source);
}

export function parseReportDateRange(filename) {
  const match = String(filename || "").match(/_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx?$/i);
  if (!match) return null;
  return { startDate: match[1], endDate: match[2] };
}

export function reportRangeMatchesTask(filename, task) {
  const actual = parseReportDateRange(filename);
  if (!actual || !task?.range) return false;
  return actual.startDate === task.range.startDate && actual.endDate === task.range.endDate;
}
