import { unlink } from "node:fs/promises";
import { join } from "node:path";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { getPetUploadDirectory } from "../src/config/environment.js";
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

async function createAssignedBooking(
  app: NestFastifyApplication,
): Promise<{ authorization: string; bookingId: string }> {
  const session = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey: "cheng-mo" },
  });
  expect(session.statusCode).toBe(201);
  const authorization = `Bearer ${session.json<{ accessToken: string }>().accessToken}`;
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/bookings",
    headers: { authorization },
    payload: {
      addonIds: [],
      idempotencyKey: "staff-today-boundary-20260813",
      petId: "pet-bohe",
      primaryServiceId: "cat-care",
      staffId: "chenjia",
      startsAt: "2026-08-13T07:00:00.000Z",
    },
  });

  expect(response.statusCode).toBe(201);
  return {
    authorization,
    bookingId: response.json<{ booking: { id: string } }>().booking.id,
  };
}

describe("员工今日工作与履约资料边界", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let bookingId: string;
  let assignedCookie: string;
  let otherStaffCookie: string;
  let uploadedPhotoId = "";

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    const assigned = await createAssignedBooking(app);
    bookingId = assigned.bookingId;
    assignedCookie = await login(app, "chenjia");
    otherStaffCookie = await login(app, "linxia");

    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const uploadResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pet-photos",
      headers: { authorization: assigned.authorization },
      payload: { mimeType: "image/png", base64Data: pngBytes.toString("base64") },
    });
    expect(uploadResponse.statusCode).toBe(201);
    uploadedPhotoId = uploadResponse.json<{ photo: { id: string } }>().photo.id;

    const petResponse = await app.inject({
      method: "GET",
      url: "/miniapp/pets/pet-bohe",
      headers: { authorization: assigned.authorization },
    });
    expect(petResponse.statusCode).toBe(200);
    const pet = petResponse.json<{ pet: Record<string, unknown> }>().pet;
    const updateResponse = await app.inject({
      method: "PUT",
      url: "/miniapp/pets/pet-bohe",
      headers: { authorization: assigned.authorization },
      payload: { ...pet, photoId: uploadedPhotoId },
    });
    expect(updateResponse.statusCode).toBe(200);
  });

  afterAll(async () => {
    await database.pool.query("UPDATE pets SET photo_id = NULL WHERE id = 'pet-bohe'");
    await database.pool.query("DELETE FROM bookings WHERE id = $1", [bookingId]);
    if (uploadedPhotoId) {
      const photoResult = await database.pool.query<{ storage_key: string }>(
        "DELETE FROM pet_photos WHERE id = $1 RETURNING storage_key",
        [uploadedPhotoId],
      );
      const storageKey = photoResult.rows[0]?.storage_key;
      if (storageKey) {
        await unlink(join(getPetUploadDirectory(), storageKey)).catch(() => undefined);
      }
    }
    await app.close();
  });

  it("分配员工可以读取本人今日队列与履约详情，且响应不暴露完整手机号或经营金额", async () => {
    const todayResponse = await app.inject({
      method: "GET",
      url: "/backoffice/staff/today",
      headers: { cookie: assignedCookie },
    });

    expect(todayResponse.statusCode).toBe(200);
    expect(todayResponse.headers["cache-control"]).toBe("no-store");
    expect(todayResponse.json()).toMatchObject({
      localDate: "2026-08-13",
      identity: { id: "chenjia", displayName: "陈嘉" },
      shifts: [{ startsAt: "10:30", endsAt: "19:00" }],
      nextBooking: {
        pet: {
          id: "pet-bohe",
          name: "薄荷",
          photoPath: `/backoffice/staff/bookings/${bookingId}/pet-photo`,
        },
        staff: { id: "chenjia" },
      },
      bookings: expect.arrayContaining([expect.objectContaining({ id: bookingId })]),
    });
    expect(JSON.stringify(todayResponse.json())).not.toContain("13951870341");
    expect(JSON.stringify(todayResponse.json())).not.toContain("totalPriceCents");

    const detailResponse = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}`,
      headers: { cookie: assignedCookie },
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      booking: {
        id: bookingId,
        customer: { displayName: "程墨", phoneMasked: "139****0341" },
        pet: {
          id: "pet-bohe",
          name: "薄荷",
          species: "cat",
          weightKg: 4.8,
          petSize: "small",
          breed: "英国短毛猫",
          coatType: "short",
          careTags: ["对陌生犬敏感"],
          careNotes: "请与犬只保持距离，使用安静的等候区域。",
        },
        service: { id: "cat-care", name: "猫咪洗护", durationMinutes: 90 },
      },
      petServiceHistory: [
        expect.objectContaining({
          bookingId: "booking-bohe-completed",
          serviceName: "猫咪洗护",
          staffName: "周宁",
          completedAt: "2026-08-06T03:22:00.000Z",
        }),
      ],
    });
    expect(detailResponse.json().booking.customer).not.toHaveProperty("id");
    expect(JSON.stringify(detailResponse.json())).not.toContain("13951870341");
    expect(JSON.stringify(detailResponse.json())).not.toContain("totalPriceCents");

    const photoResponse = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}/pet-photo`,
      headers: { cookie: assignedCookie },
    });
    expect(photoResponse.statusCode).toBe(200);
    expect(photoResponse.headers["content-type"]).toContain("image/png");
    expect(photoResponse.headers["cache-control"]).toBe("private, no-store");
    expect(photoResponse.rawPayload).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
    );

    const otherStaffPhotoResponse = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}/pet-photo`,
      headers: { cookie: otherStaffCookie },
    });
    expect(otherStaffPhotoResponse.statusCode).toBe(403);

    const consentResult = await database.pool.query<{ consented_at: Date }>(
      `
        SELECT consented_at
        FROM privacy_consents
        WHERE customer_id = 'customer-gu-yan' AND notice_version = '2026.08'
      `,
    );
    expect(consentResult.rows[0]?.consented_at).toEqual(new Date("2026-08-12T06:14:00.000Z"));
  });

  it("其他员工访问预约详情时得到明确无权限，而不是空数据或不存在", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/backoffice/staff/bookings/${bookingId}`,
      headers: { cookie: otherStaffCookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("只有分配员工明确确认后才能揭示完整手机号，并追加不可覆盖的服务端审计事实", async () => {
    const unconfirmedResponse = await app.inject({
      method: "POST",
      url: `/backoffice/staff/bookings/${bookingId}/customer-phone/reveal`,
      headers: { cookie: assignedCookie, origin: adminOrigin },
      payload: { confirmed: false },
    });
    expect(unconfirmedResponse.statusCode).toBe(400);
    expect(unconfirmedResponse.json()).toMatchObject({
      code: "PHONE_REVEAL_CONFIRMATION_REQUIRED",
    });

    const forbiddenResponse = await app.inject({
      method: "POST",
      url: `/backoffice/staff/bookings/${bookingId}/customer-phone/reveal`,
      headers: { cookie: otherStaffCookie, origin: adminOrigin },
      payload: { confirmed: true },
    });
    expect(forbiddenResponse.statusCode).toBe(403);

    const response = await app.inject({
      method: "POST",
      url: `/backoffice/staff/bookings/${bookingId}/customer-phone/reveal`,
      headers: { cookie: assignedCookie, origin: adminOrigin },
      payload: {
        confirmed: true,
        actorId: "linxia",
        customerId: "customer-xu-lan",
        auditText: "前端不能决定审计内容",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      bookingId,
      phone: "13951870341",
      revealedAt: "2026-08-13T02:50:00.000Z",
    });

    const auditResult = await database.pool.query<{
      id: string;
      actor_type: string;
      actor_id: string;
      subject_type: string;
      subject_id: string;
      payload: { customerId: string };
      occurred_at: Date;
    }>(
      `
        SELECT id, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
        FROM audit_events
        WHERE event_type = 'customer_phone_revealed' AND subject_id = $1
        ORDER BY occurred_at DESC, id DESC
      `,
      [bookingId],
    );
    expect(auditResult.rows).toHaveLength(1);
    expect(auditResult.rows[0]).toMatchObject({
      actor_type: "staff",
      actor_id: "chenjia",
      subject_type: "booking",
      subject_id: bookingId,
      payload: { customerId: "customer-cheng-mo" },
      occurred_at: new Date("2026-08-13T02:50:00.000Z"),
    });
    const auditId = auditResult.rows[0]?.id;
    await expect(
      database.pool.query("UPDATE audit_events SET payload = '{}'::jsonb WHERE id = $1", [auditId]),
    ).rejects.toThrow(/审计记录不可修改或删除/);
    await expect(
      database.pool.query("DELETE FROM audit_events WHERE id = $1", [auditId]),
    ).rejects.toThrow(/审计记录不可修改或删除/);
  });
});
