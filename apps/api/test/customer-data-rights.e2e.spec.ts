import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { CustomerDataExport, CustomerDataRightsStatusResponse } from "@rongguang/contracts";
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

function sessionCookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const setCookie = Array.isArray(value) ? value[0] : value;
  if (typeof setCookie !== "string") throw new Error("登录响应没有设置会话 Cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

async function managerCookie(app: NestFastifyApplication): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { origin: "http://localhost:5173" },
    payload: { username: "manager", password: "Rongguang2026!" },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

describe("顾客数据导出与匿名化删除", () => {
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
      `UPDATE customers
       SET display_name = '陆遥', phone = '13690247519', anonymized_at = NULL
       WHERE id = 'customer-lu-yao'`,
    );
    await database.pool.query(
      `INSERT INTO demo_customer_profiles (customer_id, demo_key, story, sort_order)
       VALUES ('customer-lu-yao', 'lu-yao', '取消或爽约历史', 3)
       ON CONFLICT (customer_id) DO UPDATE
       SET demo_key = excluded.demo_key, story = excluded.story, sort_order = excluded.sort_order`,
    );
    await database.pool.query(
      `UPDATE pets
       SET name = '栗子', species = 'dog', weight_kg = 28.6,
           breed = '金毛寻回犬', sex = 'male', birth_date = '2020-11-22',
           coat_type = 'long', seed_photo_path = '/assets/brand/pet-lizi-golden.jpg',
           photo_id = NULL, care_notes = '耳部清洁动作放缓。',
           archived_at = '2026-08-02T04:00:00.000Z', updated_at = now()
       WHERE id = 'pet-lizi'`,
    );
    await database.pool.query("DELETE FROM pet_care_tags WHERE pet_id = 'pet-lizi'");
    await database.pool.query(
      "INSERT INTO pet_care_tags (pet_id, tag) VALUES ('pet-lizi', '耳部需轻柔')",
    );
    await database.pool.query(
      `INSERT INTO privacy_consents (customer_id, notice_version, source, consented_at)
       VALUES ('customer-lu-yao', '2026.05', 'miniapp_booking', '2026-05-06T01:10:00.000Z')
       ON CONFLICT (customer_id, notice_version) DO UPDATE
       SET source = excluded.source, consented_at = excluded.consented_at`,
    );
    await database.pool.query(
      "UPDATE bookings SET pet_name_snapshot = '栗子' WHERE customer_id = 'customer-lu-yao'",
    );
    await app.close();
    vi.unstubAllEnvs();
  });

  it("只向当前顾客导出结构化本人资料并留下最小审计事实", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/miniapp/data-export?customerId=customer-lu-yao",
      headers: { authorization: chengAuthorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain("rongguang-my-data-20260813.json");
    const exported = response.json<CustomerDataExport>();
    expect(exported).toMatchObject({
      exportType: "customer_personal_data_json",
      exportedAt: "2026-08-13T02:50:00.000Z",
      subjectScope: "authenticated_customer",
      customer: {
        displayName: "程墨",
        phone: "13951870341",
      },
    });
    expect(exported.pets).toEqual([
      expect.objectContaining({
        name: "薄荷",
        careTags: ["对陌生犬敏感"],
        careNotes: "请与犬只保持距离，使用安静的等候区域。",
      }),
    ]);
    expect(exported.privacyConsents).toEqual([
      expect.objectContaining({ version: "2026.08", source: "miniapp_booking" }),
    ]);
    expect(exported.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "booking-bohe-future",
          pet: expect.objectContaining({ name: "薄荷" }),
        }),
      ]),
    );
    expect(exported.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ bookingId: "booking-bohe-future" })]),
    );
    expect(response.body).not.toContain("陆遥");
    expect(response.body).not.toContain("栗子");

    const audit = await database.pool.query<{
      actor_type: string;
      actor_id: string;
      subject_type: string;
      subject_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT actor_type, actor_id, subject_type, subject_id, payload
       FROM audit_events
       WHERE event_type = 'data_exported'
         AND actor_type = 'customer'
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "customer",
        actor_id: "customer-cheng-mo",
        subject_type: "customer",
        subject_id: "customer-cheng-mo",
        payload: {
          exportType: "customer_personal_data_json",
          bookingCount: 2,
          messageCount: 3,
          petCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("13951870341");
    expect(JSON.stringify(audit.rows)).not.toContain(chengAuthorization);
  });

  it("按本人会话列出阻断删除的未来预约，并明确演示保留规则", async () => {
    const blocked = await app.inject({
      method: "GET",
      url: "/miniapp/data-rights",
      headers: { authorization: chengAuthorization },
    });
    const available = await app.inject({
      method: "GET",
      url: "/miniapp/data-rights",
      headers: { authorization: luAuthorization },
    });

    expect(blocked.statusCode).toBe(200);
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.json<CustomerDataRightsStatusResponse>()).toMatchObject({
      customer: { displayName: "程墨", phoneMasked: "139****0341" },
      dataSummary: {
        petCount: 1,
        privacyConsentCount: 1,
        bookingCount: 2,
        messageCount: 3,
      },
      canDelete: false,
      futureBookings: [
        {
          id: "booking-bohe-future",
          petName: "薄荷",
          primaryServiceName: "猫咪洗护",
          startsAt: "2026-08-14T03:00:00.000Z",
          endsAt: "2026-08-14T04:30:00.000Z",
        },
      ],
      retentionPolicy: {
        anonymized: expect.arrayContaining(["顾客姓名与手机号", "宠物档案、照片与护理资料"]),
        retained: expect.arrayContaining(["不含身份的预约历史", "经营统计与删除审计事实"]),
        disclaimer: expect.stringContaining("演示保留规则"),
      },
    });
    expect(available.statusCode).toBe(200);
    expect(available.json<CustomerDataRightsStatusResponse>()).toMatchObject({
      customer: { displayName: "陆遥" },
      canDelete: true,
      futureBookings: [],
    });
  });

  it("服务端拒绝在未来预约处理前匿名化，并返回可恢复的预约入口", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/miniapp/data-deletion",
      headers: { authorization: chengAuthorization },
      payload: { confirmAnonymization: true },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "FUTURE_BOOKINGS_REQUIRE_ACTION",
      message: "请先处理仍未结束的预约，再删除顾客资料。",
      futureBookings: [
        {
          id: "booking-bohe-future",
          petName: "薄荷",
          primaryServiceName: "猫咪洗护",
          startsAt: "2026-08-14T03:00:00.000Z",
          endsAt: "2026-08-14T04:30:00.000Z",
        },
      ],
    });

    const unchanged = await app.inject({
      method: "GET",
      url: "/miniapp/me",
      headers: { authorization: chengAuthorization },
    });
    expect(unchanged.statusCode).toBe(200);
    expect(unchanged.json()).toMatchObject({ customer: { displayName: "程墨" } });
  });

  it("匿名化身份与宠物资料，保留经营事实，并撤销全部旧会话", async () => {
    const secondOldSession = await customerAuthorization(app, "lu-yao");
    const manager = await managerCookie(app);
    const missingConfirmation = await app.inject({
      method: "POST",
      url: "/miniapp/data-deletion",
      headers: { authorization: luAuthorization },
      payload: { confirmAnonymization: false },
    });
    expect(missingConfirmation.statusCode).toBe(400);
    expect(missingConfirmation.json()).toMatchObject({
      code: "ANONYMIZATION_CONFIRMATION_REQUIRED",
    });

    const response = await app.inject({
      method: "POST",
      url: "/miniapp/data-deletion",
      headers: { authorization: luAuthorization },
      payload: { confirmAnonymization: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      anonymizedAt: "2026-08-13T02:50:00.000Z",
      retained: { bookingCount: 2, completedBookingCount: 0, totalPriceCents: 45600 },
      sessionsRevoked: true,
    });

    const persisted = await database.pool.query<{
      display_name: string;
      phone: string;
      anonymized_at: Date;
      pet_name: string;
      breed: string | null;
      sex: string | null;
      birth_date: string | null;
      coat_type: string | null;
      seed_photo_path: string | null;
      photo_id: string | null;
      care_notes: string | null;
      archived_at: Date | null;
      care_tag_count: string;
      consent_count: string;
      session_count: string;
      demo_profile_count: string;
    }>(
      `SELECT customer.display_name, customer.phone, customer.anonymized_at,
              pet.name AS pet_name, pet.breed, pet.sex, pet.birth_date::text,
              pet.coat_type, pet.seed_photo_path, pet.photo_id, pet.care_notes, pet.archived_at,
              (SELECT count(*)::text FROM pet_care_tags WHERE pet_id = pet.id) AS care_tag_count,
              (SELECT count(*)::text FROM privacy_consents WHERE customer_id = customer.id)
                AS consent_count,
              (SELECT count(*)::text FROM customer_sessions WHERE customer_id = customer.id)
                AS session_count,
              (SELECT count(*)::text FROM demo_customer_profiles WHERE customer_id = customer.id)
                AS demo_profile_count
       FROM customers AS customer
       JOIN pets AS pet ON pet.customer_id = customer.id
       WHERE customer.id = 'customer-lu-yao'`,
    );
    expect(persisted.rows).toEqual([
      expect.objectContaining({
        display_name: "已匿名顾客",
        phone: "13000000000",
        anonymized_at: new Date("2026-08-13T02:50:00.000Z"),
        pet_name: "已匿名宠物",
        breed: null,
        sex: null,
        birth_date: null,
        coat_type: null,
        seed_photo_path: null,
        photo_id: null,
        care_notes: null,
        archived_at: new Date("2026-08-13T02:50:00.000Z"),
        care_tag_count: "0",
        consent_count: "0",
        session_count: "0",
        demo_profile_count: "0",
      }),
    ]);
    const retainedBookings = await database.pool.query<{
      id: string;
      status: string;
      pet_name_snapshot: string;
      total_price_cents: number;
    }>(
      `SELECT id, status, pet_name_snapshot, total_price_cents
       FROM bookings WHERE customer_id = 'customer-lu-yao' ORDER BY id`,
    );
    expect(retainedBookings.rows).toEqual([
      {
        id: "booking-lizi-cancelled",
        status: "cancelled",
        pet_name_snapshot: "已匿名宠物",
        total_price_cents: 22800,
      },
      {
        id: "booking-lizi-no-show",
        status: "no_show",
        pet_name_snapshot: "已匿名宠物",
        total_price_cents: 22800,
      },
    ]);

    const managerProfile = await app.inject({
      method: "GET",
      url: "/backoffice/manager/customers/customer-lu-yao",
      headers: { cookie: manager },
    });
    const managerHistory = await app.inject({
      method: "GET",
      url: "/backoffice/manager/customers/customer-lu-yao/history",
      headers: { cookie: manager },
    });
    const managerProxyOptions = await app.inject({
      method: "GET",
      url: "/backoffice/manager/proxy-bookings/options",
      headers: { cookie: manager },
    });
    expect(managerProfile.statusCode).toBe(200);
    expect(managerProfile.json()).toMatchObject({
      customer: { displayName: "已匿名顾客", phoneMasked: "130****0000", privacyConsents: [] },
      pets: [expect.objectContaining({ name: "已匿名宠物", careTags: [], careNotes: null })],
    });
    expect(managerHistory.statusCode).toBe(200);
    expect(managerHistory.json()).toMatchObject({
      bookings: [
        expect.objectContaining({ pet: expect.objectContaining({ name: "已匿名宠物" }) }),
        expect.objectContaining({ pet: expect.objectContaining({ name: "已匿名宠物" }) }),
      ],
    });
    expect(managerProfile.body + managerHistory.body).not.toContain("陆遥");
    expect(managerProfile.body + managerHistory.body).not.toContain("栗子");
    expect(managerProfile.body + managerHistory.body).not.toContain("13690247519");
    expect(managerProxyOptions.statusCode).toBe(200);
    expect(managerProxyOptions.json<{ customers: { id: string }[] }>().customers).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "customer-lu-yao" })]),
    );

    for (const authorization of [luAuthorization, secondOldSession]) {
      const revoked = await app.inject({
        method: "GET",
        url: "/miniapp/me",
        headers: { authorization },
      });
      expect(revoked.statusCode).toBe(401);
      expect(revoked.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    }
    const repeated = await app.inject({
      method: "POST",
      url: "/miniapp/data-deletion",
      headers: { authorization: secondOldSession },
      payload: { confirmAnonymization: true },
    });
    expect(repeated.statusCode).toBe(401);
    const replacementSession = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "lu-yao" },
    });
    expect(replacementSession.statusCode).toBe(400);
    expect(replacementSession.json()).toMatchObject({ code: "INVALID_DEMO_CUSTOMER" });

    const audit = await database.pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, payload FROM audit_events
       WHERE event_type = 'customer_data_anonymized'
         AND subject_id = 'customer-lu-yao'
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    );
    expect(audit.rows).toEqual([
      {
        event_type: "customer_data_anonymized",
        payload: {
          bookingCount: 2,
          completedBookingCount: 0,
          totalPriceCents: 45600,
          retentionPolicy: "portfolio_demo",
        },
      },
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("陆遥");
    expect(JSON.stringify(audit.rows)).not.toContain("13690247519");
  });
});
