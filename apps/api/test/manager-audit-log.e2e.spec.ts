import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";
const auditId = "audit-ticket29-safe-summary";

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

async function deleteTicketAudits(database: DatabaseService): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "DELETE FROM audit_event_redactions WHERE audit_event_id LIKE 'audit-ticket29-%'",
    );
    await client.query("DELETE FROM audit_events WHERE id LIKE 'audit-ticket29-%'");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe("不可修改审计记录与店长读取边界", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;
  let customerAuthorization: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    await deleteTicketAudits(database);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "linxia");
    const customerSession = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "xu-lan" },
    });
    customerAuthorization = `Bearer ${customerSession.json<{ accessToken: string }>().accessToken}`;
    await database.pool.query(
      `INSERT INTO audit_events (
         id, event_type, actor_type, actor_id,
         subject_type, subject_id, payload, occurred_at
       )
       VALUES ($1, 'customer_phone_revealed', 'staff', 'chenjia',
               'booking', 'booking-ticket29-sensitive', $2::jsonb, $3)`,
      [
        auditId,
        JSON.stringify({
          bookingId: "booking-ticket29-sensitive",
          password: "never-return-password",
          sessionToken: "never-return-session",
          verificationCode: "123456",
          exportContents: "never-return-complete-export",
        }),
        "2026-08-13T02:42:18.000Z",
      ],
    );
    for (let index = 0; index < 22; index += 1) {
      await database.pool.query(
        `INSERT INTO audit_events (
           id, event_type, actor_type, actor_id,
           subject_type, subject_id, payload, occurred_at
         )
         VALUES ($1, 'data_exported', 'manager', 'manager',
                 'store', $2, $3::jsonb, $4)`,
        [
          `audit-ticket29-page-${String(index).padStart(2, "0")}`,
          "store-ticket29-page",
          JSON.stringify({ exportType: "bookings_csv", rowCount: index }),
          new Date(Date.parse("2026-08-12T00:00:00.000Z") + index * 1_000).toISOString(),
        ],
      );
    }
    await database.pool.query(
      `INSERT INTO audit_events (
         id, event_type, actor_type, actor_id,
         subject_type, subject_id, payload, occurred_at
       )
       VALUES ('audit-ticket29-anonymized', 'data_exported', 'customer', 'customer-lu-yao-ticket29',
               'customer', 'customer-lu-yao-ticket29', $1::jsonb, '2026-08-11T04:00:00.000Z')`,
      [JSON.stringify({ customerName: "陆遥", phone: "13690247519" })],
    );
    await database.pool.query(
      `INSERT INTO audit_event_redactions (
         audit_event_id, actor_id, payload, redacted_at, reason
       )
       VALUES ('audit-ticket29-anonymized', 'anonymized-customer', $1::jsonb,
               '2026-08-13T02:50:00.000Z', 'customer_data_anonymized')`,
      [JSON.stringify({ retainedFact: true })],
    );
  });

  afterAll(async () => {
    await deleteTicketAudits(database);
    await app.close();
    vi.unstubAllEnvs();
  });

  it("店长读取安全的审计事实摘要，响应不返回原始载荷或敏感明文", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/manager/audits?subjectId=booking-ticket29-sensitive",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      appliedFilters: {
        actor: null,
        action: null,
        subjectType: null,
        subjectId: "booking-ticket29-sensitive",
        from: null,
        to: null,
        page: 1,
      },
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      records: [
        {
          id: auditId,
          occurredAt: "2026-08-13T02:42:18.000Z",
          actor: { type: "staff", id: "chenjia", label: "陈嘉 · 员工" },
          action: { type: "customer_phone_revealed", label: "揭示完整手机号" },
          subject: {
            type: "booking",
            id: "booking-ticket29-sensitive",
            label: "预约 booking-ticket29-sensitive",
          },
          changes: ["敏感资料已受控揭示"],
        },
      ],
    });
    expect(response.body).not.toMatch(
      /never-return-password|never-return-session|123456|never-return-complete-export|payload/i,
    );
  });

  it("按操作者、动作、对象和上海日期筛选，并使用稳定分页恢复结果", async () => {
    const filtered = await app.inject({
      method: "GET",
      url:
        "/backoffice/manager/audits" +
        "?actor=staff%3Achenjia" +
        "&action=customer_phone_revealed" +
        "&subjectType=booking" +
        "&subjectId=booking-ticket29-sensitive" +
        "&from=2026-08-13&to=2026-08-13&page=1",
      headers: { cookie: managerCookie },
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({
      appliedFilters: {
        actor: "staff:chenjia",
        action: "customer_phone_revealed",
        subjectType: "booking",
        subjectId: "booking-ticket29-sensitive",
        from: "2026-08-13",
        to: "2026-08-13",
        page: 1,
      },
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      records: [{ id: auditId }],
      filterOptions: {
        actors: expect.arrayContaining([{ value: "staff:chenjia", label: "陈嘉 · 员工" }]),
      },
    });

    const secondPage = await app.inject({
      method: "GET",
      url:
        "/backoffice/manager/audits?action=data_exported" + "&subjectId=store-ticket29-page&page=2",
      headers: { cookie: managerCookie },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      appliedFilters: { action: "data_exported", page: 2 },
      pagination: { page: 2, pageSize: 20, totalItems: 22, totalPages: 2 },
    });
    expect(secondPage.json<{ records: Array<{ changes: string[] }> }>().records).toEqual([
      expect.objectContaining({ changes: ["导出预约 CSV；共 1 条"] }),
      expect.objectContaining({ changes: ["导出预约 CSV；共 0 条"] }),
    ]);
  });

  it("拒绝无效的筛选枚举、日历日期与页码", async () => {
    const responses = await Promise.all([
      app.inject({
        method: "GET",
        url: "/backoffice/manager/audits?action=forged_action",
        headers: { cookie: managerCookie },
      }),
      app.inject({
        method: "GET",
        url: "/backoffice/manager/audits?from=2026-02-31",
        headers: { cookie: managerCookie },
      }),
      app.inject({
        method: "GET",
        url: "/backoffice/manager/audits?page=0",
        headers: { cookie: managerCookie },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400]);
    for (const response of responses) {
      expect(response.json()).toMatchObject({ code: "INVALID_AUDIT_FILTER" });
    }
  });

  it("员工、顾客和普通写请求都不能进入店长只读审计接缝", async () => {
    const [staff, customer, write] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/backoffice/manager/audits",
        headers: { cookie: staffCookie },
      }),
      app.inject({
        method: "GET",
        url: "/backoffice/manager/audits",
        headers: { authorization: customerAuthorization },
      }),
      app.inject({
        method: "POST",
        url: "/backoffice/manager/audits",
        headers: { cookie: managerCookie, origin: adminOrigin },
        payload: {
          actor: { type: "manager", id: "forged" },
          occurredAt: "1999-01-01T00:00:00.000Z",
        },
      }),
    ]);

    expect(staff.statusCode).toBe(403);
    expect(customer.statusCode).toBe(401);
    expect(write.statusCode).toBe(404);
  });

  it("匿名化后只读取身份无关的删除相关事实", async () => {
    const response = await app.inject({
      method: "GET",
      url:
        "/backoffice/manager/audits" +
        "?actor=customer%3Aanonymized-customer" +
        "&action=data_exported&from=2026-08-11&to=2026-08-11",
      headers: { cookie: managerCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      records: [
        {
          id: "audit-ticket29-anonymized",
          actor: {
            type: "customer",
            id: "anonymized-customer",
            label: "已匿名顾客 · 顾客",
          },
          subject: {
            type: "customer",
            id: expect.stringMatching(/^anonymized-[a-f0-9]{12}$/),
          },
        },
      ],
    });
    expect(response.body).not.toMatch(/customer-lu-yao-ticket29|lu-yao|陆遥|13690247519/);
  });

  it("真实 PostgreSQL 触发器拒绝更新或删除审计事实与脱敏覆盖层", async () => {
    await expect(
      database.pool.query("UPDATE audit_events SET payload = '{}'::jsonb WHERE id = $1", [auditId]),
    ).rejects.toThrow(/审计记录不可修改或删除/);
    await expect(
      database.pool.query("DELETE FROM audit_events WHERE id = $1", [auditId]),
    ).rejects.toThrow(/审计记录不可修改或删除/);
    await expect(
      database.pool.query(
        "UPDATE audit_event_redactions SET payload = '{}'::jsonb WHERE audit_event_id = 'audit-ticket29-anonymized'",
      ),
    ).rejects.toThrow(/审计记录不可修改或删除/);
    await expect(
      database.pool.query(
        "DELETE FROM audit_event_redactions WHERE audit_event_id = 'audit-ticket29-anonymized'",
      ),
    ).rejects.toThrow(/审计记录不可修改或删除/);
  });
});
