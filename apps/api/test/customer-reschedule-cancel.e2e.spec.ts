import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type {
  BookingAvailabilityResponse,
  CancelBookingResponse,
  CreateBookingResponse,
  RescheduleBookingOptionsResponse,
  RescheduleBookingResponse,
} from "@rongguang/contracts";
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

function shanghaiClock(instant: string): string {
  const local = new Date(Date.parse(instant) + 8 * 60 * 60_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

describe("顾客取消与顾客改期", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let authorization: string;
  let otherAuthorization: string;
  const createdBookingIds: string[] = [];
  const bookingIds = ["booking-cancel-boundary", "booking-cancel-after-cutoff"];
  const petIds = [
    "pet-customer-change-after-cutoff",
    "pet-customer-reschedule-success",
    "pet-customer-reschedule-race-a",
    "pet-customer-reschedule-race-b",
    "pet-customer-reschedule-content",
    "pet-customer-cancel-capacity",
    "pet-customer-cancel-observer",
  ];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    authorization = await customerAuthorization(app, "cheng-mo");
    otherAuthorization = await customerAuthorization(app, "lu-yao");
    await database.pool.query(
      `
        DELETE FROM booking_idempotency_keys
        WHERE customer_id IN ('customer-cheng-mo', 'customer-lu-yao')
          AND (idempotency_key LIKE 'cancel-%' OR idempotency_key LIKE 'reschedule-%')
      `,
    );
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [bookingIds]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [petIds]);
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES
          ('pet-customer-change-after-cutoff', 'customer-cheng-mo', '边界宠物', 'cat', 4.8),
          ('pet-customer-reschedule-success', 'customer-cheng-mo', '改期宠物', 'cat', 4.8),
          ('pet-customer-reschedule-race-a', 'customer-cheng-mo', '争抢甲', 'cat', 4.8),
          ('pet-customer-reschedule-race-b', 'customer-cheng-mo', '争抢乙', 'cat', 4.8),
          ('pet-customer-reschedule-content', 'customer-cheng-mo', '不换服务', 'cat', 4.8),
          ('pet-customer-cancel-capacity', 'customer-cheng-mo', '释放容量', 'cat', 4.8),
          ('pet-customer-cancel-observer', 'customer-cheng-mo', '观察容量', 'cat', 4.8)
      `,
    );
    await database.pool.query(
      `
        INSERT INTO bookings (
          id, customer_id, pet_id, staff_id, starts_at, ends_at,
          occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
          pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
          primary_service_id_snapshot, primary_service_name_snapshot,
          primary_service_price_cents, primary_service_duration_minutes,
          addon_snapshots, required_skill_ids_snapshot, total_price_cents,
          staff_display_name_snapshot, turnover_minutes,
          original_starts_at, original_ends_at,
          original_occupancy_starts_at, original_occupancy_ends_at,
          verification_code_digest, verification_code_seed, created_at
        )
        SELECT
          'booking-cancel-boundary', customer_id, pet_id, staff_id,
          '2026-08-13T14:50:00.000Z', '2026-08-13T16:20:00.000Z',
          '2026-08-13T14:50:00.000Z', '2026-08-13T16:35:00.000Z',
          service_duration_minutes, 'confirmed', pet_name_snapshot, pet_species_snapshot,
          pet_weight_kg_snapshot, pet_size_snapshot, primary_service_id_snapshot,
          primary_service_name_snapshot, primary_service_price_cents,
          primary_service_duration_minutes, addon_snapshots, required_skill_ids_snapshot,
          total_price_cents, staff_display_name_snapshot, turnover_minutes,
          '2026-08-13T14:50:00.000Z', '2026-08-13T16:20:00.000Z',
          '2026-08-13T14:50:00.000Z', '2026-08-13T16:35:00.000Z',
          verification_code_digest, 'booking-cancel-boundary', '2026-08-12T02:50:00.000Z'
        FROM bookings
        WHERE id = 'booking-bohe-future'
      `,
    );
    await database.pool.query(
      `
        INSERT INTO bookings (
          id, customer_id, pet_id, staff_id, starts_at, ends_at,
          occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
          pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
          primary_service_id_snapshot, primary_service_name_snapshot,
          primary_service_price_cents, primary_service_duration_minutes,
          addon_snapshots, required_skill_ids_snapshot, total_price_cents,
          staff_display_name_snapshot, turnover_minutes,
          original_starts_at, original_ends_at,
          original_occupancy_starts_at, original_occupancy_ends_at,
          verification_code_digest, verification_code_seed, created_at
        )
        SELECT
          'booking-cancel-after-cutoff', customer_id,
          'pet-customer-change-after-cutoff', 'zhouning',
          '2026-08-13T14:49:00.000Z', '2026-08-13T16:19:00.000Z',
          '2026-08-13T14:49:00.000Z', '2026-08-13T16:34:00.000Z',
          service_duration_minutes, 'confirmed', pet_name_snapshot, pet_species_snapshot,
          pet_weight_kg_snapshot, pet_size_snapshot, primary_service_id_snapshot,
          primary_service_name_snapshot, primary_service_price_cents,
          primary_service_duration_minutes, addon_snapshots, required_skill_ids_snapshot,
          total_price_cents, staff_display_name_snapshot, turnover_minutes,
          '2026-08-13T14:49:00.000Z', '2026-08-13T16:19:00.000Z',
          '2026-08-13T14:49:00.000Z', '2026-08-13T16:34:00.000Z',
          verification_code_digest, 'booking-cancel-after-cutoff',
          '2026-08-12T02:50:00.000Z'
        FROM bookings
        WHERE id = 'booking-bohe-future'
      `,
    );
  });

  afterAll(async () => {
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [
      [...bookingIds, ...createdBookingIds],
    ]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [petIds]);
    await database.pool.query(
      `
        DELETE FROM booking_idempotency_keys
        WHERE customer_id IN ('customer-cheng-mo', 'customer-lu-yao')
          AND (idempotency_key LIKE 'cancel-%' OR idempotency_key LIKE 'reschedule-%')
      `,
    );
    await app.close();
    vi.unstubAllEnvs();
  });

  it("恰好提前十二小时允许取消，重复命令返回同一首次结果", async () => {
    const request = {
      method: "POST" as const,
      url: "/miniapp/bookings/booking-cancel-boundary/cancel",
      headers: { authorization },
      payload: {
        idempotencyKey: "cancel-boundary-20260813",
        reason: "行程变化",
      },
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(first.json<CancelBookingResponse>()).toMatchObject({
      booking: { id: "booking-cancel-boundary", status: "cancelled" },
      verificationCode: null,
      verificationWindow: null,
      customerActions: {
        canCancel: false,
        canReschedule: false,
        cutoffAt: "2026-08-13T02:50:00.000Z",
      },
      changeHistory: [
        expect.objectContaining({
          kind: "customer_cancelled",
          actor: { type: "customer", id: "customer-cheng-mo" },
          previous: {
            staff: { id: "chenjia", displayName: "陈嘉" },
            startsAt: "2026-08-13T14:50:00.000Z",
            endsAt: "2026-08-13T16:20:00.000Z",
            turnoverEndsAt: "2026-08-13T16:35:00.000Z",
          },
          next: null,
        }),
      ],
    });
    const released = await database.pool.query<{
      occupancy_starts_at: Date | null;
      occupancy_ends_at: Date | null;
    }>(
      `
        SELECT occupancy_starts_at, occupancy_ends_at
        FROM bookings
        WHERE id = 'booking-cancel-boundary'
      `,
    );
    expect(released.rows[0]).toEqual({
      occupancy_starts_at: null,
      occupancy_ends_at: null,
    });
    await expect(
      database.pool.query(
        `
          UPDATE bookings
          SET occupancy_starts_at = NULL, occupancy_ends_at = NULL
          WHERE id = 'booking-bohe-future'
        `,
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "bookings_occupancy_bounds_check" });
  });

  it("少于十二小时拒绝取消并把联系门店的首次结果用于后续重试", async () => {
    const request = {
      method: "POST" as const,
      url: "/miniapp/bookings/booking-cancel-after-cutoff/cancel",
      headers: { authorization },
      payload: {
        idempotencyKey: "cancel-after-cutoff-20260813",
        reason: "行程变化",
      },
    };
    const first = await app.inject(request);
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:48:00.000Z");
    const retry = await app.inject(request);
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");

    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({
      code: "BOOKING_CHANGE_CUTOFF_PASSED",
      message: "开始前已不足 12 小时，请联系门店处理。",
      customerActions: {
        canCancel: false,
        canReschedule: false,
        cutoffAt: "2026-08-13T02:49:00.000Z",
      },
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual(first.json());

    const options = await app.inject({
      method: "GET",
      url: "/miniapp/bookings/booking-cancel-after-cutoff/reschedule-options",
      headers: { authorization },
    });
    expect(options.statusCode).toBe(200);
    expect(options.json<RescheduleBookingOptionsResponse>()).toMatchObject({
      booking: {
        id: "booking-cancel-after-cutoff",
        startsAt: "2026-08-13T14:49:00.000Z",
        staff: { id: "zhouning" },
      },
      customerActions: {
        canCancel: false,
        canReschedule: false,
        message: "开始前已不足 12 小时，请联系门店处理。",
      },
    });
  });

  it("少于十二小时拒绝改期，并在时间回退后仍重放首次联系门店结果", async () => {
    const request = {
      method: "POST" as const,
      url: "/miniapp/bookings/booking-cancel-after-cutoff/reschedule",
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-after-cutoff-20260813",
        staffId: "zhouning",
        startsAt: "2026-08-14T01:30:00.000Z",
      },
    };
    const first = await app.inject(request);
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:48:00.000Z");
    const retry = await app.inject(request);
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");

    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({
      code: "BOOKING_CHANGE_CUTOFF_PASSED",
      message: "开始前已不足 12 小时，请联系门店处理。",
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual(first.json());
  });

  it("从预约身份恢复原安排并只返回保持原宠物和服务的真实可约时段", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/miniapp/bookings/booking-bohe-future/reschedule-options",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<RescheduleBookingOptionsResponse>();
    expect(body).toMatchObject({
      booking: {
        id: "booking-bohe-future",
        pet: { id: "pet-bohe", name: "薄荷" },
        primaryService: { id: "cat-care", name: "猫咪洗护" },
        staff: { id: "chenjia", displayName: "陈嘉" },
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T04:30:00.000Z",
      },
      customerActions: { canReschedule: true },
      availability: {
        selection: {
          pet: { id: "pet-bohe", name: "薄荷" },
          primaryService: { id: "cat-care", name: "猫咪洗护" },
          serviceDurationMinutes: 90,
          totalPriceCents: 16800,
        },
        days: expect.any(Array),
      },
    });
    expect(body.availability).not.toBeNull();
    const slots = body.availability?.days.flatMap((day) => day.slots) ?? [];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots).not.toContainEqual(
      expect.objectContaining({
        startsAt: "2026-08-14T03:00:00.000Z",
        staff: expect.objectContaining({ id: "chenjia" }),
      }),
    );
  });

  it("原子改期保留预约身份与服务快照、轮换核销码并只追加一次变更事实", async () => {
    const availabilityResponse = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-customer-reschedule-success&primaryServiceId=cat-care",
      headers: { authorization },
    });
    expect(availabilityResponse.statusCode).toBe(200);
    const initialSlots = availabilityResponse
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots);
    expect(initialSlots.length).toBeGreaterThan(1);
    const originalSlot = initialSlots.find(
      (slot) => Date.parse(slot.startsAt) >= Date.parse("2026-08-13T14:50:00.000Z"),
    );
    expect(originalSlot).toBeDefined();

    const createdResponse = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-create-20260813",
        petId: "pet-customer-reschedule-success",
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: originalSlot?.staff.id,
        staffPreference: { kind: "fastest" },
        startsAt: originalSlot?.startsAt,
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<CreateBookingResponse>();
    createdBookingIds.push(created.booking.id);

    const optionsResponse = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}/reschedule-options`,
      headers: { authorization },
    });
    expect(optionsResponse.statusCode).toBe(200);
    const target = optionsResponse
      .json<RescheduleBookingOptionsResponse>()
      .availability?.days.flatMap((day) => day.slots)
      .find((slot) => Date.parse(slot.startsAt) >= Date.parse("2026-08-13T14:50:00.000Z"));
    expect(target).toBeDefined();

    const request = {
      method: "POST" as const,
      url: `/miniapp/bookings/${created.booking.id}/reschedule`,
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-success-20260813",
        staffId: target?.staff.id,
        startsAt: target?.startsAt,
      },
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    const rescheduled = first.json<RescheduleBookingResponse>();
    expect(rescheduled).toMatchObject({
      booking: {
        id: created.booking.id,
        status: "confirmed",
        pet: created.booking.pet,
        primaryService: created.booking.primaryService,
        addons: created.booking.addons,
        totalPriceCents: created.booking.totalPriceCents,
        startsAt: target?.startsAt,
        endsAt: target?.endsAt,
        staff: { id: target?.staff.id, displayName: target?.staff.displayName },
        originalSchedule: created.booking.originalSchedule,
      },
      verificationCode: expect.stringMatching(/^\d{6}$/),
      changeHistory: [
        expect.objectContaining({
          kind: "customer_rescheduled",
          actor: { type: "customer", id: "customer-cheng-mo" },
          previous: {
            staff: {
              id: created.booking.staff.id,
              displayName: created.booking.staff.displayName,
            },
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
        }),
      ],
    });
    expect(rescheduled.verificationCode).not.toBe(created.verificationCode);

    const secondOptionsResponse = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}/reschedule-options`,
      headers: { authorization },
    });
    expect(secondOptionsResponse.statusCode).toBe(200);
    const secondTarget = secondOptionsResponse
      .json<RescheduleBookingOptionsResponse>()
      .availability?.days.flatMap((day) => day.slots)
      .find((slot) => Date.parse(slot.startsAt) >= Date.parse("2026-08-13T14:50:00.000Z"));
    expect(secondTarget).toBeDefined();
    const secondChange = await app.inject({
      method: "POST",
      url: `/miniapp/bookings/${created.booking.id}/reschedule`,
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-success-second-20260813",
        staffId: secondTarget?.staff.id,
        startsAt: secondTarget?.startsAt,
      },
    });
    expect(secondChange.statusCode).toBe(201);
    expect(secondChange.json<RescheduleBookingResponse>().changeHistory[0]).toMatchObject({
      kind: "customer_rescheduled",
      next: { startsAt: secondTarget?.startsAt },
    });

    const delayedRetry = await app.inject(request);
    expect(delayedRetry.statusCode).toBe(201);
    expect(delayedRetry.json()).toEqual(first.json());
    const storedFirstResult = await database.pool.query<{
      response_body: Record<string, unknown>;
    }>(
      `
        SELECT response_body
        FROM booking_idempotency_keys
        WHERE customer_id = 'customer-cheng-mo'
          AND command_type = 'customer_reschedule'
          AND idempotency_key = 'reschedule-success-20260813'
      `,
    );
    expect(JSON.stringify(storedFirstResult.rows[0]?.response_body)).not.toContain(
      rescheduled.verificationCode,
    );
    expect(storedFirstResult.rows[0]?.response_body).toMatchObject({
      verificationCodeVersion: expect.any(Number),
    });

    const messages = await app.inject({
      method: "GET",
      url: "/miniapp/messages",
      headers: { authorization },
    });
    const rescheduleMessages = messages
      .json<{ messages: Array<{ kind: string; bookingId: string; body: string }> }>()
      .messages.filter(
        (message) =>
          message.kind === "booking_rescheduled" && message.bookingId === created.booking.id,
      );
    expect(rescheduleMessages).toHaveLength(2);
    expect(rescheduleMessages.map((message) => message.body)).toEqual([
      `改期宠物的新安排已确认，开始时间为 ${shanghaiClock(secondTarget?.startsAt ?? "")}。`,
      `改期宠物的新安排已确认，开始时间为 ${shanghaiClock(target?.startsAt ?? "")}。`,
    ]);
    const confirmationMessage = messages
      .json<{ messages: Array<{ kind: string; bookingId: string; body: string }> }>()
      .messages.find(
        (message) =>
          message.kind === "booking_confirmed" && message.bookingId === created.booking.id,
      );
    expect(confirmationMessage?.body).toBe(
      `改期宠物的猫咪洗护已确认，员工为${created.booking.staff.displayName}。`,
    );
  });

  it("两笔改期并发争抢同一安排时只成功一笔，失败方保留原安排、顾客选择和核销码", async () => {
    const petIdsForRace = ["pet-customer-reschedule-race-a", "pet-customer-reschedule-race-b"];
    const created = await Promise.all(
      petIdsForRace.map(async (petId, index) => {
        const availability = await app.inject({
          method: "GET",
          url: `/miniapp/available-slots?petId=${petId}&primaryServiceId=cat-care`,
          headers: { authorization },
        });
        expect(availability.statusCode).toBe(200);
        const futureSlots = availability
          .json<BookingAvailabilityResponse>()
          .days.flatMap((day) => day.slots)
          .filter((slot) => Date.parse(slot.startsAt) >= Date.parse("2026-08-13T14:50:00.000Z"));
        const slot = futureSlots[index * 4];
        expect(slot).toBeDefined();
        const response = await app.inject({
          method: "POST",
          url: "/miniapp/bookings",
          headers: { authorization },
          payload: {
            idempotencyKey: `reschedule-race-create-${index}-20260813`,
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
      }),
    );
    const options = await Promise.all(
      created.map(async (item) => {
        const response = await app.inject({
          method: "GET",
          url: `/miniapp/bookings/${item.booking.id}/reschedule-options`,
          headers: { authorization },
        });
        expect(response.statusCode).toBe(200);
        return (
          response
            .json<RescheduleBookingOptionsResponse>()
            .availability?.days.flatMap((day) => day.slots) ?? []
        );
      }),
    );
    const contested = options[0]?.find((slot) =>
      options[1]?.some(
        (candidate) => candidate.startsAt === slot.startsAt && candidate.staff.id === slot.staff.id,
      ),
    );
    expect(contested).toBeDefined();

    const responses = await Promise.all(
      created.map((item, index) =>
        app.inject({
          method: "POST",
          url: `/miniapp/bookings/${item.booking.id}/reschedule`,
          headers: { authorization },
          payload: {
            idempotencyKey: `reschedule-race-command-${index}-20260813`,
            staffId: contested?.staff.id,
            startsAt: contested?.startsAt,
          },
        }),
      ),
    );
    const successIndex = responses.findIndex((response) => response.statusCode === 201);
    const conflictIndex = responses.findIndex((response) => response.statusCode === 409);

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
    const failedBefore = created[conflictIndex];
    expect(failedBefore).toBeDefined();
    expect(responses[conflictIndex]?.json()).toMatchObject({
      code: "BOOKING_TIME_CONFLICT",
      nextStep: "conflict",
      booking: {
        id: failedBefore?.booking.id,
        startsAt: failedBefore?.booking.startsAt,
        staff: { id: failedBefore?.booking.staff.id },
      },
      requested: {
        staffId: contested?.staff.id,
        startsAt: contested?.startsAt,
      },
      suggestions: expect.any(Array),
    });

    const failedDetail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${failedBefore?.booking.id}`,
      headers: { authorization },
    });
    expect(failedDetail.statusCode).toBe(200);
    expect(failedDetail.json()).toMatchObject({
      booking: {
        id: failedBefore?.booking.id,
        startsAt: failedBefore?.booking.startsAt,
        staff: failedBefore?.booking.staff,
      },
      verificationCode: failedBefore?.verificationCode,
      changeHistory: [],
    });

    const messages = await app.inject({
      method: "GET",
      url: "/miniapp/messages",
      headers: { authorization },
    });
    const raceBookingIds = new Set(created.map((item) => item.booking.id));
    expect(
      messages
        .json<{ messages: Array<{ kind: string; bookingId: string }> }>()
        .messages.filter(
          (message) =>
            message.kind === "booking_rescheduled" && raceBookingIds.has(message.bookingId),
        ),
    ).toHaveLength(1);
    expect(successIndex).toBeGreaterThanOrEqual(0);
  });

  it("改期命令拒绝夹带更换宠物或主要服务，并保留当前预约事实", async () => {
    const availability = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-customer-reschedule-content&primaryServiceId=cat-care",
      headers: { authorization },
    });
    const slots = availability
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)
      .filter((slot) => Date.parse(slot.startsAt) >= Date.parse("2026-08-13T14:50:00.000Z"));
    const originalSlot = slots[0];
    const targetSlot = slots.find(
      (slot) =>
        slot.startsAt !== originalSlot?.startsAt || slot.staff.id !== originalSlot?.staff.id,
    );
    expect(originalSlot).toBeDefined();
    expect(targetSlot).toBeDefined();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-content-create-20260813",
        petId: "pet-customer-reschedule-content",
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: originalSlot?.staff.id,
        staffPreference: { kind: "fastest" },
        startsAt: originalSlot?.startsAt,
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<CreateBookingResponse>();
    createdBookingIds.push(created.booking.id);

    const response = await app.inject({
      method: "POST",
      url: `/miniapp/bookings/${created.booking.id}/reschedule`,
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-content-rejected-20260813",
        staffId: targetSlot?.staff.id,
        startsAt: targetSlot?.startsAt,
        petId: "pet-bohe",
        primaryServiceId: "dog-basic-care",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "BOOKING_CONTENT_CHANGE_NOT_ALLOWED",
      message: "改期不能更换宠物或主要服务，请取消后重新预约。",
    });
    const detail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}`,
      headers: { authorization },
    });
    expect(detail.json()).toMatchObject({
      booking: {
        id: created.booking.id,
        pet: { id: "pet-customer-reschedule-content" },
        primaryService: { id: "cat-care" },
        startsAt: created.booking.startsAt,
      },
      verificationCode: created.verificationCode,
      changeHistory: [],
    });
  });

  it("取消立即作废核销码并释放可约容量，越权与终态重复操作仍被拒绝", async () => {
    const availability = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-customer-cancel-capacity&primaryServiceId=cat-care",
      headers: { authorization },
    });
    expect(availability.statusCode).toBe(200);
    const slot = availability
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)
      .find((item) => Date.parse(item.startsAt) >= Date.parse("2026-08-13T14:50:00.000Z"));
    expect(slot).toBeDefined();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization },
      payload: {
        idempotencyKey: "cancel-capacity-create-20260813",
        petId: "pet-customer-cancel-capacity",
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: slot?.staff.id,
        staffPreference: { kind: "fastest" },
        startsAt: slot?.startsAt,
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json<CreateBookingResponse>();
    createdBookingIds.push(created.booking.id);
    const observerUrl = `/miniapp/available-slots?petId=pet-customer-cancel-observer&primaryServiceId=cat-care&staffId=${created.booking.staff.id}`;
    const beforeCancel = await app.inject({
      method: "GET",
      url: observerUrl,
      headers: { authorization },
    });
    expect(
      beforeCancel
        .json<BookingAvailabilityResponse>()
        .days.flatMap((day) => day.slots)
        .some((item) => item.startsAt === created.booking.startsAt),
    ).toBe(false);

    const cancelled = await app.inject({
      method: "POST",
      url: `/miniapp/bookings/${created.booking.id}/cancel`,
      headers: { authorization },
      payload: {
        idempotencyKey: "cancel-capacity-command-20260813",
        reason: "行程变化",
      },
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json()).toMatchObject({
      booking: { id: created.booking.id, status: "cancelled" },
      verificationCode: null,
      verificationWindow: null,
    });
    const afterCancel = await app.inject({
      method: "GET",
      url: observerUrl,
      headers: { authorization },
    });
    expect(
      afterCancel
        .json<BookingAvailabilityResponse>()
        .days.flatMap((day) => day.slots)
        .some((item) => item.startsAt === created.booking.startsAt),
    ).toBe(true);

    const forbidden = await app.inject({
      method: "POST",
      url: `/miniapp/bookings/${created.booking.id}/cancel`,
      headers: { authorization: otherAuthorization },
      payload: {
        idempotencyKey: "cancel-capacity-forbidden-20260813",
        reason: "行程变化",
      },
    });
    const terminal = await app.inject({
      method: "POST",
      url: `/miniapp/bookings/${created.booking.id}/reschedule`,
      headers: { authorization },
      payload: {
        idempotencyKey: "reschedule-cancelled-command-20260813",
        staffId: slot?.staff.id,
        startsAt: slot?.startsAt,
      },
    });
    expect(forbidden.statusCode).toBe(404);
    expect(forbidden.json()).toMatchObject({ code: "BOOKING_NOT_FOUND" });
    expect(terminal.statusCode).toBe(409);
    expect(terminal.json()).toMatchObject({ code: "BOOKING_CHANGE_NOT_ALLOWED" });

    await database.pool.query(`UPDATE pets SET archived_at = $2 WHERE id = $1`, [
      "pet-customer-cancel-capacity",
      "2026-08-13T02:50:00.000Z",
    ]);
    const terminalOptions = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${created.booking.id}/reschedule-options`,
      headers: { authorization },
    });
    expect(terminalOptions.statusCode).toBe(200);
    expect(terminalOptions.json<RescheduleBookingOptionsResponse>()).toMatchObject({
      booking: { id: created.booking.id, status: "cancelled" },
      customerActions: { canReschedule: false },
      availability: null,
    });

    const messages = await app.inject({
      method: "GET",
      url: "/miniapp/messages",
      headers: { authorization },
    });
    expect(
      messages
        .json<{ messages: Array<{ kind: string; bookingId: string }> }>()
        .messages.filter(
          (message) =>
            message.kind === "booking_cancelled" && message.bookingId === created.booking.id,
        ),
    ).toHaveLength(1);
  });
});
