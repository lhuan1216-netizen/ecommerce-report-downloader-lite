const phaseLabels = {
  created: "任务已创建",
  navigating: "正在打开商品排行",
  selecting_period: "正在设置报表周期",
  waiting_button: "正在等待下载按钮",
  waiting_download: "正在下载报表",
  retrying: "连接中断，正在重试",
  complete: "下载完成",
  failed: "任务失败",
  complete_with_warning: "下载完成（平台日期回退）",
  cancelled: "任务已取消"
};

const elements = {
  accountName: document.querySelector("#account-name"),
  preset: document.querySelector("#preset"),
  customDateRow: document.querySelector("#custom-date-row"),
  customDate: document.querySelector("#custom-date"),
  start: document.querySelector("#start"),
  resume: document.querySelector("#resume"),
  inspect: document.querySelector("#inspect"),
  cancel: document.querySelector("#cancel"),
  status: document.querySelector("#status"),
  error: document.querySelector("#error"),
  logs: document.querySelector("#logs")
};

initializeDatePicker();
elements.preset.addEventListener("change", updateDatePickerVisibility);
elements.start.addEventListener("click", () => {
  const accountName = elements.accountName.value.trim();
  if (!accountName) {
    showError("请填写账号或店铺名称，用于隔离任务和整理报表");
    return;
  }
  if (elements.preset.value === "custom" && !elements.customDate.value) {
    showError("请选择要下载的日期");
    return;
  }
  act({
    type: "START",
    accountName,
    presetName: elements.preset.value,
    customDate: elements.preset.value === "custom" ? elements.customDate.value : null
  });
});
elements.resume.addEventListener("click", () => act({ type: "RESUME" }));
elements.cancel.addEventListener("click", () => act({ type: "CANCEL" }));
elements.inspect.addEventListener("click", () => act({ type: "INSPECT" }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.activeTask) render(changes.activeTask.newValue);
});

await refresh();

async function act(message) {
  setBusy(true);
  const response = await chrome.runtime.sendMessage(message).catch((error) => ({ ok: false, error: error.message }));
  setBusy(false);
  if (!response?.ok) {
    showError(response?.error || "操作失败");
    return;
  }
  if (message.type === "INSPECT") {
    showError(`页面检查完成：识别到 ${response.value?.interactive?.length || 0} 个交互元素`, false);
  }
  await refresh();
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) return showError(response?.error || "无法读取任务状态");
  if (!elements.accountName.value && response.value.profile?.accountName) {
    elements.accountName.value = response.value.profile.accountName;
  }
  render(response.value.task);
}

function render(task) {
  if (!task) {
    elements.status.textContent = "尚未启动";
    elements.logs.replaceChildren();
    elements.resume.disabled = true;
    elements.cancel.disabled = true;
    return;
  }

  const range = task.range ? `${task.range.startDate} 至 ${task.range.endDate}` : "";
  const attempt = `尝试 ${Math.min(task.attempt + 1, task.maxAttempts)}/${task.maxAttempts}`;
  const account = task.accountName ? `账号：${task.accountName}` : "";
  elements.status.textContent = [phaseLabels[task.phase] || task.phase, account, range, attempt]
    .filter(Boolean)
    .join(" · ");
  elements.resume.disabled = task.status !== "running";
  elements.cancel.disabled = !["running"].includes(task.status);
  elements.start.disabled = task.status === "running";
  elements.preset.disabled = task.status === "running";
  elements.accountName.disabled = task.status === "running";
  elements.customDate.disabled = task.status === "running";

  if (task.error) showError(task.error);
  else if (task.warning) showError(task.warning, false);
  else elements.error.hidden = true;

  const latest = [...(task.logs || [])].reverse().slice(0, 12);
  elements.logs.replaceChildren(...latest.map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.message;
    return item;
  }));
}

function showError(message, isError = true) {
  elements.error.hidden = false;
  elements.error.textContent = message;
  elements.error.style.color = isError ? "#9b2323" : "#17643f";
}

function setBusy(value) {
  for (const button of [elements.start, elements.resume, elements.inspect, elements.cancel]) {
    button.disabled = value;
  }
}

function initializeDatePicker() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const value = formatLocalDate(yesterday);
  elements.customDate.max = value;
  elements.customDate.value = value;
  updateDatePickerVisibility();
}

function updateDatePickerVisibility() {
  elements.customDateRow.hidden = elements.preset.value !== "custom";
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
