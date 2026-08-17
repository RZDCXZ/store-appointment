import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

async function customerAuthorization(
  app: NestFastifyApplication,
  customerKey: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey },
  });

  expect(response.statusCode).toBe(201);
  return `Bearer ${response.json<{ accessToken: string }>().accessToken}`;
}

describe("顾客提交并确认预约", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let authorization: string;
  const testPetIds = ["pet-booking-a", "pet-booking-b", "pet-booking-c"];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    authorization = await customerAuthorization(app, "cheng-mo");
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES
          ('pet-booking-a', 'customer-cheng-mo', '米粒', 'dog', 8.4),
          ('pet-booking-b', 'customer-cheng-mo', '小满', 'dog', 9.2),
          ('pet-booking-c', 'customer-cheng-mo', '南瓜', 'dog', 12.5)
        ON CONFLICT (id) DO UPDATE SET archived_at = NULL, updated_at = now()
      `,
    );
  });

  afterAll(async () => {
    await database.pool.query("DELETE FROM bookings WHERE pet_id = ANY($1::text[])", [testPetIds]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [testPetIds]);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("把仍可用的草稿原子创建为已确认预约并返回六位核销码", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "create-success-20260813",
        petId: "pet-booking-a",
        primaryServiceId: "dog-basic-care",
        addonIds: ["oral-care"],
        staffId: "zhaohang",
        startsAt: "2026-08-26T05:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(201);
    const created = response.json<{
      verificationCode: string;
      booking: { id: string } & Record<string, unknown>;
    }>();
    expect(created).toMatchObject({
      verificationCode: expect.stringMatching(/^\d{6}$/),
      booking: {
        id: expect.any(String),
        status: "confirmed",
        pet: {
          id: "pet-booking-a",
          name: "米粒",
          weightKg: 8.4,
          petSize: "small",
        },
        primaryService: {
          id: "dog-basic-care",
          name: "犬基础洗护",
          priceCents: 12800,
          durationMinutes: 60,
        },
        addons: [{ id: "oral-care", name: "口腔清洁", priceCents: 3500, durationMinutes: 15 }],
        staff: { id: "zhaohang", displayName: "赵航" },
        startsAt: "2026-08-26T05:00:00.000Z",
        endsAt: "2026-08-26T06:15:00.000Z",
        turnoverEndsAt: "2026-08-26T06:30:00.000Z",
        totalPriceCents: 16300,
        serviceDurationMinutes: 75,
        turnoverMinutes: 15,
      },
    });

    await database.pool.query("UPDATE pets SET weight_kg = 11 WHERE id = 'pet-booking-a'");
    const restored = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}`,
      headers: { authorization },
    });
    const otherCustomer = await customerAuthorization(app, "xu-lan");
    const forbidden = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}`,
      headers: { authorization: otherCustomer },
    });
    await database.pool.query("UPDATE pets SET weight_kg = 8.4 WHERE id = 'pet-booking-a'");

    expect(restored.statusCode).toBe(200);
    expect(restored.headers["cache-control"]).toBe("no-store");
    expect(restored.json()).toMatchObject({
      booking: {
        id: created.booking.id,
        pet: { id: "pet-booking-a", weightKg: 8.4, petSize: "small" },
        originalSchedule: {
          startsAt: "2026-08-26T05:00:00.000Z",
          endsAt: "2026-08-26T06:15:00.000Z",
          occupancyStartsAt: "2026-08-26T05:00:00.000Z",
          occupancyEndsAt: "2026-08-26T06:30:00.000Z",
        },
      },
    });
    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json()).toMatchObject({ code: "BOOKING_NOT_FOUND" });
  });

  it("同一顾客与幂等键并发重试返回完全相同的首次结果且只追加一组事实", async () => {
    const request = {
      method: "POST" as const,
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "create-idempotent-20260813",
        petId: "pet-booking-b",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-26T07:30:00.000Z",
      },
    };
    const [first, retry] = await Promise.all([app.inject(request), app.inject(request)]);

    expect([first.statusCode, retry.statusCode]).toEqual([201, 201]);
    expect(retry.json()).toEqual(first.json());
    const result = first.json<{
      verificationCode: string;
      booking: { id: string };
    }>();
    const facts = await database.pool.query<{
      verification_code_digest: string;
      booking_event_count: number;
      audit_event_count: number;
      notification_count: number;
      idempotency_count: number;
    }>(
      `
        SELECT booking.verification_code_digest,
               (SELECT count(*)::int FROM booking_events WHERE booking_id = booking.id)
                 AS booking_event_count,
               (SELECT count(*)::int FROM audit_events WHERE subject_id = booking.id)
                 AS audit_event_count,
               (SELECT count(*)::int FROM notification_outbox WHERE booking_id = booking.id)
                 AS notification_count,
               (SELECT count(*)::int FROM booking_idempotency_keys WHERE booking_id = booking.id)
                 AS idempotency_count
        FROM bookings AS booking
        WHERE booking.id = $1
      `,
      [result.booking.id],
    );

    expect(facts.rows[0]).toEqual({
      verification_code_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      booking_event_count: 1,
      audit_event_count: 1,
      notification_count: 1,
      idempotency_count: 1,
    });
    expect(facts.rows[0]?.verification_code_digest).not.toContain(result.verificationCode);

    const reused = await app.inject({
      ...request,
      payload: { ...request.payload, startsAt: "2026-08-26T08:00:00.000Z" },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("分别返回稳定的员工冲突与宠物冲突业务错误码", async () => {
    const staffBase = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "staff-conflict-base-20260813",
        petId: "pet-booking-a",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-25T02:30:00.000Z",
      },
    });
    const staffConflict = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "staff-conflict-next-20260813",
        petId: "pet-booking-b",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-25T02:30:00.000Z",
      },
    });
    const petBase = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "pet-conflict-base-20260813",
        petId: "pet-booking-c",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-25T04:00:00.000Z",
      },
    });
    const petConflict = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "pet-conflict-next-20260813",
        petId: "pet-booking-c",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "linxia",
        startsAt: "2026-08-25T04:00:00.000Z",
      },
    });

    expect(staffBase.statusCode).toBe(201);
    expect(staffConflict.statusCode).toBe(409);
    expect(staffConflict.json()).toMatchObject({
      code: "STAFF_TIME_CONFLICT",
      nextStep: "time",
    });
    expect(petBase.statusCode).toBe(201);
    expect(petConflict.statusCode).toBe(409);
    expect(petConflict.json()).toMatchObject({
      code: "PET_TIME_CONFLICT",
      nextStep: "time",
    });
  });

  it("同一顾客的不同宠物可由不同员工在同一时段并行创建", async () => {
    const requests = [
      { petId: "pet-booking-a", staffId: "linxia", idempotencyKey: "parallel-a-20260813" },
      { petId: "pet-booking-b", staffId: "zhaohang", idempotencyKey: "parallel-b-20260813" },
    ].map((selection) =>
      app.inject({
        method: "POST",
        url: "/miniapp/bookings",
        headers: { authorization },
        payload: {
          ...selection,
          primaryServiceId: "dog-basic-care",
          addonIds: [],
          startsAt: "2026-08-26T02:30:00.000Z",
        },
      }),
    );
    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(
      responses.map(
        (response) => response.json<{ booking: { staff: { id: string } } }>().booking.staff.id,
      ),
    ).toEqual(["linxia", "zhaohang"]);
  });

  it("在事务内重新拒绝隐私、服务、技能与已发布排班的非法状态", async () => {
    const noConsentAuthorization = await customerAuthorization(app, "lu-yao");
    const noConsent = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: noConsentAuthorization },
      payload: {
        idempotencyKey: "illegal-privacy-20260813",
        petId: "pet-lizi",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "linxia",
        startsAt: "2026-08-25T06:00:00.000Z",
      },
    });
    const unavailableService = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "illegal-service-20260813",
        petId: "pet-booking-a",
        primaryServiceId: "retired-dog-care",
        addonIds: [],
        staffId: "linxia",
        startsAt: "2026-08-25T06:00:00.000Z",
      },
    });
    const missingSkill = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "illegal-skill-20260813",
        petId: "pet-booking-a",
        primaryServiceId: "dog-basic-care",
        addonIds: ["oral-care"],
        staffId: "chenjia",
        startsAt: "2026-08-25T06:00:00.000Z",
      },
    });
    const unpublishedSchedule = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "illegal-schedule-20260813",
        petId: "pet-booking-a",
        primaryServiceId: "dog-basic-care",
        addonIds: [],
        staffId: "zhaohang",
        startsAt: "2026-08-23T03:00:00.000Z",
      },
    });

    expect(noConsent.statusCode).toBe(409);
    expect(noConsent.json()).toMatchObject({
      code: "PRIVACY_CONSENT_REQUIRED",
      nextStep: "privacy",
    });
    expect(unavailableService.statusCode).toBe(409);
    expect(unavailableService.json()).toMatchObject({
      code: "SERVICE_NOT_AVAILABLE",
      nextStep: "service",
    });
    expect(missingSkill.statusCode).toBe(409);
    expect(missingSkill.json()).toMatchObject({ code: "STAFF_NOT_QUALIFIED", nextStep: "staff" });
    expect(unpublishedSchedule.statusCode).toBe(409);
    expect(unpublishedSchedule.json()).toMatchObject({
      code: "SLOT_NO_LONGER_AVAILABLE",
      nextStep: "time",
    });
  });
});
