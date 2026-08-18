import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  CapacityChangeAffectedBooking,
  CapacityChangeCreateResponse,
  CapacityChangeInput,
  CapacityChangePreviewResponse,
  ManagerCapacityChangeOptionsResponse,
} from "@rongguang/contracts";
import type { Pool, PoolClient } from "pg";

import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import {
  addLocalDays,
  getLocalWeekday,
  getShanghaiLocalDate,
  isLocalDate,
} from "./schedule-date.js";
import { ScheduleService } from "./schedule.service.js";

type DatabaseConnection = Pool | PoolClient;

interface StaffRow {
  id: string;
  display_name: string;
  employee_number: number;
}

interface BusinessHoursRow {
  opens_at: string | null;
  closes_at: string | null;
}

interface ScheduleIntervalRow {
  staff_id: string;
  shift_id: string;
  shift_starts_at: string;
  shift_ends_at: string;
  break_id: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface AffectedBookingRow {
  id: string;
  verification_code_version: number;
  status: CapacityChangeAffectedBooking["status"];
  customer_display_name: string;
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  staff_id: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
  ends_at: Date;
  occupancy_ends_at: Date;
}

interface ShiftBuilder {
  staffId: string;
  startsAt: number;
  endsAt: number;
  breaks: Map<string, { startsAt: number; endsAt: number }>;
}

interface ParsedCapacityChange extends CapacityChangeInput {
  kind: "time_off" | "store_closure";
  staffId?: string;
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const identifierPattern = /^[a-z0-9][a-z0-9-]{1,79}$/;

function clockMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function validationError(fieldErrors: Record<string, string>): never {
  throw new HttpException(
    { code: "VALIDATION_ERROR", message: "请检查容量变化信息。", fieldErrors },
    HttpStatus.BAD_REQUEST,
  );
}

function parseInput(body: unknown): ParsedCapacityChange {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    validationError({ form: "请求内容必须是容量变化对象。" });
  }

  const value = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const kind = value.kind;
  const staffId = typeof value.staffId === "string" ? value.staffId.trim() : undefined;
  const localDate = typeof value.localDate === "string" ? value.localDate.trim() : "";
  const startsAt = typeof value.startsAt === "string" ? value.startsAt.trim() : "";
  const endsAt = typeof value.endsAt === "string" ? value.endsAt.trim() : "";
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";

  if (kind !== "time_off" && kind !== "store_closure") {
    fieldErrors.kind = "请选择员工停班或门店临时闭店。";
  }
  if (kind === "time_off" && (!staffId || !identifierPattern.test(staffId))) {
    fieldErrors.staffId = "员工停班必须选择有效员工。";
  }
  if (kind === "store_closure" && staffId) {
    fieldErrors.staffId = "临时闭店是门店整体事实，不能指定员工。";
  }
  if (!isLocalDate(localDate)) {
    fieldErrors.localDate = "请选择有效日期。";
  }
  if (!timePattern.test(startsAt)) {
    fieldErrors.startsAt = "开始时间须使用 HH:MM 格式。";
  }
  if (!timePattern.test(endsAt)) {
    fieldErrors.endsAt = "结束时间须使用 HH:MM 格式。";
  }
  if (timePattern.test(startsAt) && timePattern.test(endsAt) && endsAt <= startsAt) {
    fieldErrors.endsAt = "结束时间必须晚于开始时间；区间采用左闭右开语义。";
  }
  if (reason.length < 1 || reason.length > 200) {
    fieldErrors.reason = "原因须填写 1–200 个字符。";
  }

  const startsOn = getShanghaiLocalDate(getDemoNow());
  const endsOn = addLocalDays(startsOn, 13);
  if (isLocalDate(localDate) && (localDate < startsOn || localDate > endsOn)) {
    fieldErrors.localDate = `只能选择 ${startsOn} 至 ${endsOn} 的已发布排班。`;
  }

  if (Object.keys(fieldErrors).length > 0) validationError(fieldErrors);

  return {
    kind: kind as ParsedCapacityChange["kind"],
    ...(staffId ? { staffId } : {}),
    localDate,
    startsAt,
    endsAt,
    reason,
  };
}

function overlapMinutes(
  leftStartsAt: number,
  leftEndsAt: number,
  rightStartsAt: number,
  rightEndsAt: number,
): number {
  return Math.max(0, Math.min(leftEndsAt, rightEndsAt) - Math.max(leftStartsAt, rightStartsAt));
}

@Injectable()
export class CapacityChangeService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

  async options(): Promise<ManagerCapacityChangeOptionsResponse> {
    const selectedDate = getShanghaiLocalDate(getDemoNow());
    const schedule = await this.schedules.getPublishedSchedule(selectedDate);

    return {
      timeZone: schedule.timeZone,
      demoNow: schedule.demoNow,
      window: schedule.window,
      staff: schedule.staffDays.map((day) => ({
        id: day.staff.id,
        displayName: day.staff.displayName,
        employeeNumber: day.staff.employeeNumber,
      })),
    };
  }

