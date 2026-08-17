import type { NestFastifyApplication } from "@nestjs/platform-fastify";
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

  if (typeof setCookie !== "string") {
    throw new Error("登录响应没有设置会话 Cookie");
  }

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

async function createBooking(
  app: NestFastifyApplication,
  authorization: string,
  idempotencyKey: string,
  startsAt: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/bookings",
    headers: { authorization },
    payload: {
      idempotencyKey,
      petId: "pet-bohe",
      primaryServiceId: "cat-care",
      addonIds: [],
      staffId: "chenjia",
      startsAt,
    },
  });

  expect(response.statusCode).toBe(201);
  return response.json<{ booking: { id: string } }>().booking.id;
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const decoder = new TextDecoder();
  let payload = "";

  while (!payload.includes(marker)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const result = await Promise.race([
      reader.read(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), remaining)),
    ]);
    if (!result || result.done) break;
    payload += decoder.decode(result.value, { stream: true });
  }

  return payload;
}

describe("店长工作台即时看到预约", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;
  let customerToken: string;
  let bookingId: string;
  const createdBookingIds: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    await app.listen({ host: "127.0.0.1", port: 0 });
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "linxia");
    customerToken = await customerAuthorization(app);
    bookingId = await createBooking(
      app,
      customerToken,
      "manager-live-facts-20260813",
      "2026-08-13T07:00:00.000Z",
    );
    createdBookingIds.push(bookingId);
  });

  afterAll(async () => {
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [
      createdBookingIds,
    ]);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("在工作台、四员工日历和可恢复详情入口读取同一笔事实与当前容量", async () => {
    const workbench = await app.inject({
      method: "GET",
      url: "/backoffice/manager/workbench",
      headers: { cookie: managerCookie },
    });
    const calendar = await app.inject({
      method: "GET",
      url: "/backoffice/manager/calendar?date=2026-08-13",
      headers: { cookie: managerCookie },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/backoffice/manager/bookings/${bookingId}`,
      headers: { cookie: managerCookie },
    });

    expect(workbench.statusCode).toBe(200);
    expect(workbench.headers["cache-control"]).toBe("no-store");
    const workbenchBody = workbench.json();
    expect(workbenchBody).toMatchObject({
      timeZone: "Asia/Shanghai",
      demoNow: "2026-08-13T02:50:00.000Z",
      localDate: "2026-08-13",
      statusSummary: { confirmed: expect.any(Number) },
      capacity: {
        publishedMinutes: expect.any(Number),
        occupiedMinutes: expect.any(Number),
        remainingMinutes: expect.any(Number),
      },
    });
    expect(
      workbenchBody.staffDays.find((day: { staff: { id: string } }) => day.staff.id === "chenjia"),
    ).toMatchObject({
      staff: { id: "chenjia", displayName: "陈嘉" },
      bookings: [expect.objectContaining({ id: bookingId, status: "confirmed" })],
    });

    expect(calendar.statusCode).toBe(200);
    expect(calendar.headers["cache-control"]).toBe("no-store");
    expect(calendar.json()).toMatchObject({
      selectedDate: "2026-08-13",
      businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
    });
    const calendarBody = calendar.json();
    expect(calendarBody.staffDays).toHaveLength(4);
    expect(calendarBody.staffDays[1]).toMatchObject({
      staff: { id: "chenjia", displayName: "陈嘉" },
    });
    expect(calendarBody.staffDays[1].shifts[0]).toMatchObject({
      startsAt: "10:30",
      endsAt: "19:00",
      breaks: [{ startsAt: "14:00", endsAt: "15:00" }],
    });
    expect(calendarBody.staffDays[1].bookings[0]).toMatchObject({
      id: bookingId,
      pet: { id: "pet-bohe", name: "薄荷" },
      primaryService: { id: "cat-care", name: "猫咪洗护" },
      startsAt: "2026-08-13T07:00:00.000Z",
      endsAt: "2026-08-13T08:30:00.000Z",
      turnoverEndsAt: "2026-08-13T08:45:00.000Z",
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.headers["cache-control"]).toBe("no-store");
    expect(detail.json()).toMatchObject({
      booking: {
        id: bookingId,
        customer: { id: "customer-cheng-mo", displayName: "程墨" },
        pet: { id: "pet-bohe", name: "薄荷" },
        staff: { id: "chenjia", displayName: "陈嘉" },
      },
    });
  });

  it("顾客成功创建预约后通过 SSE 只发送刷新提示而不发送最终事实", async () => {
    const response = await fetch(`${await app.getUrl()}/backoffice/manager/events`, {
      headers: { cookie: managerCookie },
    });
    const reader = response.body?.getReader();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(reader).toBeDefined();

    expect(await readSseUntil(reader!, "connected", 3_000)).toContain("connected");
    const liveBookingId = await createBooking(
      app,
      customerToken,
      "manager-live-sse-20260813",
      "2026-08-13T09:00:00.000Z",
    );
    createdBookingIds.push(liveBookingId);

    const payload = await readSseUntil(reader!, "booking-changed", 3_000);

    await reader?.cancel();
    expect(payload).toContain("booking-changed");
    expect(payload).toContain("manager-live-bookings");
    expect(payload).not.toContain(liveBookingId);
    expect(payload).not.toContain("pet-bohe");
  });

  it("员工不能访问工作台、完整日历、跨员工预约详情或店长事件流", async () => {
    const paths = [
      "/backoffice/manager/workbench",
      "/backoffice/manager/calendar?date=2026-08-13",
      `/backoffice/manager/bookings/${bookingId}`,
      "/backoffice/manager/events",
    ];

    for (const path of paths) {
      const response = await app.inject({
        method: "GET",
        url: path,
        headers: { cookie: staffCookie },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
