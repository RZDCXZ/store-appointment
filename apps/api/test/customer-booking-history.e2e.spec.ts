import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type {
  BookingDetailResponse,
  CustomerBookingHistoryResponse,
  CustomerMessagesResponse,
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

describe("顾客预约记录、详情、核销码与消息", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let chengAuthorization: string;
  let luAuthorization: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    chengAuthorization = await customerAuthorization(app, "cheng-mo");
    luAuthorization = await customerAuthorization(app, "lu-yao");
  });

  afterAll(async () => {
    await database.pool.query(
      "UPDATE bookings SET status = 'confirmed' WHERE id = 'booking-bohe-future'",
    );
    await app.close();
    vi.unstubAllEnvs();
  });

  it("按当前顾客把仍有效的预约与终态历史分段并返回完整快照", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/miniapp/bookings",
      headers: { authorization: chengAuthorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<CustomerBookingHistoryResponse>();
    expect(body.demoNow).toBe("2026-08-13T02:50:00.000Z");
    expect(body.upcoming).toEqual([
      expect.objectContaining({
        id: "booking-bohe-future",
        status: "confirmed",
        pet: expect.objectContaining({ name: "薄荷" }),
        primaryService: expect.objectContaining({ name: "猫咪洗护" }),
        staff: { id: "chenjia", displayName: "陈嘉" },
        startsAt: "2026-08-14T03:00:00.000Z",
        totalPriceCents: 16800,
        serviceDurationMinutes: 90,
      }),
    ]);
    expect(body.history).toEqual([
      expect.objectContaining({
        id: "booking-bohe-completed",
        status: "completed",
        completedAt: "2026-08-06T03:22:00.000Z",
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("栗子");
    expect(JSON.stringify(body)).not.toMatch(/care_notes|service_record|internal/i);
  });

  it("详情刷新可重建相同六位码，而数据库只保存不可逆摘要", async () => {
    const request = {
      method: "GET" as const,
      url: "/miniapp/bookings/booking-bohe-future",
      headers: { authorization: chengAuthorization },
    };
    const first = await app.inject(request);
    const refreshed = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    const detail = first.json<BookingDetailResponse>();
    expect(detail).toMatchObject({
      booking: {
        id: "booking-bohe-future",
        status: "confirmed",
        completedAt: null,
      },
      verificationCode: expect.stringMatching(/^\d{6}$/),
      verificationWindow: {
        opensAt: "2026-08-14T02:30:00.000Z",
        closesAt: "2026-08-14T03:15:00.000Z",
        description: "可在开始前 30 分钟至开始后 15 分钟内出示",
      },
    });
    expect(refreshed.json<BookingDetailResponse>().verificationCode).toBe(detail.verificationCode);

    const persisted = await database.pool.query<{
      verification_code_digest: string;
      verification_code_seed: string;
      verification_code_version: number;
    }>(
      `
        SELECT verification_code_digest, verification_code_seed, verification_code_version
        FROM bookings
        WHERE id = 'booking-bohe-future'
      `,
    );
    expect(persisted.rows[0]).toEqual({
      verification_code_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      verification_code_seed: "booking-bohe-future",
      verification_code_version: 1,
    });
    expect(persisted.rows[0]?.verification_code_digest).not.toContain(
      detail.verificationCode ?? "",
    );
  });

  it("已完成详情只暴露实际完成时间，已核销或取消后不再返回可用码", async () => {
    const completed = await app.inject({
      method: "GET",
      url: "/miniapp/bookings/booking-bohe-completed",
      headers: { authorization: chengAuthorization },
    });
    expect(completed.json<BookingDetailResponse>()).toMatchObject({
      booking: {
        status: "completed",
        completedAt: "2026-08-06T03:22:00.000Z",
      },
      verificationCode: null,
      verificationWindow: null,
    });
    expect(completed.body).not.toMatch(/care_notes|service_record|internal/i);

    await database.pool.query(
      "UPDATE bookings SET status = 'checked_in' WHERE id = 'booking-bohe-future'",
    );
    const checkedIn = await app.inject({
      method: "GET",
      url: "/miniapp/bookings/booking-bohe-future",
      headers: { authorization: chengAuthorization },
    });
    expect(checkedIn.json<BookingDetailResponse>()).toMatchObject({
      booking: { status: "checked_in" },
      verificationCode: null,
      verificationWindow: null,
    });
    await database.pool.query(
      "UPDATE bookings SET status = 'confirmed' WHERE id = 'booking-bohe-future'",
    );

    const cancelled = await app.inject({
      method: "GET",
      url: "/miniapp/bookings/booking-lizi-cancelled",
      headers: { authorization: luAuthorization },
    });
    expect(cancelled.json<BookingDetailResponse>()).toMatchObject({
      booking: { status: "cancelled" },
      verificationCode: null,
      verificationWindow: null,
    });
  });

  it("替换预约或消息标识不能读取其他顾客的数据", async () => {
    const forbiddenBooking = await app.inject({
      method: "GET",
      url: "/miniapp/bookings/booking-bohe-future",
      headers: { authorization: luAuthorization },
    });
    const forbiddenMessage = await app.inject({
      method: "GET",
      url: "/miniapp/messages/notification-bohe-future-confirmed",
      headers: { authorization: luAuthorization },
    });

    expect(forbiddenBooking.statusCode).toBe(404);
    expect(forbiddenBooking.json()).toMatchObject({ code: "BOOKING_NOT_FOUND" });
    expect(forbiddenMessage.statusCode).toBe(404);
    expect(forbiddenMessage.json()).toMatchObject({ code: "MESSAGE_NOT_FOUND" });
  });

  it("模拟消息由当前顾客预约事实生成并携带预约详情跳转身份", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/miniapp/messages",
      headers: { authorization: chengAuthorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<CustomerMessagesResponse>();
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "notification-bohe-future-confirmed",
          kind: "booking_confirmed",
          title: "预约已确认",
          body: "薄荷的猫咪洗护已确认，员工为陈嘉。",
          bookingId: "booking-bohe-future",
          actionLabel: "查看预约",
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain("栗子");

    const detail = await app.inject({
      method: "GET",
      url: "/miniapp/messages/notification-bohe-future-confirmed",
      headers: { authorization: chengAuthorization },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      message: { bookingId: "booking-bohe-future" },
    });
  });
});
