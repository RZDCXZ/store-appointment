import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { BookingAvailabilityResponse } from "@rongguang/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { BookingAvailabilityService } from "../src/booking-availability/booking-availability.service.js";
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
  let competingAuthorizations: [string, string];
  const competingPetIds = Array.from(
    { length: 20 },
    (_, index) => `pet-booking-race-${String(index + 1).padStart(2, "0")}`,
  );
  const retryPetIds = [
    "pet-booking-retry-base",
    "pet-booking-retry-loser",
    "pet-booking-retry-suggestion",
  ];
  const petOverlapRaceId = "pet-booking-pet-overlap-race";
  const testIdempotencyPatterns = [
    "create-%",
    "staff-conflict-%",
    "pet-conflict-%",
    "race-request-%",
    "pet-race-%",
    "retry-conflict-%",
    "parallel-%",
    "illegal-%",
  ];
  const testPetIds = [
    "pet-booking-a",
    "pet-booking-b",
    "pet-booking-c",
    petOverlapRaceId,
    ...competingPetIds,
    ...retryPetIds,
  ];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    authorization = await customerAuthorization(app, "cheng-mo");
    competingAuthorizations = [authorization, await customerAuthorization(app, "xu-lan")];
    await database.pool.query(
      `
        DELETE FROM booking_idempotency_keys
        WHERE customer_id = ANY($2::text[])
          AND idempotency_key LIKE ANY($1::text[])
      `,
      [testIdempotencyPatterns, ["customer-cheng-mo", "customer-xu-lan"]],
    );
    await database.pool.query("DELETE FROM bookings WHERE pet_id = ANY($1::text[])", [testPetIds]);
    await database.pool.query(
      `
        INSERT INTO privacy_consents (customer_id, notice_version, source, consented_at)
        SELECT 'customer-xu-lan', version, 'miniapp_booking', $1
        FROM privacy_notices
        WHERE is_current
        ON CONFLICT (customer_id, notice_version) DO NOTHING
      `,
      ["2026-08-13T02:50:00.000Z"],
    );
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES
          ('pet-booking-a', 'customer-cheng-mo', '米粒', 'dog', 8.4),
          ('pet-booking-b', 'customer-cheng-mo', '小满', 'dog', 9.2),
          ('pet-booking-c', 'customer-cheng-mo', '南瓜', 'dog', 12.5),
          ('pet-booking-pet-overlap-race', 'customer-cheng-mo', '同宠争抢', 'dog', 8.4)
        ON CONFLICT (id) DO UPDATE
        SET customer_id = excluded.customer_id,
            archived_at = NULL,
            updated_at = now()
      `,
    );
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        SELECT pet_id,
               CASE WHEN ordinal % 2 = 0 THEN 'customer-xu-lan' ELSE 'customer-cheng-mo' END,
               '争抢宠物' || ordinal::text,
               'dog',
               8.4
        FROM unnest($1::text[]) WITH ORDINALITY AS competing_pet(pet_id, ordinal)
        ON CONFLICT (id) DO UPDATE
        SET customer_id = excluded.customer_id,
            archived_at = NULL,
            updated_at = now()
      `,
      [competingPetIds],
    );
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES
          ('pet-booking-retry-base', 'customer-cheng-mo', '先到', 'dog', 8.4),
          ('pet-booking-retry-loser', 'customer-cheng-mo', '重试', 'dog', 8.4),
          ('pet-booking-retry-suggestion', 'customer-cheng-mo', '后到', 'dog', 8.4)
        ON CONFLICT (id) DO UPDATE SET archived_at = NULL, updated_at = now()
      `,
    );
  });

  afterAll(async () => {
    await database.pool.query("DELETE FROM bookings WHERE pet_id = ANY($1::text[])", [testPetIds]);
    await database.pool.query(
      `
        DELETE FROM booking_idempotency_keys
        WHERE customer_id = ANY($2::text[])
          AND idempotency_key LIKE ANY($1::text[])
      `,
      [testIdempotencyPatterns, ["customer-cheng-mo", "customer-xu-lan"]],
    );
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [testPetIds]);
    await database.pool.query("DELETE FROM privacy_consents WHERE customer_id = 'customer-xu-lan'");
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

  it("员工与宠物重叠都返回统一时段冲突业务错误", async () => {
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
      code: "BOOKING_TIME_CONFLICT",
      nextStep: "conflict",
      suggestions: expect.any(Array),
    });
    expect(petBase.statusCode).toBe(201);
    expect(petConflict.statusCode).toBe(409);
    expect(petConflict.json()).toMatchObject({
      code: "BOOKING_TIME_CONFLICT",
      nextStep: "conflict",
      suggestions: expect.any(Array),
    });
  });

  it("二十个不同请求争抢同一时段时只确认一笔并为其余请求返回统一冲突与实时建议", async () => {
    const availabilityResponse = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${competingPetIds[0]}&primaryServiceId=dog-basic-care&staffId=zhaohang`,
      headers: { authorization },
    });
    expect(availabilityResponse.statusCode).toBe(200);
    const availability = availabilityResponse.json<BookingAvailabilityResponse>();
    const contestedSlot = availability.days.find((day) => day.slots.length >= 6)?.slots[2];
    expect(contestedSlot).toBeDefined();

    const responses = await Promise.all(
      competingPetIds.map((petId, index) =>
        app.inject({
          method: "POST",
          url: "/miniapp/bookings",
          headers: { authorization: competingAuthorizations[index % 2] },
          payload: {
            idempotencyKey: `race-request-${String(index + 1).padStart(2, "0")}-20260813`,
            petId,
            primaryServiceId: "dog-basic-care",
            addonIds: [],
            staffId: "zhaohang",
            startsAt: contestedSlot?.startsAt,
          },
        }),
      ),
    );
    const successes = responses.filter((response) => response.statusCode === 201);
    const conflicts = responses.filter((response) => response.statusCode === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(19);
    for (const conflict of conflicts) {
      const body = conflict.json<{
        code: string;
        suggestions: Array<{
          date: string;
          startsAt: string;
          endsAt: string;
          staff: { id: string; displayName: string };
        }>;
      }>();
      expect(body.code).toBe("BOOKING_TIME_CONFLICT");
      expect(body.suggestions.length).toBeGreaterThanOrEqual(3);
      expect(body.suggestions.length).toBeLessThanOrEqual(5);
      expect(body.suggestions[0]).toMatchObject({
        date: expect.stringMatching(/^2026-08-/),
        startsAt: expect.stringMatching(/^2026-08-/),
        endsAt: expect.stringMatching(/^2026-08-/),
        staff: { id: "zhaohang", displayName: "赵航" },
      });
      expect(body.suggestions.map((suggestion) => suggestion.startsAt)).not.toContain(
        contestedSlot?.startsAt,
      );
      expect(conflict.body).not.toMatch(
        /bookings_(?:staff_occupancy|pet_service)_exclusion|constraint|stack/i,
      );
    }

    const facts = await database.pool.query<{
      booking_count: number;
      booking_event_count: number;
      audit_event_count: number;
      notification_count: number;
    }>(
      `
        SELECT count(*)::int AS booking_count,
               count(event.id)::int AS booking_event_count,
               count(audit.id)::int AS audit_event_count,
               count(notification.id)::int AS notification_count
        FROM bookings AS booking
        LEFT JOIN booking_events AS event ON event.booking_id = booking.id
        LEFT JOIN audit_events AS audit
          ON audit.subject_type = 'booking' AND audit.subject_id = booking.id
        LEFT JOIN notification_outbox AS notification ON notification.booking_id = booking.id
        WHERE booking.pet_id = ANY($1::text[])
      `,
      [competingPetIds],
    );
    expect(facts.rows[0]).toEqual({
      booking_count: 1,
      booking_event_count: 1,
      audit_event_count: 1,
      notification_count: 1,
    });
  });

  it("二十个请求让同一宠物跨员工重叠时仍只确认一笔且失败请求没有业务副作用", async () => {
    const staffIds = ["linxia", "zhaohang"] as const;
    const availability = await Promise.all(
      staffIds.map(async (staffId) => {
        const response = await app.inject({
          method: "GET",
          url: `/miniapp/available-slots?petId=${petOverlapRaceId}&primaryServiceId=dog-basic-care&staffId=${staffId}`,
          headers: { authorization },
        });
        expect(response.statusCode).toBe(200);
        return response
          .json<BookingAvailabilityResponse>()
          .days.flatMap((day) => day.slots)
          .map((slot) => slot.startsAt);
      }),
    );
    const commonStartsAt = availability[0]?.find((startsAt) => availability[1]?.includes(startsAt));
    expect(commonStartsAt).toBeDefined();

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/miniapp/bookings",
          headers: { authorization },
          payload: {
            idempotencyKey: `pet-race-${String(index + 1).padStart(2, "0")}-20260813`,
            petId: petOverlapRaceId,
            primaryServiceId: "dog-basic-care",
            addonIds: [],
            staffId: staffIds[index % staffIds.length],
            staffPreference: { kind: "fastest" },
            startsAt: commonStartsAt,
          },
        }),
      ),
    );
    const successes = responses.filter((response) => response.statusCode === 201);
    const conflicts = responses.filter((response) => response.statusCode === 409);

    expect(successes).toHaveLength(1);
    expect(successes[0]?.json()).toMatchObject({
      verificationCode: expect.stringMatching(/^\d{6}$/),
    });
    expect(conflicts).toHaveLength(19);
    for (const conflict of conflicts) {
      expect(conflict.json()).toMatchObject({
        code: "BOOKING_TIME_CONFLICT",
        suggestions: expect.any(Array),
      });
      expect(conflict.json()).not.toHaveProperty("verificationCode");
    }

    const facts = await database.pool.query<{
      booking_count: number;
      booking_event_count: number;
      audit_event_count: number;
      notification_count: number;
    }>(
      `
        SELECT count(*)::int AS booking_count,
               count(event.id)::int AS booking_event_count,
               count(audit.id)::int AS audit_event_count,
               count(notification.id)::int AS notification_count
        FROM bookings AS booking
        LEFT JOIN booking_events AS event ON event.booking_id = booking.id
        LEFT JOIN audit_events AS audit
          ON audit.subject_type = 'booking' AND audit.subject_id = booking.id
        LEFT JOIN notification_outbox AS notification ON notification.booking_id = booking.id
        WHERE booking.pet_id = $1
      `,
      [petOverlapRaceId],
    );
    expect(facts.rows[0]).toEqual({
      booking_count: 1,
      booking_event_count: 1,
      audit_event_count: 1,
      notification_count: 1,
    });
  });

  it("相同幂等键重试返回首次冲突结果且不会成为新的竞争请求", async () => {
    const availabilityResponse = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${retryPetIds[0]}&primaryServiceId=dog-basic-care&staffId=zhaohang`,
      headers: { authorization },
    });
    const availability = availabilityResponse.json<BookingAvailabilityResponse>();
    const contestedSlot = availability.days.find((day) => day.slots.length >= 5)?.slots[2];
    expect(contestedSlot).toBeDefined();

    const create = (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/miniapp/bookings",
        headers: { authorization },
        payload,
      });
    const basePayload = {
      primaryServiceId: "dog-basic-care",
      addonIds: [],
      staffId: "zhaohang",
      startsAt: contestedSlot?.startsAt,
    };
    expect(
      (
        await create({
          ...basePayload,
          idempotencyKey: "retry-conflict-base-20260813",
          petId: retryPetIds[0],
        })
      ).statusCode,
    ).toBe(201);

    const retryPayload = {
      ...basePayload,
      idempotencyKey: "retry-conflict-loser-20260813",
      petId: retryPetIds[1],
    };
    const availabilityService = app.get(BookingAvailabilityService);
    const discover = vi.spyOn(availabilityService, "discover");
    const simultaneousRetries = await Promise.all(
      Array.from({ length: 10 }, () => create(retryPayload)),
    );
    expect(simultaneousRetries.every((response) => response.statusCode === 409)).toBe(true);
    const firstBody = simultaneousRetries[0]?.json<{
      code: string;
      suggestions: Array<{
        startsAt: string;
        staff: { id: string };
      }>;
    }>();
    expect(firstBody?.code).toBe("BOOKING_TIME_CONFLICT");
    expect(firstBody?.suggestions[0]).toBeDefined();
    expect(simultaneousRetries.map((response) => response.json())).toEqual(
      Array.from({ length: 10 }, () => firstBody),
    );
    expect(discover).toHaveBeenCalledTimes(1);
    discover.mockRestore();

    const firstSuggestion = firstBody?.suggestions[0];
    expect(
      (
        await create({
          idempotencyKey: "retry-conflict-suggestion-20260813",
          petId: retryPetIds[2],
          primaryServiceId: "dog-basic-care",
          addonIds: [],
          staffId: firstSuggestion?.staff.id,
          startsAt: firstSuggestion?.startsAt,
        })
      ).statusCode,
    ).toBe(201);

    await database.pool.query(
      "UPDATE pets SET archived_at = $1 WHERE id = 'pet-booking-retry-loser'",
      ["2026-08-13T03:00:00.000Z"],
    );
    const retry = await create(retryPayload);
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual(firstBody);
    await database.pool.query(
      "UPDATE pets SET archived_at = NULL WHERE id = 'pet-booking-retry-loser'",
    );

    const result = await database.pool.query<{
      idempotency_count: number;
      booking_count: number;
      event_count: number;
      audit_count: number;
      notification_count: number;
    }>(
      `
        SELECT (
                 SELECT count(*)::int
                 FROM booking_idempotency_keys
                 WHERE customer_id = 'customer-cheng-mo'
                   AND command_type = 'create_booking'
                   AND idempotency_key = 'retry-conflict-loser-20260813'
               ) AS idempotency_count,
               count(booking.id)::int AS booking_count,
               count(event.id)::int AS event_count,
               count(audit.id)::int AS audit_count,
               count(notification.id)::int AS notification_count
        FROM pets AS pet
        LEFT JOIN bookings AS booking ON booking.pet_id = pet.id
        LEFT JOIN booking_events AS event ON event.booking_id = booking.id
        LEFT JOIN audit_events AS audit
          ON audit.subject_type = 'booking' AND audit.subject_id = booking.id
        LEFT JOIN notification_outbox AS notification ON notification.booking_id = booking.id
        WHERE pet.id = 'pet-booking-retry-loser'
      `,
    );
    expect(result.rows[0]).toEqual({
      idempotency_count: 1,
      booking_count: 0,
      event_count: 0,
      audit_count: 0,
      notification_count: 0,
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
