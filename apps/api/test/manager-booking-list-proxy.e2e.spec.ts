import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";

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
    payload: { username, password: "Rongguang2026!" },
  });

  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

describe("店长预约列表与代客预约", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  const createdBookingIds: string[] = [];
  const createdCustomerPhones: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
  });

  afterAll(async () => {
    await database.pool.query(
      "DELETE FROM booking_events WHERE id = 'manager-detail-reschedule-history-ticket16'",
    );
    await database.pool.query("DELETE FROM bookings WHERE id = ANY($1::text[])", [
      createdBookingIds,
    ]);
    await database.pool.query("DELETE FROM customers WHERE phone = ANY($1::text[])", [
      createdCustomerPhones,
    ]);
    await database.pool.query(
      `
        DELETE FROM privacy_consents
        WHERE customer_id = 'customer-xu-lan'
          AND source = 'manager_offline'
      `,
    );
    await app.close();
    vi.unstubAllEnvs();
  });

  it("按日期、状态、员工、主要服务和顾客或宠物关键字组合筛选预约", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings?date=2026-08-14&status=confirmed&staffId=chenjia&primaryServiceId=cat-care&q=%E8%96%84%E8%8D%B7",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      appliedFilters: {
        date: "2026-08-14",
        status: "confirmed",
        staffId: "chenjia",
        primaryServiceId: "cat-care",
        query: "薄荷",
      },
      bookings: [
        {
          id: "booking-bohe-future",
          status: "confirmed",
          customer: { displayName: "程墨" },
          pet: { name: "薄荷" },
          primaryService: { id: "cat-care", name: "猫咪洗护" },
          staff: { id: "chenjia", displayName: "陈嘉" },
        },
      ],
      filterOptions: {
        staff: expect.arrayContaining([{ id: "chenjia", displayName: "陈嘉" }]),
        primaryServices: expect.arrayContaining([{ id: "cat-care", name: "猫咪洗护" }]),
      },
    });
  });

  it("详情返回当前事实、门店服务记录、完整变更历史和关联通知", async () => {
    await database.pool.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES (
          'manager-detail-reschedule-history-ticket16',
          'booking-bohe-completed',
          'booking_rescheduled',
          'manager',
          'manager',
          $1::jsonb,
          '2026-08-12T02:00:00.000Z'
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        JSON.stringify({
          reason: "应顾客电话调整",
          previous: {
            staff: { id: "chenjia", displayName: "陈嘉" },
            startsAt: "2026-08-12T03:00:00.000Z",
            endsAt: "2026-08-12T04:30:00.000Z",
            turnoverEndsAt: "2026-08-12T04:45:00.000Z",
          },
          next: {
            staff: { id: "zhouning", displayName: "周宁" },
            startsAt: "2026-08-12T05:00:00.000Z",
            endsAt: "2026-08-12T06:30:00.000Z",
            turnoverEndsAt: "2026-08-12T06:45:00.000Z",
          },
        }),
      ],
    );
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-bohe-completed",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      booking: {
        id: "booking-bohe-completed",
        status: "completed",
        customer: { displayName: "程墨", phoneMasked: "139****0341" },
        pet: { id: "pet-bohe", name: "薄荷", species: "cat" },
        primaryService: { name: "猫咪洗护" },
        staff: { id: "zhouning", displayName: "周宁" },
      },
      petProfile: {
        weightKg: 4.8,
        petSize: "small",
        breed: "英国短毛猫",
        careTags: ["对陌生犬敏感"],
      },
      serviceRecord: {
        id: "service-record-bohe-completed",
        bookingId: "booking-bohe-completed",
        internalText: "洗护过程配合良好，耳部清洁完成。",
      },
      changeHistory: expect.arrayContaining([
        expect.objectContaining({ type: "booking_confirmed", actorType: "customer" }),
        expect.objectContaining({
          type: "booking_rescheduled",
          actorType: "manager",
          reason: "应顾客电话调整",
          previous: expect.objectContaining({
            staff: { id: "chenjia", displayName: "陈嘉" },
            startsAt: "2026-08-12T03:00:00.000Z",
          }),
          next: expect.objectContaining({
            staff: { id: "zhouning", displayName: "周宁" },
            startsAt: "2026-08-12T05:00:00.000Z",
          }),
        }),
      ]),
      notifications: [
        expect.objectContaining({
          id: "notification-bohe-completed-confirmed",
          type: "booking_confirmed",
          status: "sent",
        }),
      ],
    });
  });

  it("提供代客预约所需的当前隐私说明、已有档案、员工和服务选项", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/proxy-bookings/options",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      demoNow: "2026-08-13T02:50:00.000Z",
      privacyNotice: { version: "2026.08", title: "茸光隐私说明" },
      window: {
        startsOn: "2026-08-13",
        endsOn: "2026-08-26",
        earliestStartsAt: "2026-08-13T03:00:00.000Z",
      },
      customers: expect.arrayContaining([
        {
          id: "customer-xu-lan",
          displayName: "许岚",
          phoneMasked: "138****2608",
          pets: [expect.objectContaining({ id: "pet-tuanzi", name: "团子" })],
        },
      ]),
      staff: expect.arrayContaining([
        expect.objectContaining({ id: "zhaohang", displayName: "赵航" }),
      ]),
      primaryServices: expect.arrayContaining([
        expect.objectContaining({ id: "dog-basic-care", name: "犬基础洗护" }),
      ]),
    });
    expect(
      response
        .json()
        .customers.flatMap((customer: { pets: Array<{ id: string }> }) => customer.pets)
        .some((pet: { id: string }) => pet.id === "pet-lizi"),
    ).toBe(false);
  });

  it("为已有顾客和宠物代录临近预约，并幂等记录线下同意与执行店长", async () => {
    const payload = {
      idempotencyKey: "manager-proxy-existing-20260813",
      profile: {
        kind: "existing",
        customerId: "customer-xu-lan",
        petId: "pet-tuanzi",
      },
      primaryServiceId: "dog-basic-care",
      addonIds: [],
      staffId: "zhaohang",
      startsAt: "2026-08-13T04:00:00.000Z",
      offlineConsentSource: "phone",
    };
    const create = () =>
      app.inject({
        method: "POST",
        url: "/backoffice/manager/proxy-bookings",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload,
      });

    const first = await create();
    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    createdBookingIds.push(firstBody.booking.id);
    expect(firstBody).toMatchObject({
      booking: {
        status: "confirmed",
        pet: { id: "pet-tuanzi", name: "团子" },
        staff: { id: "zhaohang", displayName: "赵航" },
        startsAt: "2026-08-13T04:00:00.000Z",
      },
      verificationCode: expect.stringMatching(/^\d{6}$/),
      proxyRecord: {
        privacyNoticeVersion: "2026.08",
        offlineConsentSource: "phone",
        manager: { id: "manager", displayName: "沈青" },
      },
    });

    const replay = await create();
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({
      booking: { id: firstBody.booking.id },
      verificationCode: firstBody.verificationCode,
      proxyRecord: firstBody.proxyRecord,
    });

    await database.pool.query(
      "UPDATE bookings SET staff_display_name_snapshot = '已变更' WHERE id = $1",
      [firstBody.booking.id],
    );
    const delayedReplay = await create();
    expect(delayedReplay.statusCode).toBe(201);
    expect(delayedReplay.json()).toMatchObject({
      booking: {
        id: firstBody.booking.id,
        status: "confirmed",
        staff: { id: "zhaohang", displayName: "赵航" },
      },
      verificationCode: firstBody.verificationCode,
      proxyRecord: firstBody.proxyRecord,
    });

    const facts = await database.pool.query(
      `
        SELECT record.privacy_notice_version,
               record.offline_consent_source,
               record.manager_id,
               consent.source AS consent_source,
               event.actor_type,
               event.actor_id,
               notification.notification_type
        FROM manager_proxy_booking_records AS record
        JOIN bookings AS booking ON booking.id = record.booking_id
        JOIN privacy_consents AS consent
          ON consent.customer_id = booking.customer_id
         AND consent.notice_version = record.privacy_notice_version
        JOIN booking_events AS event
          ON event.booking_id = booking.id
         AND event.event_type = 'booking_confirmed'
        JOIN notification_outbox AS notification
          ON notification.booking_id = booking.id
         AND notification.notification_type = 'booking_confirmed'
        WHERE record.booking_id = $1
      `,
      [firstBody.booking.id],
    );
    expect(facts.rows).toEqual([
      expect.objectContaining({
        privacy_notice_version: "2026.08",
        offline_consent_source: "phone",
        manager_id: "manager",
        consent_source: "manager_offline",
        actor_type: "manager",
        actor_id: "manager",
        notification_type: "booking_confirmed",
      }),
    ]);
  });

  it("为新顾客原子建立最小顾客与宠物档案、线下同意和预约", async () => {
    const phone = "13566081234";
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/proxy-bookings",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        idempotencyKey: "manager-proxy-new-20260813",
        profile: {
          kind: "new",
          customer: { displayName: "乔安", phone },
          pet: { name: "雪球", species: "cat", weightKg: 5.2 },
        },
        primaryServiceId: "cat-care",
        addonIds: [],
        staffId: "chenjia",
        startsAt: "2026-08-13T04:00:00.000Z",
        offlineConsentSource: "chat",
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    createdBookingIds.push(body.booking.id);
    createdCustomerPhones.push(phone);
    expect(body).toMatchObject({
      booking: {
        pet: { name: "雪球", species: "cat", weightKg: 5.2, petSize: "small" },
        primaryService: { id: "cat-care", name: "猫咪洗护" },
        staff: { id: "chenjia", displayName: "陈嘉" },
      },
      proxyRecord: {
        privacyNoticeVersion: "2026.08",
        offlineConsentSource: "chat",
        manager: { id: "manager" },
      },
    });

    const profile = await database.pool.query(
      `
        SELECT customer.display_name,
               customer.phone,
               pet.name AS pet_name,
               pet.species,
               pet.weight_kg::text,
               consent.source
        FROM bookings AS booking
        JOIN customers AS customer ON customer.id = booking.customer_id
        JOIN pets AS pet ON pet.id = booking.pet_id
        JOIN privacy_consents AS consent
          ON consent.customer_id = customer.id
         AND consent.notice_version = '2026.08'
        WHERE booking.id = $1
      `,
      [body.booking.id],
    );
    expect(profile.rows).toEqual([
      expect.objectContaining({
        display_name: "乔安",
        phone,
        pet_name: "雪球",
        species: "cat",
        weight_kg: "5.20",
        source: "manager_offline",
      }),
    ]);
  });

  it("并发代录同一员工时段时由数据库排除约束拒绝强制重叠", async () => {
    const common = {
      primaryServiceId: "dog-basic-care",
      addonIds: [],
      staffId: "zhaohang",
      startsAt: "2026-08-13T07:30:00.000Z",
      offlineConsentSource: "in_store",
    };
    const requests = [
      {
        ...common,
        idempotencyKey: "manager-proxy-overlap-tuanzi",
        profile: {
          kind: "existing",
          customerId: "customer-xu-lan",
          petId: "pet-tuanzi",
        },
      },
      {
        ...common,
        idempotencyKey: "manager-proxy-overlap-maiya",
        profile: {
          kind: "existing",
          customerId: "customer-gu-yan",
          petId: "pet-maiya",
        },
      },
    ];

    const responses = await Promise.all(
      requests.map((payload) =>
        app.inject({
          method: "POST",
          url: "/backoffice/manager/proxy-bookings",
          headers: { cookie: managerCookie, origin: adminOrigin },
          payload,
        }),
      ),
    );
    const success = responses.find((response) => response.statusCode === 201);
    const conflict = responses.find((response) => response.statusCode === 409);

    expect(success).toBeDefined();
    const conflictBody = conflict?.json();
    expect(conflictBody).toMatchObject({
      code: "BOOKING_TIME_CONFLICT",
      nextStep: "conflict",
      suggestions: expect.arrayContaining([
        expect.objectContaining({
          startsAt: expect.any(String),
          staff: expect.objectContaining({ id: "zhaohang" }),
        }),
      ]),
    });
    createdBookingIds.push(success!.json().booking.id);

    const overlaps = await database.pool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM bookings
        WHERE staff_id = 'zhaohang'
          AND status NOT IN ('cancelled', 'no_show')
          AND tstzrange(occupancy_starts_at, occupancy_ends_at, '[)')
              && tstzrange(
                '2026-08-13T07:30:00.000Z'::timestamptz,
                '2026-08-13T08:45:00.000Z'::timestamptz,
                '[)'
              )
      `,
    );
    expect(overlaps.rows[0]?.count).toBe("1");

    await database.pool.query("DELETE FROM bookings WHERE id = $1", [success!.json().booking.id]);
    const conflictIndex = responses.findIndex((response) => response.statusCode === 409);
    const replay = await app.inject({
      method: "POST",
      url: "/backoffice/manager/proxy-bookings",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: requests[conflictIndex],
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual(conflictBody);
  });
});
