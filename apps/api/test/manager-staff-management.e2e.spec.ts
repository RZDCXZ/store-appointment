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
  if (typeof setCookie !== "string") throw new Error("登录响应没有设置会话 Cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

async function login(
  app: NestFastifyApplication,
  username: string,
  password = "Rongguang2026!",
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { origin: adminOrigin },
    payload: { username, password },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

async function clearTestStaffAudits(database: DatabaseService): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      "DELETE FROM audit_events WHERE subject_type = 'staff' AND subject_id = 'zhaohang'",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe("员工账号与员工技能管理", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;
  let staffCookie: string;
  let customerAuthorization: string;
  let createdStaffId: string | null = null;
  let createdStaffCookie: string | null = null;
  let insertedPrivacyConsentVersion: string | null = null;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    await clearTestStaffAudits(database);
    managerCookie = await login(app, "manager");
    staffCookie = await login(app, "linxia");
    const customerSession = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "xu-lan" },
    });
    customerAuthorization = `Bearer ${customerSession.json<{ accessToken: string }>().accessToken}`;
    const consent = await database.pool.query<{ notice_version: string }>(
      `
        INSERT INTO privacy_consents (customer_id, notice_version, source, consented_at)
        SELECT 'customer-xu-lan', version, 'miniapp_booking', $1
        FROM privacy_notices
        WHERE is_current
        ON CONFLICT (customer_id, notice_version) DO NOTHING
        RETURNING notice_version
      `,
      ["2026-08-13T02:50:00.000Z"],
    );
    insertedPrivacyConsentVersion = consent.rows[0]?.notice_version ?? null;
  });

  afterAll(async () => {
    await database.pool.query(
      `
        DELETE FROM staff_skills WHERE staff_id = 'zhaohang';
        INSERT INTO staff_skills (staff_id, skill_id)
        VALUES
          ('zhaohang', 'dog-basic-care'),
          ('zhaohang', 'dog-styling'),
          ('zhaohang', 'nail-care'),
          ('zhaohang', 'oral-care')
        ON CONFLICT DO NOTHING
      `,
    );
    await database.pool.query(
      `
        UPDATE staff_members SET active = true WHERE id = 'zhaohang';
        UPDATE backoffice_accounts SET active = true WHERE id = 'zhaohang'
      `,
    );
    await clearTestStaffAudits(database);
    if (createdStaffId) {
      const client = await database.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        await client.query("DELETE FROM audit_events WHERE subject_id = $1", [createdStaffId]);
        await client.query("DELETE FROM staff_skills WHERE staff_id = $1", [createdStaffId]);
        await client.query("DELETE FROM staff_members WHERE id = $1", [createdStaffId]);
        await client.query("DELETE FROM backoffice_accounts WHERE id = $1", [createdStaffId]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    await database.pool.query(
      `
        DELETE FROM booking_idempotency_keys
        WHERE customer_id = 'customer-xu-lan'
          AND idempotency_key = 'ticket20-skill-lock'
      `,
    );
    if (insertedPrivacyConsentVersion) {
      await database.pool.query(
        `
          DELETE FROM privacy_consents
          WHERE customer_id = 'customer-xu-lan' AND notice_version = $1
        `,
        [insertedPrivacyConsentVersion],
      );
    }
    await app.close();
    vi.unstubAllEnvs();
  });

  it("仅店长可读取员工账号状态、未来班次摘要和主要服务及增项技能矩阵", async () => {
    const [anonymous, staff, manager] = await Promise.all([
      app.inject({ method: "GET", url: "/backoffice/manager/staff" }),
      app.inject({
        method: "GET",
        url: "/backoffice/manager/staff",
        headers: { cookie: staffCookie },
      }),
      app.inject({
        method: "GET",
        url: "/backoffice/manager/staff",
        headers: { cookie: managerCookie },
      }),
    ]);

    expect(anonymous.statusCode).toBe(401);
    expect(staff.statusCode).toBe(403);
    expect(manager.statusCode).toBe(200);
    expect(manager.headers["cache-control"]).toBe("no-store");
    expect(manager.json()).toMatchObject({
      staff: expect.arrayContaining([
        expect.objectContaining({
          id: "linxia",
          username: "linxia",
          displayName: "林夏",
          employeeNumber: 1,
          status: "active",
          shiftSummary: {
            publishedShiftCount: expect.any(Number),
            scheduledMinutes: expect.any(Number),
            nextShiftStartsAt: expect.any(String),
          },
          skillIds: expect.arrayContaining(["dog-basic-care", "dog-styling"]),
        }),
      ]),
      skillColumns: expect.arrayContaining([
        expect.objectContaining({
          id: "dog-basic-care",
          name: "犬基础洗护",
          kind: "primary_service",
          status: "active",
        }),
        expect.objectContaining({
          id: "oral-care",
          name: "口腔清洁",
          kind: "addon",
          status: "active",
        }),
      ]),
    });

    const serialized = JSON.stringify(manager.json());
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toContain("scrypt$");
  });

  it("技能增删会立即改变指定员工的可约时段，并追加店长审计事实", async () => {
    const current = await app.inject({
      method: "GET",
      url: "/backoffice/manager/staff",
      headers: { cookie: managerCookie },
    });
    const zhaoHang = current
      .json<{ staff: Array<{ id: string; skillIds: string[] }> }>()
      .staff.find((member) => member.id === "zhaohang");
    expect(zhaoHang?.skillIds).toContain("dog-styling");

    const remove = await app.inject({
      method: "PATCH",
      url: "/backoffice/manager/staff/zhaohang/skills",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { skillIds: zhaoHang?.skillIds.filter((skill) => skill !== "dog-styling") },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({
      staff: expect.arrayContaining([
        expect.objectContaining({
          id: "zhaohang",
          skillIds: expect.not.arrayContaining(["dog-styling"]),
        }),
      ]),
    });

    const unavailable = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling&staffId=zhaohang",
      headers: { authorization: customerAuthorization },
    });
    expect(unavailable.statusCode).toBe(200);
    expect(unavailable.json().days.flatMap((day: { slots: unknown[] }) => day.slots)).toHaveLength(
      0,
    );

    const restore = await app.inject({
      method: "PATCH",
      url: "/backoffice/manager/staff/zhaohang/skills",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { skillIds: zhaoHang?.skillIds },
    });
    expect(restore.statusCode).toBe(200);
    const available = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling&staffId=zhaohang",
      headers: { authorization: customerAuthorization },
    });
    expect(
      available.json().days.flatMap((day: { slots: unknown[] }) => day.slots).length,
    ).toBeGreaterThan(0);

    const audit = await database.pool.query<{
      actor_id: string;
      event_type: string;
      payload: { addedSkillIds: string[]; removedSkillIds: string[] };
    }>(
      `
        SELECT actor_id, event_type, payload
        FROM audit_events
        WHERE subject_type = 'staff' AND subject_id = 'zhaohang'
        ORDER BY occurred_at, id
      `,
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows.every((event) => event.actor_id === "manager")).toBe(true);
    expect(audit.rows.map((event) => event.event_type)).toEqual([
      "staff_skills_updated",
      "staff_skills_updated",
    ]);
    expect(audit.rows.some((event) => event.payload.removedSkillIds[0] === "dog-styling")).toBe(
      true,
    );
    expect(audit.rows.some((event) => event.payload.addedSkillIds[0] === "dog-styling")).toBe(true);

    const forbidden = await app.inject({
      method: "PATCH",
      url: "/backoffice/manager/staff/zhaohang/skills",
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: { skillIds: [] },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("店长创建员工账号时只保存安全哈希，并可用新演示密码登录", async () => {
    const demoPassword = "Ticket20-Demo!";
    const created = await app.inject({
      method: "POST",
      url: "/backoffice/manager/staff",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: {
        username: "ticket20staff",
        displayName: "唐语",
        demoPassword,
        skillIds: ["cat-care", "nail-care"],
      },
    });

    expect(created.statusCode).toBe(201);
    const createdBody = created.json<{
      staff: Array<{
        id: string;
        username: string;
        displayName: string;
        employeeNumber: number;
        status: string;
        skillIds: string[];
      }>;
    }>();
    const member = createdBody.staff.find((staff) => staff.username === "ticket20staff");
    expect(member).toMatchObject({
      displayName: "唐语",
      employeeNumber: 5,
      status: "active",
      skillIds: ["cat-care", "nail-care"],
    });
    createdStaffId = member?.id ?? null;
    expect(createdStaffId).toBeTruthy();
    expect(JSON.stringify(createdBody)).not.toMatch(/password|scrypt\$/i);

    const stored = await database.pool.query<{
      password_hash: string;
      role: string;
    }>("SELECT password_hash, role FROM backoffice_accounts WHERE id = $1", [createdStaffId]);
    expect(stored.rows[0]?.role).toBe("staff");
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(stored.rows[0]?.password_hash).not.toContain(demoPassword);

    createdStaffCookie = await login(app, "ticket20staff", demoPassword);
    expect(createdStaffCookie).toMatch(/^rongguang_backoffice_session=/);

    const audit = await database.pool.query<{
      actor_id: string;
      payload: Record<string, unknown>;
    }>(
      `
        SELECT actor_id, payload
        FROM audit_events
        WHERE event_type = 'staff_account_created' AND subject_id = $1
      `,
      [createdStaffId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_id).toBe("manager");
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toMatch(/password|scrypt\$/i);
  });

  it("未来预约会阻断停用并逐笔返回后续处理入口", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: "/backoffice/manager/staff/chenjia/deactivate",
      headers: { cookie: managerCookie, origin: adminOrigin },
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      code: "STAFF_HAS_FUTURE_BOOKINGS",
      message: expect.stringMatching(/未来预约/),
      affectedBookings: [
        {
          id: "booking-bohe-future",
          petName: "薄荷",
          serviceName: "猫咪洗护",
          staffName: "陈嘉",
          startsAt: "2026-08-14T03:00:00.000Z",
          resolutionPath: "/manager/appointments/booking-bohe-future",
        },
      ],
    });

    const current = await app.inject({
      method: "GET",
      url: "/backoffice/manager/staff",
      headers: { cookie: managerCookie },
    });
    expect(current.json()).toMatchObject({
      staff: expect.arrayContaining([expect.objectContaining({ id: "chenjia", status: "active" })]),
    });
  });

  it("停用冲突检查不等待正在改期的预约行锁，避免与员工事实锁形成反向锁序", async () => {
    const bookingChange = await database.pool.connect();
    let response: Awaited<ReturnType<NestFastifyApplication["inject"]>> | undefined;
    let finishedBeforeRelease: boolean;
    try {
      await bookingChange.query("BEGIN");
      await bookingChange.query(
        "SELECT id FROM bookings WHERE id = 'booking-bohe-future' FOR UPDATE",
      );

      let settled = false;
      const deactivation = app
        .inject({
          method: "POST",
          url: "/backoffice/manager/staff/chenjia/deactivate",
          headers: { cookie: managerCookie, origin: adminOrigin },
        })
        .then((result) => {
          settled = true;
          return result;
        });

      await new Promise((resolve) => setTimeout(resolve, 80));
      finishedBeforeRelease = settled;
      await bookingChange.query("COMMIT");
      response = await deactivation;
    } catch (error) {
      await bookingChange.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      bookingChange.release();
    }

    expect(finishedBeforeRelease).toBe(true);
    expect(response?.statusCode).toBe(409);
    expect(response?.json()).toMatchObject({ code: "STAFF_HAS_FUTURE_BOOKINGS" });
  });

  it("预约提交会等待员工技能事务，并在锁释放后按最新技能重新校验", async () => {
    const available = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling&staffId=zhaohang",
      headers: { authorization: customerAuthorization },
    });
    const startsAt = available
      .json<{ days: Array<{ slots: Array<{ startsAt: string }> }> }>()
      .days.flatMap((day) => day.slots)[0]?.startsAt;
    expect(startsAt).toBeTruthy();

    const skillChange = await database.pool.connect();
    let response: Awaited<ReturnType<NestFastifyApplication["inject"]>> | undefined;
    let wasWaiting: boolean;
    try {
      await skillChange.query("BEGIN");
      await skillChange.query(
        `
          SELECT staff.id
          FROM staff_members AS staff
          JOIN backoffice_accounts AS account ON account.id = staff.id
          WHERE staff.id = 'zhaohang'
          FOR UPDATE OF staff, account
        `,
      );
      await skillChange.query(
        "DELETE FROM staff_skills WHERE staff_id = 'zhaohang' AND skill_id = 'dog-styling'",
      );

      let settled = false;
      const submission = app
        .inject({
          method: "POST",
          url: "/miniapp/bookings",
          headers: { authorization: customerAuthorization },
          payload: {
            idempotencyKey: "ticket20-skill-lock",
            petId: "pet-tuanzi",
            primaryServiceId: "dog-styling",
            addonIds: [],
            staffId: "zhaohang",
            startsAt,
          },
        })
        .then((result) => {
          settled = true;
          return result;
        });

      await new Promise((resolve) => setTimeout(resolve, 40));
      wasWaiting = !settled;
      await skillChange.query("COMMIT");
      response = await submission;
    } catch (error) {
      await skillChange.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await database.pool.query(
        `
          INSERT INTO staff_skills (staff_id, skill_id)
          VALUES ('zhaohang', 'dog-styling')
          ON CONFLICT DO NOTHING
        `,
      );
      skillChange.release();
    }

    if (response?.statusCode === 201) {
      const bookingId = response.json<{ booking: { id: string } }>().booking.id;
      const cleanup = await database.pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SET LOCAL session_replication_role = replica");
        await cleanup.query("DELETE FROM audit_events WHERE subject_id = $1", [bookingId]);
        await cleanup.query("DELETE FROM bookings WHERE id = $1", [bookingId]);
        await cleanup.query("COMMIT");
      } catch (error) {
        await cleanup.query("ROLLBACK");
        throw error;
      } finally {
        cleanup.release();
      }
    }
    expect(wasWaiting).toBe(true);
    expect(response?.statusCode).toBe(409);
    expect(response?.json()).toMatchObject({ code: "STAFF_NOT_QUALIFIED" });
  });

  it("停用成功会让会话与新容量立即失效，同时保留历史预约员工快照", async () => {
    const zhaoHangCookie = await login(app, "zhaohang");
    const before = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling&staffId=zhaohang",
      headers: { authorization: customerAuthorization },
    });
    expect(
      before.json().days.flatMap((day: { slots: unknown[] }) => day.slots).length,
    ).toBeGreaterThan(0);

    const deactivated = await app.inject({
      method: "POST",
      url: "/backoffice/manager/staff/zhaohang/deactivate",
      headers: { cookie: managerCookie, origin: adminOrigin },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json()).toMatchObject({
      staff: expect.arrayContaining([
        expect.objectContaining({ id: "zhaohang", displayName: "赵航", status: "inactive" }),
      ]),
    });

    const expiredSession = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: zhaoHangCookie },
    });
    expect(expiredSession.statusCode).toBe(401);
    expect(expiredSession.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    const relogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin: adminOrigin },
      payload: { username: "zhaohang", password: "Rongguang2026!" },
    });
    expect(relogin.statusCode).toBe(401);

    const after = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling&staffId=zhaohang",
      headers: { authorization: customerAuthorization },
    });
    expect(after.json().days.flatMap((day: { slots: unknown[] }) => day.slots)).toHaveLength(0);

    const historical = await app.inject({
      method: "GET",
      url: "/backoffice/manager/bookings/booking-maiya-completed",
      headers: { cookie: managerCookie },
    });
    expect(historical.statusCode).toBe(200);
    expect(historical.json()).toMatchObject({
      booking: { id: "booking-maiya-completed", staff: { id: "zhaohang", displayName: "赵航" } },
      serviceRecord: { staff: { id: "zhaohang", displayName: "赵航" } },
    });

    const audit = await database.pool.query<{
      actor_id: string;
      payload: { revokedSessionCount: number };
    }>(
      `
        SELECT actor_id, payload
        FROM audit_events
        WHERE event_type = 'staff_account_deactivated' AND subject_id = 'zhaohang'
      `,
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        actor_id: "manager",
        payload: expect.objectContaining({ revokedSessionCount: 1 }),
      }),
    ]);
  });
});
