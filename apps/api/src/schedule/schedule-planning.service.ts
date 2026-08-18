import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  EditableScheduleShift,
  ManagerSchedulePlanningResponse,
  ManagerSchedulePublishResponse,
  ScheduleBusinessHours,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import { getDemoNow } from "../config/environment.js";
import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { DatabaseService } from "../database/database.service.js";
import {
  addLocalDays,
  getLocalWeekday,
  getShanghaiLocalDate,
  isLocalDate,
} from "./schedule-date.js";

interface BusinessHoursRow {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
}

interface StaffRow {
  id: string;
  display_name: string;
  employee_number: number;
}

interface TemplateRow {
  staff_id: string;
  weekday: number;
  shift_id: string;
  shift_starts_at: string;
  shift_ends_at: string;
  break_id: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface DraftRow {
  local_date: string;
  staff_id: string;
  source: "weekly_template" | "date_exception";
  exception_kind: "adjusted_shift" | "overtime" | "special_break" | "day_off" | null;
  exception_note: string | null;
  shift_id: string | null;
  shift_starts_at: string | null;
  shift_ends_at: string | null;
  break_id: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface ShiftBuilder {
  startsAt: string;
  endsAt: string;
  breaks: Map<string, { startsAt: string; endsAt: string }>;
}

interface AffectedBookingRow {
  id: string;
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
  ends_at: Date;
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(value: string): number {
  const [hours = "0", minute = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minute);
}

function validationError(message: string): never {
  throw new HttpException(
    { code: "VALIDATION_ERROR", message, fieldErrors: { shifts: message } },
    HttpStatus.BAD_REQUEST,
  );
}

function parseShifts(body: unknown, businessHours: ScheduleBusinessHours): EditableScheduleShift[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    validationError("请求内容必须是排班对象。");
  }
  const value = (body as { shifts?: unknown }).shifts;
  if (!Array.isArray(value) || value.length > 4) {
    validationError("每天须提供 0–4 个班次。");
  }

  const shifts = value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      validationError("每个班次都须包含有效开始、结束与休息区间。");
    }
    const shift = item as { startsAt?: unknown; endsAt?: unknown; breaks?: unknown };
    if (
      typeof shift.startsAt !== "string" ||
      typeof shift.endsAt !== "string" ||
      !timePattern.test(shift.startsAt) ||
      !timePattern.test(shift.endsAt) ||
      minutes(shift.endsAt) <= minutes(shift.startsAt) ||
      !Array.isArray(shift.breaks)
    ) {
      validationError("班次与休息须使用有效的 HH:MM 时间，且结束晚于开始。");
    }
    const startsAt = shift.startsAt;
    const endsAt = shift.endsAt;

    const breaks = shift.breaks.map((itemBreak) => {
      if (typeof itemBreak !== "object" || itemBreak === null || Array.isArray(itemBreak)) {
        validationError("休息区间格式无效。");
      }
      const interval = itemBreak as { startsAt?: unknown; endsAt?: unknown };
      if (
        typeof interval.startsAt !== "string" ||
        typeof interval.endsAt !== "string" ||
        !timePattern.test(interval.startsAt) ||
        !timePattern.test(interval.endsAt) ||
        minutes(interval.startsAt) < minutes(startsAt) ||
        minutes(interval.endsAt) > minutes(endsAt) ||
        minutes(interval.endsAt) <= minutes(interval.startsAt)
      ) {
        validationError("休息必须完整落在所属班次内，且结束晚于开始。");
      }
      return { startsAt: interval.startsAt, endsAt: interval.endsAt };
    });
    breaks.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    if (
      breaks.some((itemBreak, index) => index > 0 && itemBreak.startsAt < breaks[index - 1]!.endsAt)
    ) {
      validationError("同一班次内的休息区间不能重叠。");
    }

    return { startsAt, endsAt, breaks };
  });
  shifts.sort((left, right) => left.startsAt.localeCompare(right.startsAt));

  if (businessHours.status === "closed" && shifts.length > 0) {
    validationError("闭店日不能设置员工班次。");
  }
  if (
    businessHours.status === "open" &&
    shifts.some(
      (shift) => shift.startsAt < businessHours.opensAt! || shift.endsAt > businessHours.closesAt!,
    )
  ) {
    validationError("班次不能超出门店营业时间。");
  }
  if (shifts.some((shift, index) => index > 0 && shift.startsAt < shifts[index - 1]!.endsAt)) {
    validationError("同一员工当天的班次不能重叠。");
  }

  return shifts;
}

