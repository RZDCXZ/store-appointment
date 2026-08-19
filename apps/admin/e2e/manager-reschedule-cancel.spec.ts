import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

const demoPassword = "Rongguang2026!";
const execFileAsync = promisify(execFile);

test.afterAll(async () => {
  await execFileAsync("corepack", ["pnpm", "--filter", "@rongguang/api", "db:reset"], {
    cwd: new URL("../../../", import.meta.url),
  });
});

async function loginAsManager(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("combobox", { name: "演示账号" }).selectOption("manager");
  await page.getByLabel("演示密码").fill(demoPassword);
  await page.getByRole("button", { name: "进入管理端" }).click();
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
}

test("店长改期与取消使用可刷新独立路由，并在详情中留下原因和通知", async ({ page }) => {
  await loginAsManager(page);

  await page.goto("/manager/appointments/booking-bohe-future/reschedule");
  await expect(page.getByRole("heading", { name: "店长改期" })).toBeVisible();
  await expect(page.getByText(/原安排：陈嘉/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/原安排：陈嘉/)).toBeVisible();
  await page.locator('input[name="suggestion"]').first().check();
  await page.getByLabel("改期原因").fill("顾客电话确认调整到建议时段");
  await page.getByRole("button", { name: "确认新安排" }).click();
  await expect(page.getByRole("heading", { name: "改期成功" })).toBeVisible();
  await expect(page.getByText(/核销码已轮换/)).toBeVisible();

  await page.goto("/manager/appointments/booking-bohe-future/cancel");
  await expect(page.getByRole("heading", { name: "取消预约" })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/取消后将立即释放实际占用/)).toBeVisible();
  await page.getByLabel("取消原因").fill("顾客确认本次不再到店");
  await page.getByRole("button", { name: "确认取消预约" }).click();
  await expect(page.getByRole("heading", { name: "预约已取消" })).toBeVisible();
  await expect(page.getByText(/实际占用已释放，核销码已作废/)).toBeVisible();

  await page.getByRole("link", { name: "查看历史与通知" }).click();
  await expect(page.getByRole("heading", { name: "薄荷的预约" })).toBeVisible();
  await expect(page.getByText("顾客电话确认调整到建议时段")).toBeVisible();
  await expect(page.getByText("顾客确认本次不再到店")).toBeVisible();
  await expect(page.getByText("booking_rescheduled", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("booking_cancelled", { exact: true }).first()).toBeVisible();
});
