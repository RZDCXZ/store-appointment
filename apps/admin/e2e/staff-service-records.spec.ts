import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test, type Page } from "@playwright/test";

const demoPassword = "Rongguang2026!";
const bookingId = "booking-bohe-future";
const execFileAsync = promisify(execFile);
const workspaceRoot = new URL("../../../", import.meta.url);

async function resetCheckedInBooking(): Promise<void> {
  await execFileAsync("corepack", ["pnpm", "--filter", "@rongguang/api", "db:reset"], {
    cwd: workspaceRoot,
  });
  await execFileAsync(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@rongguang/api",
      "exec",
      "node",
      "--input-type=module",
      "--eval",
      `
        import pg from "pg";
        const pool = new pg.Pool({
          connectionString:
            process.env.DATABASE_URL ??
            "postgresql://rongguang:rongguang_local@127.0.0.1:5432/rongguang",
        });
        await pool.query(
          \`UPDATE bookings
           SET status = 'checked_in', completed_at = NULL,
               starts_at = '2026-08-13T02:00:00.000Z',
               ends_at = '2026-08-13T03:30:00.000Z',
               occupancy_starts_at = '2026-08-13T02:00:00.000Z',
               occupancy_ends_at = '2026-08-13T03:45:00.000Z',
               original_starts_at = '2026-08-13T02:00:00.000Z',
               original_ends_at = '2026-08-13T03:30:00.000Z',
               original_occupancy_starts_at = '2026-08-13T02:00:00.000Z',
               original_occupancy_ends_at = '2026-08-13T03:45:00.000Z'
           WHERE id = '${bookingId}'\`,
        );
        await pool.query(
          \`INSERT INTO booking_events (
             id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
           ) VALUES (
             'event-bohe-e2e-checked-in', '${bookingId}', 'booking_checked_in',
             'staff', 'chenjia',
             '{"actor":{"type":"staff","id":"chenjia","displayName":"陈嘉"}}'::jsonb,
             '2026-08-13T02:05:00.000Z'
           )\`,
        );
        await pool.end();
      `,
    ],
    { cwd: workspaceRoot },
  );
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("combobox", { name: "演示账号" }).selectOption("chenjia");
  await page.getByLabel("演示密码").fill(demoPassword);
  await page.getByRole("button", { name: "进入管理端" }).click();
}

test.beforeEach(async ({ page }) => {
  await resetCheckedInBooking();
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
});

test.afterAll(async () => {
  await execFileAsync("corepack", ["pnpm", "--filter", "@rongguang/api", "db:reset"], {
    cwd: workspaceRoot,
  });
});

test("员工在 390px 完成服务、刷新恢复只读记录并追加说明", async ({ page }) => {
  await page.goto(`/staff/appointments/${bookingId}`);
  await page.getByRole("link", { name: "完成服务并保存记录" }).click();
  await expect(page).toHaveURL(`/staff/appointments/${bookingId}/complete`);

  await page.getByRole("button", { name: "情绪稳定" }).click();
  await page.getByLabel("内部文字记录（选填）").fill("洗护过程配合良好。");
  await page.getByRole("button", { name: "完成服务并保存记录" }).click();

  await expect(page.getByRole("status")).toContainText("门店服务记录已保存");
  await expect(page.getByLabel("只读门店服务记录")).toContainText("洗护过程配合良好。");
  await page.reload();
  await expect(page.getByLabel("只读门店服务记录")).toContainText("情绪稳定");

  await page.goto(`/staff/appointments/${bookingId}/service-record`);
  await page.getByLabel("追加说明").fill("补充：左前爪修剪时略有躲闪。");
  await page.getByRole("button", { name: "保存追加说明" }).click();
  await expect(page.getByRole("status")).toContainText("说明已追加");
  await expect(page.getByText("补充：左前爪修剪时略有躲闪。")).toBeVisible();
  await expect(
    page.locator(".staff-service-record-notes").getByText(/陈嘉.*8月13日周四 10:50/),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("补充：左前爪修剪时略有躲闪。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("员工在 390px 填写原因终止服务并在刷新后恢复独立终态", async ({ page }) => {
  await page.goto(`/staff/appointments/${bookingId}`);
  await page.getByRole("link", { name: "服务终止" }).click();
  await expect(page).toHaveURL(`/staff/appointments/${bookingId}/terminate`);

  const submit = page.getByRole("button", { name: "确认服务终止" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("终止原因").fill("宠物持续应激，无法安全继续服务");
  await submit.click();

  await expect(page.getByRole("status")).toContainText("服务已终止");
  await expect(page.getByRole("status")).toContainText("宠物持续应激");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("服务已终止");
  await expect(page.getByRole("status")).toContainText("宠物持续应激，无法安全继续服务");
  await expect(page.getByRole("status")).toContainText("15 分钟周转");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
