import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  CapacityChangeAffectedBooking,
  CapacityChangeCreateResponse,
  CapacityChangeDetailResponse,
  CapacityChangeFact,
  CapacityChangeInput,
  CapacityChangeKind,
  CapacityChangePreviewResponse,
  CapacityChangeResolution,
  CapacityChangeStatus,
  ManagerCapacityChangeOptionsResponse,
  RevokeCapacityChangeResponse,
  ResolveCapacityChangeBookingResponse,
} from "@rongguang/contracts";
import type { Pool, PoolClient } from "pg";

import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { BookingService } from "../booking/booking.service.js";
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

interface CapacityChangeDetailRow {
  id: string;
  staff_id: string | null;
  staff_display_name: string | null;
  local_date: string;
  starts_at: string;
  ends_at: string;
  status: CapacityChangeStatus;
  reason: string;
  target_capacity_minutes: number;
  affected_booking_count: number;
  impact_snapshot: CapacityChangeAffectedBooking[];
  created_at: Date;
}

interface CapacityChangeResolutionRow {
  id: string;
  booking_id: string;
  action: CapacityChangeResolution["action"];
  manager_id: string;
  manager_display_name: string;
  reason: string;
  result_summary: CapacityChangeResolution["result"];
  booking_event_id: string;
  resolved_at: Date;
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

function parseRevocationReason(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    validationError({ form: "请求内容必须是撤销信息对象。" });
  }
  const reason =
    typeof (body as Record<string, unknown>).reason === "string"
      ? ((body as Record<string, unknown>).reason as string).trim()
      : "";
  if (reason.length < 2 || reason.length > 120) {
    validationError({ reason: "撤销原因须填写 2–120 个字符。" });
  }
  return reason;
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
    @Inject(BookingService) private readonly bookings: BookingService,
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
          label: status === "pending" ? "处理受影响预约" : "查看按员工日历",
          href:
            status === "pending"
              ? `/manager/schedule/capacity-changes/${input.kind}/${id}`
              : `/manager/appointments/calendar?date=${input.localDate}`,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async detail(kind: string, id: string): Promise<CapacityChangeDetailResponse> {
    const normalizedKind = this.requireKind(kind);
    const change = await this.findChange(normalizedKind, id);
    const resolutionResult = await this.database.pool.query<CapacityChangeResolutionRow>(
      `SELECT resolution.id,
              resolution.booking_id,
              resolution.action,
              resolution.manager_id,
              account.display_name AS manager_display_name,
              resolution.reason,
              resolution.result_summary,
              resolution.booking_event_id,
              resolution.resolved_at
       FROM capacity_change_booking_resolutions AS resolution
       JOIN backoffice_accounts AS account ON account.id = resolution.manager_id
       WHERE ($1::text = 'time_off' AND resolution.staff_time_off_id = $2
         OR $1::text = 'store_closure' AND resolution.store_closure_id = $2)
       ORDER BY resolution.resolved_at, resolution.id`,
      [normalizedKind, id],
    );
    const resolutions = new Map(
      resolutionResult.rows.map((row) => [
        row.booking_id,
        {
          id: row.id,
          action: row.action,
          operator: { id: row.manager_id, displayName: row.manager_display_name },
          reason: row.reason,
          result: row.result_summary,
          bookingEventId: row.booking_event_id,
          resolvedAt: row.resolved_at.toISOString(),
        } satisfies CapacityChangeResolution,
      ]),
    );

    const impactedBookings = await Promise.all(
      change.impact_snapshot.map(async (impact) => {
        const resolution = resolutions.get(impact.id) ?? null;
        if (resolution || change.status !== "pending") {
          return {
            ...impact,
            bookingRevision: impact.revision,
            sameTimeStaffCandidates: [],
            rescheduleSuggestions: [],
            cancelNotificationPreview: {
              kind: "booking_cancelled" as const,
              recipient: impact.customerName,
              message: `将向${impact.customerName}生成${impact.petName}的预约取消通知。`,
            },
            resolution,
          };
        }

        const options = await this.bookings.managerRescheduleOptions(impact.id);
        const slots =
          options.availability?.days.flatMap((day) =>
            day.slots.map((slot) => ({
              date: day.date,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              staff: { id: slot.staff.id, displayName: slot.staff.displayName },
            })),
          ) ?? [];
        const candidateOptions = await Promise.all(
          (options.availability?.staffOptions ?? [])
            .filter((staff) => staff.id !== impact.staff.id)
            .map((staff) => this.bookings.managerRescheduleOptions(impact.id, staff.id)),
        );
        const sameTimeStaffCandidates = [
          ...new Map(
            candidateOptions.flatMap(
              (candidate) =>
                candidate.availability?.days.flatMap((day) =>
                  day.slots
                    .filter((slot) => slot.startsAt === impact.startsAt)
                    .map(
                      (slot) =>
                        [
                          slot.staff.id,
                          { id: slot.staff.id, displayName: slot.staff.displayName },
                        ] as const,
                    ),
                ) ?? [],
            ),
          ).values(),
        ];

        return {
          ...impact,
          bookingRevision: impact.revision,
          sameTimeStaffCandidates,
          rescheduleSuggestions: slots.slice(0, 5),
          cancelNotificationPreview: {
            kind: "booking_cancelled" as const,
            recipient: impact.customerName,
            message: `将向${impact.customerName}生成${impact.petName}的预约取消通知。`,
          },
          resolution,
        };
      }),
    );

    return {
      change: this.changeFact(normalizedKind, change),
      progress: { resolved: resolutions.size, total: change.affected_booking_count },
      impactedBookings,
      canRevoke: normalizedKind === "time_off" && change.status === "pending",
    };
  }