type ScheduleExceptionKind = "adjusted_shift" | "overtime" | "special_break" | "day_off";

function parseException(
  body: unknown,
  businessHours: ScheduleBusinessHours,
): {
  kind: ScheduleExceptionKind;
  note: string;
  shifts: EditableScheduleShift[];
} {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    validationError("请求内容必须是具体日期排班对象。");
  }
  const input = body as { kind?: unknown; note?: unknown };
  const kinds = new Set<ScheduleExceptionKind>([
    "adjusted_shift",
    "overtime",
    "special_break",
    "day_off",
  ]);
  if (typeof input.kind !== "string" || !kinds.has(input.kind as ScheduleExceptionKind)) {
    validationError("请选择调班、加班、休息或当天休息例外。");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (!note || note.length > 200) {
    validationError("日期例外说明为必填项，且不能超过 200 个字。");
  }
  const shifts = parseShifts(body, businessHours);
  if (input.kind === "day_off" && shifts.length > 0) {
    validationError("当天休息例外不能包含班次。");
  }
  if (input.kind !== "day_off" && shifts.length === 0) {
    validationError("调班、加班或休息例外至少需要一个有效班次。");
  }
  if (input.kind === "special_break" && !shifts.some((shift) => shift.breaks.length > 0)) {
    validationError("休息例外至少需要一个有效休息区间。");
  }

  return { kind: input.kind as ScheduleExceptionKind, note, shifts };
}

