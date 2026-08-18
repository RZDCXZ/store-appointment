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

test("MG-07 可刷新恢复、预检并原子纠正内容，详情保留前后值和通知", async ({ page }) => {
  await loginAsManager(page);

  await page.goto("/manager/appointments/booking-bohe-future/correction");
  await expect(page.getByRole("heading", { name: "纠正预约内容" })).toBeVisible();
  await expect(page.getByText(/4.8 kg.*小型/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/主要服务规格：猫咪洗护.*小型/).first()).toBeVisible();
  await expect(page.getByText("增项：无增项").first()).toBeVisible();

  await page.getByLabel("纠正后体重（kg）").fill("4.9");
  await page.getByRole("checkbox", { name: /修甲护理/ }).check();
  await expect(page.getByText(/4.9 kg.*小型/)).toBeVisible();
  await expect(page.getByText(/主要服务规格：猫咪洗护.*¥168.*90 分钟/).last()).toBeVisible();
  await expect(page.getByText(/预约总计：¥198.*105 分钟/)).toBeVisible();
  await expect(page.getByText("员工技能满足")).toBeVisible();
  await expect(page.getByText("排班与连续容量可用")).toBeVisible();

  await page.getByLabel("纠正原因").fill("顾客确认复秤并增加修甲护理");
  await page.getByRole("button", { name: "确认并保存纠正" }).click();
  await expect(page.getByRole("heading", { name: "预约内容已纠正" })).toBeVisible();
  await expect(page.getByText(/核销码保持不变/)).toBeVisible();

  await page.getByRole("link", { name: "查看预约详情" }).click();
  await expect(page.getByRole("heading", { name: "薄荷的预约" })).toBeVisible();
  await expect(page.getByText("顾客确认复秤并增加修甲护理")).toBeVisible();
  await expect(page.getByText(/原内容：4.8 kg.*无增项.*¥168.*90 分钟/)).toBeVisible();
  await expect(page.getByText(/新内容：4.9 kg.*修甲护理.*¥198.*105 分钟/)).toBeVisible();
  await expect(page.getByText("booking_content_corrected", { exact: true })).toBeVisible();
});
