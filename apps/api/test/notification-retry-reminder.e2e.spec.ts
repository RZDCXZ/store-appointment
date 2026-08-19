import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";
import { NotificationService } from "../src/notification/notification.service.js";

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

async function customerAuthorization(app: NestFastifyApplication): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey: "cheng-mo" },
  });
  expect(response.statusCode).toBe(201);
  return `Bearer ${response.json<{ accessToken: string }>().accessToken}`;
}

describe("通知失败、重试与预约提醒", () => {
  const runId = randomUUID();
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let customerToken: string;
  const notificationIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    vi.stubEnv("NOTIFICATION_RETRY_BACKOFF_MS", "5");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    customerToken = await customerAuthorization(app);
  });

  afterAll(async () => {
    await database.pool.query("DELETE FROM notification_outbox WHERE id = ANY($1::text[])", [
      notificationIds,
    ]);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("通过独立列表与详情 API 恢复通知任务事实", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/backoffice/manager/notifications",
      headers: { cookie: managerCookie },
    });

    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    const listBody = list.json<{ channel: string; tasks: Array<Record<string, unknown>> }>();
    expect(listBody.channel).toBe("模拟微信通道");
    expect(listBody.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "notification-bohe-future-confirmed",
          type: "booking_confirmed",
          status: "sent",
          customer: expect.objectContaining({ displayName: "程墨" }),
          booking: expect.objectContaining({ id: "booking-bohe-future", petName: "薄荷" }),
        }),
        expect.objectContaining({
          id: "notification-seed-final-failed",
          type: "booking_rescheduled",
          status: "manual_retry_required",
          attemptCount: 3,
        }),
      ]),
    );

    const detail = await app.inject({
      method: "GET",
      url: "/backoffice/manager/notifications/notification-bohe-future-confirmed",
      headers: { cookie: managerCookie },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.headers["cache-control"]).toBe("no-store");
    expect(detail.json()).toMatchObject({
      task: {
        id: "notification-bohe-future-confirmed",
        status: "sent",
        channel: "模拟微信通道",
        attempts: expect.any(Array),
      },
    });

    const failedDetail = await app.inject({
      method: "GET",
      url: "/backoffice/manager/notifications/notification-seed-final-failed",
      headers: { cookie: managerCookie },
    });
    expect(failedDetail.statusCode).toBe(200);
    expect(failedDetail.json()).toMatchObject({
      task: {
        status: "manual_retry_required",
        attempts: [
          { number: 1, result: "failed" },
          { number: 2, result: "failed" },
          { number: 3, result: "failed" },
        ],
      },
    });
  });

  it("自动发送连续三次失败后进入工作台风险任务且预约事实保持有效", async () => {
    const notificationId = `notification-auto-retry-${runId}`;
    notificationIds.push(notificationId);
    const bookingBefore = await database.pool.query(
      "SELECT status, starts_at FROM bookings WHERE id = 'booking-bohe-future'",
    );
    await database.pool.query(
      `
        INSERT INTO notification_outbox (
          id, booking_id, customer_id, notification_type, payload,
          status, attempt_count, available_at, created_at, simulated_failures_remaining
        )
        VALUES (
          $1, 'booking-bohe-future', 'customer-cheng-mo', 'booking_rescheduled',
          '{"bookingId":"booking-bohe-future"}'::jsonb,
          'pending', 0, $2, $2, 3
        )
      `,
      [notificationId, "2026-08-13T02:50:00.000Z"],
    );

    const deadline = Date.now() + 2_000;
    let stored: { status: string; attempt_count: number } | undefined;
    while (Date.now() < deadline) {
      const result = await database.pool.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM notification_outbox WHERE id = $1",
        [notificationId],
      );
      stored = result.rows[0];
      if (stored?.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(stored).toEqual({ status: "failed", attempt_count: 3 });
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/notifications/${notificationId}`,
      headers: { cookie: managerCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      task: {
        status: "manual_retry_required",
        attempts: [
          { number: 1, mode: "automatic", result: "failed" },
          { number: 2, mode: "automatic", result: "failed" },
          { number: 3, mode: "automatic", result: "failed" },
        ],
      },
      businessFactNotice: "通知失败不会撤销已经成立的预约事实。",
    });
    const workbench = await app.inject({
      method: "GET",
      url: "/backoffice/manager/workbench",
      headers: { cookie: managerCookie },
    });
    expect(workbench.json().risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `notification:${notificationId}`,
          kind: "failed_notification",
          href: `/manager/system/notifications/${notificationId}`,
        }),
      ]),
    );
    expect(
      await database.pool.query(
        "SELECT status, starts_at FROM bookings WHERE id = 'booking-bohe-future'",
      ),
    ).toMatchObject({ rows: bookingBefore.rows });
  });

  it("店长注入可预测失败并人工重试，每次人工操作写入审计且顾客消息不重复", async () => {
    const notificationId = `notification-manual-retry-${runId}`;
    notificationIds.push(notificationId);
    await database.pool.query(
      `INSERT INTO notification_outbox (
         id, booking_id, customer_id, notification_type, payload,
         status, attempt_count, available_at, created_at
       )
       VALUES (
         $1, 'booking-bohe-future', 'customer-cheng-mo', 'booking_rescheduled',
         '{"bookingId":"booking-bohe-future"}'::jsonb,
         'failed', 3, clock_timestamp(), clock_timestamp()
       )`,
      [notificationId],
    );
    await database.pool.query(
      `INSERT INTO notification_delivery_attempts (
         id, notification_id, attempt_number, mode, result, detail, attempted_at
       )
       SELECT $1 || '-' || number::text, $1, number, 'automatic', 'failed',
              '模拟微信通道超时', clock_timestamp()
       FROM generate_series(1, 3) AS number`,
      [notificationId],
    );

    const injected = await app.inject({
      method: "POST",
      url: `/backoffice/manager/notifications/${notificationId}/simulated-failures`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { count: 1 },
    });
    expect(injected.statusCode).toBe(201);
    expect(injected.json()).toEqual({ notificationId, simulatedFailuresRemaining: 1 });

    const firstRetry = await app.inject({
      method: "POST",
      url: `/backoffice/manager/notifications/${notificationId}/manual-retry`,
      headers: { cookie: managerCookie, origin: adminOrigin },
    });
    expect(firstRetry.statusCode).toBe(201);
    expect(firstRetry.json()).toMatchObject({ notificationId, status: "pending" });

    const firstDeadline = Date.now() + 2_000;
    let firstResult: { status: string; attempt_count: number } | undefined;
    while (Date.now() < firstDeadline) {
      const result = await database.pool.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM notification_outbox WHERE id = $1",
        [notificationId],
      );
      firstResult = result.rows[0];
      if (firstResult?.status === "failed" && firstResult.attempt_count === 4) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(firstResult).toEqual({ status: "failed", attempt_count: 4 });

    const secondRetry = await app.inject({
      method: "POST",
      url: `/backoffice/manager/notifications/${notificationId}/manual-retry`,
      headers: { cookie: managerCookie, origin: adminOrigin },
    });
    expect(secondRetry.statusCode).toBe(201);

    const secondDeadline = Date.now() + 2_000;
    let secondResult: { status: string; attempt_count: number } | undefined;
    while (Date.now() < secondDeadline) {
      const result = await database.pool.query<{ status: string; attempt_count: number }>(
        "SELECT status, attempt_count FROM notification_outbox WHERE id = $1",
        [notificationId],
      );
      secondResult = result.rows[0];
      if (secondResult?.status === "sent") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(secondResult).toEqual({ status: "sent", attempt_count: 5 });

    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/notifications/${notificationId}`,
      headers: { cookie: managerCookie },
    });
    expect(detail.json()).toMatchObject({
      task: {
        status: "sent",
        attempts: [
          {},
          {},
          {},
          { number: 4, mode: "manual", result: "failed" },
          { number: 5, mode: "manual", result: "sent" },
        ],
      },
    });
    const audits = await database.pool.query<{
      event_type: string;
      actor_id: string;
      subject_id: string;
    }>(
      `SELECT event_type, actor_id, subject_id
       FROM audit_events
       WHERE subject_type = 'notification' AND subject_id = $1
       ORDER BY occurred_at, id`,
      [notificationId],
    );
    expect(audits.rows).toEqual([
      {
        event_type: "notification_manual_retry_requested",
        actor_id: "manager",
        subject_id: notificationId,
      },
      {
        event_type: "notification_manual_retry_requested",
        actor_id: "manager",
        subject_id: notificationId,
      },
    ]);

    const messages = await app.inject({
      method: "GET",
      url: "/miniapp/messages",
      headers: { authorization: customerToken },
    });
    expect(
      messages
        .json<{ messages: Array<{ id: string }> }>()
        .messages.filter((message) => message.id === notificationId),
    ).toHaveLength(1);
  });

  it("在开始前二十四小时生成提醒，但创建时已不足二十四小时的不补发", async () => {
    const bookingIds = ["booking-bohe-future", "booking-maiya-today"];
    const original = await database.pool.query<{
      id: string;
      starts_at: Date;
      ends_at: Date;
      occupancy_starts_at: Date | null;
      occupancy_ends_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, starts_at, ends_at, occupancy_starts_at, occupancy_ends_at, created_at
       FROM bookings WHERE id = ANY($1::text[]) ORDER BY id`,
      [bookingIds],
    );
    await database.pool.query(
      "DELETE FROM notification_outbox WHERE booking_id = ANY($1::text[]) AND notification_type = 'booking_reminder'",
      [bookingIds],
    );

    try {
      await database.pool.query(
        `UPDATE bookings
         SET starts_at = '2026-08-14T02:50:00.000Z',
             ends_at = '2026-08-14T04:20:00.000Z',
             occupancy_starts_at = '2026-08-14T02:50:00.000Z',
             occupancy_ends_at = '2026-08-14T04:35:00.000Z',
             created_at = '2026-08-13T01:50:00.000Z'
         WHERE id = 'booking-bohe-future'`,
      );
      await database.pool.query(
        `UPDATE bookings
         SET starts_at = '2026-08-14T01:50:00.000Z',
             ends_at = '2026-08-14T03:20:00.000Z',
             occupancy_starts_at = '2026-08-14T01:50:00.000Z',
             occupancy_ends_at = '2026-08-14T03:35:00.000Z',
             created_at = '2026-08-13T02:50:00.000Z'
         WHERE id = 'booking-maiya-today'`,
      );
      await app.get(NotificationService).createDueRemindersAt("2026-08-13T02:50:00.000Z");

      const deadline = Date.now() + 2_000;
      let reminders: Array<{ booking_id: string; notification_type: string }> = [];
      while (Date.now() < deadline) {
        const result = await database.pool.query<{
          booking_id: string;
          notification_type: string;
        }>(
          `SELECT booking_id, notification_type
           FROM notification_outbox
           WHERE booking_id = ANY($1::text[]) AND notification_type = 'booking_reminder'
           ORDER BY booking_id`,
          [bookingIds],
        );
        reminders = result.rows;
        if (reminders.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(reminders).toEqual([
        { booking_id: "booking-bohe-future", notification_type: "booking_reminder" },
      ]);
    } finally {
      for (const booking of original.rows) {
        await database.pool.query(
          `UPDATE bookings
           SET starts_at = $2, ends_at = $3,
               occupancy_starts_at = $4, occupancy_ends_at = $5, created_at = $6
           WHERE id = $1`,
          [
            booking.id,
            booking.starts_at,
            booking.ends_at,
            booking.occupancy_starts_at,
            booking.occupancy_ends_at,
            booking.created_at,
          ],
        );
      }
      await database.pool.query(
        "DELETE FROM notification_outbox WHERE booking_id = ANY($1::text[]) AND notification_type = 'booking_reminder'",
        [bookingIds],
      );
    }
  });

  it("进程重启后回收停在处理中的任务并继续发送", async () => {
    const notificationId = `notification-restart-${runId}`;
    notificationIds.push(notificationId);
    await database.pool.query(
      `INSERT INTO notification_outbox (
         id, booking_id, customer_id, notification_type, payload,
         status, attempt_count, available_at, created_at
       )
       VALUES (
         $1, 'booking-bohe-future', 'customer-cheng-mo', 'booking_rescheduled',
         '{"bookingId":"booking-bohe-future"}'::jsonb,
         'processing', 0, clock_timestamp(), clock_timestamp()
       )`,
      [notificationId],
    );

    const restartedApp = await createApplication();
    try {
      await restartedApp.init();
      const deadline = Date.now() + 2_000;
      let recovered: { status: string; attempt_count: number } | undefined;
      while (Date.now() < deadline) {
        const result = await database.pool.query<{ status: string; attempt_count: number }>(
          "SELECT status, attempt_count FROM notification_outbox WHERE id = $1",
          [notificationId],
        );
        recovered = result.rows[0];
        if (recovered?.status === "sent") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(recovered).toEqual({ status: "sent", attempt_count: 1 });
      const attempts = await database.pool.query<{ mode: string; result: string }>(
        `SELECT mode, result FROM notification_delivery_attempts
         WHERE notification_id = $1 ORDER BY attempt_number`,
        [notificationId],
      );
      expect(attempts.rows).toEqual([{ mode: "automatic", result: "sent" }]);
    } finally {
      await restartedApp.close();
    }
  });
});
