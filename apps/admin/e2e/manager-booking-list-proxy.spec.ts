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

async function confirmOfflineConsent(page: Page, source: "phone" | "chat" | "in_store") {
  await page.getByLabel("线下同意来源").selectOption(source);
  await page.getByLabel(/已向顾客说明《茸光隐私说明》/).check();
}

test("店长可从独立路由筛选、查详情并代录新旧档案，冲突时不强制占用", async ({ page }) => {
  await loginAsManager(page);

  await page.goto(
    "/manager/appointments/list?date=2026-08-14&status=confirmed&staffId=chenjia&primaryServiceId=cat-care&q=%E8%96%84%E8%8D%B7",
  );
  await expect(page.getByRole("heading", { name: "预约列表" })).toBeVisible();
  await expect(page.getByLabel("预约日期")).toHaveValue("2026-08-14");
  await expect(page.getByLabel("预约状态")).toHaveValue("confirmed");
  await expect(page.getByLabel("员工")).toHaveValue("chenjia");
  await expect(page.getByLabel("主要服务")).toHaveValue("cat-care");
  await expect(page.getByRole("link", { name: "查看薄荷预约详情" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("搜索顾客或宠物")).toHaveValue("薄荷");

  await page.goto("/manager/appointments/booking-bohe-completed");
  await expect(page.getByRole("heading", { name: "薄荷的预约" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "门店服务记录" })).toBeVisible();
  await expect(page.getByText("洗护过程配合良好，耳部清洁完成。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "预约变更历史" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "通知记录" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "薄荷的预约" })).toBeVisible();

  await page.goto("/manager/appointments/proxy");
  await expect(page.getByRole("heading", { name: "代客预约" })).toBeVisible();
  await page.reload();
  await page.getByLabel("已有顾客").selectOption("customer-xu-lan");
  await page.getByLabel("已有宠物").selectOption("pet-tuanzi");
  await page.getByLabel("主要服务").selectOption("dog-basic-care");
  await page.getByLabel("执行员工").selectOption("zhaohang");
  await page.getByLabel("开始时间").fill("2026-08-13T12:00");
  await confirmOfflineConsent(page, "phone");
  await page.getByRole("button", { name: "建立代客预约" }).click();
  await expect(page.getByRole("heading", { name: "代客预约已建立" })).toBeVisible();
  await expect(page.getByText(/已记录沈青按「电话」确认隐私说明 2026.08/)).toBeVisible();

  await page.goto("/manager/appointments/proxy");
  await page.getByRole("radio", { name: "新建顾客与宠物" }).check();
  await page.getByLabel("顾客姓名").fill("乔安");
  await page.getByLabel("顾客手机号").fill("13566081234");
  await page.getByLabel("宠物名称").fill("雪球");
  await page.getByLabel("宠物种类").selectOption("cat");
  await page.getByLabel("宠物体重（kg）").fill("5.2");
  await page.getByLabel("主要服务").selectOption("cat-care");
  await page.getByLabel("执行员工").selectOption("chenjia");
  await page.getByLabel("开始时间").fill("2026-08-13T12:00");
  await confirmOfflineConsent(page, "chat");
  await page.getByRole("button", { name: "建立代客预约" }).click();
  await expect(page.getByRole("heading", { name: "代客预约已建立" })).toBeVisible();
  await expect(page.getByText("雪球的到店核销码")).toBeVisible();

  await page.goto("/manager/appointments/proxy");
  await page.getByLabel("已有顾客").selectOption("customer-cheng-mo");
  await page.getByLabel("已有宠物").selectOption("pet-bohe");
  await page.getByLabel("主要服务").selectOption("cat-care");
  await page.getByLabel("执行员工").selectOption("chenjia");
  await page.getByLabel("开始时间").fill("2026-08-13T12:30");
  await confirmOfflineConsent(page, "in_store");
  await page.getByRole("button", { name: "建立代客预约" }).click();
  await expect(page.getByRole("alert")).toContainText("当前选择已保留");
  await expect(page.getByLabel("执行员工")).toHaveValue("chenjia");
  await expect(page.getByLabel("开始时间")).toHaveValue("2026-08-13T12:30");
});
