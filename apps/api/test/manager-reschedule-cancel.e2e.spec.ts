import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type {
  BookingAvailabilityResponse,
  CreateBookingResponse,
  ManagerBookingChangeResponse,
  ManagerRescheduleBookingOptionsResponse,
} from "@rongguang/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";
const demoPassword = "Rongguang2026!";

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

describe("店长改期与店长取消", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;
  let customerAuth: string;
  const petIds = [
    "pet-manager-change-success",
    "pet-manager-change-conflict",
    "pet-manager-change-blocker",
    "pet-manager-change-cancel",
    "pet-manager-change-checked-in",
  ];
  const createdBookingIds: string[] = [];

  async function createCustomerBooking(
    petId: string,
    idempotencyKey: string,
  ): Promise<CreateBookingResponse> {
    const availabilityResponse = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${petId}&primaryServiceId=cat-care`,
      headers: { authorization: customerAuth },
    });
    expect(availabilityResponse.statusCode).toBe(200);
    const slot = availabilityResponse
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)[0];
    expect(slot).toBeDefined();
    const response = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerAuth },
      payload: {
        idempotencyKey,
        petId,
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: slot?.staff.id,
        staffPreference: { kind: "fastest" },
        startsAt: slot?.startsAt,
      },
    });
    expect(response.statusCode).toBe(201);
    const booking = response.json<CreateBookingResponse>();
    createdBookingIds.push(booking.booking.id);
    return booking;
  }

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    [managerCookie, staffCookie, customerAuth] = await Promise.all([
      login(app, "manager"),
      login(app, "chenjia"),
      customerAuthorization(app),
    ]);
    await database.pool.query("DELETE FROM bookings WHERE pet_id = ANY($1::text[])", [petIds]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [petIds]);
    await database.pool.query(
      "DELETE FROM manager_booking_change_idempotency_keys WHERE idempotency_key LIKE 'manager-%' OR idempotency_key LIKE 'staff-%'",
    );
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES
          ('pet-manager-change-success', 'customer-cheng-mo', '店长改期宠物', 'cat', 4.8),
          ('pet-manager-change-conflict', 'customer-cheng-mo', '保留原安排', 'cat', 4.8),
          ('pet-manager-change-blocker', 'customer-cheng-mo', '占用新安排', 'cat', 4.8),
          ('pet-manager-change-cancel', 'customer-cheng-mo', '店长取消宠物', 'cat', 4.8),
          ('pet-manager-change-checked-in', 'customer-cheng-mo', '已经到店宠物', 'cat', 4.8)
      `,
    );
  });

  afterAll(async () => {
    await database.pool.query(
      "DELETE FROM manager_booking_change_idempotency_keys WHERE idempotency_key LIKE 'manager-%' OR idempotency_key LIKE 'staff-%'",
    );
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [
      createdBookingIds,
    ]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [petIds]);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("从可寻址预约身份恢复原安排和店长真实可用改期建议", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-future/reschedule-options",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      booking: {
        id: "booking-bohe-future",
        pet: { id: "pet-bohe", name: "薄荷" },
        primaryService: { id: "cat-care", name: "猫咪洗护" },
        staff: { id: "chenjia", displayName: "陈嘉" },
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T04:30:00.000Z",
        totalPriceCents: 16800,
        serviceDurationMinutes: 90,
      },
      managerActions: { canReschedule: true, canCancel: true },
      availability: {
        window: { earliestStartsAt: "2026-08-13T03:00:00.000Z" },
        selection: {
          pet: { id: "pet-bohe", name: "薄荷" },
          totalPriceCents: 16800,
          serviceDurationMinutes: 90,
        },
        days: expect.any(Array),
      },
    });
    const slots = response
      .json<{ availability: { days: Array<{ slots: Array<{ startsAt: string }> }> } }>()
      .availability.days.flatMap((day) => day.slots);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots).not.toContainEqual(
      expect.objectContaining({ startsAt: "2026-08-14T03:00:00.000Z" }),
    );
  });

  it("原子改期保留预约身份、轮换核销码，并幂等追加店长原因与通知", async () => {
    const created = await createCustomerBooking(
      "pet-manager-change-success",
      "manager-change-create-success",
    );
    const before = await database.pool.query<{
      verification_code_digest: string;
      verification_code_version: number;
    }>("SELECT verification_code_digest, verification_code_version FROM bookings WHERE id = $1", [
      created.booking.id,
    ]);
    const optionsResponse = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}/reschedule-options`,
      headers: { cookie: managerCookie },
    });
    expect(optionsResponse.statusCode).toBe(200);
    const target = optionsResponse
      .json<ManagerRescheduleBookingOptionsResponse>()
      .availability?.days.flatMap((day) => day.slots)[0];
    expect(target).toBeDefined();
    const request = {
      method: "POST" as const,
      url: `/backoffice/manager/bookings/${created.booking.id}/reschedule`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-reschedule-success-20260813",
        reason: "已经与顾客电话确认新的到店时间",
        staffId: target?.staff.id,
        startsAt: target?.startsAt,
      },
    };

    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(first.json<ManagerBookingChangeResponse>()).toMatchObject({
      booking: {
        id: created.booking.id,
        status: "confirmed",
        pet: created.booking.pet,
        primaryService: created.booking.primaryService,
        startsAt: target?.startsAt,
        endsAt: target?.endsAt,
        staff: { id: target?.staff.id, displayName: target?.staff.displayName },
        originalSchedule: created.booking.originalSchedule,
      },
      managerActions: { canReschedule: true, canCancel: true },
      verificationCodeStatus: "rotated",
      change: {
        kind: "manager_rescheduled",
        actor: { type: "manager", id: "manager", displayName: "沈青" },
        reason: "已经与顾客电话确认新的到店时间",
        previous: {
          staff: created.booking.staff,
          startsAt: created.booking.startsAt,
          endsAt: created.booking.endsAt,
          turnoverEndsAt: created.booking.turnoverEndsAt,
        },
        next: {
          staff: { id: target?.staff.id, displayName: target?.staff.displayName },
          startsAt: target?.startsAt,
          endsAt: target?.endsAt,
          turnoverEndsAt: target?.turnoverEndsAt,
        },
      },
    });

    const facts = await database.pool.query<{
      verification_code_digest: string;
      verification_code_version: number;
      event_count: number;
      notification_count: number;
      audit_count: number;
    }>(
      `
        SELECT booking.verification_code_digest,
               booking.verification_code_version,
               (SELECT count(*)::int FROM booking_events
                WHERE booking_id = booking.id AND event_type = 'booking_rescheduled') AS event_count,
               (SELECT count(*)::int FROM notification_outbox
                WHERE booking_id = booking.id AND notification_type = 'booking_rescheduled')
                 AS notification_count,
               (SELECT count(*)::int FROM audit_events
                WHERE subject_id = booking.id AND event_type = 'manager_booking_rescheduled')
                 AS audit_count
        FROM bookings AS booking
        WHERE booking.id = $1
      `,
      [created.booking.id],
    );
    expect(facts.rows[0]).toMatchObject({
      verification_code_version: (before.rows[0]?.verification_code_version ?? 0) + 1,
      event_count: 1,
      notification_count: 1,
      audit_count: 1,
    });
    expect(facts.rows[0]?.verification_code_digest).not.toBe(
      before.rows[0]?.verification_code_digest,
    );
  });

  it("新安排冲突时保留原占用、核销码和当前事实，并稳定重放相近建议", async () => {
    const original = await createCustomerBooking(
      "pet-manager-change-conflict",
      "manager-change-create-conflict",
    );
    const blocker = await createCustomerBooking(
      "pet-manager-change-blocker",
      "manager-change-create-blocker",
    );
    const before = await database.pool.query<{
      staff_id: string;
      starts_at: Date;
      ends_at: Date;
      occupancy_ends_at: Date;
      verification_code_digest: string;
      verification_code_version: number;
    }>(
      `
        SELECT staff_id, starts_at, ends_at, occupancy_ends_at,
               verification_code_digest, verification_code_version
        FROM bookings WHERE id = $1
      `,
      [original.booking.id],
    );
    const request = {
      method: "POST" as const,
      url: `/backoffice/manager/bookings/${original.booking.id}/reschedule`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-reschedule-conflict-20260813",
        reason: "顾客希望改到这个已经被占用的时间",
        staffId: blocker.booking.staff.id,
        startsAt: blocker.booking.startsAt,
      },
    };

    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({
      code: "BOOKING_TIME_CONFLICT",
      message: expect.stringContaining("原安排和核销码保持不变"),
      nextStep: "conflict",
      booking: {
        id: original.booking.id,
        staff: original.booking.staff,
        startsAt: original.booking.startsAt,
      },
      requested: {
        staffId: blocker.booking.staff.id,
        startsAt: blocker.booking.startsAt,
      },
      suggestions: expect.any(Array),
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual(first.json());
    const after = await database.pool.query(
      `
        SELECT staff_id, starts_at, ends_at, occupancy_ends_at,
               verification_code_digest, verification_code_version
        FROM bookings WHERE id = $1
      `,
      [original.booking.id],
    );
    expect(after.rows).toEqual(before.rows);
    const sideEffects = await database.pool.query<{
      event_count: number;
      notification_count: number;
    }>(
      `
        SELECT
          (SELECT count(*)::int FROM booking_events
           WHERE booking_id = $1 AND event_type = 'booking_rescheduled') AS event_count,
          (SELECT count(*)::int FROM notification_outbox
           WHERE booking_id = $1 AND notification_type = 'booking_rescheduled')
             AS notification_count
      `,
      [original.booking.id],
    );
    expect(sideEffects.rows[0]).toEqual({ event_count: 0, notification_count: 0 });
  });

  it("店长取消在核销前释放实际占用、作废核销码，并幂等追加历史与通知", async () => {
    const created = await createCustomerBooking(
      "pet-manager-change-cancel",
      "manager-change-create-cancel",
    );
    const request = {
      method: "POST" as const,
      url: `/backoffice/manager/bookings/${created.booking.id}/cancel`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-cancel-success-20260813",
        reason: "门店临时无法按线下约定提供服务",
      },
    };

    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(first.json<ManagerBookingChangeResponse>()).toMatchObject({
      booking: { id: created.booking.id, status: "cancelled" },
      managerActions: { canReschedule: false, canCancel: false },
      verificationCodeStatus: "invalidated",
      change: {
        kind: "manager_cancelled",
        actor: { type: "manager", id: "manager", displayName: "沈青" },
        reason: "门店临时无法按线下约定提供服务",
        previous: {
          staff: created.booking.staff,
          startsAt: created.booking.startsAt,
          endsAt: created.booking.endsAt,
          turnoverEndsAt: created.booking.turnoverEndsAt,
        },
        next: null,
      },
    });
    const facts = await database.pool.query<{
      occupancy_starts_at: Date | null;
      occupancy_ends_at: Date | null;
      event_count: number;
      notification_count: number;
      audit_count: number;
    }>(
      `
        SELECT booking.occupancy_starts_at,
               booking.occupancy_ends_at,
               (SELECT count(*)::int FROM booking_events
                WHERE booking_id = booking.id AND event_type = 'booking_cancelled') AS event_count,
               (SELECT count(*)::int FROM notification_outbox
                WHERE booking_id = booking.id AND notification_type = 'booking_cancelled')
                 AS notification_count,
               (SELECT count(*)::int FROM audit_events
                WHERE subject_id = booking.id AND event_type = 'manager_booking_cancelled')
                 AS audit_count
        FROM bookings AS booking
        WHERE booking.id = $1
      `,
      [created.booking.id],
    );
    expect(facts.rows[0]).toEqual({
      occupancy_starts_at: null,
      occupancy_ends_at: null,
      event_count: 1,
      notification_count: 1,
      audit_count: 1,
    });
    const customerDetail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}`,
      headers: { authorization: customerAuth },
    });
    expect(customerDetail.statusCode).toBe(200);
    expect(customerDetail.json()).toMatchObject({
      verificationCode: null,
      changeHistory: [
        expect.objectContaining({
          kind: "manager_cancelled",
          actor: { type: "manager", id: "manager" },
          reason: "门店临时无法按线下约定提供服务",
        }),
      ],
    });
  });

  it("到店核销后拒绝店长取消与改期，并返回只允许继续履约的当前事实", async () => {
    const created = await createCustomerBooking(
      "pet-manager-change-checked-in",
      "manager-change-create-checked-in",
    );
    await database.pool.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [
      created.booking.id,
    ]);
    const commonHeaders = { cookie: managerCookie, origin: adminOrigin };
    const cancellation = await app.inject({
      method: "POST",
      url: `/backoffice/manager/bookings/${created.booking.id}/cancel`,
      headers: commonHeaders,
      payload: {
        idempotencyKey: "manager-cancel-after-check-in",
        reason: "不能覆盖已经成立的到店事实",
      },
    });
    const reschedule = await app.inject({
      method: "POST",
      url: `/backoffice/manager/bookings/${created.booking.id}/reschedule`,
      headers: commonHeaders,
      payload: {
        idempotencyKey: "manager-reschedule-after-check-in",
        reason: "不能覆盖已经成立的到店事实",
        staffId: created.booking.staff.id,
        startsAt: "2026-08-14T05:00:00.000Z",
      },
    });
    const options = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}/reschedule-options`,
      headers: { cookie: managerCookie },
    });

    for (const response of [cancellation, reschedule]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "BOOKING_CHANGE_NOT_ALLOWED",
        booking: { id: created.booking.id, status: "checked_in" },
        managerActions: {
          canReschedule: false,
          canCancel: false,
          message: expect.stringContaining("完成服务或记录服务终止"),
        },
      });
    }
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({
      booking: { id: created.booking.id, status: "checked_in" },
      managerActions: { canReschedule: false, canCancel: false },
      availability: null,
    });
  });

  it("店长改期与取消都要求填写可审计原因", async () => {
    const reschedule = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/reschedule",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-reschedule-reason-required",
        reason: " ",
        staffId: "zhouning",
        startsAt: "2026-08-14T05:00:00.000Z",
      },
    });
    const cancellation = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/cancel",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-cancel-reason-required",
        reason: " ",
      },
    });

    for (const response of [reschedule, cancellation]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: { reason: expect.any(String) },
      });
    }
  });

  it("员工身份不能读取建议或执行店长改期与取消", async () => {
    const read = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-future/reschedule-options",
      headers: { cookie: staffCookie },
    });
    const reschedule = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/reschedule",
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "staff-cannot-manager-reschedule",
        reason: "员工不能越权改期",
        staffId: "chenjia",
        startsAt: "2026-08-14T05:00:00.000Z",
      },
    });
    const cancellation = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/cancel",
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "staff-cannot-manager-cancel",
        reason: "员工不能越权取消",
      },
    });

    expect(read.statusCode).toBe(403);
    expect(reschedule.statusCode).toBe(403);
    expect(cancellation.statusCode).toBe(403);
  });
});
