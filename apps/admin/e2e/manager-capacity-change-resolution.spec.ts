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

async function loginAsManager(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("combobox", { name: "演示账号" }).selectOption("manager");
  await page.getByLabel("演示密码").fill(demoPassword);
  await page.getByRole("button", { name: "进入管理端" }).click();
  await expect(page.getByRole("heading", { name: "今日工作台" })).toBeVisible();
}

async function customerToken(request: APIRequestContext): Promise<string> {
  const session = await request.post(`${apiBaseUrl}/miniapp/demo-sessions`, {
    data: { customerKey: "xu-lan" },
  });
  expect(session.status()).toBe(201);
  const accessToken = ((await session.json()) as { accessToken: string }).accessToken;
  const consent = await request.post(`${apiBaseUrl}/miniapp/privacy-consent`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { version: "2026.08", accepted: true },
  });
  expect(consent.status()).toBe(201);
  return accessToken;
}

async function createBooking(
  request: APIRequestContext,
  accessToken: string,
  idempotencyKey: string,
  startsAt: string,
): Promise<string> {
  const response = await request.post(`${apiBaseUrl}/miniapp/bookings`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: {
      idempotencyKey,
      petId: "pet-tuanzi",
      primaryServiceId: "dog-basic-care",
      addonIds: [],
      staffId: "linxia",
      startsAt,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { booking: { id: string } }).booking.id;
}

test("店长从工作台进入独立路由，刷新恢复进度并逐笔完成停班影响", async ({ page }) => {
  await loginAsManager(page);
  const accessToken = await customerToken(page.request);
  await createBooking(
    page.request,
    accessToken,
    "playwright-capacity-impact-first",
    "2026-08-18T02:30:00.000Z",
  );
  await createBooking(
    page.request,
    accessToken,
    "playwright-capacity-impact-second",
    "2026-08-18T06:00:00.000Z",
  );
  const created = await page.request.post(`${apiBaseUrl}/backoffice/manager/capacity-changes`, {
    headers: { origin: "http://127.0.0.1:5174" },
    data: {
      kind: "time_off",
      staffId: "linxia",
      localDate: "2026-08-18",
      startsAt: "10:30",
      endsAt: "15:15",
      reason: "参加全天护理培训",
    },
  });
  expect(created.status()).toBe(201);
  const changeId = ((await created.json()) as { change: { id: string } }).change.id;
  const route = `/manager/schedule/capacity-changes/time_off/${changeId}`;

  await page.goto("/manager/workbench");
  const risk = page.getByRole("link", { name: /待处理停班.*影响 2 笔预约/ });
  await expect(risk).toHaveAttribute("href", route);
  await risk.click();
  await expect(page).toHaveURL(new RegExp(`${changeId}$`));
  await expect(page.getByRole("heading", { name: "处理受影响预约" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "0 / 2 已处理" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "0 / 2 已处理" })).toBeVisible();

  const cards = page.locator(".impact-booking-card");
  await expect(cards).toHaveCount(2);
  const first = cards.first();
  await first.getByLabel("团子接手员工").selectOption("zhaohang");
  await first.getByLabel("团子处理原因").fill("顾客确认同时间改由赵航服务");
  await first.getByRole("button", { name: "保存本笔处理结果" }).click();
  await expect(page.getByRole("heading", { name: "1 / 2 已处理" })).toBeVisible();
  await expect(first.getByText("同时间换员工已成立")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "1 / 2 已处理" })).toBeVisible();
  const second = page.locator(".impact-booking-card").nth(1);
  await second.getByText("取消预约", { exact: true }).click();
  await expect(second.getByText("团子的本次预约已取消。", { exact: true })).toBeVisible();
  await second.getByLabel("团子取消原因").fill("顾客确认培训期间取消本次预约");
  await second.getByRole("button", { name: "保存本笔处理结果" }).click();

  await expect(page.getByRole("heading", { name: "2 / 2 已处理" })).toBeVisible();
  await expect(page.getByText("已生效", { exact: true })).toBeVisible();
  await expect(page.getByText("全部受影响预约已处理，容量变化已正式生效。")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "2 / 2 已处理" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${changeId}$`));

  await page.goto("/manager/workbench");
  await expect(page.locator(`a[href="${route}"]`)).toHaveCount(0);
});

test("预约事实再次变化后刷新确认页，并用新命令键重试", async ({ page }) => {
  await loginAsManager(page);
  const accessToken = await customerToken(page.request);
  const bookingId = await createBooking(
    page.request,
    accessToken,
    "playwright-capacity-stale-acknowledgement",
    "2026-08-25T02:00:00.000Z",
  );
  const created = await page.request.post(`${apiBaseUrl}/backoffice/manager/capacity-changes`, {
    headers: { origin: "http://127.0.0.1:5174" },
    data: {
      kind: "time_off",
      staffId: "linxia",
      localDate: "2026-08-25",
      startsAt: "10:00",
      endsAt: "11:15",
      reason: "参加护理培训复训",
    },
  });
  expect(created.status()).toBe(201);
  const changeId = ((await created.json()) as { change: { id: string } }).change.id;
  const managerOrigin = { origin: "http://127.0.0.1:5174" };

  async function moveBooking(idempotencyKey: string, reason: string): Promise<void> {
    const options = await page.request.get(
      `${apiBaseUrl}/backoffice/manager/bookings/${bookingId}/reschedule-options`,
    );
    expect(options.status()).toBe(200);
    const facts = (await options.json()) as {
      bookingRevision: number;
      booking: { staff: { id: string }; startsAt: string };
      availability: {
        days: Array<{ slots: Array<{ staff: { id: string }; startsAt: string }> }>;
      } | null;
    };
    const target = facts.availability?.days.flatMap((day) => day.slots)[0];
    expect(target).toBeDefined();
    const moved = await page.request.post(
      `${apiBaseUrl}/backoffice/manager/bookings/${bookingId}/reschedule`,
      {
        headers: managerOrigin,
        data: {
          idempotencyKey,
          reason,
          expectedStaffId: facts.booking.staff.id,
          expectedStartsAt: facts.booking.startsAt,
          expectedBookingRevision: facts.bookingRevision,
          staffId: target?.staff.id,
          startsAt: target?.startsAt,
        },
      },
    );
    expect(moved.status(), await moved.text()).toBe(201);
  }

  const route = `/manager/schedule/capacity-changes/time_off/${changeId}`;
  await page.goto(route);
  await expect(page.getByRole("heading", { name: "0 / 1 已处理" })).toBeVisible();
  await moveBooking("playwright-capacity-first-external-move", "首次从预约详情移出停班区间");
  await page.reload();

  const card = page.locator(".impact-booking-card");
  await expect(card.getByText("这笔预约已在其他入口解除本次容量影响")).toBeVisible();
  await card.getByLabel("团子确认现有结果原因").fill("已核对第一次外部改期结果");
  await moveBooking("playwright-capacity-second-external-move", "处理页打开后预约再次变化");

  const refreshed = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url() === `${apiBaseUrl}/backoffice/manager/capacity-changes/time_off/${changeId}`,
  );
  await card.getByRole("button", { name: "确认现有结果" }).click();
  await expect(page.getByRole("alert")).toContainText("预约事实已再次变化");
  await refreshed;

  await card.getByRole("button", { name: "确认现有结果" }).click();
  await expect(page.getByRole("heading", { name: "1 / 1 已处理" })).toBeVisible();
  await expect(card.getByText("确认现有结果已成立")).toBeVisible();
});
