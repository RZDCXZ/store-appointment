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

describe("停班与临时闭店进入待处理", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;
  let customerToken: string;
  const createdChanges: Array<{ id: string; kind: "time_off" | "store_closure" }> = [];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "linxia");
    customerToken = await customerAuthorization(app);
    await database.pool.query(
      `INSERT INTO privacy_consents (customer_id, notice_version, source, consented_at)
       SELECT 'customer-xu-lan', version, 'miniapp_booking', $1
       FROM privacy_notices
       WHERE is_current
       ON CONFLICT (customer_id, notice_version) DO NOTHING`,
      ["2026-08-13T02:50:00.000Z"],
    );
  });

  afterAll(async () => {
    const timeOffIds = createdChanges
      .filter((change) => change.kind === "time_off")
      .map((change) => change.id);
    const closureIds = createdChanges
      .filter((change) => change.kind === "store_closure")
      .map((change) => change.id);
    await database.pool.query("DELETE FROM staff_time_off_intervals WHERE id = ANY($1::text[])", [
      timeOffIds,
    ]);
    await database.pool.query("DELETE FROM store_closure_intervals WHERE id = ANY($1::text[])", [
      closureIds,
    ]);
    await database.pool.query(
      "DELETE FROM privacy_consents WHERE customer_id = 'customer-xu-lan' AND notice_version = '2026.08'",
    );
    await app.close();
    vi.unstubAllEnvs();
  });

  it("无受影响预约的员工停班直接生效并追加创建与状态审计事实", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "time_off",
        staffId: "linxia",
        localDate: "2026-08-15",
        startsAt: "14:00",
        endsAt: "15:00",
        reason: "参加宠物护理培训",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      change: {
        id: string;
        kind: "time_off";
        status: "active";
        targetCapacityMinutes: number;
        affectedBookingCount: number;
      };
    }>();
    createdChanges.push({ id: body.change.id, kind: body.change.kind });
    expect(body.change).toMatchObject({
      kind: "time_off",
      status: "active",
      targetCapacityMinutes: 60,
      affectedBookingCount: 0,
    });

    const audits = await database.pool.query<{ event_type: string; payload: unknown }>(
      `SELECT event_type, payload
       FROM audit_events
       WHERE subject_id = $1
       ORDER BY occurred_at, id`,
      [body.change.id],
    );
    expect(audits.rows).toMatchObject([
      { event_type: "capacity_change_created", payload: { kind: "time_off" } },
      {
        event_type: "capacity_change_status_changed",
        payload: { previousStatus: null, status: "active" },
      },
    ]);
  });

  it("有受影响预约的临时闭店保存门店整体快照并进入待处理，强制参数不能绕过", async () => {
    const payload = {
      kind: "store_closure",
      localDate: "2026-08-14",
      startsAt: "11:00",
      endsAt: "13:00",
      reason: "临时设备检修",
    } as const;
    const preview = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes/preview",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload,
    });

    expect(preview.statusCode).toBe(201);
    expect(preview.json()).toMatchObject({
      target: { kind: "store_closure", staff: null },
      targetCapacityMinutes: 450,
      affectedBookingCount: 1,
      affectedBookings: [
        {
          id: "booking-bohe-future",
          status: "confirmed",
          customerName: "程墨",
          petName: "薄荷",
          staff: { id: "chenjia", displayName: "陈嘉" },
          startsAt: "2026-08-14T03:00:00.000Z",
          endsAt: "2026-08-14T04:30:00.000Z",
          turnoverEndsAt: "2026-08-14T04:45:00.000Z",
        },
      ],
      outcome: "pending",
    });

    const created = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { ...payload, force: true, status: "active" },
    });

    expect(created.statusCode).toBe(201);
    const change = created.json<{
      change: { id: string; kind: "store_closure"; status: string };
    }>().change;
    createdChanges.push({ id: change.id, kind: change.kind });
    expect(change.status).toBe("pending");

    const stored = await database.pool.query<{
      affected_booking_count: number;
      impact_snapshot: Array<{ id: string; staff: { id: string } }>;
    }>(
      `SELECT affected_booking_count, impact_snapshot
       FROM store_closure_intervals
       WHERE id = $1`,
      [change.id],
    );
    expect(stored.rows[0]).toMatchObject({
      affected_booking_count: 1,
      impact_snapshot: [{ id: "booking-bohe-future", staff: { id: "chenjia" } }],
    });
    const audits = await database.pool.query<{ event_type: string; payload: unknown }>(
      `SELECT event_type, payload
       FROM audit_events
       WHERE subject_id = $1
       ORDER BY occurred_at, id`,
      [change.id],
    );
    expect(audits.rows).toMatchObject([
      { event_type: "capacity_change_created", payload: { kind: "store_closure" } },
      {
        event_type: "capacity_change_status_changed",
        payload: { previousStatus: null, status: "pending" },
      },
    ]);
    const forgedTimeOff = await database.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM staff_time_off_intervals
       WHERE reason = $1 AND local_date = $2::date`,
      [payload.reason, payload.localDate],
    );
    expect(forgedTimeOff.rows[0]?.count).toBe(0);
  });

  it("工作台与按员工日历显示未来待处理临时闭店的风险、遮罩和影响数", async () => {
    const pendingClosure = createdChanges.find((change) => change.kind === "store_closure");
    expect(pendingClosure).toBeDefined();
    const workbench = await app.inject({
      method: "GET",
      url: "/backoffice/manager/workbench",
      headers: { cookie: managerCookie },
    });
    const calendar = await app.inject({
      method: "GET",
      url: "/backoffice/manager/calendar?date=2026-08-14",
      headers: { cookie: managerCookie },
    });

    expect(workbench.statusCode).toBe(200);
    expect(workbench.json().risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pending_store_closure",
          title: "待处理临时闭店",
          detail: expect.stringContaining("影响 1 笔预约"),
          href: `/manager/schedule/capacity-changes/store_closure/${pendingClosure?.id}`,
        }),
      ]),
    );
    expect(calendar.statusCode).toBe(200);
    expect(
      calendar
        .json()
        .staffDays.every((day: { blocks: Array<Record<string, unknown>> }) =>
          day.blocks.some(
            (block) =>
              block.kind === "store_closure" &&
              block.status === "pending" &&
              block.affectedBookingCount === 1,
          ),
        ),
    ).toBe(true);
  });

  it("待处理区间阻断新预约但保留已有预约的员工、时段和状态", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-future",
      headers: { cookie: managerCookie },
    });
    const blocked = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerToken },
      payload: {
        idempotencyKey: "pending-closure-blocks-new-booking",
        petId: "pet-tuanzi",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-14T04:00:00.000Z",
      },
    });
    const after = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-future",
      headers: { cookie: managerCookie },
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "SLOT_NO_LONGER_AVAILABLE" });
    expect(after.json().booking).toMatchObject(before.json().booking);
    expect(after.json().booking).toMatchObject({
      status: "confirmed",
      staff: { id: "chenjia" },
      startsAt: "2026-08-14T03:00:00.000Z",
      endsAt: "2026-08-14T04:30:00.000Z",
    });
  });

  it("左闭右开边界只把真正重叠实际占用的预约计入影响", async () => {
    const touching = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes/preview",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "time_off",
        staffId: "chenjia",
        localDate: "2026-08-14",
        startsAt: "12:45",
        endsAt: "13:15",
        reason: "边界验证",
      },
    });
    const overlapping = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes/preview",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "time_off",
        staffId: "chenjia",
        localDate: "2026-08-14",
        startsAt: "12:44",
        endsAt: "13:15",
        reason: "边界验证",
      },
    });

    expect(touching.statusCode).toBe(201);
    expect(touching.json()).toMatchObject({ affectedBookingCount: 0, outcome: "active" });
    expect(overlapping.statusCode).toBe(201);
    expect(overlapping.json()).toMatchObject({
      affectedBookingCount: 1,
      affectedBookings: [{ id: "booking-bohe-future" }],
      outcome: "pending",
    });
  });

  it("员工和未登录请求不能预览或创建容量变化", async () => {
    const payload = {
      kind: "time_off",
      staffId: "linxia",
      localDate: "2026-08-15",
      startsAt: "16:00",
      endsAt: "17:00",
      reason: "越权验证",
    };
    const staffPreview = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes/preview",
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload,
    });
    const staffOptions = await app.inject({
      method: "GET",
      url: "/backoffice/manager/capacity-changes/options",
      headers: { cookie: staffCookie },
    });
    const anonymousCreate = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes",
      headers: { origin: adminOrigin },
      payload,
    });

    expect(staffPreview.statusCode).toBe(403);
    expect(staffOptions.statusCode).toBe(403);
    expect(anonymousCreate.statusCode).toBe(401);
  });
});
