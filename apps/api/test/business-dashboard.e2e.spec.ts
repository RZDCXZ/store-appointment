import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";

function sessionCookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const setCookie = Array.isArray(value) ? value[0] : value;
  if (typeof setCookie !== "string") throw new Error("登录响应没有设置会话 Cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

async function login(app: NestFastifyApplication, username: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { origin: adminOrigin },
    payload: { username, password: "Rongguang2026!" },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

describe("店长经营看板 API", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "linxia");
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("默认三十天按最终计划开始日汇总唯一指标，并返回前一等长周期与九十天复访分母", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/business/metrics",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      timeZone: "Asia/Shanghai",
      demoNow: "2026-08-13T02:50:00.000Z",
      periodDays: 30,
      currentPeriodRevision: expect.any(String),
      currentWindow: { startsOn: "2026-07-15", endsOn: "2026-08-13" },
      previousWindow: { startsOn: "2026-06-15", endsOn: "2026-07-14" },
      current: {
        bookingCount: 58,
        completedBookingCount: 38,
        completedServiceMinutes: 2310,
        availableStaffMinutes: 39_150,
        utilizationRate: 2310 / 39_150,
        completedListPriceCents: 490_400,
        cancellationCount: 6,
        cancellationDenominator: 58,
        cancellationRate: 6 / 58,
        noShowCount: 6,
        noShowDenominator: 52,
        noShowRate: 6 / 52,
        terminationCount: 4,
        terminationDenominator: 58,
        terminationRate: 4 / 58,
      },
      previous: {
        bookingCount: 50,
        completedBookingCount: 37,
        completedServiceMinutes: 2220,
        availableStaffMinutes: 37_350,
        utilizationRate: 2220 / 37_350,
        completedListPriceCents: 473_600,
        cancellationCount: 4,
        cancellationDenominator: 50,
        cancellationRate: 4 / 50,
        noShowCount: 4,
        noShowDenominator: 46,
        noShowRate: 4 / 46,
        terminationCount: 5,
        terminationDenominator: 50,
        terminationRate: 5 / 50,
      },
      revisit90Days: {
        periodDays: 90,
        currentWindow: { startsOn: "2026-05-16", endsOn: "2026-08-13" },
        previousWindow: { startsOn: "2026-02-15", endsOn: "2026-05-15" },
        current: {
          completedCustomerCount: 18,
          revisitCustomerCount: 16,
          revisitRate: 16 / 18,
        },
        previous: {
          completedCustomerCount: 16,
          revisitCustomerCount: 16,
          revisitRate: 1,
        },
      },
    });
  });

  it("只接受七、三十、九十天，并拒绝员工读取经营指标", async () => {
    const invalid = await app.inject({
      method: "GET",
      url: "/backoffice/manager/business/metrics?period=14",
      headers: { cookie: managerCookie },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/backoffice/manager/business/metrics?period=7",
      headers: { cookie: staffCookie },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "INVALID_BUSINESS_PERIOD" });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("只扣除生效停班，待处理停班不改变服务工时利用率分母", async () => {
    await database.pool.query(
      `INSERT INTO staff_time_off_intervals (
         id, staff_id, local_date, starts_at, ends_at, status, reason
       ) VALUES
         ('business-active-time-off', 'linxia', '2026-08-13', '09:30', '10:30', 'active',
          '经营看板生效停班'),
         ('business-pending-time-off', 'chenjia', '2026-08-13', '10:30', '11:30', 'pending',
          '经营看板待处理停班')`,
    );

    try {
      const response = await app.inject({
        method: "GET",
        url: "/backoffice/manager/business/metrics?period=30",
        headers: { cookie: managerCookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().current).toMatchObject({
        completedServiceMinutes: 2310,
        availableStaffMinutes: 39_090,
        utilizationRate: 2310 / 39_090,
      });
    } finally {
      await database.pool.query(
        "DELETE FROM staff_time_off_intervals WHERE id IN ('business-active-time-off', 'business-pending-time-off')",
      );
    }
  });

  it("以最终计划开始日跨越上海午夜时，在七天当前期与前期之间确定归属", async () => {
    const original = await database.pool.query<{
      starts_at: Date;
      ends_at: Date;
      occupancy_starts_at: Date;
      occupancy_ends_at: Date;
    }>(
      `SELECT starts_at, ends_at, occupancy_starts_at, occupancy_ends_at
       FROM bookings WHERE id = 'booking-bohe-future'`,
    );

    try {
      await database.pool.query(
        `UPDATE bookings
         SET starts_at = '2026-08-06T16:00:00.000Z',
             ends_at = '2026-08-06T17:30:00.000Z',
             occupancy_starts_at = '2026-08-06T16:00:00.000Z',
             occupancy_ends_at = '2026-08-06T17:45:00.000Z'
         WHERE id = 'booking-bohe-future'`,
      );
      const atMidnight = await app.inject({
        method: "GET",
        url: "/backoffice/manager/business/metrics?period=7",
        headers: { cookie: managerCookie },
      });

      await database.pool.query(
        `UPDATE bookings
         SET starts_at = '2026-08-06T15:59:59.999Z',
             ends_at = '2026-08-06T17:29:59.999Z',
             occupancy_starts_at = '2026-08-06T15:59:59.999Z',
             occupancy_ends_at = '2026-08-06T17:44:59.999Z'
         WHERE id = 'booking-bohe-future'`,
      );
      const beforeMidnight = await app.inject({
        method: "GET",
        url: "/backoffice/manager/business/metrics?period=7",
        headers: { cookie: managerCookie },
      });

      expect(atMidnight.json()).toMatchObject({
        current: { bookingCount: 15 },
        previous: { bookingCount: 15 },
      });
      expect(beforeMidnight.json()).toMatchObject({
        current: { bookingCount: 14 },
        previous: { bookingCount: 16 },
      });
    } finally {
      const row = original.rows[0];
      if (row) {
        await database.pool.query(
          `UPDATE bookings
           SET starts_at = $1, ends_at = $2, occupancy_starts_at = $3, occupancy_ends_at = $4
           WHERE id = 'booking-bohe-future'`,
          [row.starts_at, row.ends_at, row.occupancy_starts_at, row.occupancy_ends_at],
        );
      }
    }
  });

  it("按当前周期返回每日精确序列", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/business/series?period=30",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      periodDays: 30,
      window: { startsOn: "2026-07-15", endsOn: "2026-08-13" },
      points: expect.arrayContaining([
        expect.objectContaining({
          localDate: "2026-08-02",
          completedBookingCount: 2,
          completedServiceMinutes: 120,
          availableStaffMinutes: 900,
          utilizationRate: 120 / 900,
          completedListPriceCents: 25_600,
        }),
        expect.objectContaining({
          localDate: "2026-08-13",
          completedBookingCount: 0,
          completedServiceMinutes: 0,
          availableStaffMinutes: 1800,
          utilizationRate: 0,
          completedListPriceCents: 0,
        }),
      ]),
    });
    expect(response.json().points).toHaveLength(30);
    const metrics = await app.inject({
      method: "GET",
      url: "/backoffice/manager/business/metrics?period=30",
      headers: { cookie: managerCookie },
    });
    expect(response.json().currentPeriodRevision).toBe(metrics.json().currentPeriodRevision);
  });

  it("按当前周期导出每日经营 CSV 并写入审计事实", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/business/export.csv",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { period: "7" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain(
      "rongguang-business-7-days-20260813.csv",
    );
    expect(response.body).toContain("已完成服务标价（非实收金额）");
    expect(response.body).toContain("2026-08-13");

    const audit = await database.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_events
       WHERE event_type = 'data_exported'
         AND payload->>'exportType' = 'business_metrics_csv'
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    );
    expect(audit.rows).toEqual([
      {
        payload: {
          exportType: "business_metrics_csv",
          filters: { periodDays: 7 },
          recordCount: 7,
        },
      },
    ]);
  });
});