function assertWindowDate(date: string, startsOn: string, endsOn: string): void {
  if (!isLocalDate(date)) {
    throw new HttpException(
      { code: "INVALID_SCHEDULE_DATE", message: "排班日期必须使用 YYYY-MM-DD 格式。" },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (date < startsOn || date > endsOn) {
    throw new HttpException(
      { code: "OUTSIDE_SCHEDULE_WINDOW", message: `只能维护 ${startsOn} 至 ${endsOn} 的排班。` },
      HttpStatus.BAD_REQUEST,
    );
  }
}

function publishSelection(
  body: unknown,
  startsOn: string,
  endsOn: string,
): {
  dates: string[];
  staffIds: string[];
} {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    validationError("请求内容必须包含待发布日期与员工。");
  }
  const input = body as { dates?: unknown; staffIds?: unknown };
  if (
    !Array.isArray(input.dates) ||
    input.dates.length === 0 ||
    input.dates.some((date) => typeof date !== "string") ||
    !Array.isArray(input.staffIds) ||
    input.staffIds.length === 0 ||
    input.staffIds.some((staffId) => typeof staffId !== "string")
  ) {
    validationError("至少选择一个待发布日期和一名员工。");
  }
  const dates = [...new Set(input.dates as string[])].sort();
  const staffIds = [...new Set(input.staffIds as string[])].sort();
  dates.forEach((date) => assertWindowDate(date, startsOn, endsOn));
  return { dates, staffIds };
}

function toBusinessHours(row: BusinessHoursRow | undefined): ScheduleBusinessHours {
  if (!row?.opens_at || !row.closes_at) {
    return { status: "closed", opensAt: null, closesAt: null };
  }

  return {
    status: "open",
    opensAt: row.opens_at.slice(0, 5),
    closesAt: row.closes_at.slice(0, 5),
  };
}

function addShiftRow(
  builders: Map<string, ShiftBuilder>,
  row: {
    shift_id: string | null;
    shift_starts_at: string | null;
    shift_ends_at: string | null;
    break_id: string | null;
    break_starts_at: string | null;
    break_ends_at: string | null;
  },
): void {
  if (!row.shift_id || !row.shift_starts_at || !row.shift_ends_at) return;

  let shift = builders.get(row.shift_id);
  if (!shift) {
    shift = {
      startsAt: row.shift_starts_at,
      endsAt: row.shift_ends_at,
      breaks: new Map(),
    };
    builders.set(row.shift_id, shift);
  }

  if (row.break_id && row.break_starts_at && row.break_ends_at) {
    shift.breaks.set(row.break_id, {
      startsAt: row.break_starts_at,
      endsAt: row.break_ends_at,
    });
  }
}

function finishShifts(builders: Map<string, ShiftBuilder>): EditableScheduleShift[] {
  return [...builders.values()]
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .map((shift) => ({
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      breaks: [...shift.breaks.values()].sort((left, right) =>
        left.startsAt.localeCompare(right.startsAt),
      ),
    }));
}

async function insertScheduleShifts(
  client: PoolClient,
  scheduleDayId: string,
  shifts: EditableScheduleShift[],
  publicationStatus: "draft" | "published",
): Promise<void> {
  for (const shift of shifts) {
    const shiftId = `${publicationStatus}-shift-${randomUUID()}`;
    await client.query(
      `INSERT INTO staff_schedule_shifts (id, schedule_day_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4)`,
      [shiftId, scheduleDayId, shift.startsAt, shift.endsAt],
    );
    for (const shiftBreak of shift.breaks) {
      await client.query(
        `INSERT INTO staff_schedule_breaks (id, schedule_shift_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4)`,
        [
          `${publicationStatus}-break-${randomUUID()}`,
          shiftId,
          shiftBreak.startsAt,
          shiftBreak.endsAt,
        ],
      );
    }
  }
}

@Injectable()
export class SchedulePlanningService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  async updateTemplate(
    manager: BackofficeIdentity,
    staffId: string,
    weekdayValue: string,
    body: unknown,
  ): Promise<ManagerSchedulePlanningResponse> {
    const weekday = Number(weekdayValue);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new HttpException(
        { code: "INVALID_WEEKDAY", message: "星期必须是 0–6。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const staff = await client.query(
        `SELECT staff.id FROM staff_members AS staff
         JOIN backoffice_accounts AS account ON account.id = staff.id
         WHERE staff.id = $1 AND staff.active = true AND account.active = true
         FOR UPDATE OF staff`,
        [staffId],
      );
      if (!staff.rows[0]) {
        throw new HttpException(
          { code: "STAFF_NOT_FOUND", message: "没有找到可排班的员工。" },
          HttpStatus.NOT_FOUND,
        );
      }
      const hours = await client.query<BusinessHoursRow>(
        `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens_at,
                to_char(closes_at, 'HH24:MI') AS closes_at
         FROM store_business_hours WHERE weekday = $1`,
        [weekday],
      );
      const shifts = parseShifts(body, toBusinessHours(hours.rows[0]));

      await client.query(
        "DELETE FROM weekly_shift_templates WHERE staff_id = $1 AND weekday = $2",
        [staffId, weekday],
      );
      for (const shift of shifts) {
        const templateId = `template-${randomUUID()}`;
        await client.query(
          `INSERT INTO weekly_shift_templates (id, staff_id, weekday, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [templateId, staffId, weekday, shift.startsAt, shift.endsAt],
        );
        for (const shiftBreak of shift.breaks) {
          await client.query(
            `INSERT INTO weekly_shift_template_breaks
               (id, template_id, starts_at, ends_at)
             VALUES ($1, $2, $3, $4)`,
            [`template-break-${randomUUID()}`, templateId, shiftBreak.startsAt, shiftBreak.endsAt],
          );
        }
      }
      await this.audits.append(
        {
          eventType: "schedule_template_updated",
          actor: { type: "manager", id: manager.id },
          subject: { type: "schedule_template", id: `${staffId}:${weekday}` },
          payload: { staffId, weekday, shifts },
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

  async generateDrafts(manager: BackofficeIdentity): Promise<ManagerSchedulePlanningResponse> {
    const startsOn = getShanghaiLocalDate(getDemoNow());
    const endsOn = addLocalDays(startsOn, 13);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const staff = await client.query<StaffRow>(
        `SELECT staff.id, account.display_name, staff.employee_number
           FROM staff_members AS staff
           JOIN backoffice_accounts AS account ON account.id = staff.id
           WHERE staff.active = true AND account.active = true
           ORDER BY staff.employee_number, staff.id
           FOR UPDATE OF staff`,
      );
      const hours = await client.query<BusinessHoursRow>(
        `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens_at,
                  to_char(closes_at, 'HH24:MI') AS closes_at
           FROM store_business_hours ORDER BY weekday`,
      );
      const templates = await client.query<TemplateRow>(
        `SELECT template.staff_id, template.weekday, template.id AS shift_id,
                  to_char(template.starts_at, 'HH24:MI') AS shift_starts_at,
                  to_char(template.ends_at, 'HH24:MI') AS shift_ends_at,
                  template_break.id AS break_id,
                  to_char(template_break.starts_at, 'HH24:MI') AS break_starts_at,
                  to_char(template_break.ends_at, 'HH24:MI') AS break_ends_at
           FROM weekly_shift_templates AS template
           LEFT JOIN weekly_shift_template_breaks AS template_break
             ON template_break.template_id = template.id
           WHERE template.active = true
           ORDER BY template.staff_id, template.weekday, template.starts_at,
                    template_break.starts_at`,
      );
      const openWeekdays = new Set(
        hours.rows
          .filter((row) => row.opens_at !== null && row.closes_at !== null)
          .map((row) => row.weekday),
      );
      const templateBuilders = new Map<string, Map<string, ShiftBuilder>>();
      for (const row of templates.rows) {
        const key = `${row.staff_id}:${row.weekday}`;
        const builders = templateBuilders.get(key) ?? new Map<string, ShiftBuilder>();
        addShiftRow(builders, row);
        templateBuilders.set(key, builders);
      }

      await client.query(
        `DELETE FROM staff_schedule_days
         WHERE publication_status = 'draft' AND local_date BETWEEN $1 AND $2`,
        [startsOn, endsOn],
      );

      for (let offset = 0; offset < 14; offset += 1) {
        const date = addLocalDays(startsOn, offset);
        const weekday = getLocalWeekday(date);
        for (const member of staff.rows) {
          const dayId = `draft-${randomUUID()}`;
          await client.query(
            `INSERT INTO staff_schedule_days
               (id, staff_id, local_date, publication_status, source, published_at)
             VALUES ($1, $2, $3, 'draft', 'weekly_template', NULL)`,
            [dayId, member.id, date],
          );

          const shifts = openWeekdays.has(weekday)
            ? finishShifts(
                templateBuilders.get(`${member.id}:${weekday}`) ?? new Map<string, ShiftBuilder>(),
              )
            : [];
          await insertScheduleShifts(client, dayId, shifts, "draft");
        }
      }

      await this.audits.append(
        {
          eventType: "schedule_drafts_generated",
          actor: { type: "manager", id: manager.id },
          subject: { type: "schedule_draft", id: `${startsOn}:${endsOn}` },
          payload: { startsOn, endsOn, dayCount: 14, staffCount: staff.rows.length },
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

  async updateDraft(
    manager: BackofficeIdentity,
    staffId: string,
    date: string,
    body: unknown,
  ): Promise<ManagerSchedulePlanningResponse> {
    const startsOn = getShanghaiLocalDate(getDemoNow());
    const endsOn = addLocalDays(startsOn, 13);
    assertWindowDate(date, startsOn, endsOn);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const staff = await client.query(
        `SELECT staff.id FROM staff_members AS staff
         JOIN backoffice_accounts AS account ON account.id = staff.id
         WHERE staff.id = $1 AND staff.active = true AND account.active = true
         FOR UPDATE OF staff`,
        [staffId],
      );
      if (!staff.rows[0]) {
        throw new HttpException(
          { code: "STAFF_NOT_FOUND", message: "没有找到可排班的员工。" },
          HttpStatus.NOT_FOUND,
        );
      }
      const draft = await client.query<{ id: string }>(
        `SELECT id FROM staff_schedule_days
         WHERE staff_id = $1 AND local_date = $2 AND publication_status = 'draft'
         FOR UPDATE`,
        [staffId, date],
      );
      if (!draft.rows[0]) {
        throw new HttpException(
          { code: "SCHEDULE_DRAFT_NOT_FOUND", message: "请先从模板生成十四天草稿。" },
          HttpStatus.NOT_FOUND,
        );
      }
      const weekday = getLocalWeekday(date);
      const hours = await client.query<BusinessHoursRow>(
        `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens_at,
                to_char(closes_at, 'HH24:MI') AS closes_at
         FROM store_business_hours WHERE weekday = $1`,
        [weekday],
      );
      const input = parseException(body, toBusinessHours(hours.rows[0]));

      await client.query("DELETE FROM staff_schedule_shifts WHERE schedule_day_id = $1", [
        draft.rows[0].id,
      ]);
      await client.query(
        `UPDATE staff_schedule_days
         SET source = 'date_exception', exception_kind = $2, exception_note = $3
         WHERE id = $1`,
        [draft.rows[0].id, input.kind, input.note],
      );
      await insertScheduleShifts(client, draft.rows[0].id, input.shifts, "draft");
      await this.audits.append(
        {
          eventType: "schedule_draft_updated",
          actor: { type: "manager", id: manager.id },
          subject: { type: "schedule_draft", id: `${staffId}:${date}` },
          payload: { staffId, date, ...input },
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

  async publishDrafts(
    manager: BackofficeIdentity,
    body: unknown,
  ): Promise<ManagerSchedulePublishResponse> {
    const startsOn = getShanghaiLocalDate(getDemoNow());
    const endsOn = addLocalDays(startsOn, 13);
    const selection = publishSelection(body, startsOn, endsOn);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const staff = await client.query<{ id: string }>(
        `SELECT staff.id FROM staff_members AS staff
         JOIN backoffice_accounts AS account ON account.id = staff.id
         WHERE staff.id = ANY($1::text[]) AND staff.active = true AND account.active = true
         ORDER BY staff.id FOR UPDATE OF staff`,
        [selection.staffIds],
      );
      if (staff.rows.length !== selection.staffIds.length) {
        throw new HttpException(
          { code: "STAFF_NOT_FOUND", message: "待发布草稿中包含不可排班的员工。" },
          HttpStatus.NOT_FOUND,
        );
      }
      const drafts = await client.query<{ id: string }>(
        `SELECT id FROM staff_schedule_days
         WHERE publication_status = 'draft'
           AND local_date = ANY($1::date[])
           AND staff_id = ANY($2::text[])
         ORDER BY local_date, staff_id FOR UPDATE`,
        [selection.dates, selection.staffIds],
      );
      const expectedCount = selection.dates.length * selection.staffIds.length;
      if (drafts.rows.length !== expectedCount) {
        throw new HttpException(
          {
            code: "SCHEDULE_DRAFT_NOT_FOUND",
            message: "所选员工与日期必须都有排班草稿，请重新生成后再发布。",
          },
          HttpStatus.NOT_FOUND,
        );
      }

      const affectedBookings = await this.affectedBookings(
        client,
        selection.dates,
        selection.staffIds,
        "draft",
      );
      if (affectedBookings.length > 0) {
        throw new HttpException(
          {
            code: "SCHEDULE_CHANGE_AFFECTS_BOOKINGS",
            message: "这次发布会影响已有预约，请先进入容量变更流程逐笔处理。",
            impactSummary: {
              affectedBookingCount: affectedBookings.length,
              dates: selection.dates,
              staffIds: selection.staffIds,
            },
            affectedBookings: affectedBookings.map((booking) => ({
              id: booking.id,
              petName: booking.pet_name_snapshot,
              serviceName: booking.primary_service_name_snapshot,
              staffName: booking.staff_display_name_snapshot,
              startsAt: booking.starts_at.toISOString(),
              endsAt: booking.ends_at.toISOString(),
              resolutionPath: `/manager/appointments/${booking.id}`,
            })),
          },
          HttpStatus.CONFLICT,
        );
      }

      await client.query(
        `DELETE FROM staff_schedule_days
         WHERE publication_status = 'published'
           AND local_date = ANY($1::date[])
           AND staff_id = ANY($2::text[])`,
        [selection.dates, selection.staffIds],
      );
      await client.query(
        `UPDATE staff_schedule_days
         SET publication_status = 'published', published_at = $3
         WHERE publication_status = 'draft'
           AND local_date = ANY($1::date[])
           AND staff_id = ANY($2::text[])`,
        [selection.dates, selection.staffIds, getDemoNow()],
      );
      await this.audits.append(
        {
          eventType: "schedule_published",
          actor: { type: "manager", id: manager.id },
          subject: {
            type: "published_schedule",
            id: `${selection.dates[0]}:${selection.dates.at(-1)}`,
          },
          payload: { ...selection, publishedCount: expectedCount },
          occurredAt: getDemoNow(),
        },
        client,
      );
      await client.query("COMMIT");
      return { publishedCount: expectedCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePublishedException(
    manager: BackofficeIdentity,
    staffId: string,
    date: string,
    body: unknown,
  ): Promise<{ updated: true }> {
    const startsOn = getShanghaiLocalDate(getDemoNow());
    const endsOn = addLocalDays(startsOn, 13);
    assertWindowDate(date, startsOn, endsOn);
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const staff = await client.query(
        `SELECT staff.id FROM staff_members AS staff
         JOIN backoffice_accounts AS account ON account.id = staff.id
         WHERE staff.id = $1 AND staff.active = true AND account.active = true
         FOR UPDATE OF staff`,
        [staffId],
      );
      if (!staff.rows[0]) {
        throw new HttpException(
          { code: "STAFF_NOT_FOUND", message: "没有找到可排班的员工。" },
          HttpStatus.NOT_FOUND,
        );
      }
      const published = await client.query<{ id: string }>(
        `SELECT id FROM staff_schedule_days
         WHERE staff_id = $1 AND local_date = $2
           AND publication_status = 'published' AND published_at IS NOT NULL
         FOR UPDATE`,
        [staffId, date],
      );
      const weekday = getLocalWeekday(date);
      const hours = await client.query<BusinessHoursRow>(
        `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens_at,
                to_char(closes_at, 'HH24:MI') AS closes_at
         FROM store_business_hours WHERE weekday = $1`,
        [weekday],
      );
      const input = parseException(body, toBusinessHours(hours.rows[0]));
      const scheduleDayId = published.rows[0]?.id ?? `published-${randomUUID()}`;

      if (!published.rows[0]) {
        await client.query(
          `INSERT INTO staff_schedule_days
             (id, staff_id, local_date, publication_status, source,
              exception_kind, exception_note, published_at)
           VALUES ($1, $2, $3, 'published', 'date_exception', $4, $5, $6)`,
          [scheduleDayId, staffId, date, input.kind, input.note, getDemoNow()],
        );
      }

      await client.query("DELETE FROM staff_schedule_shifts WHERE schedule_day_id = $1", [
        scheduleDayId,
      ]);
      await client.query(
        `UPDATE staff_schedule_days
         SET source = 'date_exception', exception_kind = $2, exception_note = $3
         WHERE id = $1`,
        [scheduleDayId, input.kind, input.note],
      );
      await insertScheduleShifts(client, scheduleDayId, input.shifts, "published");

      const affectedBookings = await this.affectedBookings(client, [date], [staffId], "published");
      if (affectedBookings.length > 0) {
        throw new HttpException(
          {
            code: "SCHEDULE_CHANGE_AFFECTS_BOOKINGS",
            message: "这个日期例外会影响已有预约，请先进入容量变更流程逐笔处理。",
            impactSummary: {
              affectedBookingCount: affectedBookings.length,
              dates: [date],
              staffIds: [staffId],
            },
            affectedBookings: affectedBookings.map((booking) => ({
              id: booking.id,
              petName: booking.pet_name_snapshot,
              serviceName: booking.primary_service_name_snapshot,
              staffName: booking.staff_display_name_snapshot,
              startsAt: booking.starts_at.toISOString(),
              endsAt: booking.ends_at.toISOString(),
              resolutionPath: `/manager/appointments/${booking.id}`,
            })),
          },
          HttpStatus.CONFLICT,
        );
      }

      await this.audits.append(
        {
          eventType: "schedule_exception_updated",
          actor: { type: "manager", id: manager.id },
          subject: { type: "published_schedule", id: `${staffId}:${date}` },
          payload: { staffId, date, ...input },
          occurredAt: getDemoNow(),
        },
        client,
      );
      await client.query("COMMIT");
      return { updated: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async affectedBookings(
    client: PoolClient,
    dates: string[],
    staffIds: string[],
    publicationStatus: "draft" | "published",
  ): Promise<AffectedBookingRow[]> {
    const result = await client.query<AffectedBookingRow>(
      `SELECT booking.id, booking.pet_name_snapshot,
              booking.primary_service_name_snapshot,
              booking.staff_display_name_snapshot,
              booking.starts_at, booking.ends_at
       FROM bookings AS booking
       WHERE booking.status IN ('confirmed', 'checked_in')
         AND booking.staff_id = ANY($2::text[])
         AND (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date = ANY($1::date[])
         AND NOT EXISTS (
           SELECT 1
           FROM staff_schedule_days AS day
           JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
           WHERE day.staff_id = booking.staff_id
             AND day.local_date = (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date
             AND day.publication_status = $3
             AND booking.occupancy_starts_at >=
               ((day.local_date + shift.starts_at) AT TIME ZONE 'Asia/Shanghai')
             AND booking.occupancy_ends_at <=
               ((day.local_date + shift.ends_at) AT TIME ZONE 'Asia/Shanghai')
             AND NOT EXISTS (
               SELECT 1
               FROM staff_schedule_breaks AS shift_break
               WHERE shift_break.schedule_shift_id = shift.id
                 AND booking.occupancy_starts_at <
                   ((day.local_date + shift_break.ends_at) AT TIME ZONE 'Asia/Shanghai')
                 AND booking.occupancy_ends_at >
                   ((day.local_date + shift_break.starts_at) AT TIME ZONE 'Asia/Shanghai')
             )
         )
       ORDER BY booking.starts_at, booking.id`,
      [dates, staffIds, publicationStatus],
    );
    return result.rows;
  }

  async read(): Promise<ManagerSchedulePlanningResponse> {
    const demoNow = getDemoNow();
    const startsOn = getShanghaiLocalDate(demoNow);
    const endsOn = addLocalDays(startsOn, 13);
    const [businessHours, staff, templates, drafts] = await Promise.all([
      this.database.pool.query<BusinessHoursRow>(
        `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens_at,
                to_char(closes_at, 'HH24:MI') AS closes_at
         FROM store_business_hours ORDER BY weekday`,
      ),
      this.database.pool.query<StaffRow>(
        `SELECT staff.id, account.display_name, staff.employee_number
         FROM staff_members AS staff
         JOIN backoffice_accounts AS account ON account.id = staff.id
         WHERE staff.active = true AND account.active = true
         ORDER BY staff.employee_number, staff.id`,
      ),
      this.database.pool.query<TemplateRow>(
        `SELECT template.staff_id, template.weekday, template.id AS shift_id,
                to_char(template.starts_at, 'HH24:MI') AS shift_starts_at,
                to_char(template.ends_at, 'HH24:MI') AS shift_ends_at,
                template_break.id AS break_id,
                to_char(template_break.starts_at, 'HH24:MI') AS break_starts_at,
                to_char(template_break.ends_at, 'HH24:MI') AS break_ends_at
         FROM weekly_shift_templates AS template
         LEFT JOIN weekly_shift_template_breaks AS template_break
           ON template_break.template_id = template.id
         WHERE template.active = true
         ORDER BY template.staff_id, template.weekday, template.starts_at,
                  template_break.starts_at`,
      ),
      this.database.pool.query<DraftRow>(
        `SELECT to_char(day.local_date, 'YYYY-MM-DD') AS local_date,
                day.staff_id, day.source, day.exception_kind, day.exception_note,
                shift.id AS shift_id,
                to_char(shift.starts_at, 'HH24:MI') AS shift_starts_at,
                to_char(shift.ends_at, 'HH24:MI') AS shift_ends_at,
                shift_break.id AS break_id,
                to_char(shift_break.starts_at, 'HH24:MI') AS break_starts_at,
                to_char(shift_break.ends_at, 'HH24:MI') AS break_ends_at
         FROM staff_schedule_days AS day
         LEFT JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
         LEFT JOIN staff_schedule_breaks AS shift_break ON shift_break.schedule_shift_id = shift.id
         WHERE day.publication_status = 'draft'
           AND day.local_date BETWEEN $1 AND $2
         ORDER BY day.local_date, day.staff_id, shift.starts_at, shift_break.starts_at`,
        [startsOn, endsOn],
      ),
    ]);

    const hoursByWeekday = new Map(businessHours.rows.map((row) => [row.weekday, row]));
    const templateBuilders = new Map<string, Map<string, ShiftBuilder>>();
    for (const row of templates.rows) {
      const key = `${row.staff_id}:${row.weekday}`;
      const builders = templateBuilders.get(key) ?? new Map<string, ShiftBuilder>();
      addShiftRow(builders, row);
      templateBuilders.set(key, builders);
    }

    const draftBuilders = new Map<string, Map<string, ShiftBuilder>>();
    const draftMetadata = new Map<string, DraftRow>();
    for (const row of drafts.rows) {
      const key = `${row.local_date}:${row.staff_id}`;
      const builders = draftBuilders.get(key) ?? new Map<string, ShiftBuilder>();
      addShiftRow(builders, row);
      draftBuilders.set(key, builders);
      draftMetadata.set(key, row);
    }

    const draftDates = [...new Set(drafts.rows.map((row) => row.local_date))];

    return {
      timeZone: "Asia/Shanghai",
      demoNow,
      window: { startsOn, endsOn },
      staff: staff.rows.map((member) => ({
        id: member.id,
        displayName: member.display_name,
        employeeNumber: member.employee_number,
        templateDays: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          businessHours: toBusinessHours(hoursByWeekday.get(weekday)),
          shifts: finishShifts(
            templateBuilders.get(`${member.id}:${weekday}`) ?? new Map<string, ShiftBuilder>(),
          ),
        })),
      })),
      draftDays: draftDates.map((date) => ({
        date,
        weekday: getLocalWeekday(date),
        businessHours: toBusinessHours(hoursByWeekday.get(getLocalWeekday(date))),
        staffDays: staff.rows.flatMap((member) => {
          const key = `${date}:${member.id}`;
          const metadata = draftMetadata.get(key);
          if (!metadata) return [];

          return [
            {
              staffId: member.id,
              status: "draft" as const,
              source: metadata.source,
              exception:
                metadata.exception_kind && metadata.exception_note
                  ? { kind: metadata.exception_kind, note: metadata.exception_note }
                  : null,
              shifts: finishShifts(draftBuilders.get(key) ?? new Map<string, ShiftBuilder>()),
            },
          ];
        }),
      })),
    };
  }
}
