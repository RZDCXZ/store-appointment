import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4100";
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

test("MG-16 独立路由按 URL 恢复筛选并展示只读安全事实", async ({ page }) => {
  await loginAsManager(page);
  const exported = await page.request.post(`${apiBaseUrl}/backoffice/manager/business/export.csv`, {
    data: { period: "7" },
    headers: { Origin: "http://127.0.0.1:5174" },
  });
  expect(exported.status()).toBe(200);

  await page.goto("/manager/system/audit?action=data_exported&page=1");
  await expect(page.getByRole("heading", { name: "审计记录" })).toBeVisible();
  await expect(page.getByText("不可修改事实")).toBeVisible();
  await expect(page.getByLabel("动作类型")).toHaveValue("data_exported");
  const records = page.getByRole("list", { name: "审计事实" });
  await expect(records.getByText("导出数据").first()).toBeVisible();
  await expect(records.getByText(/导出.+；共 \d+ 条/).first()).toBeVisible();
  await expect(records.getByRole("button")).toHaveCount(0);

  await page.reload();
  await expect(page.getByLabel("动作类型")).toHaveValue("data_exported");
  await expect(page).toHaveURL(/\/manager\/system\/audit\?action=data_exported&page=1$/);
});
