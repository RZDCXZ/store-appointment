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
            occupancy_starts_at = '2026-08-14T03:00:00.000Z',
            occupancy_ends_at = '2026-08-14T04:45:00.000Z'
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
