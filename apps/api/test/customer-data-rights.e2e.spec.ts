import { access, unlink } from "node:fs/promises";
import { join } from "node:path";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { CustomerDataExport, CustomerDataRightsStatusResponse } from "@rongguang/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { getPetUploadDirectory } from "../src/config/environment.js";
import { DatabaseService } from "../src/database/database.service.js";

const historyEventId = "event-lu-data-rights-history";
const correctionEventId = "event-lu-data-rights-correction";
const notificationId = "notification-lu-data-rights";
const capacityChangeId = "store-closure-lu-data-rights";
const capacityResolutionId = "capacity-resolution-lu-data-rights";
const serviceRecordId = "service-record-lu-data-rights";
const serviceRecordNoteId = "service-record-note-lu-data-rights";
const auditHistoryId = "audit-lu-data-rights-history";
const auditCorrectionId = "audit-lu-data-rights-correction";
const auditCapacityId = "audit-lu-data-rights-capacity";

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
  let uploadedPhotoStorageKey = "";

  async function cleanupServiceRecordFixture(): Promise<void> {
    const connection = await database.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SET LOCAL session_replication_role = replica");
      await connection.query("DELETE FROM store_service_record_notes WHERE id = $1", [
        serviceRecordNoteId,
      ]);
      await connection.query("DELETE FROM store_service_records WHERE id = $1", [serviceRecordId]);
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    chengAuthorization = await customerAuthorization(app, "cheng-mo");
    luAuthorization = await customerAuthorization(app, "lu-yao");
  });

  afterAll(async () => {
    await cleanupServiceRecordFixture();
    await database.pool.query("DELETE FROM store_closure_intervals WHERE id = $1", [
      capacityChangeId,
    ]);
    await database.pool.query("DELETE FROM notification_outbox WHERE id = $1", [notificationId]);
    await database.pool.query("DELETE FROM booking_events WHERE id = ANY($1::text[])", [
      [historyEventId, correctionEventId],
    ]);
    await database.pool.query("UPDATE pets SET photo_id = NULL WHERE id = 'pet-lizi'");
    await database.pool.query("DELETE FROM pet_photos WHERE customer_id = 'customer-lu-yao'");
    if (uploadedPhotoStorageKey) {
      await unlink(join(getPetUploadDirectory(), uploadedPhotoStorageKey)).catch(() => undefined);
    }
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
    await cleanupServiceRecordFixture();

    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const uploadResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pet-photos",
      headers: { authorization: luAuthorization },
      payload: { mimeType: "image/png", base64Data: pngBytes.toString("base64") },
    });
    expect(uploadResponse.statusCode).toBe(201);
    const uploadedPhotoId = uploadResponse.json<{ photo: { id: string } }>().photo.id;
    const photoRow = await database.pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM pet_photos WHERE id = $1",
      [uploadedPhotoId],
    );
    uploadedPhotoStorageKey = photoRow.rows[0]?.storage_key ?? "";
    expect(uploadedPhotoStorageKey).not.toBe("");
    await database.pool.query("UPDATE pets SET photo_id = $2 WHERE id = $1", [
      "pet-lizi",
      uploadedPhotoId,
    ]);

    const previousSchedule = {
      staff: { id: "linxia", displayName: "林夏" },
      startsAt: "2026-07-01T03:00:00.000Z",
      endsAt: "2026-07-01T04:30:00.000Z",
      turnoverEndsAt: "2026-07-01T04:45:00.000Z",
    };
    const nextSchedule = {
      staff: { id: "chenjia", displayName: "陈嘉" },
      startsAt: "2026-07-02T03:00:00.000Z",
      endsAt: "2026-07-02T04:30:00.000Z",
      turnoverEndsAt: "2026-07-02T04:45:00.000Z",
    };
    const previousSelection = {
      pet: {
        id: "pet-lizi",
        name: "栗子",
        species: "dog",
        weightKg: 28.6,
        petSize: "large",
      },
      primaryService: { id: "dog-care", name: "犬只洗护", priceCents: 22800 },
      addons: [],
      requiredSkillIds: ["dog-basic-care"],
      totalPriceCents: 22800,
      serviceDurationMinutes: 90,
    };
    const nextSelection = {
      ...previousSelection,
      pet: { ...previousSelection.pet, weightKg: 27.8 },
      totalPriceCents: 21800,
    };
    await database.pool.query(
      `INSERT INTO booking_events (
         id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
       ) VALUES
         ($1, 'booking-lizi-cancelled', 'booking_rescheduled', 'customer',
          'customer-lu-yao', $2::jsonb, '2026-07-02T02:50:00.000Z'),
         ($3, 'booking-lizi-cancelled', 'booking_content_corrected', 'manager',
          'manager', $4::jsonb, '2026-07-02T02:55:00.000Z')`,
      [
        historyEventId,
        JSON.stringify({
          reason: "陆遥来电要求改期",
          previous: previousSchedule,
          next: nextSchedule,
        }),
        correctionEventId,
        JSON.stringify({
          reason: "栗子的体重已更新",
          previous: previousSelection,
          next: nextSelection,
        }),
      ],
    );
    await database.pool.query(
      `INSERT INTO store_service_records (
         id, booking_id, pet_snapshot, primary_service_snapshot, addon_snapshots,
         staff_snapshot, actual_starts_at, actual_ends_at, care_tags, internal_text, created_at
       ) VALUES (
         $1, 'booking-lizi-no-show', $2::jsonb, $3::jsonb, '[]'::jsonb, $4::jsonb,
         '2026-07-18T03:02:00.000Z', '2026-07-18T04:20:00.000Z',
         '["耳部需轻柔"]'::jsonb, '栗子需要轻柔清洁耳部。', '2026-07-18T04:20:00.000Z'
       )`,
      [
        serviceRecordId,
        JSON.stringify(previousSelection.pet),
        JSON.stringify(previousSelection.primaryService),
        JSON.stringify({ id: "zhaohang", displayName: "赵航" }),
      ],
    );
    await database.pool.query(
      `INSERT INTO store_service_record_notes (
         id, service_record_id, kind, note_text, author_type,
         author_id, author_display_name, created_at
       ) VALUES (
         $1, $2, 'manager_correction', '陆遥补充：栗子对吹风敏感。',
         'manager', 'manager', '沈青', '2026-07-18T04:30:00.000Z'
       )`,
      [serviceRecordNoteId, serviceRecordId],
    );
    await database.pool.query(
      `INSERT INTO notification_outbox (
         id, booking_id, customer_id, notification_type, payload,
         status, available_at, created_at
       ) VALUES (
         $1, 'booking-lizi-cancelled', 'customer-lu-yao', 'booking_content_corrected',
         $2::jsonb, 'pending', '2026-07-02T03:00:00.000Z', '2026-07-02T03:00:00.000Z'
       )`,
      [
        notificationId,
        JSON.stringify({
          bookingId: "booking-lizi-cancelled",
          petName: "栗子",
          serviceName: "犬只洗护",
          staffName: "林夏",
          startsAt: "2026-07-02T03:00:00.000Z",
          managerDisplayName: "沈青",
          reason: "栗子的体重已更新",
        }),
      ],
    );
    const impactSnapshot = {
      id: "booking-lizi-cancelled",
      revision: 2,
      status: "cancelled",
      customerName: "陆遥",
      petName: "栗子",
      serviceName: "犬只洗护",
      staff: { id: "linxia", displayName: "林夏" },
      startsAt: previousSchedule.startsAt,
      endsAt: previousSchedule.endsAt,
      turnoverEndsAt: previousSchedule.turnoverEndsAt,
    };
    await database.pool.query(
      `INSERT INTO store_closure_intervals (
         id, local_date, starts_at, ends_at, status, reason, created_by,
         target_capacity_minutes, affected_booking_count, impact_snapshot, created_at
       ) VALUES (
         $1, '2026-07-01', '10:00', '12:00', 'cancelled', '临时闭店', 'manager',
         120, 1, $2::jsonb, '2026-06-30T02:00:00.000Z'
       )`,
      [capacityChangeId, JSON.stringify([impactSnapshot])],
    );
    const capacityResponse = {
      change: { id: capacityChangeId, kind: "store_closure", status: "active" },
      progress: { resolved: 1, total: 1 },
      resolvedBooking: {
        id: capacityResolutionId,
        bookingId: "booking-lizi-cancelled",
        action: "reschedule",
        operator: { id: "manager", displayName: "沈青" },
        reason: "陆遥来电确认改期",
        result: nextSchedule,
        bookingEventId: historyEventId,
        resolvedAt: "2026-07-02T02:50:00.000Z",
      },
    };
    await database.pool.query(
      `INSERT INTO capacity_change_booking_resolutions (
         id, store_closure_id, booking_id, action, manager_id, reason,
         original_snapshot, result_summary, booking_event_id, resolved_at,
         idempotency_key, request_digest, response_body
       ) VALUES (
         $1, $2, 'booking-lizi-cancelled', 'reschedule', 'manager', $3,
         $4::jsonb, $5::jsonb, $6, '2026-07-02T02:50:00.000Z',
         'customer-data-rights-capacity', 'fixture-digest', $7::jsonb
       )`,
      [
        capacityResolutionId,
        capacityChangeId,
        "陆遥来电确认改期",
        JSON.stringify(impactSnapshot),
        JSON.stringify(nextSchedule),
        historyEventId,
        JSON.stringify(capacityResponse),
      ],
    );
    await database.pool.query(
      `INSERT INTO audit_events (
         id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
       ) VALUES
         ($1, 'customer_booking_rescheduled', 'customer', 'customer-lu-yao',
          'booking', 'booking-lizi-cancelled', $2::jsonb, '2026-07-02T02:50:00.000Z'),
         ($3, 'manager_booking_content_corrected', 'manager', 'manager',
          'booking', 'booking-lizi-cancelled', $4::jsonb, '2026-07-02T02:55:00.000Z'),
         ($5, 'capacity_change_booking_resolved', 'manager', 'manager',
          'store_closure', $6, $7::jsonb, '2026-07-02T03:00:00.000Z')
       ON CONFLICT (id) DO NOTHING`,
      [
        auditHistoryId,
        JSON.stringify({
          reason: "陆遥来电要求改期",
          previous: previousSchedule,
          next: nextSchedule,
        }),
        auditCorrectionId,
        JSON.stringify({
          reason: "栗子的体重已更新",
          previous: previousSelection,
          next: nextSelection,
        }),
        auditCapacityId,
        capacityChangeId,
        JSON.stringify({
          bookingId: "booking-lizi-cancelled",
          action: "reschedule",
          reason: "陆遥来电确认改期",
          bookingEventId: historyEventId,
        }),
      ],
    );

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
      photo_count: string;
      photo_deletion_count: string;
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
                AS demo_profile_count,
              (SELECT count(*)::text FROM pet_photos WHERE customer_id = customer.id)
                AS photo_count,
              (SELECT count(*)::text FROM pet_photo_deletion_outbox)
                AS photo_deletion_count
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
        photo_count: "0",
        photo_deletion_count: "0",
      }),
    ]);
    await expect(
      access(join(getPetUploadDirectory(), uploadedPhotoStorageKey)),
    ).rejects.toMatchObject({ code: "ENOENT" });
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

    const retainedEvents = await database.pool.query<{
      id: string;
      actor_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, actor_id, payload
       FROM booking_events
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [[historyEventId, correctionEventId]],
    );
    expect(retainedEvents.rows).toEqual([
      {
        id: correctionEventId,
        actor_id: "manager",
        payload: {
          reason: "[原原因已匿名化]",
          previous: { ...previousSelection, pet: { ...previousSelection.pet, name: "已匿名宠物" } },
          next: { ...nextSelection, pet: { ...nextSelection.pet, name: "已匿名宠物" } },
        },
      },
      {
        id: historyEventId,
        actor_id: "anonymized-customer",
        payload: {
          reason: "[原原因已匿名化]",
          previous: previousSchedule,
          next: nextSchedule,
        },
      },
    ]);
    const retainedNotification = await database.pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM notification_outbox WHERE id = $1",
      [notificationId],
    );
    expect(retainedNotification.rows[0]?.payload).toEqual({
      bookingId: "booking-lizi-cancelled",
      petName: "已匿名宠物",
      serviceName: "犬基础洗护",
      staffName: "林夏",
      startsAt: "2026-08-01T02:00:00+00:00",
    });
    const retainedCapacity = await database.pool.query<{
      impact_snapshot: Array<Record<string, unknown>>;
      reason: string;
      original_snapshot: Record<string, unknown>;
      result_summary: Record<string, unknown>;
      response_body: Record<string, unknown>;
    }>(
      `SELECT change.impact_snapshot, resolution.reason, resolution.original_snapshot,
              resolution.result_summary, resolution.response_body
       FROM capacity_change_booking_resolutions AS resolution
       JOIN store_closure_intervals AS change ON change.id = resolution.store_closure_id
       WHERE resolution.id = $1`,
      [capacityResolutionId],
    );
    expect(retainedCapacity.rows[0]).toMatchObject({
      impact_snapshot: [
        {
          ...impactSnapshot,
          customerName: "已匿名顾客",
          petName: "已匿名宠物",
        },
      ],
      reason: "[原原因已匿名化]",
      original_snapshot: {
        ...impactSnapshot,
        customerName: "已匿名顾客",
        petName: "已匿名宠物",
      },
      result_summary: nextSchedule,
      response_body: {
        ...capacityResponse,
        resolvedBooking: {
          ...capacityResponse.resolvedBooking,
          reason: "[原原因已匿名化]",
        },
      },
    });
    expect(
      JSON.stringify(retainedEvents.rows) + JSON.stringify(retainedCapacity.rows),
    ).not.toContain("陆遥");
    expect(
      JSON.stringify(retainedEvents.rows) + JSON.stringify(retainedCapacity.rows),
    ).not.toContain("栗子");

    const retainedServiceRecord = await database.pool.query<{
      pet_snapshot: Record<string, unknown>;
      care_tags: unknown[];
      internal_text: string | null;
      note_text: string;
    }>(
      `SELECT record.pet_snapshot, record.care_tags, record.internal_text, note.note_text
       FROM store_service_records AS record
       JOIN store_service_record_notes AS note ON note.service_record_id = record.id
       WHERE record.id = $1`,
      [serviceRecordId],
    );
    expect(retainedServiceRecord.rows).toEqual([
      {
        pet_snapshot: {
          ...previousSelection.pet,
          id: `anonymized-${serviceRecordId}`,
          name: "已匿名宠物",
        },
        care_tags: [],
        internal_text: null,
        note_text: "[原说明已匿名化]",
      },
    ]);

    const rawAudits = await database.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_events
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [[auditHistoryId, auditCorrectionId, auditCapacityId]],
    );
    const effectiveAudits = await database.pool.query<{
      id: string;
      actor_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, actor_id, payload FROM effective_audit_events
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [[auditHistoryId, auditCorrectionId, auditCapacityId]],
    );
    expect(JSON.stringify(rawAudits.rows)).toContain("陆遥");
    expect(JSON.stringify(rawAudits.rows)).toContain("栗子");
    expect(JSON.stringify(effectiveAudits.rows)).not.toContain("陆遥");
    expect(JSON.stringify(effectiveAudits.rows)).not.toContain("栗子");
    expect(effectiveAudits.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: auditHistoryId, actor_id: "anonymized-customer" }),
      ]),
    );

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
