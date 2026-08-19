import { randomUUID } from "node:crypto";

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

async function customerAuthorization(
  app: NestFastifyApplication,
  customerKey = "xu-lan",
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey },
  });
  expect(response.statusCode).toBe(201);
  return `Bearer ${response.json<{ accessToken: string }>().accessToken}`;
}

describe("逐笔处理受影响预约", () => {
  const runId = randomUUID();
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let customerToken: string;
  let secondCustomerToken: string;
  const bookingIds: string[] = [];
  const timeOffIds: string[] = [];
  const closureIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    customerToken = await customerAuthorization(app);
    secondCustomerToken = await customerAuthorization(app, "cheng-mo");
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
    await database.pool.query("DELETE FROM staff_time_off_intervals WHERE id = ANY($1::text[])", [
      timeOffIds,
    ]);
    await database.pool.query("DELETE FROM store_closure_intervals WHERE id = ANY($1::text[])", [
      closureIds,
    ]);
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [bookingIds]);
    await app.close();
    vi.unstubAllEnvs();
  });

  async function createBooking(
    idempotencyKey: string,
    startsAt: string,
    staffId = "linxia",
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerToken },
      payload: {
        idempotencyKey: `${idempotencyKey}:${runId}`,
        petId: "pet-tuanzi",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId,
        startsAt,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const bookingId = response.json<{ booking: { id: string } }>().booking.id;
    bookingIds.push(bookingId);
    return bookingId;
  }

  async function createTimeOff(
    localDate: string,
    startsAt: string,
    endsAt: string,
    staffId = "linxia",
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "time_off",
        staffId,
        localDate,
        startsAt,
        endsAt,
        reason: "参加护理培训",
      },
    });
    expect(response.statusCode).toBe(201);
    const timeOffId = response.json<{ change: { id: string } }>().change.id;
    timeOffIds.push(timeOffId);
    return timeOffId;
  }

  async function createClosure(
    localDate: string,
    startsAt: string,
    endsAt: string,
  ): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/capacity-changes",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        kind: "store_closure",
        localDate,
        startsAt,
        endsAt,
        reason: "门店设备临时检修",
      },
    });
    expect(response.statusCode).toBe(201);
    const closureId = response.json<{ change: { id: string } }>().change.id;
    closureIds.push(closureId);
    return closureId;
  }

  it("同时间换员工只提供合格连续容量，并在最后一笔成功时原子生效", async () => {
    const bookingId = await createBooking(
      "impact-change-staff-booking",
      "2026-08-15T04:00:00.000Z",
    );
    const timeOffId = await createTimeOff("2026-08-15", "12:00", "13:15");

    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      change: { id: timeOffId, kind: "time_off", status: "pending" },
      progress: { resolved: 0, total: 1 },
      impactedBookings: [
        {
          id: bookingId,
          resolution: null,
          sameTimeStaffCandidates: expect.arrayContaining([
            { id: "chenjia", displayName: "陈嘉" },
            { id: "zhaohang", displayName: "赵航" },
          ]),
        },
      ],
    });
    expect(
      detail
        .json<{
          impactedBookings: Array<{
            bookingRevision: number;
            sameTimeStaffCandidates: Array<{ id: string }>;
          }>;
        }>()
        .impactedBookings[0]?.sameTimeStaffCandidates.map((staff) => staff.id),
    ).not.toContain("linxia");
    const bookingRevision = detail.json<{
      impactedBookings: Array<{ bookingRevision: number }>;
    }>().impactedBookings[0]?.bookingRevision;

    const resolved = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${bookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "change_staff",
        staffId: "zhaohang",
        reason: "已与顾客确认由赵航同时间服务",
        idempotencyKey: "impact-change-staff-command",
        expectedBookingRevision: bookingRevision,
      },
    });

    expect(resolved.statusCode).toBe(201);
    expect(resolved.json()).toMatchObject({
      change: { id: timeOffId, status: "active" },
      progress: { resolved: 1, total: 1 },
      resolvedBooking: {
        bookingId,
        action: "change_staff",
        operator: { id: "manager", displayName: "沈青" },
        reason: "已与顾客确认由赵航同时间服务",
        result: {
          staff: { id: "zhaohang", displayName: "赵航" },
          startsAt: "2026-08-15T04:00:00.000Z",
        },
      },
    });

    const replayed = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${bookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "change_staff",
        staffId: "zhaohang",
        reason: "已与顾客确认由赵航同时间服务",
        idempotencyKey: "impact-change-staff-command",
        expectedBookingRevision: bookingRevision,
      },
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toMatchObject({
      change: { status: "active" },
      progress: { resolved: 1, total: 1 },
      resolvedBooking: { bookingId, id: resolved.json().resolvedBooking.id },
    });

    const booking = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${bookingId}`,
      headers: { cookie: managerCookie },
    });
    expect(booking.statusCode).toBe(200);
    expect(booking.json()).toMatchObject({
      booking: {
        id: bookingId,
        staff: { id: "zhaohang", displayName: "赵航" },
        startsAt: "2026-08-15T04:00:00.000Z",
      },
      changeHistory: expect.arrayContaining([
        expect.objectContaining({
          type: "booking_rescheduled",
          reason: "已与顾客确认由赵航同时间服务",
        }),
      ]),
      notifications: expect.arrayContaining([
        expect.objectContaining({ type: "booking_rescheduled" }),
      ]),
    });
  });

  it("改期后保持部分完成，取消最后一笔后才使停班生效", async () => {
    const firstBookingId = await createBooking(
      "impact-partial-first-booking",
      "2026-08-18T02:00:00.000Z",
    );
    const secondBookingId = await createBooking(
      "impact-partial-second-booking",
      "2026-08-18T03:30:00.000Z",
    );
    const timeOffId = await createTimeOff("2026-08-18", "10:00", "12:45");
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    expect(detail.statusCode).toBe(200);
    const before = detail.json<{
      impactedBookings: Array<{
        id: string;
        bookingRevision: number;
        startsAt: string;
        rescheduleSuggestions: Array<{ staff: { id: string }; startsAt: string }>;
      }>;
    }>();
    const first = before.impactedBookings.find((booking) => booking.id === firstBookingId);
    const suggestion = first?.rescheduleSuggestions.find(
      (candidate) => candidate.startsAt !== first.startsAt,
    );
    expect(suggestion).toBeDefined();

    const rescheduled = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${firstBookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "reschedule",
        staffId: suggestion?.staff.id,
        startsAt: suggestion?.startsAt,
        reason: "顾客确认改到相近可用时间",
        idempotencyKey: "impact-partial-reschedule",
        expectedBookingRevision: first?.bookingRevision,
      },
    });
    expect(rescheduled.statusCode).toBe(201);
    expect(rescheduled.json()).toMatchObject({
      change: { status: "pending" },
      progress: { resolved: 1, total: 2 },
      resolvedBooking: { bookingId: firstBookingId, action: "reschedule" },
    });

    const partial = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    expect(partial.json()).toMatchObject({
      change: { status: "pending" },
      progress: { resolved: 1, total: 2 },
      impactedBookings: expect.arrayContaining([
        expect.objectContaining({
          id: firstBookingId,
          resolution: expect.objectContaining({ action: "reschedule" }),
        }),
        expect.objectContaining({ id: secondBookingId, resolution: null }),
      ]),
    });
    const second = partial
      .json<{ impactedBookings: Array<{ id: string; bookingRevision: number }> }>()
      .impactedBookings.find((booking) => booking.id === secondBookingId);

    const cancelled = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${secondBookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "cancel",
        reason: "顾客确认取消本次预约",
        idempotencyKey: "impact-partial-cancel",
        expectedBookingRevision: second?.bookingRevision,
      },
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json()).toMatchObject({
      change: { status: "active" },
      progress: { resolved: 2, total: 2 },
      resolvedBooking: {
        bookingId: secondBookingId,
        action: "cancel",
        result: null,
      },
    });

    const cancelledBooking = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${secondBookingId}`,
      headers: { cookie: managerCookie },
    });
    expect(cancelledBooking.json()).toMatchObject({
      booking: { status: "cancelled" },
      changeHistory: expect.arrayContaining([
        expect.objectContaining({
          type: "booking_cancelled",
          reason: "顾客确认取消本次预约",
        }),
      ]),
      notifications: expect.arrayContaining([
        expect.objectContaining({ type: "booking_cancelled" }),
      ]),
    });
  });

  it("并发处理同一笔预约只有一个结果成立，另一请求不会覆盖进度", async () => {
    await createBooking("impact-concurrent-other-booking", "2026-08-19T01:30:00.000Z");
    const targetBookingId = await createBooking(
      "impact-concurrent-target-booking",
      "2026-08-19T03:00:00.000Z",
    );
    const timeOffId = await createTimeOff("2026-08-19", "09:30", "12:15");
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    const target = detail
      .json<{ impactedBookings: Array<{ id: string; bookingRevision: number }> }>()
      .impactedBookings.find((booking) => booking.id === targetBookingId);

    const resolveWith = (staffId: string, idempotencyKey: string) =>
      app.inject({
        method: "POST",
        url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${targetBookingId}/resolve`,
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: {
          action: "change_staff",
          staffId,
          reason: `并发确认由${staffId}服务`,
          idempotencyKey,
          expectedBookingRevision: target?.bookingRevision,
        },
      });
    const responses = await Promise.all([
      resolveWith("chenjia", "impact-concurrent-chenjia"),
      resolveWith("zhaohang", "impact-concurrent-zhaohang"),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
      code: "IMPACT_ALREADY_RESOLVED",
    });
    const after = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    expect(after.json()).toMatchObject({
      change: { status: "pending" },
      progress: { resolved: 1, total: 2 },
      impactedBookings: expect.arrayContaining([
        expect.objectContaining({
          id: targetBookingId,
          resolution: expect.objectContaining({ action: "change_staff" }),
        }),
      ]),
    });
    const booking = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${targetBookingId}`,
      headers: { cookie: managerCookie },
    });
    expect(["chenjia", "zhaohang"]).toContain(booking.json().booking.staff.id);
  });

  it("撤销未完成停班恢复容量，但保留已经成立的预约处理结果", async () => {
    await createBooking("impact-revoke-unresolved-booking", "2026-08-20T02:30:00.000Z", "chenjia");
    const movedBookingId = await createBooking(
      "impact-revoke-moved-booking",
      "2026-08-20T04:00:00.000Z",
      "chenjia",
    );
    const timeOffId = await createTimeOff("2026-08-20", "10:30", "13:15", "chenjia");
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    const moved = detail
      .json<{ impactedBookings: Array<{ id: string; bookingRevision: number }> }>()
      .impactedBookings.find((booking) => booking.id === movedBookingId);
    const resolved = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${movedBookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "change_staff",
        staffId: "zhaohang",
        reason: "顾客确认同时间改由赵航服务",
        idempotencyKey: "impact-revoke-move-command",
        expectedBookingRevision: moved?.bookingRevision,
      },
    });
    expect(resolved.statusCode).toBe(201);
    expect(resolved.json()).toMatchObject({
      change: { status: "pending" },
      progress: { resolved: 1, total: 2 },
    });

    const blockedBeforeRevoke = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: secondCustomerToken },
      payload: {
        idempotencyKey: `impact-revoke-blocked:${runId}`,
        petId: "pet-bohe",
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: "chenjia",
        startsAt: "2026-08-20T04:00:00.000Z",
      },
    });
    expect(blockedBeforeRevoke.statusCode).toBe(409);
    expect(blockedBeforeRevoke.json()).toMatchObject({ code: "SLOT_NO_LONGER_AVAILABLE" });

    const revoked = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/revoke`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { reason: "培训计划取消，恢复原容量" },
    });
    expect(revoked.statusCode).toBe(201);
    expect(revoked.json()).toMatchObject({
      change: { id: timeOffId, status: "cancelled" },
      retainedResolutions: [
        {
          bookingId: movedBookingId,
          action: "change_staff",
          result: { staff: { id: "zhaohang" } },
        },
      ],
    });

    const restored = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: secondCustomerToken },
      payload: {
        idempotencyKey: `impact-revoke-restored:${runId}`,
        petId: "pet-bohe",
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: "chenjia",
        startsAt: "2026-08-20T04:00:00.000Z",
      },
    });
    expect(restored.statusCode, restored.body).toBe(201);
    bookingIds.push(restored.json<{ booking: { id: string } }>().booking.id);

    const movedBooking = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${movedBookingId}`,
      headers: { cookie: managerCookie },
    });
    expect(movedBooking.json()).toMatchObject({
      booking: { staff: { id: "zhaohang" }, startsAt: "2026-08-20T04:00:00.000Z" },
      changeHistory: expect.arrayContaining([
        expect.objectContaining({
          type: "booking_rescheduled",
          reason: "顾客确认同时间改由赵航服务",
        }),
      ]),
    });
    const after = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    expect(after.json()).toMatchObject({
      change: { status: "cancelled" },
      progress: { resolved: 1, total: 2 },
      canRevoke: false,
    });
  });

  it("处理失败时原安排与进度都不变", async () => {
    const bookingId = await createBooking(
      "impact-failed-resolution-booking",
      "2026-08-22T02:30:00.000Z",
    );
    const timeOffId = await createTimeOff("2026-08-22", "10:30", "11:45");
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
      headers: { cookie: managerCookie },
    });
    const impact = detail.json<{
      impactedBookings: Array<{ bookingRevision: number }>;
    }>().impactedBookings[0];

    const failed = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}/bookings/${bookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "change_staff",
        staffId: "zhouning",
        reason: "尝试交给技能不匹配的员工",
        idempotencyKey: "impact-failed-resolution-command",
        expectedBookingRevision: impact?.bookingRevision,
      },
    });
    expect(failed.statusCode).toBe(409);

    const [after, booking] = await Promise.all([
      app.inject({
        method: "GET",
        url: `/backoffice/manager/capacity-changes/time_off/${timeOffId}`,
        headers: { cookie: managerCookie },
      }),
      app.inject({
        method: "GET",
        url: `/backoffice/manager/bookings/${bookingId}`,
        headers: { cookie: managerCookie },
      }),
    ]);
    expect(after.json()).toMatchObject({
      change: { status: "pending" },
      progress: { resolved: 0, total: 1 },
    });
    expect(booking.json()).toMatchObject({
      booking: {
        staff: { id: "linxia" },
        startsAt: "2026-08-22T02:30:00.000Z",
        status: "confirmed",
      },
    });
  });

  it("闭店逐笔处理完成后生效、持续阻断容量且不提供撤销入口", async () => {
    const bookingId = await createBooking(
      "impact-store-closure-booking",
      "2026-08-21T02:30:00.000Z",
    );
    const closureId = await createClosure("2026-08-21", "10:30", "11:45");
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/capacity-changes/store_closure/${closureId}`,
      headers: { cookie: managerCookie },
    });
    expect(detail.json()).toMatchObject({
      change: { status: "pending" },
      canRevoke: false,
      impactedBookings: [
        {
          id: bookingId,
          sameTimeStaffCandidates: [],
          resolution: null,
        },
      ],
    });
    const impact = detail.json<{
      impactedBookings: Array<{ bookingRevision: number }>;
    }>().impactedBookings[0];
    const resolved = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/store_closure/${closureId}/bookings/${bookingId}/resolve`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        action: "cancel",
        reason: "顾客确认闭店期间取消预约",
        idempotencyKey: "impact-store-closure-cancel-command",
        expectedBookingRevision: impact?.bookingRevision,
      },
    });
    expect(resolved.statusCode).toBe(201);
    expect(resolved.json()).toMatchObject({
      change: { status: "active" },
      progress: { resolved: 1, total: 1 },
    });

    const capacityStillBlocked = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerToken },
      payload: {
        idempotencyKey: `impact-store-closure-blocked:${runId}`,
        petId: "pet-tuanzi",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-21T02:30:00.000Z",
      },
    });
    expect(capacityStillBlocked.statusCode).toBe(409);

    const revoke = await app.inject({
      method: "POST",
      url: `/backoffice/manager/capacity-changes/store_closure/${closureId}/revoke`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { reason: "不允许绕过逐笔处理撤销闭店" },
    });
    expect(revoke.statusCode).toBe(409);
    expect(revoke.json()).toMatchObject({ code: "CAPACITY_CHANGE_REVOCATION_NOT_ALLOWED" });
  });
});
