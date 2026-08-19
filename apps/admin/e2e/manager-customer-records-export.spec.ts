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

test("MG-14 可从独立路由恢复顾客和宠物档案，并下载当前筛选 CSV/JSON", async ({ page }) => {
  await loginAsManager(page);

  await page.goto("/manager/customers?q=%E8%96%84%E8%8D%B7&page=1");
  await expect(page.getByRole("heading", { name: "顾客档案" })).toBeVisible();
  await expect(page.getByLabel("搜索顾客或宠物")).toHaveValue("薄荷");
  await expect(page.getByText("139****0341")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看程墨档案" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "查看薄荷档案" })).toBeVisible();

  const jsonDownload = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出当前筛选 JSON" }).click(),
  ]).then(([download]) => download);
  expect(jsonDownload.suggestedFilename()).toBe("rongguang-customers-pets-20260813.json");

  await page.goto("/manager/customers/customer-cheng-mo");
  await expect(page.getByRole("heading", { name: "程墨" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "预约与服务历史" })).toBeVisible();
  await expect(page.getByText("更正：耳部清洁仅完成外耳可见区域。")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "查看薄荷档案" })).toBeVisible();

  await page.goto("/manager/customers/customer-cheng-mo/pets/pet-bohe");
  await expect(page.getByRole("heading", { name: "薄荷" })).toBeVisible();
  await expect(page.getByRole("region", { name: "护理注意事项（顾客填写）" })).toContainText(
    "请与犬只保持距离",
  );
  await expect(page.getByRole("region", { name: "门店服务记录（内部）" })).toContainText(
    "洗护过程配合良好",
  );
  await page.reload();
  await expect(page.getByText("沈青 · 2026/08/06 11:35")).toBeVisible();

  await page.goto(
    "/manager/appointments/list?date=2026-08-14&status=confirmed&staffId=chenjia&primaryServiceId=cat-care&q=%E8%96%84%E8%8D%B7",
  );
  await expect(page.getByRole("heading", { name: "预约列表" })).toBeVisible();
  const csvDownload = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出当前筛选 CSV" }).click(),
  ]).then(([download]) => download);
  expect(csvDownload.suggestedFilename()).toBe("rongguang-bookings-20260813.csv");
});
