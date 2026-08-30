import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrganizedFilename,
  buildItemRankUrl,
  getCustomRange,
  getPresetRange,
  isAllowedSycmUrl,
  isDownloadCandidate,
  isItemRankUrl,
  makeTask,
  parseReportDateRange,
  reportRangeMatchesTask
} from "../src/core.js";

test("近 7 天排除今天并包含昨天", () => {
  const range = getPresetRange("recent7", new Date(2026, 7, 24, 15));
  assert.deepEqual(range, {
    presetName: "recent7",
    label: "7天",
    dateType: "recent7",
    startDate: "2026-08-17",
    endDate: "2026-08-23"
  });
});

test("按账号安全整理下载文件", () => {
  assert.equal(
    buildOrganizedFilename("/tmp/商品_2026-08-10_2026-08-10.xls", "旗舰店/A"),
    "生意参谋报表/旗舰店_A/商品_2026-08-10_2026-08-10.xls"
  );
});

test("自定义日期生成单日报表范围", () => {
  assert.deepEqual(getCustomRange("2026-08-10", new Date(2026, 7, 24)), {
    presetName: "custom",
    label: "自定义日期",
    dateType: "day",
    startDate: "2026-08-10",
    endDate: "2026-08-10"
  });
  assert.throws(() => getCustomRange("2026-08-24", new Date(2026, 7, 24)), /最多只能选择昨天/);
  assert.throws(() => getCustomRange("2026-02-30", new Date(2026, 7, 24)), /日期不存在/);
});

test("商品排行 URL 使用受限 HTTPS 域名和编码日期", () => {
  const url = buildItemRankUrl(getPresetRange("recent7", new Date(2026, 7, 24)));
  assert.equal(url, "https://sycm.taobao.com/cc/item_rank?dateRange=2026-08-17%7C2026-08-23&dateType=recent7");
  assert.equal(isItemRankUrl(url), true);
});

test("只允许精确的生意参谋域名", () => {
  assert.equal(isAllowedSycmUrl("https://sycm.taobao.com/cc/item_rank"), true);
  assert.equal(isAllowedSycmUrl("http://sycm.taobao.com/cc/item_rank"), false);
  assert.equal(isAllowedSycmUrl("https://sycm.taobao.com.evil.example/"), false);
  assert.equal(isAllowedSycmUrl("https://taobao.com/"), false);
});

test("下载监听忽略任务开始前的文件", () => {
  const task = makeTask({ id: "t1", tabId: 1, presetName: "recent7", now: new Date("2026-08-24T00:00:00Z") });
  task.phase = "waiting_download";
  task.waitingSince = "2026-08-24T00:00:10Z";
  assert.equal(isDownloadCandidate({
    startTime: "2026-08-24T00:00:01Z",
    filename: "/tmp/report.xlsx"
  }, task), false);
  assert.equal(isDownloadCandidate({
    startTime: "2026-08-24T00:00:11Z",
    filename: "/tmp/report.xlsx"
  }, task), true);
});

test("从商品报表文件名核验实际日期", () => {
  const filename = "/Users/example/Downloads/【生意参谋平台】商品_全部_2026-08-22_2026-08-22.xls";
  assert.deepEqual(parseReportDateRange(filename), {
    startDate: "2026-08-22",
    endDate: "2026-08-22"
  });
  const task = makeTask({ id: "t2", tabId: 1, presetName: "yesterday", now: new Date(2026, 7, 24) });
  assert.equal(reportRangeMatchesTask(filename, task), false);
  assert.equal(reportRangeMatchesTask(
    "/tmp/【生意参谋平台】商品_全部_2026-08-23_2026-08-23.xls",
    task
  ), true);
});
