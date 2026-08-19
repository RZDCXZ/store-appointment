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

test("MG-18 直达与刷新后推进演示时间，并经两步确认确定性重置", async ({ page }) => {
  await loginAsManager(page);

  await page.goto("/manager/system/demo");
  await expect(page.getByRole("heading", { name: "演示时间与数据重置" })).toBeVisible();
  await expect(page.getByText("DEMO_NOW 已启用")).toBeVisible();
  await expect(page.getByText(/2026年8月13日.*10:50/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "演示时间与数据重置" })).toBeVisible();

  await page.getByRole("button", { name: "+15 分钟" }).click();
  await expect(page.getByRole("status")).toContainText("演示时间已推进");
  await expect(page.getByText(/2026年8月13日.*11:05/).first()).toBeVisible();

  await page.getByRole("button", { name: "重置演示数据" }).click();
  const dialog = page.getByRole("dialog", { name: "重置演示数据" });
  await expect(dialog.getByText("上传文件会被清理，种子素材会恢复")).toBeVisible();
  await expect(dialog.getByText("全部后台与小程序旧会话会失效")).toBeVisible();
  await dialog.getByRole("button", { name: "继续确认" }).click();
  const finalReset = dialog.getByRole("button", { name: "确认重置演示数据" });
  await expect(finalReset).toBeDisabled();
  await dialog.getByLabel("请输入：重置茸光演示数据").fill("重置茸光演示数据");
  await finalReset.click();

  await expect(page.getByRole("status")).toContainText("全部旧会话现在均已失效");
  const oldSession = await page.request.get(`${apiBaseUrl}/auth/session`);
  expect(oldSession.status()).toBe(401);
  await expect(page.getByRole("link", { name: "请重新登录" })).toBeVisible();
});