  async preview(body: unknown): Promise<CapacityChangePreviewResponse> {
    const input = parseInput(body);
    return this.analyze(input, this.database.pool, false);
  }

  async create(manager: BackofficeIdentity, body: unknown): Promise<CapacityChangeCreateResponse> {
    const input = parseInput(body);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const preview = await this.analyze(input, client, true);
      const id = `${input.kind === "time_off" ? "time-off" : "store-closure"}-${randomUUID()}`;
      const createdAt = getDemoNow();
      const status = preview.outcome;
      const snapshot = JSON.stringify(preview.affectedBookings);

      if (input.kind === "time_off") {
        await client.query(
          `INSERT INTO staff_time_off_intervals (
             id, staff_id, local_date, starts_at, ends_at, status, reason,
             created_by, target_capacity_minutes, affected_booking_count,
             impact_snapshot, created_at, activated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
          [
            id,
            input.staffId,
            input.localDate,
            input.startsAt,
            input.endsAt,
            status,
            input.reason,
            manager.id,
            preview.targetCapacityMinutes,
            preview.affectedBookingCount,
            snapshot,
            createdAt,
            status === "active" ? createdAt : null,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO store_closure_intervals (
             id, local_date, starts_at, ends_at, status, reason,
             created_by, target_capacity_minutes, affected_booking_count,
             impact_snapshot, created_at, activated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
          [
            id,
            input.localDate,
            input.startsAt,
            input.endsAt,
            status,
            input.reason,
            manager.id,
            preview.targetCapacityMinutes,
            preview.affectedBookingCount,
            snapshot,
            createdAt,
            status === "active" ? createdAt : null,
          ],
        );
      }

      const subjectType = input.kind === "time_off" ? "staff_time_off" : "store_closure";
      await this.audits.append(
        {
          eventType: "capacity_change_created",
          actor: { type: "manager", id: manager.id },
          subject: { type: subjectType, id },
          payload: {
            kind: input.kind,
            staffId: input.staffId ?? null,
            localDate: input.localDate,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            reason: input.reason,
            targetCapacityMinutes: preview.targetCapacityMinutes,
            affectedBookingCount: preview.affectedBookingCount,
          },
          occurredAt: createdAt,
        },
        client,
      );
      await this.audits.append(
        {
          eventType: "capacity_change_status_changed",
          actor: { type: "manager", id: manager.id },
          subject: { type: subjectType, id },
          payload: { previousStatus: null, status },
          occurredAt: new Date(Date.parse(createdAt) + 1).toISOString(),
        },
        client,
      );
      await client.query("COMMIT");

      return {
        change: { id, kind: input.kind, ...preview, status, createdAt },
        nextStep: {
          label: status === "pending" ? "查看待处理区间" : "查看按员工日历",
          href: `/manager/appointments/calendar?date=${input.localDate}`,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async analyze(
    input: ParsedCapacityChange,
    connection: DatabaseConnection,
    lockStaff: boolean,
  ): Promise<CapacityChangePreviewResponse> {
    const staffResult = await connection.query<StaffRow>(
      `SELECT staff.id, account.display_name, staff.employee_number
       FROM staff_members AS staff
       JOIN backoffice_accounts AS account ON account.id = staff.id
       WHERE staff.active = true
         AND account.active = true
         AND ($1::text = 'store_closure' OR staff.id = $2)
       ORDER BY staff.id
       ${lockStaff ? "FOR UPDATE OF staff" : ""}`,
      [input.kind, input.staffId ?? null],
    );
    if (input.kind === "time_off" && staffResult.rows.length !== 1) {
      throw new HttpException(
        { code: "STAFF_NOT_FOUND", message: "所选员工不存在或已停用。" },
        HttpStatus.NOT_FOUND,
      );
    }

    const hoursResult = await connection.query<BusinessHoursRow>(
      `SELECT to_char(opens_at, 'HH24:MI') AS opens_at,
              to_char(closes_at, 'HH24:MI') AS closes_at
       FROM store_business_hours
       WHERE weekday = $1`,
      [getLocalWeekday(input.localDate)],
    );
    const hours = hoursResult.rows[0];
    if (
      !hours?.opens_at ||
      !hours.closes_at ||
      input.startsAt < hours.opens_at.slice(0, 5) ||
      input.endsAt > hours.closes_at.slice(0, 5)
    ) {
      validationError({
        interval: "容量变化区间必须完整落在当日门店营业时间内。",
      });
    }

    const staffIds = staffResult.rows.map((staff) => staff.id);
    const scheduleResult = await connection.query<ScheduleIntervalRow>(
      `SELECT day.staff_id, shift.id AS shift_id,
              to_char(shift.starts_at, 'HH24:MI') AS shift_starts_at,
              to_char(shift.ends_at, 'HH24:MI') AS shift_ends_at,
              shift_break.id AS break_id,
              to_char(shift_break.starts_at, 'HH24:MI') AS break_starts_at,
              to_char(shift_break.ends_at, 'HH24:MI') AS break_ends_at
       FROM staff_schedule_days AS day
       JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
       LEFT JOIN staff_schedule_breaks AS shift_break ON shift_break.schedule_shift_id = shift.id
       WHERE day.local_date = $1::date
         AND day.publication_status = 'published'
         AND day.published_at IS NOT NULL
         AND day.staff_id = ANY($2::text[])
       ORDER BY day.staff_id, shift.starts_at, shift_break.starts_at`,
      [input.localDate, staffIds],
    );
    const shifts = new Map<string, ShiftBuilder>();
    for (const row of scheduleResult.rows) {
      let shift = shifts.get(row.shift_id);
      if (!shift) {
        shift = {
          staffId: row.staff_id,
          startsAt: clockMinutes(row.shift_starts_at),
          endsAt: clockMinutes(row.shift_ends_at),
          breaks: new Map(),
        };
        shifts.set(row.shift_id, shift);
      }
      if (row.break_id && row.break_starts_at && row.break_ends_at) {
        shift.breaks.set(row.break_id, {
          startsAt: clockMinutes(row.break_starts_at),
          endsAt: clockMinutes(row.break_ends_at),
        });
      }
    }

    const targetStartsAt = clockMinutes(input.startsAt);
    const targetEndsAt = clockMinutes(input.endsAt);
    if (
      input.kind === "time_off" &&
      ![...shifts.values()].some(
        (shift) => shift.startsAt <= targetStartsAt && shift.endsAt >= targetEndsAt,
      )
    ) {
      validationError({ interval: "员工停班区间必须完整落在该员工的已发布班次内。" });
    }
    const targetCapacityMinutes = [...shifts.values()].reduce((total, shift) => {
      const shiftOverlap = overlapMinutes(
        shift.startsAt,
        shift.endsAt,
        targetStartsAt,
        targetEndsAt,
      );
      const breakOverlap = [...shift.breaks.values()].reduce(
        (breakTotal, shiftBreak) =>
          breakTotal +
          overlapMinutes(shiftBreak.startsAt, shiftBreak.endsAt, targetStartsAt, targetEndsAt),
        0,
      );
      return total + Math.max(0, shiftOverlap - breakOverlap);
    }, 0);
    if (targetCapacityMinutes === 0) {
      validationError({ interval: "所选区间没有已发布容量，请调整日期或时间。" });
    }

    const affectedResult = await connection.query<AffectedBookingRow>(
      `SELECT booking.id, booking.verification_code_version, booking.status,
              customer.display_name AS customer_display_name,
              booking.pet_name_snapshot, booking.primary_service_name_snapshot,
              booking.staff_id, booking.staff_display_name_snapshot,
              booking.starts_at, booking.ends_at, booking.occupancy_ends_at
       FROM bookings AS booking
       JOIN customers AS customer ON customer.id = booking.customer_id
       WHERE booking.status IN ('confirmed', 'checked_in')
         AND ($1::text = 'store_closure' OR booking.staff_id = $2)
         AND booking.occupancy_starts_at < (($3::date + $5::time) AT TIME ZONE 'Asia/Shanghai')
         AND booking.occupancy_ends_at > (($3::date + $4::time) AT TIME ZONE 'Asia/Shanghai')
       ORDER BY booking.starts_at, booking.id`,
      [input.kind, input.staffId ?? null, input.localDate, input.startsAt, input.endsAt],
    );
    const affectedBookings = affectedResult.rows.map<CapacityChangeAffectedBooking>((booking) => ({
      id: booking.id,
      revision: booking.verification_code_version,
      status: booking.status,
      customerName: booking.customer_display_name,
      petName: booking.pet_name_snapshot,
      serviceName: booking.primary_service_name_snapshot,
      staff: { id: booking.staff_id, displayName: booking.staff_display_name_snapshot },
      startsAt: booking.starts_at.toISOString(),
      endsAt: booking.ends_at.toISOString(),
      turnoverEndsAt: booking.occupancy_ends_at.toISOString(),
    }));
    const targetStaff = input.kind === "time_off" ? staffResult.rows[0] : null;
    const outcome = affectedBookings.length > 0 ? "pending" : "active";

    return {
      target: {
        kind: input.kind,
        label:
          input.kind === "time_off"
            ? `${targetStaff?.display_name ?? "所选员工"}停班`
            : "门店临时闭店",
        staff: targetStaff ? { id: targetStaff.id, displayName: targetStaff.display_name } : null,
      },
      interval: {
        localDate: input.localDate,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
      reason: input.reason,
      targetCapacityMinutes,
      affectedBookingCount: affectedBookings.length,
      affectedBookings,
      outcome,
      consequence:
        outcome === "pending"
          ? "确认后该区间立即停止接受新预约；已有预约保持原员工、时段和状态，等待逐笔处理。"
          : "没有受影响预约；确认后容量变化将直接生效。",
    };
  }
}
