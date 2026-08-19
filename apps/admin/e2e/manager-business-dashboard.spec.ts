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

async function login(page: Page, username: "manager" | "linxia"): Promise<void> {
  await page.goto("/login");
  await page.getByRole("combobox", { name: "演示账号" }).selectOption(username);
  await page.getByLabel("演示密码").fill(demoPassword);
  await page.getByRole("button", { name: "进入管理端" }).click();
}

test("MG-17 可从独立路由恢复经营周期、刷新精确指标并导出 CSV", async ({ page }) => {
  await login(page, "manager");
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();

  await page.goto("/manager/business?period=90");
  await expect(page.getByRole("heading", { name: "经营看板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "近 90 天" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("¥13,864.00", { exact: true })).toBeVisible();
  await expect(page.getByText("非实收金额", { exact: true })).toBeVisible();
  await expect(page.getByText("分子不含周转、取消、爽约或服务终止")).toBeVisible();
  await expect(page.getByRole("heading", { name: "已完成服务标价", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "服务终止", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "近 90 天" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("¥13,864.00", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "近 7 天" }).click();
  await expect(page).toHaveURL(/\/manager\/business\?period=7$/);
  await expect(page.getByRole("button", { name: "近 7 天" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const download = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出当前周期 CSV" }).click(),
  ]).then(([file]) => file);
  expect(download.suggestedFilename()).toBe("rongguang-business-7-days-20260813.csv");
});

test("MG-17 员工直达经营路由只看到页面级无权限", async ({ page }) => {
  await login(page, "linxia");
  await expect(page.getByRole("heading", { name: "我的今日工作" })).toBeVisible();

  await page.goto("/manager/business?period=90");
  await expect(page.getByRole("heading", { name: "没有权限" })).toBeVisible();
  await expect(page.getByText("员工身份不能访问店长页面。")).toBeVisible();
});
