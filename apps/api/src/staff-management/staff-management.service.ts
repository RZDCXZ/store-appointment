import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ManagerStaffAccount,
  ManagerStaffResponse,
  ManagerStaffSkillColumn,
  StaffSkillId,
} from "@rongguang/contracts";

import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { hashPassword } from "../auth/password.js";
import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { addLocalDays, getShanghaiLocalDate } from "../schedule/schedule-date.js";

const skillValues = new Set<StaffSkillId>([
  "dog-basic-care",
  "dog-styling",
  "cat-care",
  "nail-care",
  "deshedding-care",
  "oral-care",
]);

interface StaffRow {
  id: string;
  username: string;
  display_name: string;
  employee_number: number;
  account_active: boolean;
  staff_active: boolean;
  skill_ids: StaffSkillId[] | null;
  published_shift_count: string;
  scheduled_minutes: string;
  next_shift_starts_at: Date | null;
}

interface SkillColumnRow {
  id: string;
  name: string;
  item_type: "primary_service" | "addon";
  active: boolean;
  required_skill_ids: StaffSkillId[];
}

interface NewStaffInput {
  username: string;
  displayName: string;
  demoPassword: string;
  skillIds: StaffSkillId[];
}

interface AffectedBookingRow {
  id: string;
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
}

function toStaff(row: StaffRow): ManagerStaffAccount {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    employeeNumber: row.employee_number,
    status: row.account_active && row.staff_active ? "active" : "inactive",
    skillIds: row.skill_ids ?? [],
    shiftSummary: {
      publishedShiftCount: Number(row.published_shift_count),
      scheduledMinutes: Number(row.scheduled_minutes),
      nextShiftStartsAt: row.next_shift_starts_at?.toISOString() ?? null,
    },
  };
}

function toSkillColumn(row: SkillColumnRow): ManagerStaffSkillColumn {
  return {
    id: row.id,
    name: row.name,
    kind: row.item_type,
    status: row.active ? "active" : "inactive",
    requiredSkillIds: row.required_skill_ids,
  };
}

