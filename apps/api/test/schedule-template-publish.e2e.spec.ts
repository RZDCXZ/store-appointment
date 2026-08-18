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

async function customerAuthorization(app: NestFastifyApplication): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey: "xu-lan" },
  });

  expect(response.statusCode).toBe(201);
  return `Bearer ${response.json<{ accessToken: string }>().accessToken}`;
}

describe("排班模板、草稿、发布与日期例外", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let customerToken: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    customerToken = await customerAuthorization(app);
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("店长可读取每名员工的每周模板与上海未来十四日草稿工作区", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/schedule/planning",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body).toMatchObject({
      timeZone: "Asia/Shanghai",
      demoNow: "2026-08-13T02:50:00.000Z",
      window: { startsOn: "2026-08-13", endsOn: "2026-08-26" },
      draftDays: [],
    });
    expect(body.staff[0]).toMatchObject({
      id: "linxia",
      displayName: "林夏",
      employeeNumber: 1,
      templateDays: expect.arrayContaining([
        {
          weekday: 4,
          businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
          shifts: [
            {
              startsAt: "09:30",
              endsAt: "18:00",
              breaks: [{ startsAt: "13:00", endsAt: "14:00" }],
            },
          ],
        },
      ]),
    });
    expect(body.staff[0].templateDays).toHaveLength(7);
  });

  it("店长可维护员工工作日、班次和休息，并追加排班模板审计事实", async () => {
    const payload = {
      shifts: [
        {
          startsAt: "09:30",
          endsAt: "13:00",
          breaks: [{ startsAt: "11:00", endsAt: "11:30" }],
        },
      ],
    };

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/templates/zhaohang/0",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const zhaoHang = response
        .json()
        .staff.find((member: { id: string }) => member.id === "zhaohang");
      expect(zhaoHang.templateDays[0]).toEqual({
        weekday: 0,
        businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
        shifts: payload.shifts,
      });

      const audit = await database.pool.query<{ actor_id: string; payload: unknown }>(
        `SELECT actor_id, payload FROM audit_events
         WHERE event_type = 'schedule_template_updated'
           AND subject_id = 'zhaohang:0'
         ORDER BY occurred_at DESC LIMIT 1`,
      );
      expect(audit.rows[0]).toMatchObject({
        actor_id: "manager",
        payload: { staffId: "zhaohang", weekday: 0, shifts: payload.shifts },
      });

      const availability = await app.inject({
        method: "GET",
        url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-basic-care&staffId=zhaohang",
        headers: { authorization: customerToken },
      });
      const sunday = availability
        .json()
        .days.find((day: { date: string }) => day.date === "2026-08-16");
      expect(sunday.slots).toHaveLength(0);
    } finally {
      await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/templates/zhaohang/0",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: { shifts: [] },
      });
    }
  });

  it("系统按上海本地日期从模板生成包含闭店周一的未来十四天草稿", async () => {
    await database.pool.query("DELETE FROM staff_schedule_days WHERE publication_status = 'draft'");

    try {
      const response = await app.inject({
        method: "POST",
        url: "/backoffice/manager/schedule/drafts/generate",
        headers: { cookie: managerCookie, origin: adminOrigin },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.window).toEqual({ startsOn: "2026-08-13", endsOn: "2026-08-26" });
      expect(body.draftDays).toHaveLength(14);
      expect(body.draftDays[0]).toMatchObject({ date: "2026-08-13", weekday: 4 });
      expect(body.draftDays[13]).toMatchObject({ date: "2026-08-26", weekday: 3 });
      const monday = body.draftDays.find((day: { date: string }) => day.date === "2026-08-17");
      expect(monday).toMatchObject({
        businessHours: { status: "closed", opensAt: null, closesAt: null },
      });
      expect(monday.staffDays.every((day: { shifts: unknown[] }) => day.shifts.length === 0)).toBe(
        true,
      );

      const published = await app.inject({
        method: "GET",
        url: "/backoffice/manager/schedule?date=2026-08-13",
        headers: { cookie: managerCookie },
      });
      const linXia = published
        .json()
        .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "linxia");
      expect(linXia.shifts[0]).toMatchObject({ startsAt: "09:30", endsAt: "18:00" });

      const audit = await database.pool.query(
        `SELECT id FROM audit_events
         WHERE event_type = 'schedule_drafts_generated'
           AND subject_id = '2026-08-13:2026-08-26'`,
      );
      expect(audit.rows.length).toBeGreaterThan(0);
    } finally {
      await database.pool.query(
        "DELETE FROM staff_schedule_days WHERE publication_status = 'draft'",
      );
    }
  });

  it("未发布草稿可按具体日期修改且不会改变现有已发布容量", async () => {
    await database.pool.query("DELETE FROM staff_schedule_days WHERE publication_status = 'draft'");
    await app.inject({
      method: "POST",
      url: "/backoffice/manager/schedule/drafts/generate",
      headers: { cookie: managerCookie, origin: adminOrigin },
    });
    const payload = {
      kind: "adjusted_shift",
      note: "草稿中调整到岗时间。",
      shifts: [
        {
          startsAt: "10:00",
          endsAt: "17:00",
          breaks: [{ startsAt: "13:30", endsAt: "14:00" }],
        },
      ],
    };

    try {
      const response = await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/drafts/linxia/2026-08-13",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const draft = response
        .json()
        .draftDays.find((day: { date: string }) => day.date === "2026-08-13")
        .staffDays.find((day: { staffId: string }) => day.staffId === "linxia");
      expect(draft).toEqual({
        staffId: "linxia",
        status: "draft",
        source: "date_exception",
        exception: { kind: "adjusted_shift", note: "草稿中调整到岗时间。" },
        shifts: payload.shifts,
      });

      const published = await app.inject({
        method: "GET",
        url: "/backoffice/manager/schedule?date=2026-08-13",
        headers: { cookie: managerCookie },
      });
      const linXia = published
        .json()
        .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "linxia");
      expect(linXia.shifts[0]).toMatchObject({ startsAt: "09:30", endsAt: "18:00" });
    } finally {
      await database.pool.query(
        "DELETE FROM staff_schedule_days WHERE publication_status = 'draft'",
      );
    }
  });

  it("发布无预约影响的具体日期草稿后立即形成顾客可预约容量", async () => {
    await database.pool.query("DELETE FROM staff_schedule_days WHERE publication_status = 'draft'");
    await app.inject({
      method: "POST",
      url: "/backoffice/manager/schedule/drafts/generate",
      headers: { cookie: managerCookie, origin: adminOrigin },
    });
    const exception = {
      kind: "overtime",
      note: "周日临时加班。",
      shifts: [
        {
          startsAt: "09:30",
          endsAt: "13:00",
          breaks: [],
        },
      ],
    };
    await app.inject({
      method: "PUT",
      url: "/backoffice/manager/schedule/drafts/zhaohang/2026-08-16",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: exception,
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/backoffice/manager/schedule/drafts/publish",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: { dates: ["2026-08-16"], staffIds: ["zhaohang"] },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ publishedCount: 1 });

      const published = await app.inject({
        method: "GET",
        url: "/backoffice/manager/schedule?date=2026-08-16",
        headers: { cookie: managerCookie },
      });
      const zhaoHang = published
        .json()
        .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "zhaohang");
      expect(zhaoHang).toMatchObject({
        scheduleStatus: "published",
        source: "date_exception",
        exception: { kind: "overtime", note: "周日临时加班。" },
        shifts: [{ startsAt: "09:30", endsAt: "13:00", breaks: [] }],
      });

      const availability = await app.inject({
        method: "GET",
        url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-basic-care&staffId=zhaohang",
        headers: { authorization: customerToken },
      });
      const sunday = availability
        .json()
        .days.find((day: { date: string }) => day.date === "2026-08-16");
      expect(sunday.slots.length).toBeGreaterThan(0);
      expect(
        sunday.slots.every((slot: { staff: { id: string } }) => slot.staff.id === "zhaohang"),
      ).toBe(true);
    } finally {
      await database.pool.query(
        `DELETE FROM staff_schedule_days
         WHERE staff_id = 'zhaohang' AND local_date = '2026-08-16'`,
      );
      await database.pool.query(
        "DELETE FROM staff_schedule_days WHERE publication_status = 'draft'",
      );
    }
  });

  it("发布会影响已有预约时保持原已发布安排并返回明确影响摘要", async () => {
    await database.pool.query("DELETE FROM staff_schedule_days WHERE publication_status = 'draft'");
    await app.inject({
      method: "POST",
      url: "/backoffice/manager/schedule/drafts/generate",
      headers: { cookie: managerCookie, origin: adminOrigin },
    });
    await app.inject({
      method: "PUT",
      url: "/backoffice/manager/schedule/drafts/zhaohang/2026-08-16",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "overtime",
        note: "影响测试的周日加班。",
        shifts: [{ startsAt: "09:30", endsAt: "13:00", breaks: [] }],
      },
    });
    await app.inject({
      method: "POST",
      url: "/backoffice/manager/schedule/drafts/publish",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { dates: ["2026-08-16"], staffIds: ["zhaohang"] },
    });
    await database.pool.query(
      `INSERT INTO bookings (
        id, customer_id, pet_id, staff_id, starts_at, ends_at,
        occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
        pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
        primary_service_id_snapshot, primary_service_name_snapshot,
        primary_service_price_cents, primary_service_duration_minutes,
        addon_snapshots, required_skill_ids_snapshot, total_price_cents,
        staff_display_name_snapshot, turnover_minutes,
        original_starts_at, original_ends_at,
        original_occupancy_starts_at, original_occupancy_ends_at,
        verification_code_digest
      ) VALUES (
        'booking-ticket21-impact', 'customer-xu-lan', 'pet-tuanzi', 'zhaohang',
        '2026-08-16T02:00:00.000Z', '2026-08-16T03:00:00.000Z',
        '2026-08-16T02:00:00.000Z', '2026-08-16T03:15:00.000Z', 60, 'confirmed',
        '团子', 'dog', 8.4, 'small', 'dog-basic-care', '犬基础洗护', 12800, 60,
        '[]'::jsonb, '["dog-basic-care"]'::jsonb, 12800, '赵航', 15,
        '2026-08-16T02:00:00.000Z', '2026-08-16T03:00:00.000Z',
        '2026-08-16T02:00:00.000Z', '2026-08-16T03:15:00.000Z', repeat('0', 64)
      )`,
    );

    try {
      await app.inject({
        method: "POST",
        url: "/backoffice/manager/schedule/drafts/generate",
        headers: { cookie: managerCookie, origin: adminOrigin },
      });
      await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/drafts/zhaohang/2026-08-16",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: { kind: "day_off", note: "当天休息。", shifts: [] },
      });
      const response = await app.inject({
        method: "POST",
        url: "/backoffice/manager/schedule/drafts/publish",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: { dates: ["2026-08-16"], staffIds: ["zhaohang"] },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "SCHEDULE_CHANGE_AFFECTS_BOOKINGS",
        impactSummary: {
          affectedBookingCount: 1,
          dates: ["2026-08-16"],
          staffIds: ["zhaohang"],
        },
        affectedBookings: [
          {
            id: "booking-ticket21-impact",
            petName: "团子",
            serviceName: "犬基础洗护",
            staffName: "赵航",
            startsAt: "2026-08-16T02:00:00.000Z",
            resolutionPath: "/manager/appointments/booking-ticket21-impact",
          },
        ],
      });

      const published = await app.inject({
        method: "GET",
        url: "/backoffice/manager/schedule?date=2026-08-16",
        headers: { cookie: managerCookie },
      });
      const zhaoHang = published
        .json()
        .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "zhaohang");
      expect(zhaoHang).toMatchObject({
        scheduleStatus: "published",
        exception: { kind: "overtime", note: "影响测试的周日加班。" },
      });
    } finally {
      await database.pool.query("DELETE FROM bookings WHERE id = 'booking-ticket21-impact'");
      await database.pool.query(
        `DELETE FROM staff_schedule_days
         WHERE staff_id = 'zhaohang' AND local_date = '2026-08-16'`,
      );
      await database.pool.query(
        "DELETE FROM staff_schedule_days WHERE publication_status = 'draft'",
      );
    }
  });

  it("具体日期例外受营业规则约束，无影响时生效并在影响预约时返回摘要", async () => {
    const overtime = await app.inject({
      method: "PUT",
      url: "/backoffice/manager/schedule/published/zhaohang/2026-08-16/exception",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "overtime",
        note: "原本无排班的周日增加加班。",
        shifts: [{ startsAt: "09:30", endsAt: "13:00", breaks: [] }],
      },
    });
    expect(overtime.statusCode).toBe(200);

    try {
      const missingBreak = await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/published/zhaohang/2026-08-16/exception",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: {
          kind: "special_break",
          note: "休息例外必须包含休息区间。",
          shifts: [{ startsAt: "09:30", endsAt: "13:00", breaks: [] }],
        },
      });
      expect(missingBreak.statusCode).toBe(400);
      expect(missingBreak.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "休息例外至少需要一个有效休息区间。",
      });

      const saved = await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/published/zhaohang/2026-08-16/exception",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: {
          kind: "special_break",
          note: "周日增加午间休息。",
          shifts: [
            {
              startsAt: "09:30",
              endsAt: "13:00",
              breaks: [{ startsAt: "11:00", endsAt: "11:30" }],
            },
          ],
        },
      });
      expect(saved.statusCode).toBe(200);

      const invalid = await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/published/zhaohang/2026-08-16/exception",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: {
          kind: "overtime",
          note: "超出营业时间。",
          shifts: [{ startsAt: "08:30", endsAt: "13:00", breaks: [] }],
        },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "班次不能超出门店营业时间。",
      });

      await database.pool.query(
        `INSERT INTO bookings (
          id, customer_id, pet_id, staff_id, starts_at, ends_at,
          occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
          pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
          primary_service_id_snapshot, primary_service_name_snapshot,
          primary_service_price_cents, primary_service_duration_minutes,
          addon_snapshots, required_skill_ids_snapshot, total_price_cents,
          staff_display_name_snapshot, turnover_minutes,
          original_starts_at, original_ends_at,
          original_occupancy_starts_at, original_occupancy_ends_at,
          verification_code_digest
        ) VALUES (
          'booking-ticket21-exception', 'customer-xu-lan', 'pet-tuanzi', 'zhaohang',
          '2026-08-16T02:00:00.000Z', '2026-08-16T03:00:00.000Z',
          '2026-08-16T02:00:00.000Z', '2026-08-16T03:15:00.000Z', 60, 'confirmed',
          '团子', 'dog', 8.4, 'small', 'dog-basic-care', '犬基础洗护', 12800, 60,
          '[]'::jsonb, '["dog-basic-care"]'::jsonb, 12800, '赵航', 15,
          '2026-08-16T02:00:00.000Z', '2026-08-16T03:00:00.000Z',
          '2026-08-16T02:00:00.000Z', '2026-08-16T03:15:00.000Z', repeat('1', 64)
        )`,
      );
      const blocked = await app.inject({
        method: "PUT",
        url: "/backoffice/manager/schedule/published/zhaohang/2026-08-16/exception",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: { kind: "day_off", note: "当天休息。", shifts: [] },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({
        code: "SCHEDULE_CHANGE_AFFECTS_BOOKINGS",
        impactSummary: { affectedBookingCount: 1 },
        affectedBookings: [{ id: "booking-ticket21-exception", petName: "团子" }],
      });

      const published = await app.inject({
        method: "GET",
        url: "/backoffice/manager/schedule?date=2026-08-16",
        headers: { cookie: managerCookie },
      });
      const zhaoHang = published
        .json()
        .staffDays.find((day: { staff: { id: string } }) => day.staff.id === "zhaohang");
      expect(zhaoHang).toMatchObject({
        scheduleStatus: "published",
        exception: { kind: "special_break", note: "周日增加午间休息。" },
        shifts: [
          {
            startsAt: "09:30",
            endsAt: "13:00",
            breaks: [{ startsAt: "11:00", endsAt: "11:30" }],
          },
        ],
      });

      const audit = await database.pool.query(
        `SELECT id FROM audit_events
         WHERE event_type = 'schedule_exception_updated'
           AND subject_id = 'zhaohang:2026-08-16'`,
      );
      expect(audit.rows.length).toBeGreaterThan(0);
    } finally {
      await database.pool.query("DELETE FROM bookings WHERE id = 'booking-ticket21-exception'");
      await database.pool.query(
        `DELETE FROM staff_schedule_days
         WHERE staff_id = 'zhaohang' AND local_date = '2026-08-16'`,
      );
      await database.pool.query(
        "DELETE FROM staff_schedule_days WHERE publication_status = 'draft'",
      );
    }
  });
});
