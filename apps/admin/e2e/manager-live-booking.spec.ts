import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4100";
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

async function createCustomerBooking(request: APIRequestContext): Promise<string> {
  const session = await request.post(`${apiBaseUrl}/miniapp/demo-sessions`, {
    data: { customerKey: "cheng-mo" },
  });
  expect(session.status()).toBe(201);
  const { accessToken } = (await session.json()) as { accessToken: string };

  const booking = await request.post(`${apiBaseUrl}/miniapp/bookings`, {
    data: {
      addonIds: [],
      idempotencyKey: "playwright-manager-live-booking-20260813",
      petId: "pet-bohe",
      primaryServiceId: "cat-care",
      staffId: "chenjia",
      startsAt: "2026-08-13T07:00:00.000Z",
    },
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(booking.status()).toBe(201);
  const body = (await booking.json()) as { booking: { id: string } };
  return body.booking.id;
}

test("顾客创建预约后，店长经 SSE 回源看到同一事实并保持路由与角色边界", async ({
  page,
  request,
}) => {
  await login(page, "manager");
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
  await expect(page.getByText("实时更新已连接")).toBeVisible();

  const bookingId = await createCustomerBooking(request);

  await expect(page.getByText("薄荷", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByLabel(/薄荷 15:00 至 16:30 已确认/)).toHaveAttribute(
    "href",
    `/manager/appointments/${bookingId}`,
  );

  await page.goto("/manager/appointments/calendar?date=2026-08-13");
  await expect(page.getByRole("heading", { name: "按员工日历" })).toBeVisible();
  await expect(page.getByTestId("manager-calendar-staff")).toHaveCount(4);
  await expect(page.getByRole("link", { name: /薄荷.*猫咪洗护/ })).toHaveAttribute(
    "href",
    `/manager/appointments/${bookingId}`,
  );
  await page.reload();
  await expect(page.getByRole("link", { name: /薄荷.*猫咪洗护/ })).toBeVisible();

  await page.goto(`/manager/appointments/${bookingId}`);
  await expect(page.getByRole("heading", { name: "薄荷的预约" })).toBeVisible();
  await expect(page.getByText(/陈嘉 · 周转 15 分钟/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "薄荷的预约" })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await login(page, "linxia");
  await expect(page.getByRole("heading", { name: "我的今日工作" })).toBeVisible();
  const managerApiStatus = await page.evaluate(async () => {
    const response = await fetch(
      "http://127.0.0.1:4100/backoffice/manager/calendar?date=2026-08-13",
      {
        credentials: "include",
      },
    );
    return response.status;
  });
  expect(managerApiStatus).toBe(403);

  await page.goto("/manager/appointments/calendar?date=2026-08-13");
  await expect(page.getByRole("heading", { name: "没有权限" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回我的工作台" })).toHaveAttribute(
    "href",
    "/staff/today",
  );
});