@Injectable()
export class StaffManagementService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  async create(manager: BackofficeIdentity, body: unknown): Promise<ManagerStaffResponse> {
    const input = this.newStaffInput(body);
    const passwordHash = await hashPassword(input.demoPassword);
    const staffId = `staff-${randomUUID()}`;
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "LOCK TABLE backoffice_accounts, staff_members IN SHARE ROW EXCLUSIVE MODE",
      );
      const duplicate = await client.query(
        "SELECT 1 FROM backoffice_accounts WHERE username = $1",
        [input.username],
      );
      if (duplicate.rows[0]) {
        throw new HttpException(
          {
            code: "USERNAME_TAKEN",
            message: "这个演示账号已存在，请换一个账号名。",
            fieldErrors: { username: "演示账号已存在。" },
          },
          HttpStatus.CONFLICT,
        );
      }
      const number = await client.query<{ employee_number: number }>(
        "SELECT coalesce(max(employee_number), 0) + 1 AS employee_number FROM staff_members",
      );
      const employeeNumber = number.rows[0]?.employee_number ?? 1;
      await client.query(
        `
          INSERT INTO backoffice_accounts (
            id, username, display_name, role, password_hash, active
          )
          VALUES ($1, $2, $3, 'staff', $4, true)
        `,
        [staffId, input.username, input.displayName, passwordHash],
      );
      await client.query(
        "INSERT INTO staff_members (id, employee_number, active) VALUES ($1, $2, true)",
        [staffId, employeeNumber],
      );
      for (const skillId of input.skillIds) {
        await client.query("INSERT INTO staff_skills (staff_id, skill_id) VALUES ($1, $2)", [
          staffId,
          skillId,
        ]);
      }
      await this.audits.append(
        {
          eventType: "staff_account_created",
          actor: { type: "manager", id: manager.id },
          subject: { type: "staff", id: staffId },
          payload: {
            username: input.username,
            displayName: input.displayName,
            employeeNumber,
            skillIds: input.skillIds,
          },
          occurredAt: getDemoNow(),
        },
        client,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.read();
  }

  async deactivate(manager: BackofficeIdentity, staffId: string): Promise<ManagerStaffResponse> {
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const staff = await client.query<{ account_active: boolean; staff_active: boolean }>(
        `
          SELECT account.active AS account_active, staff.active AS staff_active
          FROM staff_members AS staff
          JOIN backoffice_accounts AS account ON account.id = staff.id
          WHERE staff.id = $1 AND account.role = 'staff'
          FOR UPDATE OF staff, account
        `,
        [staffId],
      );
      const member = staff.rows[0];
      if (!member) {
        throw new HttpException(
          { code: "STAFF_NOT_FOUND", message: "找不到这个员工账号。" },
          HttpStatus.NOT_FOUND,
        );
      }
      if (!member.account_active || !member.staff_active) {
        throw new HttpException(
          { code: "STAFF_INACTIVE", message: "这个员工账号已经停用。" },
          HttpStatus.CONFLICT,
        );
      }

      // The employee/account lock above is the allocation barrier. Keep this as an MVCC read so
      // reschedule/correction (booking row -> employee) cannot deadlock with deactivation.
      const affected = await client.query<AffectedBookingRow>(
        `
          SELECT id, pet_name_snapshot, primary_service_name_snapshot,
                 staff_display_name_snapshot, starts_at
          FROM bookings
          WHERE staff_id = $1
            AND starts_at > $2
            AND status IN ('confirmed', 'checked_in')
          ORDER BY starts_at, id
        `,
        [staffId, getDemoNow()],
      );
      if (affected.rows.length > 0) {
        throw new HttpException(
          {
            code: "STAFF_HAS_FUTURE_BOOKINGS",
            message: "该员工仍有未来预约，请逐笔换员工、改期或取消后再停用。",
            affectedBookings: affected.rows.map((booking) => ({
              id: booking.id,
              petName: booking.pet_name_snapshot,
              serviceName: booking.primary_service_name_snapshot,
              staffName: booking.staff_display_name_snapshot,
              startsAt: booking.starts_at.toISOString(),
              resolutionPath: `/manager/appointments/${booking.id}`,
            })),
          },
          HttpStatus.CONFLICT,
        );
      }

      await client.query("UPDATE staff_members SET active = false WHERE id = $1", [staffId]);
      await client.query("UPDATE backoffice_accounts SET active = false WHERE id = $1", [staffId]);
      const revoked = await client.query(
        "DELETE FROM backoffice_sessions WHERE account_id = $1 RETURNING token_hash",
        [staffId],
      );
      await this.audits.append(
        {
          eventType: "staff_account_deactivated",
          actor: { type: "manager", id: manager.id },
          subject: { type: "staff", id: staffId },
          payload: { revokedSessionCount: revoked.rowCount ?? 0 },
          occurredAt: getDemoNow(),
        },
        client,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.read();
  }

  async updateSkills(
    manager: BackofficeIdentity,
    staffId: string,
    body: unknown,
  ): Promise<ManagerStaffResponse> {
    const skillIds = this.skillIds(body);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const staff = await client.query<{ active: boolean }>(
        `
          SELECT staff.active
          FROM staff_members AS staff
          JOIN backoffice_accounts AS account ON account.id = staff.id
          WHERE staff.id = $1 AND account.role = 'staff'
          FOR UPDATE OF staff, account
        `,
        [staffId],
      );
      if (!staff.rows[0]) {
        throw new HttpException(
          { code: "STAFF_NOT_FOUND", message: "找不到这个员工账号。" },
          HttpStatus.NOT_FOUND,
        );
      }
      if (!staff.rows[0].active) {
        throw new HttpException(
          { code: "STAFF_INACTIVE", message: "已停用员工不能再修改技能。" },
          HttpStatus.CONFLICT,
        );
      }

      const existing = await client.query<{ skill_id: StaffSkillId }>(
        "SELECT skill_id FROM staff_skills WHERE staff_id = $1 ORDER BY skill_id",
        [staffId],
      );
      const previous = existing.rows.map((row) => row.skill_id);
      const addedSkillIds = skillIds.filter((skill) => !previous.includes(skill));
      const removedSkillIds = previous.filter((skill) => !skillIds.includes(skill));

      if (addedSkillIds.length > 0 || removedSkillIds.length > 0) {
        await client.query("DELETE FROM staff_skills WHERE staff_id = $1", [staffId]);
        for (const skillId of skillIds) {
          await client.query("INSERT INTO staff_skills (staff_id, skill_id) VALUES ($1, $2)", [
            staffId,
            skillId,
          ]);
        }
        await this.audits.append(
          {
            eventType: "staff_skills_updated",
            actor: { type: "manager", id: manager.id },
            subject: { type: "staff", id: staffId },
            payload: { addedSkillIds, removedSkillIds },
            occurredAt: getDemoNow(),
          },
          client,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.read();
  }

  async read(): Promise<ManagerStaffResponse> {
    const startsOn = getShanghaiLocalDate(getDemoNow());
    const endsOn = addLocalDays(startsOn, 13);
    const [staff, skillColumns] = await Promise.all([
      this.database.pool.query<StaffRow>(
        `
          WITH shift_facts AS (
            SELECT day.staff_id,
                   count(DISTINCT shift.id)::text AS published_shift_count,
                   coalesce(sum(
                     extract(epoch FROM (shift.ends_at - shift.starts_at)) / 60
                     - coalesce(breaks.break_minutes, 0)
                   ), 0)::int::text AS scheduled_minutes,
                   min(
                     (day.local_date + shift.starts_at) AT TIME ZONE 'Asia/Shanghai'
                   ) FILTER (
                     WHERE (day.local_date + shift.starts_at) AT TIME ZONE 'Asia/Shanghai' >= $3
                   ) AS next_shift_starts_at
            FROM staff_schedule_days AS day
            JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
            LEFT JOIN LATERAL (
              SELECT sum(extract(epoch FROM (item.ends_at - item.starts_at)) / 60) AS break_minutes
              FROM staff_schedule_breaks AS item
              WHERE item.schedule_shift_id = shift.id
            ) AS breaks ON true
            WHERE day.local_date BETWEEN $1 AND $2
              AND day.publication_status = 'published'
              AND day.published_at IS NOT NULL
            GROUP BY day.staff_id
          ), skill_facts AS (
            SELECT staff_id, array_agg(skill_id ORDER BY skill_id) AS skill_ids
            FROM staff_skills
            GROUP BY staff_id
          )
          SELECT staff.id, account.username, account.display_name, staff.employee_number,
                 account.active AS account_active, staff.active AS staff_active,
                 skills.skill_ids,
                 coalesce(shifts.published_shift_count, '0') AS published_shift_count,
                 coalesce(shifts.scheduled_minutes, '0') AS scheduled_minutes,
                 shifts.next_shift_starts_at
          FROM staff_members AS staff
          JOIN backoffice_accounts AS account ON account.id = staff.id
          LEFT JOIN skill_facts AS skills ON skills.staff_id = staff.id
          LEFT JOIN shift_facts AS shifts ON shifts.staff_id = staff.id
          ORDER BY staff.employee_number, staff.id
        `,
        [startsOn, endsOn, getDemoNow()],
      ),
      this.database.pool.query<SkillColumnRow>(
        `
          SELECT id, name, item_type, active, required_skill_ids
          FROM service_catalog_items
          ORDER BY item_type DESC, display_order, created_at, id
        `,
      ),
    ]);

    return {
      staff: staff.rows.map(toStaff),
      skillColumns: skillColumns.rows.map(toSkillColumn),
    };
  }

  private skillIds(body: unknown): StaffSkillId[] {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      this.validationError("请求内容必须是员工技能对象。");
    }
    const value = (body as { skillIds?: unknown }).skillIds;
    if (
      !Array.isArray(value) ||
      value.some((skill) => typeof skill !== "string" || !skillValues.has(skill as StaffSkillId))
    ) {
      this.validationError("员工技能必须来自当前主要服务或增项的技能列表。");
    }
    return [...new Set(value as StaffSkillId[])].sort();
  }

  private newStaffInput(body: unknown): NewStaffInput {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      this.validationError("请求内容必须是员工账号对象。");
    }
    const input = body as Record<string, unknown>;
    const fieldErrors: Record<string, string> = {};
    const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) {
      fieldErrors.username = "演示账号须为 3–32 位小写字母、数字、点、横线或下划线。";
    }
    const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
    if (!displayName || displayName.length > 40) {
      fieldErrors.displayName = "员工姓名为必填项，且不能超过 40 个字。";
    }
    const demoPassword = typeof input.demoPassword === "string" ? input.demoPassword : "";
    if (demoPassword.length < 10 || demoPassword.length > 200) {
      fieldErrors.demoPassword = "演示密码须为 10–200 个字符。";
    }
    let skillIds: StaffSkillId[] = [];
    try {
      skillIds = this.skillIds(body);
    } catch {
      fieldErrors.skillIds = "员工技能必须来自当前主要服务或增项的技能列表。";
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new HttpException(
        { code: "VALIDATION_ERROR", message: "请检查员工账号信息后重试。", fieldErrors },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { username, displayName, demoPassword, skillIds };
  }

  private validationError(message: string): never {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message, fieldErrors: { skillIds: message } },
      HttpStatus.BAD_REQUEST,
    );
  }
}
