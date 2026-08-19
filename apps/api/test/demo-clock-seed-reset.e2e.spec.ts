import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";
import { getDatabaseUrl, getPetUploadDirectory } from "../src/config/environment.js";
import { migrate, resetDemoData } from "../src/database/cli.js";

const adminOrigin = "http://localhost:5173";

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

async function customerAuthorization(
  app: NestFastifyApplication,
  customerKey = "cheng-mo",
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey },
  });
  expect(response.statusCode).toBe(201);
  return `Bearer ${response.json<{ accessToken: string }>().accessToken}`;
}

async function readSeedFingerprint(database: DatabaseService): Promise<unknown> {
  const result = await database.pool.query<{ fingerprint: unknown }>(
    `SELECT jsonb_build_object(
       'counts', jsonb_build_object(
         'customers', (SELECT count(*) FROM customers),
         'pets', (SELECT count(*) FROM pets),
         'bookings', (SELECT count(*) FROM bookings),
         'schedules', (SELECT count(*) FROM staff_schedule_days),
         'notifications', (SELECT count(*) FROM notification_outbox)
       ),
       'bookingStates', (
         SELECT jsonb_agg(jsonb_build_array(status, count) ORDER BY status)
         FROM (SELECT status, count(*) AS count FROM bookings GROUP BY status) states
       ),
       'scenarioBookings', (
         SELECT jsonb_agg(
           jsonb_build_array(id, customer_id, pet_id, status, starts_at, ends_at)
           ORDER BY id
         )
         FROM bookings
         WHERE id LIKE 'booking-seed-%'
            OR id IN ('booking-maiya-today', 'booking-bohe-future')
       ),
       'quickCustomers', (
         SELECT jsonb_agg(jsonb_build_array(id, display_name) ORDER BY id)
         FROM customers
         WHERE id IN ('customer-xu-lan', 'customer-cheng-mo', 'customer-lu-yao')
       ),
       'fixedFailures', (
         SELECT jsonb_agg(jsonb_build_array(id, status, attempt_count) ORDER BY id)
         FROM notification_outbox
         WHERE id = 'notification-seed-final-failed'
       ),
       'pendingTimeOff', (
         SELECT jsonb_agg(jsonb_build_array(id, staff_id, status, starts_at, ends_at) ORDER BY id)
         FROM staff_time_off_intervals
         WHERE id = 'time-off-seed-pending'
       ),
       'seedManifest', (SELECT value FROM app_metadata WHERE key = 'seed_manifest')
     ) AS fingerprint`,
  );
  return result.rows[0]?.fingerprint;
}

