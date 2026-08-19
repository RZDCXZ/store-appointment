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

describe("店长顾客与宠物档案及导出", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "chenjia");
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it.each([
    ["%E8%AE%B8%E5%B2%9A", "许岚"],
    ["138****2608", "许岚"],
    ["%E5%9B%A2%E5%AD%90", "许岚"],
  ])("按姓名、脱敏手机号或宠物搜索顾客：%s", async (query, displayName) => {
    const response = await app.inject({
      method: "GET",
      url: `/backoffice/manager/customers?q=${query}`,
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      appliedFilters: { query: decodeURIComponent(query), page: 1 },
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      customers: [
        {
          id: "customer-xu-lan",
          displayName,
          phoneMasked: "138****2608",
          pets: [
            expect.objectContaining({
              id: "pet-tuanzi",
              name: "团子",
              species: "dog",
              archivedAt: null,
            }),
          ],
        },
      ],
    });
  });

  it("读取顾客本人资料、隐私同意与完整宠物档案", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/customers/customer-cheng-mo",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      customer: {
        id: "customer-cheng-mo",
        displayName: "程墨",
        phoneMasked: "139****0341",
        createdAt: expect.any(String),
        privacyConsents: expect.arrayContaining([
          expect.objectContaining({ version: "2026.08", source: "miniapp_booking" }),
        ]),
      },
      pets: [
        {
          id: "pet-bohe",
          name: "薄荷",
          species: "cat",
          weightKg: 4.8,
          petSize: "small",
          breed: "英国短毛猫",
          sex: "female",
          birthDate: "2021-09-06",
          coatType: "short",
          photoPath: "/assets/brand/pet-bohe-british-shorthair.jpg",
          careTags: ["对陌生犬敏感"],
          careNotes: "请与犬只保持距离，使用安静的等候区域。",
          archivedAt: null,
        },
      ],
    });
  });

  it("把顾客预约历史关联到宠物门店服务记录并按时间保留更正说明", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/customers/customer-cheng-mo/history",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      bookings: expect.arrayContaining([
        expect.objectContaining({
          id: "booking-bohe-future",
          pet: expect.objectContaining({ id: "pet-bohe", name: "薄荷" }),
          status: "confirmed",
        }),
        expect.objectContaining({
          id: "booking-bohe-completed",
          pet: expect.objectContaining({ id: "pet-bohe", name: "薄荷" }),
          status: "completed",
        }),
      ]),
      serviceRecords: [
        expect.objectContaining({
          id: "service-record-bohe-completed",
          bookingId: "booking-bohe-completed",
          pet: expect.objectContaining({ id: "pet-bohe", name: "薄荷" }),
          internalText: "洗护过程配合良好，耳部清洁完成。",
          notes: [
            {
              id: "service-record-note-bohe-manager",
              kind: "manager_correction",
              text: "更正：耳部清洁仅完成外耳可见区域。",
              author: { type: "manager", id: "manager", displayName: "沈青" },
              createdAt: "2026-08-06T03:35:00.000Z",
            },
          ],
        }),
      ],
    });
  });

  it("宠物详情把顾客护理注意事项与内部门店服务记录分开，并校验所属顾客", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/customers/customer-cheng-mo/pets/pet-bohe",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      customer: { id: "customer-cheng-mo", displayName: "程墨", phoneMasked: "139****0341" },
      pet: {
        id: "pet-bohe",
        name: "薄荷",
        careNotes: "请与犬只保持距离，使用安静的等候区域。",
      },
      serviceRecords: [
        expect.objectContaining({
          id: "service-record-bohe-completed",
          internalText: "洗护过程配合良好，耳部清洁完成。",
        }),
      ],
    });

    const unrelated = await app.inject({
      method: "GET",
      url: "/backoffice/manager/customers/customer-xu-lan/pets/pet-bohe",
      headers: { cookie: managerCookie },
    });
    expect(unrelated.statusCode).toBe(404);
    expect(unrelated.json()).toMatchObject({ code: "PET_NOT_FOUND" });
  });

  it("按当前预约筛选导出领域字段 CSV，并写入完整导出审计事实", async () => {
    const filters = {
      date: "2026-08-14",
      status: "confirmed",
      staffId: "chenjia",
      primaryServiceId: "cat-care",
      query: "薄荷",
    };
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/exports/bookings.csv",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: filters,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("rongguang-bookings-20260813.csv");
    expect(response.headers["access-control-expose-headers"]).toContain("Content-Disposition");
    expect(response.body).toContain(
      "预约编号,预约状态,顾客姓名,顾客手机号（脱敏）,宠物名称,宠物种类,主要服务,增项,员工,计划开始时间,计划结束时间,服务时长（分钟）,周转时间（分钟）,预约标价（元）",
    );
    expect(response.body).toContain(
      "booking-bohe-future,已确认,程墨,139****0341,薄荷,猫,猫咪洗护,无增项,陈嘉,2026-08-14 11:00,2026-08-14 12:30,90,15,168.00",
    );
    expect(response.body).not.toContain("customer_id");
    expect(response.body).not.toContain("pet_name_snapshot");

    const audit = await database.pool.query<{
      actor_type: string;
      actor_id: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `
        SELECT actor_type, actor_id, payload, occurred_at
        FROM audit_events
        WHERE event_type = 'data_exported'
          AND payload->>'exportType' = 'bookings_csv'
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `,
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "manager",
        actor_id: "manager",
        payload: { exportType: "bookings_csv", filters, recordCount: 1 },
        occurred_at: new Date("2026-08-13T02:50:00.000Z"),
      },
    ]);
  });

  it("按当前授权范围导出顾客与宠物层级 JSON，并记录筛选与类型", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/backoffice/manager/exports/customers-pets.json",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { query: "薄荷" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain(
      "rongguang-customers-pets-20260813.json",
    );
    expect(response.headers["access-control-expose-headers"]).toContain("Content-Disposition");
    expect(response.json()).toMatchObject({
      exportType: "customers_pets_json",
      exportedAt: "2026-08-13T02:50:00.000Z",
      authorizationScope: "single_store_manager",
      appliedFilters: { query: "薄荷" },
      customers: [
        {
          displayName: "程墨",
          phoneMasked: "139****0341",
          privacyConsents: expect.arrayContaining([
            expect.objectContaining({ version: "2026.08", source: "miniapp_booking" }),
          ]),
          pets: [
            expect.objectContaining({
              name: "薄荷",
              species: "cat",
              weightKg: 4.8,
              careTags: ["对陌生犬敏感"],
              careNotes: "请与犬只保持距离，使用安静的等候区域。",
            }),
          ],
        },
      ],
    });
    expect(response.body).not.toContain("customer_id");
    expect(response.body).not.toContain("13951870341");

    const audit = await database.pool.query<{ payload: Record<string, unknown> }>(
      `
        SELECT payload
        FROM audit_events
        WHERE event_type = 'data_exported'
          AND payload->>'exportType' = 'customers_pets_json'
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `,
    );
    expect(audit.rows).toEqual([
      {
        payload: {
          exportType: "customers_pets_json",
          filters: { query: "薄荷" },
          recordCount: 1,
        },
      },
    ]);
  });

  it.each([
    ["GET", "/backoffice/manager/customers", undefined],
    ["GET", "/backoffice/manager/customers/customer-cheng-mo/pets/pet-bohe", undefined],
    ["POST", "/backoffice/manager/exports/bookings.csv", {}],
    ["POST", "/backoffice/manager/exports/customers-pets.json", {}],
  ] as const)("员工不能访问门店顾客资料或跨顾客导出：%s %s", async (method, url, payload) => {
    const response = await app.inject({
      method,
      url,
      headers: { cookie: staffCookie, origin: adminOrigin },
      ...(payload ? { payload } : {}),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });
});
