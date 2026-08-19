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

async function login(page: Page, username: "chenjia" | "linxia"): Promise<void> {
  await page.goto("/login");
  await page.getByRole("combobox", { name: "演示账号" }).selectOption(username);
  await page.getByLabel("演示密码").fill(demoPassword);
  await page.getByRole("button", { name: "进入管理端" }).click();
  await expect(page).toHaveURL(/\/staff\/today$/);
}

test("员工在 390px 直达今日工作、恢复本人详情并确认揭示手机号", async ({ page }) => {
  const bookingId = "booking-maiya-today";
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "linxia");

  await expect(page).toHaveURL(/\/staff\/today$/);
  await expect(page.getByRole("heading", { name: "我的今日工作" })).toBeVisible();
  await expect(page.getByText("林夏 · 员工")).toBeVisible();
  await expect(page.getByText("班次 09:30–18:00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "下一位宠物" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "麦芽", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "行动队列" })).toBeVisible();
  await expect(page.getByText("待核销", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已确认", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page
    .locator(".staff-next-card")
    .getByRole("link", { name: /查看麦芽预约详情/ })
    .click();
  await expect(page).toHaveURL(`/staff/appointments/${bookingId}`);
  await expect(page.getByRole("heading", { name: "麦芽的预约" })).toBeVisible();
  await expect(page.getByText("需要慢速吹干", { exact: true })).toBeVisible();
  await expect(page.getByText("137****5678", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "历史门店服务记录" })).toBeVisible();
  await expect(page.getByText(/赵航.*犬基础洗护/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "麦芽的预约" })).toBeVisible();

  await page.goto(`/staff/appointments/${bookingId}/check-in`);
  await expect(page.getByRole("heading", { name: "到店核销" })).toBeVisible();
  await expect(page.getByLabel("六位核销码")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.goto(`/staff/appointments/${bookingId}`);

  await page.getByRole("link", { name: "揭示完整号码" }).click();
  await expect(page).toHaveURL(`/staff/appointments/${bookingId}/phone`);
  await expect(page.getByRole("heading", { name: "揭示完整手机号" })).toBeVisible();
  await expect(page.getByText("此次访问会记录在审计中")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "揭示完整手机号" })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并揭示" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "我确认当前履约需要联系顾客" }).check();
  await page.getByRole("button", { name: "确认并揭示" }).click();
  await expect(page.getByText("137 1234 5678", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.goto("/staff/appointments/booking-lizi-cancelled/phone");
  await expect(page.getByRole("heading", { name: "完整手机号不可揭示" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/staff/today");
  await expect(page.getByRole("heading", { name: "我的今日工作" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "麦芽", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByRole("button", { name: "退出登录" }).click();
  await login(page, "chenjia");
  await page.goto(`/staff/appointments/${bookingId}`);
  await expect(page.getByRole("heading", { name: "没有预约访问权限" })).toBeVisible();
  await expect(page.getByText("当前员工只能读取分配给自己的预约。", { exact: true })).toBeVisible();
  await page.goto(`/staff/appointments/${bookingId}/phone`);
  await expect(page.getByRole("heading", { name: "没有手机号访问权限" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新读取" })).toHaveCount(0);
});
