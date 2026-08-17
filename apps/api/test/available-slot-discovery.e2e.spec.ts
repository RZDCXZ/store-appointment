import type { NestFastifyApplication } from "@nestjs/platform-fastify";
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

describe("顾客查询真实可约时段", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let xuLanAuthorization: string;
  let chengMoAuthorization: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    [xuLanAuthorization, chengMoAuthorization] = await Promise.all([
      customerAuthorization(app, "xu-lan"),
      customerAuthorization(app, "cheng-mo"),
    ]);
  });

  afterAll(async () => {
    await database.pool.query(
      "DELETE FROM bookings WHERE id IN ('booking-slot-pet-conflict', 'booking-exclusion-base')",
    );
    await database.pool.query(
      "DELETE FROM staff_time_off_intervals WHERE id = 'time-off-slot-test'",
    );
    await database.pool.query("DELETE FROM store_closure_intervals WHERE id = 'closure-slot-test'");
    await database.pool.query("DELETE FROM pets WHERE id = 'pet-booking-test-cat'");
    await app.close();
    vi.unstubAllEnvs();
  });

  it("按宠物体型实时返回服务组合价格、时长、完整技能与十四日真实时段", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-basic-care&addonIds=oral-care",
      headers: { authorization: xuLanAuthorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      timeZone: "Asia/Shanghai",
      demoNow: "2026-08-13T02:50:00.000Z",
      window: {
        startsOn: "2026-08-13",
        endsOn: "2026-08-26",
        earliestStartsAt: "2026-08-13T05:00:00.000Z",
      },
      selection: {
        pet: { id: "pet-tuanzi", name: "团子", petSize: "small" },
        primaryService: {
          id: "dog-basic-care",
          name: "犬基础洗护",
          priceCents: 12800,
          durationMinutes: 60,
        },
        addons: [{ id: "oral-care", name: "口腔清洁", priceCents: 3500, durationMinutes: 15 }],
        totalPriceCents: 16300,
        serviceDurationMinutes: 75,
        requiredSkillIds: ["dog-basic-care", "oral-care"],
      },
    });

    const body = response.json();
    expect(body.days).toHaveLength(14);
    expect(body.days[0]).toMatchObject({ date: "2026-08-13", reason: null });
    expect(body.days[0].slots[0]).toMatchObject({
      startsAt: "2026-08-13T05:00:00.000Z",
      endsAt: "2026-08-13T06:15:00.000Z",
      turnoverEndsAt: "2026-08-13T06:30:00.000Z",
      staff: { id: "zhaohang", displayName: "赵航", employeeNumber: 4 },
    });
    expect(body.days.find((day: { date: string }) => day.date === "2026-08-16")).toMatchObject({
      reason: "no_qualified_staff",
      reasonLabel: "暂无合格员工",
    });
    expect(body.days.find((day: { date: string }) => day.date === "2026-08-17")).toMatchObject({
      reason: "closed",
      reasonLabel: "周一闭店",
      slots: [],
    });
  });

  it("指定员工时只返回该员工；周日犬造型美容明确没有合格员工", async () => {
    const specified = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-basic-care&staffId=linxia",
      headers: { authorization: xuLanAuthorization },
    });
    const specifiedBody = specified.json();

    expect(specified.statusCode).toBe(200);
    expect(
      specifiedBody.days.flatMap((day: { slots: { staff: { id: string } }[] }) => day.slots),
    ).toSatisfy((slots: { staff: { id: string } }[]) =>
      slots.every((slot) => slot.staff.id === "linxia"),
    );

    const styling = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling",
      headers: { authorization: xuLanAuthorization },
    });
    const sunday = styling.json().days.find((day: { date: string }) => day.date === "2026-08-16");

    expect(styling.statusCode).toBe(200);
    expect(sunday).toMatchObject({
      reason: "no_qualified_staff",
      reasonLabel: "暂无合格员工",
      slots: [],
    });
  });

  it("同一宠物已有重叠服务时不返回冲突时段，不同宠物可由另一员工同时服务", async () => {
    await database.pool.query(
      `
        INSERT INTO pets (id, customer_id, name, species, weight_kg)
        VALUES ('pet-booking-test-cat', 'customer-cheng-mo', '云朵', 'cat', 5.2)
        ON CONFLICT (id) DO UPDATE SET archived_at = NULL
      `,
    );
    await database.pool.query(
      `
        INSERT INTO bookings (
          id, customer_id, pet_id, staff_id, starts_at, ends_at,
          occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
          pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
          primary_service_id_snapshot, primary_service_name_snapshot,
          primary_service_price_cents, primary_service_duration_minutes,
          addon_snapshots, required_skill_ids_snapshot, total_price_cents,
          staff_display_name_snapshot, turnover_minutes,
          original_starts_at, original_ends_at,
          original_occupancy_starts_at, original_occupancy_ends_at,
          verification_code_digest
        )
        VALUES (
          'booking-slot-pet-conflict', 'customer-cheng-mo', 'pet-bohe', 'chenjia',
          '2026-08-14T07:00:00.000Z', '2026-08-14T08:30:00.000Z',
          '2026-08-14T07:00:00.000Z', '2026-08-14T08:45:00.000Z', 90, 'confirmed',
          '薄荷', 'cat', 4.8, 'small', 'cat-care', '猫咪洗护', 16800, 90,
          '[]'::jsonb, '["cat-care"]'::jsonb, 16800, '陈嘉', 15,
          '2026-08-14T07:00:00.000Z', '2026-08-14T08:30:00.000Z',
          '2026-08-14T07:00:00.000Z', '2026-08-14T08:45:00.000Z', repeat('0', 64)
        )
        ON CONFLICT (id) DO UPDATE
        SET staff_id = excluded.staff_id,
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            occupancy_starts_at = excluded.occupancy_starts_at,
            occupancy_ends_at = excluded.occupancy_ends_at,
            service_duration_minutes = excluded.service_duration_minutes,
            status = excluded.status
      `,
    );

    const [samePetResponse, otherPetResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/miniapp/available-slots?petId=pet-bohe&primaryServiceId=cat-care",
        headers: { authorization: chengMoAuthorization },
      }),
      app.inject({
        method: "GET",
        url: "/miniapp/available-slots?petId=pet-booking-test-cat&primaryServiceId=cat-care",
        headers: { authorization: chengMoAuthorization },
      }),
    ]);
    const samePetFriday = samePetResponse
      .json()
      .days.find((day: { date: string }) => day.date === "2026-08-14");
    const otherPetFriday = otherPetResponse
      .json()
      .days.find((day: { date: string }) => day.date === "2026-08-14");

    expect(samePetResponse.statusCode).toBe(200);
    expect(
      samePetFriday.slots.find(
        (slot: { startsAt: string }) => slot.startsAt === "2026-08-14T07:00:00.000Z",
      ),
    ).toBeUndefined();
    expect(
      otherPetFriday.slots.find(
        (slot: { startsAt: string }) => slot.startsAt === "2026-08-14T07:00:00.000Z",
      ),
    ).toMatchObject({ staff: { id: "zhouning" } });
  });

  it("待处理或生效的员工停班与门店临时闭店会从真实容量中扣除", async () => {
    await database.pool.query(
      `
        INSERT INTO staff_time_off_intervals (
          id, staff_id, local_date, starts_at, ends_at, status, reason
        )
        VALUES (
          'time-off-slot-test', 'linxia', '2026-08-14', '10:00', '12:00',
          'pending', '测试停班'
        )
      `,
    );
    await database.pool.query(
      `
        INSERT INTO store_closure_intervals (
          id, local_date, starts_at, ends_at, status, reason
        )
        VALUES (
          'closure-slot-test', '2026-08-14', '16:00', '17:00',
          'active', '测试临时闭店'
        )
      `,
    );

    const response = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-basic-care&staffId=linxia",
      headers: { authorization: xuLanAuthorization },
    });
    const friday = response.json().days.find((day: { date: string }) => day.date === "2026-08-14");
    const starts = friday.slots.map((slot: { startsAt: string }) => slot.startsAt);

    expect(response.statusCode).toBe(200);
    expect(starts).not.toContain("2026-08-14T01:30:00.000Z");
    expect(starts).not.toContain("2026-08-14T03:30:00.000Z");
    expect(starts).not.toContain("2026-08-14T07:00:00.000Z");
    expect(starts).not.toContain("2026-08-14T08:30:00.000Z");
  });

  it("PostgreSQL 最终拒绝员工实际占用或同宠物服务区间重叠", async () => {
    await database.pool.query(
      `
        INSERT INTO bookings (
          id, customer_id, pet_id, staff_id, starts_at, ends_at,
          occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
          pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
          primary_service_id_snapshot, primary_service_name_snapshot,
          primary_service_price_cents, primary_service_duration_minutes,
          addon_snapshots, required_skill_ids_snapshot, total_price_cents,
          staff_display_name_snapshot, turnover_minutes,
          original_starts_at, original_ends_at,
          original_occupancy_starts_at, original_occupancy_ends_at,
          verification_code_digest
        )
        VALUES (
          'booking-exclusion-base', 'customer-xu-lan', 'pet-tuanzi', 'linxia',
          '2026-08-20T02:00:00.000Z', '2026-08-20T03:00:00.000Z',
          '2026-08-20T02:00:00.000Z', '2026-08-20T03:15:00.000Z', 60, 'confirmed',
          '团子', 'dog', 8.4, 'small', 'dog-basic-care', '犬基础洗护', 12800, 60,
          '[]'::jsonb, '["dog-basic-care"]'::jsonb, 12800, '林夏', 15,
          '2026-08-20T02:00:00.000Z', '2026-08-20T03:00:00.000Z',
          '2026-08-20T02:00:00.000Z', '2026-08-20T03:15:00.000Z', repeat('0', 64)
        )
      `,
    );

    await expect(
      database.pool.query(
        `
          INSERT INTO bookings (
            id, customer_id, pet_id, staff_id, starts_at, ends_at,
            occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
            pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
            primary_service_id_snapshot, primary_service_name_snapshot,
            primary_service_price_cents, primary_service_duration_minutes,
            addon_snapshots, required_skill_ids_snapshot, total_price_cents,
            staff_display_name_snapshot, turnover_minutes,
            original_starts_at, original_ends_at,
            original_occupancy_starts_at, original_occupancy_ends_at,
            verification_code_digest
          )
          VALUES (
            'booking-exclusion-staff', 'customer-cheng-mo', 'pet-bohe', 'linxia',
            '2026-08-20T03:00:00.000Z', '2026-08-20T03:30:00.000Z',
            '2026-08-20T03:00:00.000Z', '2026-08-20T03:45:00.000Z', 30, 'confirmed',
            '薄荷', 'cat', 4.8, 'small', 'cat-care', '猫咪洗护', 16800, 30,
            '[]'::jsonb, '["cat-care"]'::jsonb, 16800, '林夏', 15,
            '2026-08-20T03:00:00.000Z', '2026-08-20T03:30:00.000Z',
            '2026-08-20T03:00:00.000Z', '2026-08-20T03:45:00.000Z', repeat('0', 64)
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "23P01" });
    await expect(
      database.pool.query(
        `
          INSERT INTO bookings (
            id, customer_id, pet_id, staff_id, starts_at, ends_at,
            occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
            pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
            primary_service_id_snapshot, primary_service_name_snapshot,
            primary_service_price_cents, primary_service_duration_minutes,
            addon_snapshots, required_skill_ids_snapshot, total_price_cents,
            staff_display_name_snapshot, turnover_minutes,
            original_starts_at, original_ends_at,
            original_occupancy_starts_at, original_occupancy_ends_at,
            verification_code_digest
          )
          VALUES (
            'booking-exclusion-pet', 'customer-xu-lan', 'pet-tuanzi', 'zhaohang',
            '2026-08-20T02:30:00.000Z', '2026-08-20T03:30:00.000Z',
            '2026-08-20T02:30:00.000Z', '2026-08-20T03:45:00.000Z', 60, 'confirmed',
            '团子', 'dog', 8.4, 'small', 'dog-basic-care', '犬基础洗护', 12800, 60,
            '[]'::jsonb, '["dog-basic-care"]'::jsonb, 12800, '赵航', 15,
            '2026-08-20T02:30:00.000Z', '2026-08-20T03:30:00.000Z',
            '2026-08-20T02:30:00.000Z', '2026-08-20T03:45:00.000Z', repeat('0', 64)
          )
        `,
      ),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("拒绝越权宠物、归档宠物和不适用的服务组合", async () => {
    const replacedPet = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-bohe&primaryServiceId=cat-care",
      headers: { authorization: xuLanAuthorization },
    });
    const archivedPet = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-lizi&primaryServiceId=dog-basic-care",
      headers: { authorization: await customerAuthorization(app, "lu-yao") },
    });
    const wrongSpecies = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=cat-care",
      headers: { authorization: xuLanAuthorization },
    });

    expect(replacedPet.statusCode).toBe(404);
    expect(replacedPet.json()).toMatchObject({ code: "PET_NOT_FOUND" });
    expect(archivedPet.statusCode).toBe(409);
    expect(archivedPet.json()).toMatchObject({ code: "PET_ARCHIVED" });
    expect(wrongSpecies.statusCode).toBe(400);
    expect(wrongSpecies.json()).toMatchObject({ code: "INVALID_BOOKING_SELECTION" });
  });
});