describe("演示时间、完整种子与确定性重置", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  let managerCookie: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_NOW", "2026-08-13T02:50:00.000Z");
    vi.stubEnv("NOTIFICATION_RETRY_BACKOFF_MS", "5");
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    managerCookie = await login(app, "manager");
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("公开读取唯一演示时钟，店长推进后立即触发提醒并写入审计事实", async () => {
    await database.pool.query(
      "DELETE FROM notification_outbox WHERE booking_id = 'booking-bohe-future' AND notification_type = 'booking_reminder'",
    );
    await database.pool.query(
      "UPDATE bookings SET created_at = '2026-08-13T02:42:00.000Z' WHERE id = 'booking-bohe-future'",
    );

    const initial = await app.inject({ method: "GET", url: "/demo/status" });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(initial.json()).toEqual({
      enabled: true,
      now: "2026-08-13T02:50:00.000Z",
      timeZone: "Asia/Shanghai",
    });

    const advanced = await app.inject({
      method: "POST",
      url: "/backoffice/manager/demo/advance",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { minutes: 15 },
    });
    expect(advanced.statusCode).toBe(201);
    expect(advanced.json()).toEqual({
      previousNow: "2026-08-13T02:50:00.000Z",
      now: "2026-08-13T03:05:00.000Z",
      timeZone: "Asia/Shanghai",
      remindersCreated: 1,
    });

    const current = await app.inject({ method: "GET", url: "/demo/status" });
    expect(current.json()).toMatchObject({ enabled: true, now: "2026-08-13T03:05:00.000Z" });
    const reminder = await database.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM notification_outbox WHERE booking_id = 'booking-bohe-future' AND notification_type = 'booking_reminder'",
    );
    expect(reminder.rows[0]?.count).toBe("1");
    const audit = await database.pool.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, payload
       FROM audit_events
       WHERE event_type = 'demo_time_advanced'
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({
      event_type: "demo_time_advanced",
      payload: { minutes: 15, previousNow: "2026-08-13T02:50:00.000Z" },
    });
  });

  it("只允许店长两步确认后重置，并清理上传、失效旧会话及恢复完整固定场景", async () => {
    const staffCookie = await login(app, "linxia");
    const customerAuthorizationHeader = await customerAuthorization(app);
    const uploadDirectory = getPetUploadDirectory();
    const uploadedFile = join(uploadDirectory, "reset-me.jpg");
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(uploadedFile, "temporary customer upload");

    const staffReset = await app.inject({
      method: "POST",
      url: "/backoffice/manager/demo/reset",
      headers: { cookie: staffCookie, origin: adminOrigin },
      payload: { confirmation: "重置茸光演示数据" },
    });
    expect(staffReset.statusCode).toBe(403);

    const wrongConfirmation = await app.inject({
      method: "POST",
      url: "/backoffice/manager/demo/reset",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { confirmation: "重置" },
    });
    expect(wrongConfirmation.statusCode).toBe(400);
    expect(wrongConfirmation.json()).toMatchObject({ code: "DEMO_RESET_CONFIRMATION_REQUIRED" });

    const reset = await app.inject({
      method: "POST",
      url: "/backoffice/manager/demo/reset",
      headers: { cookie: managerCookie, origin: adminOrigin },
      payload: { confirmation: "重置茸光演示数据" },
    });
    expect(reset.statusCode).toBe(201);
    expect(reset.json()).toMatchObject({
      now: "2026-08-13T02:50:00.000Z",
      timeZone: "Asia/Shanghai",
      invalidatedSessions: "all",
      uploadsRestored: true,
    });

    await expect(access(uploadedFile)).rejects.toThrow();
    const oldBackofficeSession = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie: managerCookie },
    });
    expect(oldBackofficeSession.statusCode).toBe(401);
    const oldCustomerSession = await app.inject({
      method: "GET",
      url: "/miniapp/me",
      headers: { authorization: customerAuthorizationHeader },
    });
    expect(oldCustomerSession.statusCode).toBe(401);

    const counts = await database.pool.query<{
      customers: string;
      pets: string;
      terminal_bookings: string;
      active_bookings: string;
    }>(
      `SELECT
         (SELECT count(*) FROM customers)::text AS customers,
         (SELECT count(*) FROM pets)::text AS pets,
         (SELECT count(*) FROM bookings WHERE status IN ('completed', 'terminated', 'cancelled', 'no_show'))::text AS terminal_bookings,
         (SELECT count(*) FROM bookings WHERE status IN ('confirmed', 'checked_in'))::text AS active_bookings`,
    );
    expect(counts.rows[0]).toEqual({
      customers: "20",
      pets: "28",
      terminal_bookings: "240",
      active_bookings: "40",
    });
    const scenarios = await database.pool.query<{ id: string }>(
      `SELECT id FROM bookings
       WHERE id IN ('booking-seed-late', 'booking-seed-awaiting-check-in', 'booking-seed-checked-in')
       UNION ALL
       SELECT id FROM staff_time_off_intervals WHERE id = 'time-off-seed-pending'
       UNION ALL
       SELECT id FROM notification_outbox WHERE id = 'notification-seed-final-failed'
       ORDER BY id`,
    );
    expect(scenarios.rows.map((row) => row.id)).toEqual([
      "booking-seed-awaiting-check-in",
      "booking-seed-checked-in",
      "booking-seed-late",
      "notification-seed-final-failed",
      "time-off-seed-pending",
    ]);
    const lateScenario = await database.pool.query<{ starts_at: Date }>(
      "SELECT starts_at FROM bookings WHERE id = 'booking-seed-late'",
    );
    expect(lateScenario.rows[0]?.starts_at.toISOString()).toBe("2026-08-13T02:30:00.000Z");

    const invalidSeedBookings = await database.pool.query<{ id: string }>(
      `SELECT booking.id
       FROM bookings booking
       JOIN pets pet ON pet.id = booking.pet_id
       JOIN service_catalog_items primary_service
         ON primary_service.id = booking.primary_service_id_snapshot
       JOIN store_business_hours business_hours
         ON business_hours.weekday = extract(
           dow FROM booking.starts_at AT TIME ZONE 'Asia/Shanghai'
         )::integer
       WHERE (
           booking.pet_species_snapshot <> pet.species
           OR NOT booking.pet_species_snapshot = ANY(primary_service.applicable_species)
           OR business_hours.opens_at IS NULL
           OR (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::time < business_hours.opens_at
           OR (COALESCE(booking.occupancy_ends_at, booking.original_occupancy_ends_at) AT TIME ZONE 'Asia/Shanghai')::time > business_hours.closes_at
           OR EXISTS (
             SELECT 1
             FROM jsonb_array_elements_text(booking.required_skill_ids_snapshot) required_skill(skill_id)
             WHERE NOT EXISTS (
               SELECT 1
               FROM staff_skills
               WHERE staff_skills.staff_id = booking.staff_id
                 AND staff_skills.skill_id = required_skill.skill_id
             )
           )
           OR NOT EXISTS (
             SELECT 1
             FROM staff_schedule_days schedule_day
             JOIN staff_schedule_shifts shift ON shift.schedule_day_id = schedule_day.id
             WHERE schedule_day.staff_id = booking.staff_id
               AND schedule_day.local_date = (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date
               AND schedule_day.publication_status = 'published'
               AND (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::time >= shift.starts_at
               AND (COALESCE(booking.occupancy_ends_at, booking.original_occupancy_ends_at) AT TIME ZONE 'Asia/Shanghai')::time <= shift.ends_at
               AND NOT EXISTS (
                 SELECT 1
                 FROM staff_schedule_breaks shift_break
                 WHERE shift_break.schedule_shift_id = shift.id
                   AND tstzrange(
                     booking.starts_at,
                     COALESCE(booking.occupancy_ends_at, booking.original_occupancy_ends_at),
                     '[)'
                   ) && tstzrange(
                     schedule_day.local_date + shift_break.starts_at AT TIME ZONE 'Asia/Shanghai',
                     schedule_day.local_date + shift_break.ends_at AT TIME ZONE 'Asia/Shanghai',
                     '[)'
                   )
               )
           )
         )
       ORDER BY booking.id`,
    );
    expect(invalidSeedBookings.rows).toEqual([]);

    const freshCustomerAuthorization = await customerAuthorization(app, "xu-lan");
    const claimable = await app.inject({
      method: "GET",
      url: "/miniapp/available-slots?petId=pet-tuanzi&primaryServiceId=dog-styling",
      headers: { authorization: freshCustomerAuthorization },
    });
    expect(claimable.statusCode).toBe(200);
    const uniqueDay = claimable
      .json<{ days: Array<{ date: string; slots: Array<{ startsAt: string }> }> }>()
      .days.find((day) => day.date === "2026-08-23");
    expect(uniqueDay?.slots).toEqual([
      {
        startsAt: "2026-08-23T07:30:00.000Z",
        endsAt: "2026-08-23T09:30:00.000Z",
        turnoverEndsAt: "2026-08-23T09:45:00.000Z",
        staff: {
          id: "zhaohang",
          displayName: "赵航",
          employeeNumber: 4,
        },
      },
    ]);
  });

  it("从空数据库迁移后连续三次重置并启动，时段、状态、异常与看板结果保持一致", async () => {
    const fingerprints: unknown[] = [];
    const dashboards: unknown[] = [];
    const originalDatabaseUrl = getDatabaseUrl();
    const originalDatabaseEnvironment = process.env.DATABASE_URL;
    const databaseName = `rongguang_ticket_28_${process.pid}`;
    const temporaryDatabaseUrl = new URL(originalDatabaseUrl);
    temporaryDatabaseUrl.pathname = `/${databaseName}`;
    const administrationPool = new Pool({ connectionString: originalDatabaseUrl });
    let temporaryAppOpen = false;

    await app.close();
    try {
      await administrationPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await administrationPool.query(`CREATE DATABASE "${databaseName}"`);
      process.env.DATABASE_URL = temporaryDatabaseUrl.href;

      const migrationPool = new Pool({ connectionString: temporaryDatabaseUrl.href });
      const migrationClient = await migrationPool.connect();
      try {
        await migrate(migrationClient);
      } finally {
        migrationClient.release();
        await migrationPool.end();
      }

      for (let iteration = 0; iteration < 3; iteration += 1) {
        const resetPool = new Pool({ connectionString: temporaryDatabaseUrl.href });
        const resetClient = await resetPool.connect();
        try {
          await resetDemoData(resetClient);
        } finally {
          resetClient.release();
          await resetPool.end();
        }

        app = await createApplication();
        await app.init();
        temporaryAppOpen = true;
        database = app.get(DatabaseService);
        managerCookie = await login(app, "manager");
        fingerprints.push(await readSeedFingerprint(database));
        const dashboard = await app.inject({
          method: "GET",
          url: "/backoffice/manager/business/metrics?period=90",
          headers: { cookie: managerCookie },
        });
        expect(dashboard.statusCode).toBe(200);
        dashboards.push(dashboard.json());
        await app.close();
        temporaryAppOpen = false;
      }

      expect(fingerprints[1]).toEqual(fingerprints[0]);
      expect(fingerprints[2]).toEqual(fingerprints[0]);
      expect(dashboards[1]).toEqual(dashboards[0]);
      expect(dashboards[2]).toEqual(dashboards[0]);
    } finally {
      if (temporaryAppOpen) await app.close();
      if (originalDatabaseEnvironment === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseEnvironment;
      await administrationPool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await administrationPool.end();
      app = await createApplication();
      await app.init();
      database = app.get(DatabaseService);
      managerCookie = await login(app, "manager");
    }
  }, 30_000);
});
