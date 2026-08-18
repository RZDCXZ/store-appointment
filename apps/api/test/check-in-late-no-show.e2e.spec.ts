import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { BookingDetailResponse } from "@rongguang/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";
const demoPassword = "Rongguang2026!";
const bookingId = "booking-bohe-future";

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
    payload: { username, password: demoPassword },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

async function customerAuthorization(app: NestFastifyApplication): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey: "cheng-mo" },
  });
  expect(response.statusCode).toBe(201);
  return `Bearer ${response.json<{ accessToken: string }>().accessToken}`;
}

describe("到店核销、迟到与爽约", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let staffCookie: string;
  let otherStaffCookie: string;
  let managerCookie: string;
  let customerAuth: string;

  async function resetBooking(): Promise<void> {
    await database.pool.query(
      "DELETE FROM booking_fulfilment_idempotency_keys WHERE booking_id = $1",
      [bookingId],
    );
    await database.pool.query(
      `
        DELETE FROM booking_events
        WHERE booking_id = $1
          AND event_type IN ('booking_checked_in', 'booking_late_checked_in', 'booking_no_show')
      `,
      [bookingId],
    );
    await database.pool.query(
      `
        UPDATE bookings
        SET status = 'confirmed',
            completed_at = NULL,
            occupancy_starts_at = '2026-08-14T03:00:00.000Z',
            occupancy_ends_at = '2026-08-14T04:45:00.000Z'
        WHERE id = $1
      `,
      [bookingId],
    );
  }

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    staffCookie = await login(app, "chenjia");
    otherStaffCookie = await login(app, "linxia");
    managerCookie = await login(app, "manager");
    customerAuth = await customerAuthorization(app);
  });

  beforeEach(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    await resetBooking();
  });

  afterAll(async () => {
    await resetBooking();
    vi.unstubAllEnvs();
    await app.close();
  });

  it("在核销窗口起点恰好允许分配员工使用六位码核销", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    const verificationCode = detail.json<BookingDetailResponse>().verificationCode;
    expect(verificationCode).toMatch(/^\d{6}$/);
    vi.stubEnv("DEMO_NOW", "2026-08-14T02:30:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/check-in`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "check-in-window-opens",
        verificationCode,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      bookingId,
      status: "checked_in",
      outcome: "checked_in",
      occurredAt: "2026-08-14T02:30:00.000Z",
      actor: { type: "staff", id: "chenjia", displayName: "陈嘉" },
      reason: null,
    });

    const refreshed = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    expect(refreshed.json<BookingDetailResponse>()).toMatchObject({
      booking: { id: bookingId, status: "checked_in" },
      verificationCode: null,
      verificationWindow: null,
    });
  });

  it("窗口前后均拒绝正常核销，窗口内错误六位码也不会改变预约", async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-14T02:29:59.999Z");
    const tooEarly = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/check-in`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { idempotencyKey: "check-in-too-early", verificationCode: "000000" },
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.json()).toMatchObject({ code: "CHECK_IN_TOO_EARLY" });

    vi.stubEnv("DEMO_NOW", "2026-08-14T03:15:00.001Z");
    const tooLate = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/check-in`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: { idempotencyKey: "check-in-too-late", verificationCode: "000000" },
    });
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json()).toMatchObject({ code: "CHECK_IN_WINDOW_CLOSED" });

    vi.stubEnv("DEMO_NOW", "2026-08-14T02:50:00.000Z");
    const invalidCode = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/check-in`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: { idempotencyKey: "check-in-invalid-code", verificationCode: "000000" },
    });
    expect(invalidCode.statusCode).toBe(400);
    expect(invalidCode.json()).toMatchObject({ code: "INVALID_VERIFICATION_CODE" });

    const status = await database.pool.query<{ status: string }>(
      "SELECT status FROM bookings WHERE id = $1",
      [bookingId],
    );
    expect(status.rows[0]?.status).toBe("confirmed");
  });

  it("在窗口终点恰好允许核销，重复请求返回首次结果且不追加历史", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    const verificationCode = detail.json<BookingDetailResponse>().verificationCode;
    expect(verificationCode).toMatch(/^\d{6}$/);
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:15:00.000Z");
    const request = {
      method: "POST" as const,
      url: `/backoffice/bookings/${bookingId}/check-in`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "check-in-window-closes",
        verificationCode,
      },
    };

    const first = await app.inject(request);
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:18:00.000Z");
    const sameKeyRetry = await app.inject(request);
    const repeatedCheckIn = await app.inject({
      ...request,
      payload: { ...request.payload, idempotencyKey: "check-in-repeated-key" },
    });

    expect(first.statusCode).toBe(201);
    expect(sameKeyRetry.statusCode).toBe(201);
    expect(repeatedCheckIn.statusCode).toBe(201);
    expect(sameKeyRetry.json()).toEqual(first.json());
    expect(repeatedCheckIn.json()).toEqual(first.json());

    const staffDetail = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}`,
      headers: { cookie: staffCookie },
    });
    const checkInEvents = staffDetail
      .json<{
        statusHistory: Array<{
          type: string;
          actorId: string | null;
          actorDisplayName: string | null;
          reason: string | null;
          occurredAt: string;
        }>;
      }>()
      .statusHistory.filter((event) => event.type === "booking_checked_in");
    expect(checkInEvents).toEqual([
      expect.objectContaining({
        actorId: "chenjia",
        actorDisplayName: "陈嘉",
        reason: null,
        occurredAt: "2026-08-14T03:15:00.000Z",
      }),
    ]);
  });

  it("恰好开始后十五分钟不能手动核销，超过后分配员工填写原因即可核销", async () => {
    const request = {
      method: "POST" as const,
      url: `/backoffice/bookings/${bookingId}/late-check-in`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "late-check-in-boundary",
        reason: "顾客路上拥堵，已与门店确认到店",
      },
    };
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:15:00.000Z");

    const atBoundary = await app.inject(request);
    expect(atBoundary.statusCode).toBe(409);
    expect(atBoundary.json()).toMatchObject({ code: "LATE_CHECK_IN_TOO_EARLY" });

    vi.stubEnv("DEMO_NOW", "2026-08-14T03:15:00.001Z");
    const afterBoundary = await app.inject({
      ...request,
      payload: { ...request.payload, idempotencyKey: "late-check-in-after-boundary" },
    });
    expect(afterBoundary.statusCode).toBe(201);
    expect(afterBoundary.json()).toMatchObject({
      bookingId,
      status: "checked_in",
      outcome: "checked_in",
      occurredAt: "2026-08-14T03:15:00.001Z",
      actor: { type: "staff", id: "chenjia", displayName: "陈嘉" },
      reason: "顾客路上拥堵，已与门店确认到店",
    });

    await database.pool.query(
      `
        UPDATE bookings
        SET status = 'completed', completed_at = '2026-08-14T04:20:00.000Z'
        WHERE id = $1
      `,
      [bookingId],
    );
    vi.stubEnv("DEMO_NOW", "2026-08-14T04:20:00.000Z");
    const retry = await app.inject({
      ...request,
      payload: { ...request.payload, idempotencyKey: "late-check-in-after-boundary" },
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(afterBoundary.json());
  });

  it("时间流逝不自动爽约，店长人工标记后仅释放处理时刻之后的实际占用", async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:15:00.000Z");
    const request = {
      method: "POST" as const,
      url: `/backoffice/bookings/${bookingId}/no-show`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "no-show-boundary-manager",
        reason: "多次联系未到店，顾客未能按约前来",
      },
    };

    const atBoundary = await app.inject(request);
    expect(atBoundary.statusCode).toBe(409);
    expect(atBoundary.json()).toMatchObject({ code: "NO_SHOW_TOO_EARLY" });

    vi.stubEnv("DEMO_NOW", "2026-08-14T03:20:00.000Z");
    const stillConfirmed = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    expect(stillConfirmed.json<BookingDetailResponse>().booking.status).toBe("confirmed");

    const successRequest = {
      ...request,
      payload: { ...request.payload, idempotencyKey: "no-show-after-boundary-manager" },
    };
    const response = await app.inject(successRequest);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      bookingId,
      status: "no_show",
      outcome: "no_show",
      occurredAt: "2026-08-14T03:20:00.000Z",
      actor: { type: "manager", id: "manager", displayName: "沈青" },
      reason: "多次联系未到店，顾客未能按约前来",
      actualOccupancy: {
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T03:20:00.000Z",
      },
      originalSchedule: {
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T04:30:00.000Z",
        occupancyStartsAt: "2026-08-14T03:00:00.000Z",
        occupancyEndsAt: "2026-08-14T04:45:00.000Z",
      },
    });

    const refreshed = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    expect(refreshed.json<BookingDetailResponse>()).toMatchObject({
      booking: {
        id: bookingId,
        status: "no_show",
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T04:30:00.000Z",
        originalSchedule: {
          startsAt: "2026-08-14T03:00:00.000Z",
          endsAt: "2026-08-14T04:30:00.000Z",
        },
      },
      verificationCode: null,
      verificationWindow: null,
    });

    vi.stubEnv("DEMO_NOW", "2026-08-14T03:40:00.000Z");
    const retry = await app.inject(successRequest);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(response.json());
  });

  it("同一身份和幂等键在预约进入后续状态后仍返回首次核销结果", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    const request = {
      method: "POST" as const,
      url: `/backoffice/bookings/${bookingId}/check-in`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "check-in-survives-later-state",
        verificationCode: detail.json<BookingDetailResponse>().verificationCode,
      },
    };
    vi.stubEnv("DEMO_NOW", "2026-08-14T02:50:00.000Z");
    const first = await app.inject(request);
    expect(first.statusCode).toBe(201);

    await database.pool.query(
      `
        UPDATE bookings
        SET status = 'completed', completed_at = '2026-08-14T04:20:00.000Z'
        WHERE id = $1
      `,
      [bookingId],
    );
    vi.stubEnv("DEMO_NOW", "2026-08-14T04:20:00.000Z");
    const retry = await app.inject(request);

    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
  });

  it("非分配员工不能核销或标记爽约", async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:20:00.000Z");

    for (const [path, payload] of [
      ["check-in", { idempotencyKey: "other-staff-check-in", verificationCode: "000000" }],
      ["late-check-in", { idempotencyKey: "other-staff-late-in", reason: "顾客迟到" }],
      ["no-show", { idempotencyKey: "other-staff-no-show", reason: "顾客未到店" }],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/backoffice/bookings/${bookingId}/${path}`,
        headers: { cookie: otherStaffCookie, origin: adminOrigin },
        payload,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it.each(["cancelled", "completed", "terminated"] as const)(
    "%s 终态对核销与爽约均返回稳定状态错误",
    async (status) => {
      await database.pool.query(
        `
          UPDATE bookings
          SET status = $2,
              completed_at = CASE
                WHEN $2 = 'completed' THEN '2026-08-14T04:20:00.000Z'::timestamptz
                ELSE NULL::timestamptz
              END,
              occupancy_starts_at = CASE WHEN $2 = 'cancelled' THEN NULL ELSE occupancy_starts_at END,
              occupancy_ends_at = CASE WHEN $2 = 'cancelled' THEN NULL ELSE occupancy_ends_at END
          WHERE id = $1
        `,
        [bookingId, status],
      );
      vi.stubEnv("DEMO_NOW", "2026-08-14T03:20:00.000Z");

      const checkIn = await app.inject({
        method: "POST",
        url: `/backoffice/bookings/${bookingId}/late-check-in`,
        headers: { cookie: staffCookie, origin: adminOrigin },
        payload: { idempotencyKey: `illegal-check-in-${status}`, reason: "状态检查" },
      });
      const noShow = await app.inject({
        method: "POST",
        url: `/backoffice/bookings/${bookingId}/no-show`,
        headers: { cookie: staffCookie, origin: adminOrigin },
        payload: { idempotencyKey: `illegal-no-show-${status}`, reason: "状态检查" },
      });

      expect(checkIn.statusCode).toBe(409);
      expect(checkIn.json()).toMatchObject({ code: "BOOKING_CHECK_IN_NOT_ALLOWED" });
      expect(noShow.statusCode).toBe(409);
      expect(noShow.json()).toMatchObject({ code: "BOOKING_NO_SHOW_NOT_ALLOWED" });
    },
  );
});
