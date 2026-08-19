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

test("MG-15 从风险队列直达失败详情，刷新恢复，并可注入失败后人工重试成功", async ({ page }) => {
  await loginAsManager(page);

  const risk = page.getByRole("link", { name: /通知最终失败/ });
  await expect(risk).toHaveAttribute(
    "href",
    "/manager/system/notifications/notification-seed-final-failed",
  );
  await risk.click();

  await expect(page).toHaveURL(/\/manager\/system\/notifications\/notification-seed-final-failed$/);
  await expect(page.getByRole("heading", { name: "预约改期通知" })).toBeVisible();
  await expect(page.getByText("通知失败不会撤销已经成立的预约事实。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "发送尝试" })).toBeVisible();
  await expect(page.getByText("累计尝试 3 次")).toBeVisible();

  await page.reload();
  await expect(page.getByText("累计尝试 3 次")).toBeVisible();
  await expect(page.getByText("自动重试已用尽，等待人工重试")).toBeVisible();

  await page.getByRole("button", { name: "注入下一次模拟失败" }).click();
  await expect(page.getByText("已注入 1 次模拟失败。")).toBeVisible();
  await page.getByRole("button", { name: "人工重试" }).click();
  await expect(page.getByText("累计尝试 4 次")).toBeVisible();
  await expect(page.getByText("第 4 次 · 人工重试")).toBeVisible();
  await expect(page.getByRole("button", { name: "人工重试" })).toBeVisible();

  await page.getByRole("button", { name: "人工重试" }).click();
  await expect(page.locator(".notification-status")).toHaveText("已发送");
  await expect(page.getByText("第 5 次 · 人工重试")).toBeVisible();
  await expect(page.getByRole("button", { name: "人工重试" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "注入下一次模拟失败" })).toHaveCount(0);

  await page.goto("/manager/workbench");
  await expect(page.getByRole("heading", { name: "风险队列" })).toBeVisible();
  await expect(page.getByRole("link", { name: /通知最终失败/ })).toHaveCount(0);
});
