import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type {
  BookingAvailabilityResponse,
  BookingDetailResponse,
  CreateBookingResponse,
} from "@rongguang/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";
const createdPetId = "pet-service-catalog-management";
let createdBookingId: string | null = null;
let createdAddonId: string | null = null;
let createdServiceId: string | null = null;

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

describe("主要服务、服务规格与增项管理", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;
  let customerAuth: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "linxia");
    customerAuth = await customerAuthorization(app);
    await database.pool.query("DELETE FROM bookings WHERE pet_id = $1", [createdPetId]);
    await database.pool.query("DELETE FROM pets WHERE id = $1", [createdPetId]);
    await database.pool.query(
      "INSERT INTO pets (id, customer_id, name, species, weight_kg) VALUES ($1, 'customer-cheng-mo', '新目录犬', 'dog', 8.4)",
      [createdPetId],
    );
  });

  afterAll(async () => {
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      if (createdBookingId) {
        await client.query("DELETE FROM notification_outbox WHERE booking_id = $1", [
          createdBookingId,
        ]);
        await client.query("DELETE FROM audit_events WHERE subject_id = $1", [createdBookingId]);
        await client.query("DELETE FROM booking_events WHERE booking_id = $1", [createdBookingId]);
        await client.query("DELETE FROM booking_idempotency_keys WHERE booking_id = $1", [
          createdBookingId,
        ]);
        await client.query("DELETE FROM bookings WHERE id = $1", [createdBookingId]);
      }
      await client.query("DELETE FROM pets WHERE id = $1", [createdPetId]);
      if (createdAddonId) {
        await client.query(
          "DELETE FROM audit_events WHERE subject_type = 'addon' AND subject_id = $1",
          [createdAddonId],
        );
        await client.query("DELETE FROM service_catalog_specifications WHERE item_id = $1", [
          createdAddonId,
        ]);
        await client.query("DELETE FROM service_catalog_items WHERE id = $1", [createdAddonId]);
      }
      if (createdServiceId) {
        await client.query(
          "DELETE FROM audit_events WHERE subject_type = 'primary_service' AND subject_id = $1",
          [createdServiceId],
        );
        await client.query(
          "DELETE FROM service_catalog_primary_addons WHERE primary_service_id = $1",
          [createdServiceId],
        );
        await client.query("DELETE FROM service_catalog_specifications WHERE item_id = $1", [
          createdServiceId,
        ]);
        await client.query("DELETE FROM service_catalog_items WHERE id = $1", [createdServiceId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  it("仅店长可以读取和写入服务管理接口", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/backoffice/manager/service-catalog",
    });
    const staff = await app.inject({
      method: "GET",
      url: "/backoffice/manager/service-catalog",
      headers: { cookie: staffCookie },
    });
    const manager = await app.inject({
      method: "GET",
      url: "/backoffice/manager/service-catalog",
      headers: { cookie: managerCookie },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(staff.statusCode).toBe(403);
    expect(manager.statusCode).toBe(200);
    expect(manager.headers["cache-control"]).toBe("no-store");
    expect(manager.json()).toMatchObject({
      revision: expect.any(Number),
      primaryServices: expect.arrayContaining([
        expect.objectContaining({
          id: "dog-basic-care",
          name: "犬基础洗护",
          status: "active",
          requiredSkillIds: ["dog-basic-care"],
          specifications: expect.arrayContaining([
            expect.objectContaining({ petSize: "small", priceCents: 12800 }),
          ]),
        }),
      ]),
      addons: expect.arrayContaining([
        expect.objectContaining({ id: "nail-care", name: "修甲护理" }),
      ]),
    });
  });

  it("拒绝缺失规格、负金额、无效时长、重叠体型和不兼容增项", async () => {
    const catalog = await app.inject({
      method: "GET",
      url: "/backoffice/manager/service-catalog",
      headers: { cookie: managerCookie },
    });
    const revision = catalog.json<{ revision: number }>().revision;
    const invalid = await app.inject({
      method: "POST",
      url: "/backoffice/manager/service-catalog/primary-services",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: revision,
        name: "无效服务",
        description: "验证失败不会写入目录。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["dog-basic-care"],
        availableAddonIds: ["oral-care"],
        specifications: [
          { petSize: "small", priceCents: -1, durationMinutes: 0 },
          { petSize: "small", priceCents: 100, durationMinutes: 17 },
        ],
      },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: {
        specifications: expect.stringMatching(/金额|时长|重叠/),
      },
    });

    const createdAddon = await app.inject({
      method: "POST",
      url: "/backoffice/manager/service-catalog/addons",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: revision,
        name: "犬专用增项",
        description: "用于验证主要服务与增项的犬猫、体型兼容关系。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["nail-care"],
        specifications: [
          { petSize: "small", priceCents: 2000, durationMinutes: 15 },
          { petSize: "medium", priceCents: 2500, durationMinutes: 20 },
          { petSize: "large", priceCents: 3000, durationMinutes: 25 },
        ],
      },
    });
    expect(createdAddon.statusCode).toBe(201);
    const createdAddonBody = createdAddon.json<{
      revision: number;
      addons: Array<{ id: string; name: string }>;
    }>();
    createdAddonId = createdAddonBody.addons.find((item) => item.name === "犬专用增项")?.id ?? null;
    expect(createdAddonId).toBeTruthy();

    const incompatible = await app.inject({
      method: "POST",
      url: "/backoffice/manager/service-catalog/primary-services",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: createdAddonBody.revision,
        name: "猫咪全体型服务",
        description: "该服务不能关联仅适用于犬的增项。",
        applicableSpecies: ["cat"],
        requiredSkillIds: ["cat-care"],
        availableAddonIds: [createdAddonId],
        specifications: [
          { petSize: "small", priceCents: 16800, durationMinutes: 90 },
          { petSize: "medium", priceCents: 21800, durationMinutes: 120 },
        ],
      },
    });
    expect(incompatible.statusCode).toBe(400);
    expect(incompatible.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { availableAddonIds: expect.stringMatching(/兼容|覆盖/) },
    });

    const updatedAddon = await app.inject({
      method: "PATCH",
      url: `/backoffice/manager/service-catalog/addons/${createdAddonId}`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: createdAddonBody.revision,
        name: "犬足部护理",
        description: "修改后的增项只影响未来预约。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["nail-care"],
        specifications: [
          { petSize: "small", priceCents: 2500, durationMinutes: 20 },
          { petSize: "medium", priceCents: 3000, durationMinutes: 20 },
          { petSize: "large", priceCents: 3500, durationMinutes: 25 },
        ],
      },
    });
    expect(updatedAddon.statusCode).toBe(200);
    expect(updatedAddon.json()).toMatchObject({
      addons: expect.arrayContaining([
        expect.objectContaining({
          id: createdAddonId,
          name: "犬足部护理",
          specifications: expect.arrayContaining([
            expect.objectContaining({
              petSize: "small",
              priceCents: 2500,
              durationMinutes: 20,
            }),
          ]),
        }),
      ]),
    });
  });

  it("新预约立即使用新服务与增项，后续修改或停用规格不重写预约快照", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/backoffice/manager/service-catalog",
      headers: { cookie: managerCookie },
    });
    const created = await app.inject({
      method: "POST",
      url: "/backoffice/manager/service-catalog/primary-services",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: initial.json<{ revision: number }>().revision,
        name: "犬敏感肌洗护",
        description: "低刺激用品与慢速吹干。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["dog-basic-care"],
        availableAddonIds: [createdAddonId],
        specifications: [
          { petSize: "small", priceCents: 18800, durationMinutes: 75 },
          { petSize: "medium", priceCents: 23800, durationMinutes: 105 },
          { petSize: "large", priceCents: 29800, durationMinutes: 135 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{
      revision: number;
      primaryServices: Array<{ id: string; name: string }>;
    }>();
    const createdService = createdBody.primaryServices.find(
      (service) => service.name === "犬敏感肌洗护",
    );
    expect(createdService).toBeDefined();
    createdServiceId = createdService?.id ?? null;

    const storefront = await app.inject({ method: "GET", url: "/miniapp/storefront" });
    expect(storefront.headers["cache-control"]).toBe("no-store");
    expect(storefront.json()).toMatchObject({
      primaryServices: expect.arrayContaining([
        expect.objectContaining({
          id: createdServiceId,
          name: "犬敏感肌洗护",
          availableAddonIds: [createdAddonId],
          specifications: expect.arrayContaining([
            { petSize: "small", priceCents: 18800, durationMinutes: 75 },
          ]),
        }),
      ]),
    });

    const availability = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${createdPetId}&primaryServiceId=${createdServiceId}&addonIds=${createdAddonId}`,
      headers: { authorization: customerAuth },
    });
    expect(availability.statusCode).toBe(200);
    const slot = availability
      .json<BookingAvailabilityResponse>()
      .days.flatMap((day) => day.slots)[0];
    expect(slot).toBeDefined();
    const booked = await app.inject({
      method: "POST",
      url: "/miniapp/bookings",
      headers: { authorization: customerAuth },
      payload: {
        idempotencyKey: "ticket-19-new-catalog-booking",
        petId: createdPetId,
        primaryServiceId: createdServiceId,
        addonIds: [createdAddonId],
        staffId: slot?.staff.id,
        staffPreference: { kind: "specified", staffId: slot?.staff.id },
        startsAt: slot?.startsAt,
      },
    });
    expect(booked.statusCode).toBe(201);
    const booking = booked.json<CreateBookingResponse>().booking;
    createdBookingId = booking.id;
    expect(booking).toMatchObject({
      primaryService: { name: "犬敏感肌洗护", priceCents: 18800, durationMinutes: 75 },
      addons: [{ id: createdAddonId, name: "犬足部护理", priceCents: 2500, durationMinutes: 20 }],
      totalPriceCents: 21300,
      serviceDurationMinutes: 95,
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/backoffice/manager/service-catalog/primary-services/${createdServiceId}`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: createdBody.revision,
        name: "犬舒缓洗护",
        description: "新名称与新配置只影响未来预约。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["dog-basic-care"],
        availableAddonIds: [createdAddonId],
        specifications: [
          { petSize: "small", priceCents: 20800, durationMinutes: 90, active: false },
          { petSize: "medium", priceCents: 25800, durationMinutes: 120 },
          { petSize: "large", priceCents: 31800, durationMinutes: 150 },
        ],
      },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json<{ revision: number }>();
    const currentStorefront = await app.inject({ method: "GET", url: "/miniapp/storefront" });
    const currentStorefrontBody = currentStorefront.json<{
      primaryServices: Array<{
        id: string;
        name: string;
        specifications: Array<{ petSize: string }>;
      }>;
    }>();
    expect(currentStorefrontBody).toMatchObject({
      primaryServices: expect.arrayContaining([
        expect.objectContaining({
          id: createdServiceId,
          name: "犬舒缓洗护",
        }),
      ]),
    });
    expect(
      currentStorefrontBody.primaryServices
        .find((service) => service.id === createdServiceId)
        ?.specifications.some((specification) => specification.petSize === "small"),
    ).toBe(false);

    const unavailableSize = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${createdPetId}&primaryServiceId=${createdServiceId}`,
      headers: { authorization: customerAuth },
    });
    expect([400, 409]).toContain(unavailableSize.statusCode);

    const changedAddon = await app.inject({
      method: "PATCH",
      url: `/backoffice/manager/service-catalog/addons/${createdAddonId}`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        expectedRevision: updatedBody.revision,
        name: "犬足部舒缓护理",
        description: "新价格与时长只影响未来预约。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["nail-care"],
        specifications: [
          { petSize: "small", priceCents: 4500, durationMinutes: 30 },
          { petSize: "medium", priceCents: 5000, durationMinutes: 30 },
          { petSize: "large", priceCents: 5500, durationMinutes: 35 },
        ],
      },
    });
    expect(changedAddon.statusCode).toBe(200);
    const deactivatedAddon = await app.inject({
      method: "POST",
      url: `/backoffice/manager/service-catalog/addons/${createdAddonId}/deactivate`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { expectedRevision: changedAddon.json<{ revision: number }>().revision },
    });
    expect(deactivatedAddon.statusCode).toBe(200);
    expect(deactivatedAddon.json()).toMatchObject({
      addons: expect.arrayContaining([
        expect.objectContaining({ id: createdAddonId, status: "inactive" }),
      ]),
    });
    const afterAddonDeactivation = await app.inject({ method: "GET", url: "/miniapp/storefront" });
    const afterAddonDeactivationBody = afterAddonDeactivation.json<{
      primaryServices: Array<{ id: string; availableAddonIds: string[] }>;
      addons: Array<{ id: string }>;
    }>();
    expect(afterAddonDeactivationBody.addons.some((addon) => addon.id === createdAddonId)).toBe(
      false,
    );
    expect(
      afterAddonDeactivationBody.primaryServices.find((service) => service.id === createdServiceId)
        ?.availableAddonIds,
    ).not.toContain(createdAddonId);

    const historical = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${createdBookingId}`,
      headers: { authorization: customerAuth },
    });
    expect(historical.statusCode).toBe(200);
    expect(historical.json<BookingDetailResponse>().booking).toMatchObject({
      primaryService: { name: "犬敏感肌洗护", priceCents: 18800, durationMinutes: 75 },
      addons: [{ id: createdAddonId, name: "犬足部护理", priceCents: 2500, durationMinutes: 20 }],
      totalPriceCents: 21300,
      serviceDurationMinutes: 95,
    });
  });

  it("拒绝过期 revision，停用后新预约不可选但历史详情与审计事实保留", async () => {
    expect(createdServiceId).toBeTruthy();
    const current = await app.inject({
      method: "GET",
      url: "/backoffice/manager/service-catalog",
      headers: { cookie: managerCookie },
    });
    const revision = current.json<{ revision: number }>().revision;
    const stale = await app.inject({
      method: "POST",
      url: `/backoffice/manager/service-catalog/primary-services/${createdServiceId}/deactivate`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { expectedRevision: revision - 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "CATALOG_REVISION_CONFLICT", revision });

    const deactivated = await app.inject({
      method: "POST",
      url: `/backoffice/manager/service-catalog/primary-services/${createdServiceId}/deactivate`,
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { expectedRevision: revision },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json()).toMatchObject({
      primaryServices: expect.arrayContaining([
        expect.objectContaining({
          id: createdServiceId,
          status: "inactive",
          referencedByBookings: true,
        }),
      ]),
    });
    const storefront = await app.inject({ method: "GET", url: "/miniapp/storefront" });
    expect(
      storefront
        .json<{ primaryServices: Array<{ id: string }> }>()
        .primaryServices.some((service) => service.id === createdServiceId),
    ).toBe(false);
    const unavailable = await app.inject({
      method: "GET",
      url: `/miniapp/available-slots?petId=${createdPetId}&primaryServiceId=${createdServiceId}`,
      headers: { authorization: customerAuth },
    });
    expect([400, 409]).toContain(unavailable.statusCode);
    const history = await app.inject({
      method: "GET",
      url: `/miniapp/bookings/${createdBookingId}`,
      headers: { authorization: customerAuth },
    });
    expect(history.json<BookingDetailResponse>().booking.primaryService.name).toBe("犬敏感肌洗护");

    const audits = await database.pool.query<{
      actor_id: string;
      event_type: string;
      subject_id: string;
      payload: { changes: string[] };
    }>(
      `
        SELECT actor_id, event_type, subject_id, payload
        FROM audit_events
        WHERE subject_type = 'primary_service' AND subject_id = $1
        ORDER BY occurred_at, id
      `,
      [createdServiceId],
    );
    expect(audits.rows.map((event) => event.event_type)).toHaveLength(3);
    expect(audits.rows.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "service_catalog_created",
        "service_catalog_updated",
        "service_catalog_deactivated",
      ]),
    );
    expect(audits.rows.every((event) => event.actor_id === "manager")).toBe(true);
    expect(audits.rows.every((event) => event.payload.changes.length > 0)).toBe(true);
    expect(
      audits.rows.find((event) => event.event_type === "service_catalog_updated")?.payload.changes,
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^名称：/),
        expect.stringMatching(/small 规格/),
      ]),
    );

    const addonAudits = await database.pool.query<{
      actor_id: string;
      event_type: string;
      payload: { changes: string[] };
    }>(
      `
        SELECT actor_id, event_type, payload
        FROM audit_events
        WHERE subject_type = 'addon' AND subject_id = $1
      `,
      [createdAddonId],
    );
    expect(addonAudits.rows.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "service_catalog_created",
        "service_catalog_updated",
        "service_catalog_deactivated",
      ]),
    );
    expect(
      addonAudits.rows
        .filter((event) => event.event_type === "service_catalog_updated")
        .some((event) => event.payload.changes.some((change) => change.includes("2500 分"))),
    ).toBe(true);
  });
});
