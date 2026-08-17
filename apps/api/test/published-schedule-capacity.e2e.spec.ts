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

  if (typeof setCookie !== "string") {
    throw new Error("登录响应没有设置会话 Cookie");
  }

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

describe("已发布排班形成可预约容量", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("店长可读取上海未来十四天中的具体日期已发布容量", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-13",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      businessHours: { closesAt: "19:00", opensAt: "09:30", status: "open" },
      demoNow: "2026-08-13T02:50:00.000Z",
      draftDayCount: 0,
      selectedDate: "2026-08-13",
      timeZone: "Asia/Shanghai",
      window: { endsOn: "2026-08-26", startsOn: "2026-08-13" },
    });

    const body = response.json();

    expect(body.window.days).toHaveLength(14);
    expect(
      body.staffDays.map((day: { staff: { displayName: string } }) => day.staff.displayName),
    ).toEqual(["林夏", "陈嘉", "周宁", "赵航"]);
    expect(body.staffDays[0]).toMatchObject({
      scheduleStatus: "published",
      source: "weekly_template",
      staff: {
        employeeNumber: 1,
        id: "linxia",
        skills: ["dog-basic-care", "dog-styling", "nail-care", "deshedding-care", "oral-care"],
      },
    });
  });

  it("周模板和未发布草稿都不会形成可预约容量", async () => {
    await database.pool.query(
      `
        INSERT INTO weekly_shift_templates (id, staff_id, weekday, starts_at, ends_at)
        VALUES ('test-zhaohang-sunday-template', 'zhaohang', 0, '09:30', '19:00')
      `,
    );
    await database.pool.query(
      `
        INSERT INTO staff_schedule_days (
          id, staff_id, local_date, publication_status, source, published_at
        )
        VALUES (
          'test-zhaohang-sunday-draft', 'zhaohang', '2026-08-16', 'draft',
          'weekly_template', NULL
        )
      `,
    );
    await database.pool.query(
      `
        INSERT INTO staff_schedule_shifts (id, schedule_day_id, starts_at, ends_at)
        VALUES ('test-zhaohang-sunday-draft-shift', 'test-zhaohang-sunday-draft', '09:30', '19:00')
      `,
    );

    try {
      const response = await app.inject({
        method: "GET",
        url: "/backoffice/manager/schedule?date=2026-08-16",
        headers: { cookie: managerCookie },
      });
      const zhaoHang = response
        .json()
        .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "zhaohang");

      expect(response.statusCode).toBe(200);
      expect(zhaoHang).toMatchObject({
        scheduleStatus: "no_schedule",
        shifts: [],
        source: null,
      });
    } finally {
      await database.pool.query(
        "DELETE FROM staff_schedule_days WHERE id = 'test-zhaohang-sunday-draft'",
      );
      await database.pool.query(
        "DELETE FROM weekly_shift_templates WHERE id = 'test-zhaohang-sunday-template'",
      );
    }
  });

  it("已发布班次中的休息会把容量切成互不相连的区间", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-13",
      headers: { cookie: managerCookie },
    });
    const linXia = response
      .json()
      .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "linxia");

    expect(linXia.shifts).toEqual([
      {
        startsAt: "09:30",
        endsAt: "18:00",
        breaks: [{ startsAt: "12:30", endsAt: "13:15" }],
        capacity: [
          { startsAt: "09:30", endsAt: "12:30" },
          { startsAt: "13:15", endsAt: "18:00" },
        ],
      },
    ]);
  });

  it("具体日期例外覆盖周模板的常规班次与休息", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-15",
      headers: { cookie: managerCookie },
    });
    const linXia = response
      .json()
      .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "linxia");

    expect(linXia).toMatchObject({
      source: "date_exception",
      exception: {
        kind: "adjusted_shift",
        note: "周六门店活动，调整到岗与休息时间。",
      },
      shifts: [
        {
          startsAt: "11:00",
          endsAt: "19:00",
          breaks: [{ startsAt: "15:00", endsAt: "15:30" }],
          capacity: [
            { startsAt: "11:00", endsAt: "15:00" },
            { startsAt: "15:30", endsAt: "19:00" },
          ],
        },
      ],
    });
  });

  it("周一闭店，周日只有不具备犬造型美容技能的员工有已发布班次", async () => {
    const sundayResponse = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-16",
      headers: { cookie: managerCookie },
    });
    const sunday = sundayResponse.json();
    const scheduledSundayStaff = sunday.staffDays.filter(
      (day: { scheduleStatus: string }) => day.scheduleStatus === "published",
    );

    expect(sunday.businessHours).toEqual({
      status: "open",
      opensAt: "09:30",
      closesAt: "19:00",
    });
    expect(
      scheduledSundayStaff.map((day: { staff: { displayName: string } }) => day.staff.displayName),
    ).toEqual(["陈嘉", "周宁"]);
    expect(
      scheduledSundayStaff.every(
        (day: { staff: { skills: string[] } }) => !day.staff.skills.includes("dog-styling"),
      ),
    ).toBe(true);

    const mondayResponse = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-17",
      headers: { cookie: managerCookie },
    });
    const monday = mondayResponse.json();

    expect(monday.businessHours).toEqual({ status: "closed", opensAt: null, closesAt: null });
    expect(
      monday.staffDays.every(
        (day: { scheduleStatus: string }) => day.scheduleStatus === "no_schedule",
      ),
    ).toBe(true);
  });

  it("十四日窗口包含首尾日期并拒绝窗口外与非法日期", async () => {
    for (const date of ["2026-08-13", "2026-08-26"]) {
      const response = await app.inject({
        method: "GET",
        url: `/backoffice/manager/schedule?date=${date}`,
        headers: { cookie: managerCookie },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().selectedDate).toBe(date);
    }

    for (const date of ["2026-08-12", "2026-08-27"]) {
      const response = await app.inject({
        method: "GET",
        url: `/backoffice/manager/schedule?date=${date}`,
        headers: { cookie: managerCookie },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "OUTSIDE_SCHEDULE_WINDOW" });
    }

    const invalidResponse = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-02-30",
      headers: { cookie: managerCookie },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({ code: "INVALID_SCHEDULE_DATE" });
  });

  it("未登录与员工身份都不能读取完整门店容量", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-13",
    });
    const staffCookie = await login(app, "linxia");
    const forbidden = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule?date=2026-08-13",
      headers: { cookie: staffCookie },
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({
      code: "FORBIDDEN",
      message: "员工不能访问排班管理或完整门店容量。",
    });
  });
});