  async resolve(
    manager: BackofficeIdentity,
    kind: string,
    id: string,
    bookingId: string,
    body: unknown,
  ): Promise<ResolveCapacityChangeBookingResponse> {
    const normalizedKind = this.requireKind(kind);
    const applied = await this.bookings.resolveCapacityChangeImpact(
      manager,
      normalizedKind,
      id,
      bookingId,
      body,
    );
    const detail = await this.detail(normalizedKind, id);
    return {
      change: detail.change,
      progress: detail.progress,
      resolvedBooking: applied.resolution,
    };
  }

  async revoke(
    manager: BackofficeIdentity,
    kind: string,
    id: string,
    body: unknown,
  ): Promise<RevokeCapacityChangeResponse> {
    const normalizedKind = this.requireKind(kind);
    if (normalizedKind !== "time_off") {
      throw new HttpException(
        {
          code: "CAPACITY_CHANGE_REVOCATION_NOT_ALLOWED",
          message: "临时闭店不能在此撤销，请处理完全部受影响预约。",
        },
        HttpStatus.CONFLICT,
      );
    }
    const reason = parseRevocationReason(body);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: CapacityChangeStatus }>(
        `SELECT status
         FROM staff_time_off_intervals
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const current = locked.rows[0];
      if (!current) {
        throw new HttpException(
          { code: "CAPACITY_CHANGE_NOT_FOUND", message: "找不到这项容量变化。" },
          HttpStatus.NOT_FOUND,
        );
      }
      if (current.status !== "pending") {
        throw new HttpException(
          {
            code: "CAPACITY_CHANGE_REVOCATION_NOT_ALLOWED",
            message: "只有尚未处理完成的员工停班可以撤销。",
          },
          HttpStatus.CONFLICT,
        );
      }

      const revokedAt = getDemoNow();
      await client.query(
        `UPDATE staff_time_off_intervals
         SET status = 'cancelled',
             cancelled_at = $2,
             cancelled_by = $3,
             cancellation_reason = $4
         WHERE id = $1`,
        [id, revokedAt, manager.id, reason],
      );
      await this.audits.append(
        {
          eventType: "capacity_change_revoked",
          actor: { type: "manager", id: manager.id },
          subject: { type: "staff_time_off", id },
          payload: { previousStatus: current.status, reason },
          occurredAt: revokedAt,
        },
        client,
      );
      await this.audits.append(
        {
          eventType: "capacity_change_status_changed",
          actor: { type: "manager", id: manager.id },
          subject: { type: "staff_time_off", id },
          payload: { previousStatus: current.status, status: "cancelled" },
          occurredAt: new Date(Date.parse(revokedAt) + 1).toISOString(),
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

    const detail = await this.detail(normalizedKind, id);
    return {
      change: { ...detail.change, status: "cancelled" },
      retainedResolutions: detail.impactedBookings.flatMap((booking) =>
        booking.resolution ? [{ ...booking.resolution, bookingId: booking.id }] : [],
      ),
    };
  }

  private requireKind(kind: string): CapacityChangeKind {
    if (kind !== "time_off" && kind !== "store_closure") {
      throw new HttpException(
        { code: "CAPACITY_CHANGE_NOT_FOUND", message: "找不到这项容量变化。" },
        HttpStatus.NOT_FOUND,
      );
    }
    return kind;
  }

  private async findChange(kind: CapacityChangeKind, id: string): Promise<CapacityChangeDetailRow> {
    const result = await this.database.pool.query<CapacityChangeDetailRow>(
      kind === "time_off"
        ? `SELECT time_off.id,
                  time_off.staff_id,
                  account.display_name AS staff_display_name,
                  to_char(time_off.local_date, 'YYYY-MM-DD') AS local_date,
                  to_char(time_off.starts_at, 'HH24:MI') AS starts_at,
                  to_char(time_off.ends_at, 'HH24:MI') AS ends_at,
                  time_off.status,
                  time_off.reason,
                  time_off.target_capacity_minutes,
                  time_off.affected_booking_count,
                  time_off.impact_snapshot,
                  time_off.created_at
           FROM staff_time_off_intervals AS time_off
           JOIN backoffice_accounts AS account ON account.id = time_off.staff_id
           WHERE time_off.id = $1`
        : `SELECT closure.id,
                  NULL::text AS staff_id,
                  NULL::text AS staff_display_name,
                  to_char(closure.local_date, 'YYYY-MM-DD') AS local_date,
                  to_char(closure.starts_at, 'HH24:MI') AS starts_at,
                  to_char(closure.ends_at, 'HH24:MI') AS ends_at,
                  closure.status,
                  closure.reason,
                  closure.target_capacity_minutes,
                  closure.affected_booking_count,
                  closure.impact_snapshot,
                  closure.created_at
           FROM store_closure_intervals AS closure
           WHERE closure.id = $1`,
      [id],
    );
    const change = result.rows[0];
    if (!change) {
      throw new HttpException(
        { code: "CAPACITY_CHANGE_NOT_FOUND", message: "找不到这项容量变化。" },
        HttpStatus.NOT_FOUND,
      );
    }
    return change;
  }

  private changeFact(kind: CapacityChangeKind, row: CapacityChangeDetailRow): CapacityChangeFact {
    return {
      id: row.id,
      kind,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      target: {
        kind,
        label: kind === "time_off" ? `${row.staff_display_name ?? "所选员工"}停班` : "门店临时闭店",
        staff:
          row.staff_id && row.staff_display_name
            ? { id: row.staff_id, displayName: row.staff_display_name }
            : null,
      },
      interval: {
        localDate: row.local_date,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      },
      reason: row.reason,
      targetCapacityMinutes: row.target_capacity_minutes,
      affectedBookingCount: row.affected_booking_count,
      affectedBookings: row.impact_snapshot,
      outcome: row.affected_booking_count > 0 ? "pending" : "active",
      consequence:
        row.status === "cancelled"
          ? "待处理停班已撤销；已经成立的预约处理结果保持不变。"
          : row.status === "active"
            ? "全部受影响预约已经处理，容量变化已正式生效。"
            : "该区间已停止接受新预约；全部受影响预约处理完成后才会正式生效。",
    };
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
