import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { BookingAvailabilityResponse, CreateBookingResponse } from "@rongguang/contracts";
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

describe("店长预约内容纠正", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let customerAuthorization: string;
  const petIds = [
    "pet-content-boundary",
    "pet-content-skill",
    "pet-content-capacity",
    "pet-content-capacity-blocker",
    "pet-content-shrink",
    "pet-content-status",
  ];
  const bookingIds: string[] = [];

  async function createSmallBookingInMediumCapacity(): Promise<CreateBookingResponse> {
    await database.pool.query(
      "UPDATE pets SET weight_kg = 10.01 WHERE id = 'pet-content-boundary'",
    );
    const availability = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-content-boundary&primaryServiceId=cat-care&addonIds=nail-care",
      headers: { authorization: customerAuthorization },
    });
    expect(availability.statusCode).toBe(200);
    const slot = availability
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)[0];
    expect(slot).toBeDefined();
    await database.pool.query("UPDATE pets SET weight_kg = 10 WHERE id = 'pet-content-boundary'");
    const created = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerAuthorization },
      payload: {
        idempotencyKey: "content-boundary-create-20260813",
        petId: "pet-content-boundary",
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: slot?.staff.id,
        staffPreference: { kind: "specified", staffId: slot?.staff.id },
        startsAt: slot?.startsAt,
      },
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<CreateBookingResponse>();
    bookingIds.push(result.booking.id);
    return result;
  }

  async function createCatBookingForStaff(
    petId: string,
    staffId: string,
    idempotencyKey: string,
    addonIds: string[] = [],
  ): Promise<CreateBookingResponse> {
    const availability = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${petId}&primaryServiceId=cat-care&staffId=${staffId}&addonIds=${addonIds.join(",")}`,
      headers: { authorization: customerAuthorization },
    });
    expect(availability.statusCode).toBe(200);
    const slot = availability
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)[0];
    expect(slot).toBeDefined();
    const created = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerAuthorization },
      payload: {
        idempotencyKey,
        petId,
        primaryServiceId: "cat-care",
        addonIds,
        staffId,
        staffPreference: { kind: "specified", staffId },
        startsAt: slot?.startsAt,
      },
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<CreateBookingResponse>();
    bookingIds.push(result.booking.id);
    return result;
  }

  async function createCatBookingAt(
    petId: string,
    staffId: string,
    startsAt: string,
    idempotencyKey: string,
    addonIds: string[] = [],
  ): Promise<CreateBookingResponse> {
    const created = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerAuthorization },
      payload: {
        idempotencyKey,
        petId,
        primaryServiceId: "cat-care",
        addonIds,
        staffId,
        staffPreference: { kind: "specified", staffId },
        startsAt,
      },
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<CreateBookingResponse>();
    bookingIds.push(result.booking.id);
    return result;
  }

  async function createAdjacentCapacityBookings(): Promise<{
    original: CreateBookingResponse;
    blocker: CreateBookingResponse;
  }> {
    const availability = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-content-capacity&primaryServiceId=cat-care&staffId=chenjia",
      headers: { authorization: customerAuthorization },
    });
    expect(availability.statusCode).toBe(200);
    const slots = availability
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)
      .filter((slot) => slot.staff.id === "chenjia");
    const first = slots.find((slot) =>
      slots.some(
        (candidate) => Date.parse(candidate.startsAt) - Date.parse(slot.startsAt) === 120 * 60_000,
      ),
    );
    const second = slots.find(
      (slot) => first && Date.parse(slot.startsAt) - Date.parse(first.startsAt) === 120 * 60_000,
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    return {
      original: await createCatBookingAt(
        "pet-content-capacity",
        "chenjia",
        first?.startsAt ?? "",
        "content-capacity-create-20260813",
      ),
      blocker: await createCatBookingAt(
        "pet-content-capacity-blocker",
        "chenjia",
        second?.startsAt ?? "",
        "content-capacity-blocker-20260813",
      ),
    };
  }

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin: adminOrigin },
      payload: { username: "manager", password: "Rongguang2026!" },
    });
    expect(login.statusCode).toBe(201);
    managerCookie = sessionCookie(login);
    const customerSession = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "cheng-mo" },
    });
    expect(customerSession.statusCode).toBe(201);
    customerAuthorization = `Bearer ${customerSession.json<{ accessToken: string }>().accessToken}`;
    await database.pool.query(
      "DELETE FROM manager_booking_change_idempotency_keys WHERE command_type = 'manager_content_correction' AND idempotency_key LIKE 'manager-correct-%'",
    );
    await database.pool.query("DELETE FROM bookings WHERE pet_id = ANY($1::text[])", [petIds]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [petIds]);
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES
          ('pet-content-boundary', 'customer-cheng-mo', '边界猫', 'cat', 10),
          ('pet-content-skill', 'customer-cheng-mo', '技能猫', 'cat', 4.8),
          ('pet-content-capacity', 'customer-cheng-mo', '容量猫', 'cat', 4.8),
          ('pet-content-capacity-blocker', 'customer-cheng-mo', '下一只猫', 'cat', 4.8),
          ('pet-content-shrink', 'customer-cheng-mo', '缩短猫', 'cat', 4.8),
          ('pet-content-status', 'customer-cheng-mo', '状态猫', 'cat', 4.8)
      `,
    );
  });

  afterAll(async () => {
    await database.pool.query(
      "DELETE FROM manager_booking_change_idempotency_keys WHERE command_type = 'manager_content_correction' AND idempotency_key LIKE 'manager-correct-%'",
    );
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [bookingIds]);
    await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [petIds]);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("从 MG-07 可寻址预约身份恢复当前服务快照与可纠正选项", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-future/correction-options",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      booking: {
        id: "booking-bohe-future",
        status: "confirmed",
        pet: { id: "pet-bohe", name: "薄荷", weightKg: 4.8, petSize: "small" },
        primaryService: {
          id: "cat-care",
          name: "猫咪洗护",
          priceCents: 16800,
          durationMinutes: 90,
        },
        addons: [],
        staff: { id: "chenjia", displayName: "陈嘉" },
        totalPriceCents: 16800,
        serviceDurationMinutes: 90,
      },
      bookingRevision: 1,
      contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      managerActions: { canCorrectContent: true },
      currentContent: {
        pet: { weightKg: 4.8, petSize: "small" },
        primaryService: { id: "cat-care", priceCents: 16800, durationMinutes: 90 },
        addons: [],
        totalPriceCents: 16800,
        serviceDurationMinutes: 90,
        requiredSkillIds: ["cat-care"],
      },
      availableAddons: expect.arrayContaining([
        expect.objectContaining({ id: "nail-care", name: "修甲护理" }),
        expect.objectContaining({ id: "deshedding-care", name: "除废毛护理" }),
        expect.objectContaining({ id: "oral-care", name: "口腔清洁" }),
      ]),
    });
  });

  it("保存前预检自动由体重重算体型、规格、价格、时长、技能和连续容量", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/correction-preview",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        petWeightKg: 10.01,
        primaryServiceId: "cat-care",
        addonIds: ["nail-care"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      booking: { id: "booking-bohe-future", staff: { id: "chenjia", displayName: "陈嘉" } },
      currentContent: {
        pet: { weightKg: 4.8, petSize: "small" },
        totalPriceCents: 16800,
        serviceDurationMinutes: 90,
      },
      candidateContent: {
        pet: { weightKg: 10.01, petSize: "medium" },
        primaryService: { priceCents: 21800, durationMinutes: 120 },
        addons: [{ id: "nail-care", priceCents: 3000, durationMinutes: 15 }],
        totalPriceCents: 24800,
        serviceDurationMinutes: 135,
        requiredSkillIds: ["cat-care", "nail-care"],
      },
      validation: {
        skill: { status: "satisfied", staff: { id: "chenjia", displayName: "陈嘉" } },
        capacity: { status: "available" },
      },
      canSave: true,
    });
  });

  it("10kg 跨到 10.01kg 时原子重算中型规格、增项与实际占用并幂等留痕通知", async () => {
    const created = await createSmallBookingInMediumCapacity();
    const options = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}/correction-options`,
      headers: { cookie: managerCookie },
    });
    expect(options.statusCode).toBe(200);
    const before = await database.pool.query<{
      verification_code_digest: string;
      verification_code_version: number;
      original_ends_at: Date;
      original_occupancy_ends_at: Date;
    }>(
      `
        SELECT verification_code_digest, verification_code_version,
               original_ends_at, original_occupancy_ends_at
        FROM bookings WHERE id = $1
      `,
      [created.booking.id],
    );
    const optionBody = options.json<{
      bookingRevision: number;
      contentDigest: string;
    }>();
    const request = {
      method: "POST" as const,
      url: `/backoffice/manager/bookings/${created.booking.id}/correct-content`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-correct-boundary-20260813",
        reason: "到店前复秤并确认需要修甲",
        expectedStaffId: created.booking.staff.id,
        expectedStartsAt: created.booking.startsAt,
        expectedBookingRevision: optionBody.bookingRevision,
        expectedContentDigest: optionBody.contentDigest,
        petWeightKg: 10.01,
        primaryServiceId: "cat-care",
        addonIds: ["nail-care"],
      },
    };

    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      booking: {
        id: created.booking.id,
        pet: { id: "pet-content-boundary", weightKg: 10.01, petSize: "medium" },
        primaryService: {
          id: "cat-care",
          name: "猫咪洗护",
          priceCents: 21800,
          durationMinutes: 120,
        },
        addons: [{ id: "nail-care", name: "修甲护理", priceCents: 3000, durationMinutes: 15 }],
        totalPriceCents: 24800,
        serviceDurationMinutes: 135,
      },
      verificationCodeStatus: "unchanged",
      change: {
        kind: "manager_content_corrected",
        actor: { type: "manager", id: "manager", displayName: "沈青" },
        reason: "到店前复秤并确认需要修甲",
        previous: {
          pet: { weightKg: 10, petSize: "small" },
          primaryService: { priceCents: 16800, durationMinutes: 90 },
          addons: [],
          totalPriceCents: 16800,
          serviceDurationMinutes: 90,
        },
        next: {
          pet: { weightKg: 10.01, petSize: "medium" },
          primaryService: { priceCents: 21800, durationMinutes: 120 },
          addons: [{ id: "nail-care" }],
          totalPriceCents: 24800,
          serviceDurationMinutes: 135,
        },
      },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}`,
      headers: { cookie: managerCookie },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json<{
      changeHistory: Array<Record<string, unknown>>;
      notifications: Array<Record<string, unknown>>;
    }>();
    const correctionEvent = detailBody.changeHistory.find(
      (event) => event.type === "booking_content_corrected",
    );
    expect(correctionEvent).toMatchObject({
      type: "booking_content_corrected",
      actorType: "manager",
      actorId: "manager",
      reason: "到店前复秤并确认需要修甲",
      previous: {
        pet: { weightKg: 10, petSize: "small" },
        totalPriceCents: 16800,
        serviceDurationMinutes: 90,
      },
      next: {
        pet: { weightKg: 10.01, petSize: "medium" },
        addons: [{ id: "nail-care" }],
        totalPriceCents: 24800,
        serviceDurationMinutes: 135,
      },
    });
    expect(
      detailBody.notifications.some(
        (notification) => notification.type === "booking_content_corrected",
      ),
    ).toBe(true);
    const facts = await database.pool.query<{
      pet_weight_kg_snapshot: string;
      pet_size_snapshot: string;
      ends_at: Date;
      occupancy_ends_at: Date;
      original_ends_at: Date;
      original_occupancy_ends_at: Date;
      verification_code_digest: string;
      verification_code_version: number;
      pet_weight_kg: string;
      event_count: number;
      audit_count: number;
      notification_count: number;
      idempotency_count: number;
    }>(
      `
        SELECT booking.pet_weight_kg_snapshot::text,
               booking.pet_size_snapshot,
               booking.ends_at,
               booking.occupancy_ends_at,
               booking.original_ends_at,
               booking.original_occupancy_ends_at,
               booking.verification_code_digest,
               booking.verification_code_version,
               pet.weight_kg::text AS pet_weight_kg,
               (SELECT count(*)::int FROM booking_events
                WHERE booking_id = booking.id AND event_type = 'booking_content_corrected')
                 AS event_count,
               (SELECT count(*)::int FROM audit_events
                WHERE subject_id = booking.id AND event_type = 'manager_booking_content_corrected')
                 AS audit_count,
               (SELECT count(*)::int FROM notification_outbox
                WHERE booking_id = booking.id AND notification_type = 'booking_content_corrected')
                 AS notification_count,
               (SELECT count(*)::int FROM manager_booking_change_idempotency_keys
                WHERE booking_id = booking.id AND command_type = 'manager_content_correction')
                 AS idempotency_count
        FROM bookings AS booking
        JOIN pets AS pet ON pet.id = booking.pet_id
        WHERE booking.id = $1
      `,
      [created.booking.id],
    );
    expect(facts.rows[0]).toMatchObject({
      pet_weight_kg_snapshot: "10.01",
      pet_size_snapshot: "medium",
      pet_weight_kg: "10.01",
      original_ends_at: before.rows[0]?.original_ends_at,
      original_occupancy_ends_at: before.rows[0]?.original_occupancy_ends_at,
      verification_code_digest: before.rows[0]?.verification_code_digest,
      verification_code_version: before.rows[0]?.verification_code_version,
      event_count: 1,
      audit_count: 1,
      notification_count: 1,
      idempotency_count: 1,
    });
    expect(facts.rows[0]?.ends_at.toISOString()).toBe(
      new Date(Date.parse(created.booking.startsAt) + 135 * 60_000).toISOString(),
    );
    expect(facts.rows[0]?.occupancy_ends_at.toISOString()).toBe(
      new Date(Date.parse(created.booking.startsAt) + 150 * 60_000).toISOString(),
    );
  });

  it("当前员工不覆盖新增项完整技能时拒绝保存并保留原快照", async () => {
    const created = await createCatBookingForStaff(
      "pet-content-skill",
      "chenjia",
      "content-skill-create-20260813",
    );
    const options = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}/correction-options`,
      headers: { cookie: managerCookie },
    });
    const optionBody = options.json<{ bookingRevision: number; contentDigest: string }>();
    const before = await database.pool.query(
      `
        SELECT pet_weight_kg_snapshot, pet_size_snapshot, addon_snapshots,
               required_skill_ids_snapshot, total_price_cents,
               service_duration_minutes, ends_at, occupancy_ends_at
        FROM bookings WHERE id = $1
      `,
      [created.booking.id],
    );

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/manager/bookings/${created.booking.id}/correct-content`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-correct-skill-20260813",
        reason: "顾客补充口腔清洁增项",
        expectedStaffId: created.booking.staff.id,
        expectedStartsAt: created.booking.startsAt,
        expectedBookingRevision: optionBody.bookingRevision,
        expectedContentDigest: optionBody.contentDigest,
        petWeightKg: 4.8,
        primaryServiceId: "cat-care",
        addonIds: ["oral-care"],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "BOOKING_CORRECTION_SKILL_MISMATCH",
      message: expect.stringContaining("陈嘉"),
      booking: { id: created.booking.id },
      candidate: {
        pet: { weightKg: 4.8, petSize: "small" },
        addons: [{ id: "oral-care" }],
      },
      validation: {
        skill: { status: "insufficient", missingSkillIds: ["oral-care"] },
        capacity: { status: "not_checked" },
      },
      nextSteps: ["change_staff", "reschedule", "cancel"],
    });
    const after = await database.pool.query(
      `
        SELECT pet_weight_kg_snapshot, pet_size_snapshot, addon_snapshots,
               required_skill_ids_snapshot, total_price_cents,
               service_duration_minutes, ends_at, occupancy_ends_at
        FROM bookings WHERE id = $1
      `,
      [created.booking.id],
    );
    expect(after.rows).toEqual(before.rows);
    const sideEffects = await database.pool.query<{
      event_count: number;
      notification_count: number;
    }>(
      `
        SELECT
          (SELECT count(*)::int FROM booking_events
           WHERE booking_id = $1 AND event_type = 'booking_content_corrected') AS event_count,
          (SELECT count(*)::int FROM notification_outbox
           WHERE booking_id = $1 AND notification_type = 'booking_content_corrected')
            AS notification_count
      `,
      [created.booking.id],
    );
    expect(sideEffects.rows[0]).toEqual({ event_count: 0, notification_count: 0 });
  });

  it("扩大服务时长压到下一笔实际占用时原子拒绝并提供换员工、改期或取消", async () => {
    const { original, blocker } = await createAdjacentCapacityBookings();
    const options = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${original.booking.id}/correction-options`,
      headers: { cookie: managerCookie },
    });
    const optionBody = options.json<{ bookingRevision: number; contentDigest: string }>();
    const before = await database.pool.query(
      `
        SELECT pet_weight_kg_snapshot, pet_size_snapshot, addon_snapshots,
               total_price_cents, service_duration_minutes, ends_at, occupancy_ends_at
        FROM bookings WHERE id = $1
      `,
      [original.booking.id],
    );
    const request = {
      method: "POST" as const,
      url: `/backoffice/manager/bookings/${original.booking.id}/correct-content`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-correct-capacity-20260813",
        reason: "补充除废毛护理会扩大连续服务时长",
        expectedStaffId: original.booking.staff.id,
        expectedStartsAt: original.booking.startsAt,
        expectedBookingRevision: optionBody.bookingRevision,
        expectedContentDigest: optionBody.contentDigest,
        petWeightKg: 4.8,
        primaryServiceId: "cat-care",
        addonIds: ["deshedding-care"],
      },
    };

    const first = await app.inject(request);
    const retry = await app.inject(request);

    expect(first.statusCode).toBe(409);
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      code: "BOOKING_CORRECTION_CAPACITY_UNAVAILABLE",
      message: expect.stringContaining("原快照和实际占用保持不变"),
      booking: { id: original.booking.id, serviceDurationMinutes: 90 },
      blocker: { bookingId: blocker.booking.id },
      validation: {
        skill: { status: "satisfied" },
        capacity: { status: "insufficient" },
      },
      nextSteps: ["change_staff", "reschedule", "cancel"],
    });
    const after = await database.pool.query(
      `
        SELECT pet_weight_kg_snapshot, pet_size_snapshot, addon_snapshots,
               total_price_cents, service_duration_minutes, ends_at, occupancy_ends_at
        FROM bookings WHERE id = $1
      `,
      [original.booking.id],
    );
    expect(after.rows).toEqual(before.rows);
    const sideEffects = await database.pool.query<{
      event_count: number;
      audit_count: number;
      notification_count: number;
    }>(
      `
        SELECT
          (SELECT count(*)::int FROM booking_events
           WHERE booking_id = $1 AND event_type = 'booking_content_corrected') AS event_count,
          (SELECT count(*)::int FROM audit_events
           WHERE subject_id = $1 AND event_type = 'manager_booking_content_corrected') AS audit_count,
          (SELECT count(*)::int FROM notification_outbox
           WHERE booking_id = $1 AND notification_type = 'booking_content_corrected')
            AS notification_count
      `,
      [original.booking.id],
    );
    expect(sideEffects.rows[0]).toEqual({
      event_count: 0,
      audit_count: 0,
      notification_count: 0,
    });
  });

  it("移除增项缩短服务时长时同步缩短实际占用但永久保留原计划区间", async () => {
    const created = await createCatBookingForStaff(
      "pet-content-shrink",
      "chenjia",
      "content-shrink-create-20260813",
      ["deshedding-care"],
    );
    expect(created.booking.serviceDurationMinutes).toBe(120);
    const options = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}/correction-options`,
      headers: { cookie: managerCookie },
    });
    const optionBody = options.json<{ bookingRevision: number; contentDigest: string }>();
    const originalOccupancyEnd = created.booking.originalSchedule.occupancyEndsAt;
    const response = await app.inject({
      method: "POST",
      url: `/backoffice/manager/bookings/${created.booking.id}/correct-content`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-correct-shrink-20260813",
        reason: "顾客确认不再需要除废毛护理",
        expectedStaffId: created.booking.staff.id,
        expectedStartsAt: created.booking.startsAt,
        expectedBookingRevision: optionBody.bookingRevision,
        expectedContentDigest: optionBody.contentDigest,
        petWeightKg: 4.8,
        primaryServiceId: "cat-care",
        addonIds: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      booking: {
        serviceDurationMinutes: 90,
        addons: [],
        originalSchedule: { occupancyEndsAt: originalOccupancyEnd },
      },
      change: {
        previous: { serviceDurationMinutes: 120, addons: [{ id: "deshedding-care" }] },
        next: { serviceDurationMinutes: 90, addons: [] },
      },
    });
    const facts = await database.pool.query<{
      ends_at: Date;
      occupancy_ends_at: Date;
      original_ends_at: Date;
      original_occupancy_ends_at: Date;
    }>(
      `
        SELECT ends_at, occupancy_ends_at, original_ends_at, original_occupancy_ends_at
        FROM bookings WHERE id = $1
      `,
      [created.booking.id],
    );
    expect(facts.rows[0]?.ends_at.toISOString()).toBe(
      new Date(Date.parse(created.booking.startsAt) + 90 * 60_000).toISOString(),
    );
    expect(facts.rows[0]?.occupancy_ends_at.toISOString()).toBe(
      new Date(Date.parse(created.booking.startsAt) + 105 * 60_000).toISOString(),
    );
    expect(facts.rows[0]?.original_ends_at.toISOString()).toBe(
      created.booking.originalSchedule.endsAt,
    );
    expect(facts.rows[0]?.original_occupancy_ends_at.toISOString()).toBe(originalOccupancyEnd);
  });

  it("更换宠物或完全不同主要服务会引导取消后新建", async () => {
    const options = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-future/correction-options",
      headers: { cookie: managerCookie },
    });
    const optionBody = options.json<{
      booking: CreateBookingResponse["booking"];
      bookingRevision: number;
      contentDigest: string;
    }>();
    const common = {
      reason: "这不是预约内容纠正允许的范围",
      expectedStaffId: optionBody.booking.staff.id,
      expectedStartsAt: optionBody.booking.startsAt,
      expectedBookingRevision: optionBody.bookingRevision,
      expectedContentDigest: optionBody.contentDigest,
      petWeightKg: optionBody.booking.pet.weightKg,
      addonIds: [],
    };
    const replacePet = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/correct-content",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        ...common,
        idempotencyKey: "manager-correct-replace-pet",
        petId: "pet-maiya",
        primaryServiceId: "cat-care",
      },
    });
    const replaceService = await app.inject({
      method: "POST",
      url: "/backoffice/manager/bookings/booking-bohe-future/correct-content",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        ...common,
        idempotencyKey: "manager-correct-replace-service",
        primaryServiceId: "dog-basic-care",
      },
    });

    for (const response of [replacePet, replaceService]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: "BOOKING_CONTENT_REPLACEMENT_NOT_ALLOWED",
        message: expect.stringContaining("取消当前预约后新建"),
        nextStep: "cancel_and_rebook",
      });
    }
  });

  it("已到店以及已完成、已取消、已爽约、已终止预约均不能纠正服务内容", async () => {
    const created = await createCatBookingForStaff(
      "pet-content-status",
      "chenjia",
      "content-status-create-20260813",
    );
    const cases: Array<{ bookingId: string; status: string }> = [
      { bookingId: created.booking.id, status: "checked_in" },
      { bookingId: "booking-bohe-completed", status: "completed" },
      { bookingId: "booking-lizi-cancelled", status: "cancelled" },
      { bookingId: "booking-lizi-no-show", status: "no_show" },
    ];
    await database.pool.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [
      created.booking.id,
    ]);

    for (const [index, item] of cases.entries()) {
      const options = await app.inject({
        method: "GET",
        url: `/backoffice/manager/bookings/${item.bookingId}/correction-options`,
        headers: { cookie: managerCookie },
      });
      const optionBody = options.json<{
        booking: CreateBookingResponse["booking"];
        bookingRevision: number;
        contentDigest: string;
      }>();
      expect(optionBody.booking.status).toBe(item.status);
      expect(options.json()).toMatchObject({ managerActions: { canCorrectContent: false } });
      const response = await app.inject({
        method: "POST",
        url: `/backoffice/manager/bookings/${item.bookingId}/correct-content`,
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: {
          idempotencyKey: `manager-correct-illegal-${index}`,
          reason: "非法状态不能纠正",
          expectedStaffId: optionBody.booking.staff.id,
          expectedStartsAt: optionBody.booking.startsAt,
          expectedBookingRevision: optionBody.bookingRevision,
          expectedContentDigest: optionBody.contentDigest,
          petWeightKg: optionBody.booking.pet.weightKg,
          primaryServiceId: optionBody.booking.primaryService.id,
          addonIds: ["nail-care"],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "BOOKING_CHANGE_NOT_ALLOWED",
        booking: { id: item.bookingId, status: item.status },
        managerActions: { canCorrectContent: false },
      });
    }

    await database.pool.query(
      "UPDATE bookings SET status = 'terminated', occupancy_ends_at = ends_at WHERE id = $1",
      [created.booking.id],
    );
    const terminatedOptions = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${created.booking.id}/correction-options`,
      headers: { cookie: managerCookie },
    });
    const terminatedBody = terminatedOptions.json<{
      booking: CreateBookingResponse["booking"];
      bookingRevision: number;
      contentDigest: string;
    }>();
    const terminated = await app.inject({
      method: "POST",
      url: `/backoffice/manager/bookings/${created.booking.id}/correct-content`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-correct-illegal-terminated",
        reason: "终态不能纠正",
        expectedStaffId: terminatedBody.booking.staff.id,
        expectedStartsAt: terminatedBody.booking.startsAt,
        expectedBookingRevision: terminatedBody.bookingRevision,
        expectedContentDigest: terminatedBody.contentDigest,
        petWeightKg: terminatedBody.booking.pet.weightKg,
        primaryServiceId: terminatedBody.booking.primaryService.id,
        addonIds: ["nail-care"],
      },
    });
    expect(terminated.statusCode).toBe(409);
    expect(terminated.json()).toMatchObject({
      code: "BOOKING_CHANGE_NOT_ALLOWED",
      booking: { status: "terminated" },
      managerActions: { canCorrectContent: false },
    });
  });
});
