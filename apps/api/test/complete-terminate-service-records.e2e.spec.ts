import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";
const bookingId = "booking-bohe-future";
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

describe("完成服务、服务终止与追加说明", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let staffCookie: string;
  let managerCookie: string;
  let customerAuth: string;

  async function resetCheckedInBooking(): Promise<void> {
    const connection = await database.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET LOCAL session_replication_role = replica");
      await connection.query(
        `
          DELETE FROM store_service_record_notes
          WHERE service_record_id IN (
            SELECT id FROM store_service_records WHERE booking_id = $1
          )
        `,
        [bookingId],
      );
      await connection.query("DELETE FROM store_service_records WHERE booking_id = $1", [
        bookingId,
      ]);
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    await database.pool.query(
      "DELETE FROM booking_fulfilment_idempotency_keys WHERE booking_id = $1",
      [bookingId],
    );
    await database.pool.query(
      `
        DELETE FROM booking_events
        WHERE booking_id = $1
          AND event_type IN (
            'booking_checked_in', 'booking_late_checked_in',
            'booking_completed', 'booking_terminated'
          )
      `,
      [bookingId],
    );
    await database.pool.query(
      `
        UPDATE bookings
        SET status = 'checked_in',
            completed_at = NULL,
            starts_at = '2026-08-14T03:00:00.000Z',
            ends_at = '2026-08-14T04:30:00.000Z',
            occupancy_starts_at = '2026-08-14T03:00:00.000Z',
            occupancy_ends_at = '2026-08-14T04:45:00.000Z',
            original_starts_at = '2026-08-14T03:00:00.000Z',
            original_ends_at = '2026-08-14T04:30:00.000Z',
            original_occupancy_starts_at = '2026-08-14T03:00:00.000Z',
            original_occupancy_ends_at = '2026-08-14T04:45:00.000Z'
        WHERE id = $1
      `,
      [bookingId],
    );
    await database.pool.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES ($1, $2, 'booking_checked_in', 'staff', 'chenjia', $3::jsonb, $4)
      `,
      [
        randomUUID(),
        bookingId,
        JSON.stringify({ actor: { type: "staff", id: "chenjia", displayName: "陈嘉" } }),
        "2026-08-14T03:05:00.000Z",
      ],
    );
  }

  async function moveCurrentScheduleToAugust16(): Promise<void> {
    await database.pool.query(
      `
        UPDATE bookings
        SET starts_at = '2026-08-16T03:00:00.000Z',
            ends_at = '2026-08-16T04:30:00.000Z',
            occupancy_starts_at = '2026-08-16T03:00:00.000Z',
            occupancy_ends_at = '2026-08-16T04:45:00.000Z'
        WHERE id = $1
      `,
      [bookingId],
    );
    await database.pool.query(
      `
        UPDATE booking_events
        SET occurred_at = '2026-08-16T03:05:00.000Z'
        WHERE booking_id = $1 AND event_type = 'booking_checked_in'
      `,
      [bookingId],
    );
  }

  async function expectStaffCapacityReleasedAt(releasedAt: string): Promise<void> {
    const conflictingStart = new Date(Date.parse(releasedAt) - 1).toISOString();
    const updateMaiya = (startsAt: string) =>
      database.pool.query(
        `
          UPDATE bookings
          SET staff_id = 'chenjia',
              staff_display_name_snapshot = '陈嘉',
              starts_at = $1::timestamptz,
              ends_at = $1::timestamptz + interval '60 minutes',
              occupancy_starts_at = $1::timestamptz,
              occupancy_ends_at = $1::timestamptz + interval '75 minutes',
              original_starts_at = $1::timestamptz,
              original_ends_at = $1::timestamptz + interval '60 minutes',
              original_occupancy_starts_at = $1::timestamptz,
              original_occupancy_ends_at = $1::timestamptz + interval '75 minutes'
          WHERE id = 'booking-maiya-today'
        `,
        [startsAt],
      );

    try {
      await expect(updateMaiya(conflictingStart)).rejects.toMatchObject({ code: "23P01" });
      await expect(updateMaiya(releasedAt)).resolves.toBeDefined();
    } finally {
      await database.pool.query(
        `
          UPDATE bookings
          SET staff_id = 'linxia',
              staff_display_name_snapshot = '林夏',
              starts_at = '2026-08-13T03:00:00.000Z',
              ends_at = '2026-08-13T04:00:00.000Z',
              occupancy_starts_at = '2026-08-13T03:00:00.000Z',
              occupancy_ends_at = '2026-08-13T04:15:00.000Z',
              original_starts_at = '2026-08-13T03:00:00.000Z',
              original_ends_at = '2026-08-13T04:00:00.000Z',
              original_occupancy_starts_at = '2026-08-13T03:00:00.000Z',
              original_occupancy_ends_at = '2026-08-13T04:15:00.000Z'
          WHERE id = 'booking-maiya-today'
        `,
      );
    }
  }

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    [staffCookie, managerCookie, customerAuth] = await Promise.all([
      login(app, "chenjia"),
      login(app, "manager"),
      customerAuthorization(app),
    ]);
  });

  beforeEach(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:40:00.000Z");
    await resetCheckedInBooking();
  });

  afterAll(async () => {
    await resetCheckedInBooking();
    await database.pool.query(
      `
        DELETE FROM booking_events
        WHERE booking_id = $1
          AND event_type IN ('booking_checked_in', 'booking_late_checked_in')
      `,
      [bookingId],
    );
    await database.pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [
      bookingId,
    ]);
    const connection = await database.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET LOCAL session_replication_role = replica");
      await connection.query(
        `
          UPDATE store_service_records
          SET pet_snapshot = '{"id":"pet-bohe","name":"薄荷","species":"cat","weightKg":4.8,"petSize":"small"}'::jsonb,
              internal_text = '洗护过程配合良好，耳部清洁完成。'
          WHERE id = 'service-record-bohe-completed'
        `,
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    vi.unstubAllEnvs();
    await app.close();
  });

  it("已到店且到达计划开始后可完成服务并生成结构化门店服务记录", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-bohe-service-record",
        careTags: ["情绪稳定"],
        internalText: "洗护过程配合良好。",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      bookingId,
      status: "completed",
      outcome: "completed",
      occurredAt: "2026-08-14T03:40:00.000Z",
      actualOccupancy: {
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T03:55:00.000Z",
      },
      serviceRecord: {
        bookingId,
        pet: { id: "pet-bohe", name: "薄荷", species: "cat" },
        primaryService: { id: "cat-care", name: "猫咪洗护" },
        addons: [],
        staff: { id: "chenjia", displayName: "陈嘉" },
        actualStartsAt: "2026-08-14T03:05:00.000Z",
        actualEndsAt: "2026-08-14T03:40:00.000Z",
        careTags: ["情绪稳定"],
        internalText: "洗护过程配合良好。",
        notes: [],
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("priceCents");
    await expectStaffCapacityReleasedAt("2026-08-14T03:55:00.000Z");
  });

  it("改期到首次原计划之后的预约仍按当前计划完成并释放当前剩余容量", async () => {
    await moveCurrentScheduleToAugust16();
    vi.stubEnv("DEMO_NOW", "2026-08-16T03:40:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-after-later-reschedule",
        careTags: [],
        internalText: null,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "completed",
      actualOccupancy: {
        startsAt: "2026-08-16T03:00:00.000Z",
        endsAt: "2026-08-16T03:55:00.000Z",
      },
      originalSchedule: {
        startsAt: "2026-08-14T03:00:00.000Z",
        occupancyEndsAt: "2026-08-14T04:45:00.000Z",
      },
    });
  });

  it("已到店但早于计划开始时拒绝完成且不生成门店服务记录", async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-14T02:59:59.999Z");

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-before-planned-start",
        careTags: [],
        internalText: null,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "BOOKING_COMPLETION_TOO_EARLY" });
    const booking = await database.pool.query<{ status: string }>(
      "SELECT status FROM bookings WHERE id = $1",
      [bookingId],
    );
    const records = await database.pool.query(
      "SELECT id FROM store_service_records WHERE booking_id = $1",
      [bookingId],
    );
    expect(booking.rows[0]?.status).toBe("checked_in");
    expect(records.rows).toHaveLength(0);
  });

  it("已到店后可填写原因终止服务并在实际结束十五分钟后释放剩余容量", async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:25:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/terminate`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "terminate-bohe-stress-response",
        reason: "宠物持续应激，无法安全继续服务",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      bookingId,
      status: "terminated",
      outcome: "terminated",
      occurredAt: "2026-08-14T03:25:00.000Z",
      reason: "宠物持续应激，无法安全继续服务",
      actualOccupancy: {
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T03:40:00.000Z",
      },
      originalSchedule: {
        startsAt: "2026-08-14T03:00:00.000Z",
        endsAt: "2026-08-14T04:30:00.000Z",
        occupancyEndsAt: "2026-08-14T04:45:00.000Z",
      },
    });
    const records = await database.pool.query(
      "SELECT id FROM store_service_records WHERE booking_id = $1",
      [bookingId],
    );
    expect(records.rows).toHaveLength(0);
    await expectStaffCapacityReleasedAt("2026-08-14T03:40:00.000Z");
  });

  it("改期到首次原计划之后的预约仍按当前计划终止并保留十五分钟周转", async () => {
    await moveCurrentScheduleToAugust16();
    vi.stubEnv("DEMO_NOW", "2026-08-16T03:25:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/terminate`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "terminate-after-later-reschedule",
        reason: "改期后到店应激，无法安全继续服务",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "terminated",
      actualOccupancy: {
        startsAt: "2026-08-16T03:00:00.000Z",
        endsAt: "2026-08-16T03:40:00.000Z",
      },
      originalSchedule: {
        startsAt: "2026-08-14T03:00:00.000Z",
        occupancyEndsAt: "2026-08-14T04:45:00.000Z",
      },
    });
    await expectStaffCapacityReleasedAt("2026-08-16T03:40:00.000Z");
  });

  it("计划开始前已核销后终止时可在周转结束后释放整段原计划容量", async () => {
    await database.pool.query(
      `
        UPDATE booking_events
        SET occurred_at = '2026-08-14T02:35:00.000Z'
        WHERE booking_id = $1 AND event_type = 'booking_checked_in'
      `,
      [bookingId],
    );
    vi.stubEnv("DEMO_NOW", "2026-08-14T02:40:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/terminate`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "terminate-before-planned-start",
        reason: "到店后持续应激，无法开始服务",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "terminated",
      occurredAt: "2026-08-14T02:40:00.000Z",
      actualOccupancy: null,
    });
  });

  it("员工只能在只读门店服务记录后追加带作者与时间的说明", async () => {
    const completion = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-before-staff-note",
        careTags: ["情绪稳定"],
        internalText: "原始内部文字保持只读。",
      },
    });
    expect(completion.statusCode).toBe(201);
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:45:00.000Z");

    const appended = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/service-record/notes`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "append-staff-service-note",
        text: "补充：左前爪修剪时略有躲闪。",
      },
    });

    expect(appended.statusCode).toBe(201);
    expect(appended.json()).toMatchObject({
      bookingId,
      note: {
        kind: "staff_note",
        text: "补充：左前爪修剪时略有躲闪。",
        author: { type: "staff", id: "chenjia", displayName: "陈嘉" },
        createdAt: "2026-08-14T03:45:00.000Z",
      },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}`,
      headers: { cookie: staffCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      serviceRecord: {
        internalText: "原始内部文字保持只读。",
        notes: [
          {
            kind: "staff_note",
            text: "补充：左前爪修剪时略有躲闪。",
            author: { displayName: "陈嘉" },
            createdAt: "2026-08-14T03:45:00.000Z",
          },
        ],
      },
    });
  });

  it("未核销不能完成，核销后顾客也不能把服务结果改写为取消", async () => {
    await database.pool.query(
      `
        DELETE FROM booking_events
        WHERE booking_id = $1
          AND event_type IN ('booking_checked_in', 'booking_late_checked_in')
      `,
      [bookingId],
    );
    await database.pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [
      bookingId,
    ]);

    const unverifiedCompletion = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-without-check-in",
        careTags: [],
        internalText: null,
      },
    });
    expect(unverifiedCompletion.statusCode).toBe(409);
    expect(unverifiedCompletion.json()).toMatchObject({ code: "BOOKING_COMPLETION_NOT_ALLOWED" });

    const unverifiedTermination = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/terminate`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "terminate-without-check-in",
        reason: "尚未核销时不能终止",
      },
    });
    expect(unverifiedTermination.statusCode).toBe(409);
    expect(unverifiedTermination.json()).toMatchObject({ code: "BOOKING_TERMINATION_NOT_ALLOWED" });
    const unchanged = await database.pool.query<{
      status: string;
      occupancy_starts_at: Date;
      occupancy_ends_at: Date;
    }>("SELECT status, occupancy_starts_at, occupancy_ends_at FROM bookings WHERE id = $1", [
      bookingId,
    ]);
    expect(unchanged.rows[0]).toMatchObject({ status: "confirmed" });
    expect(unchanged.rows[0]?.occupancy_starts_at.toISOString()).toBe("2026-08-14T03:00:00.000Z");
    expect(unchanged.rows[0]?.occupancy_ends_at.toISOString()).toBe("2026-08-14T04:45:00.000Z");

    await resetCheckedInBooking();
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    const cancellation = await app.inject({
      method: "POST",
      url: `/miniapp/bookings/${bookingId}/cancel`,
      headers: { authorization: customerAuth },
      payload: {
        idempotencyKey: "cancel-after-check-in-state",
        reason: "不能覆盖到店事实",
      },
    });
    expect(cancellation.statusCode).toBe(409);
    expect(cancellation.json()).toMatchObject({ code: "BOOKING_CHANGE_NOT_ALLOWED" });
  });

  it("完成服务只能由预约的分配员工执行，店长不能代为写入正常完成记录", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-cannot-complete-service",
        careTags: [],
        internalText: null,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    const records = await database.pool.query(
      "SELECT id FROM store_service_records WHERE booking_id = $1",
      [bookingId],
    );
    expect(records.rows).toHaveLength(0);
  });

  it("重复完成不会生成第二条记录，原记录在数据库层也不能更新或删除", async () => {
    const request = {
      method: "POST" as const,
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-once-only-record",
        careTags: [],
        internalText: null,
      },
    };
    const first = await app.inject(request);
    const sameKeyRetry = await app.inject(request);
    const secondCommand = await app.inject({
      ...request,
      payload: { ...request.payload, idempotencyKey: "complete-second-command" },
    });

    expect(first.statusCode).toBe(201);
    expect(sameKeyRetry.statusCode).toBe(201);
    expect(sameKeyRetry.json()).toEqual(first.json());
    expect(secondCommand.statusCode).toBe(409);
    expect(secondCommand.json()).toMatchObject({ code: "BOOKING_COMPLETION_NOT_ALLOWED" });
    const records = await database.pool.query(
      "SELECT id FROM store_service_records WHERE booking_id = $1",
      [bookingId],
    );
    expect(records.rows).toHaveLength(1);
    await expect(
      database.pool.query(
        "UPDATE store_service_records SET internal_text = '尝试覆盖' WHERE booking_id = $1",
        [bookingId],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      database.pool.query("DELETE FROM store_service_records WHERE booking_id = $1", [bookingId]),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("店长追加的内容明确记录为更正说明且不覆盖员工原文", async () => {
    const completion = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-before-manager-correction",
        careTags: [],
        internalText: "员工原始记录。",
      },
    });
    expect(completion.statusCode).toBe(201);
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:50:00.000Z");

    const correction = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/service-record/notes`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "append-manager-correction",
        text: "更正：护理标签应补充为换毛期。",
      },
    });
    expect(correction.statusCode).toBe(201);
    expect(correction.json()).toMatchObject({
      note: {
        kind: "manager_correction",
        author: { type: "manager", id: "manager", displayName: "沈青" },
      },
    });

    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}`,
      headers: { cookie: staffCookie },
    });
    expect(detail.json()).toMatchObject({
      serviceRecord: {
        internalText: "员工原始记录。",
        notes: [{ kind: "manager_correction", text: "更正：护理标签应补充为换毛期。" }],
      },
    });
  });

  it("隐私匿名化使用受控数据库函数清理不可变记录中的宠物身份与自由文字", async () => {
    const completion = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-before-service-record-anonymization",
        careTags: ["情绪稳定"],
        internalText: "含有宠物名称薄荷的内部记录。",
      },
    });
    expect(completion.statusCode).toBe(201);
    const recordId = completion.json<{ serviceRecord: { id: string } }>().serviceRecord.id;
    vi.stubEnv("DEMO_NOW", "2026-08-14T03:45:00.000Z");
    const note = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/service-record/notes`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "append-before-service-record-anonymization",
        text: "补充中也可能包含顾客或宠物身份。",
      },
    });
    expect(note.statusCode).toBe(201);

    const completionEventsBeforeAnonymization = await database.pool.query<{ payload: object }>(
      `
        SELECT payload
        FROM booking_events
        WHERE booking_id = $1 AND event_type = 'booking_completed'
      `,
      [bookingId],
    );
    expect(completionEventsBeforeAnonymization.rows).toHaveLength(1);
    expect(completionEventsBeforeAnonymization.rows[0]?.payload).not.toHaveProperty(
      "serviceRecord",
    );
    expect(JSON.stringify(completionEventsBeforeAnonymization.rows[0]?.payload)).not.toContain(
      "含有宠物名称薄荷的内部记录。",
    );

    const anonymized = await database.pool.query<{ anonymized_count: number }>(
      "SELECT anonymize_store_service_records_for_customer($1) AS anonymized_count",
      ["customer-cheng-mo"],
    );
    expect(anonymized.rows[0]?.anonymized_count).toBe(2);

    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}`,
      headers: { cookie: staffCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      serviceRecord: {
        pet: { id: `anonymized-${recordId}`, name: "已匿名宠物" },
        internalText: null,
        notes: [{ text: "[原说明已匿名化]" }],
      },
    });

    const persistedEvents = await database.pool.query<{ payload: object }>(
      "SELECT payload FROM booking_events WHERE booking_id = $1",
      [bookingId],
    );
    const persistedIdempotency = await database.pool.query<{ response_body: object }>(
      "SELECT response_body FROM booking_fulfilment_idempotency_keys WHERE booking_id = $1",
      [bookingId],
    );
    const persistedCopies = JSON.stringify({
      events: persistedEvents.rows,
      idempotency: persistedIdempotency.rows,
    });
    expect(persistedIdempotency.rows).toHaveLength(0);
    expect(persistedCopies).not.toContain("薄荷");
    expect(persistedCopies).not.toContain("含有宠物名称薄荷的内部记录。");
    expect(persistedCopies).not.toContain("补充中也可能包含顾客或宠物身份。");
  });

  it("顾客预约详情只返回实际完成时间而不泄露门店服务记录或说明", async () => {
    const completion = await app.inject({
      method: "POST",
      url: `/backoffice/bookings/${bookingId}/complete`,
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "complete-customer-detail-boundary",
        careTags: ["情绪稳定"],
        internalText: "顾客不可见的内部文字。",
      },
    });
    expect(completion.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${bookingId}`,
      headers: { authorization: customerAuth },
    });
    const body = detail.json<Record<string, unknown>>();
    expect(detail.statusCode).toBe(200);
    expect(body).toMatchObject({
      booking: { status: "completed", completedAt: "2026-08-14T03:40:00.000Z" },
    });
    expect(body).not.toHaveProperty("serviceRecord");
    expect(JSON.stringify(body)).not.toContain("顾客不可见的内部文字");
  });
});
