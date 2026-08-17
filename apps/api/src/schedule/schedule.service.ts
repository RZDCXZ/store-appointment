import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ManagerPublishedScheduleResponse,
  PublishedScheduleShift,
  ScheduleBusinessHours,
  StaffSkillId,
} from "@rongguang/contracts";

import { getDemoNow } from "../config/environment.js";
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
  skills: StaffSkillId[];
}

interface ScheduleRow {
  staff_id: string;
  source: "weekly_template" | "date_exception";
  exception_kind: "adjusted_shift" | "special_break" | "day_off" | null;
  exception_note: string | null;
  shift_id: string | null;
  shift_starts_at: string | null;
  shift_ends_at: string | null;
  break_id: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface PublishedCountRow {
  local_date: string;
  staff_count: string;
}

interface CountRow {
  count: string;
}

interface ShiftBuilder {
  staffId: string;
  id: string;
  startsAt: string;
  endsAt: string;
  breaks: Map<string, { startsAt: string; endsAt: string }>;
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

function subtractBreaks(shift: ShiftBuilder): PublishedScheduleShift {
  const breaks = [...shift.breaks.values()].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt),
  );
  const capacity: PublishedScheduleShift["capacity"] = [];
  let cursor = shift.startsAt;

  for (const shiftBreak of breaks) {
    if (shiftBreak.endsAt <= cursor || shiftBreak.startsAt >= shift.endsAt) {
      continue;
    }

    const breakStartsAt =
      shiftBreak.startsAt < shift.startsAt ? shift.startsAt : shiftBreak.startsAt;
    const breakEndsAt = shiftBreak.endsAt > shift.endsAt ? shift.endsAt : shiftBreak.endsAt;

    if (breakStartsAt > cursor) {
      capacity.push({ startsAt: cursor, endsAt: breakStartsAt });
    }

    if (breakEndsAt > cursor) {
      cursor = breakEndsAt;
    }
  }

  if (cursor < shift.endsAt) {
    capacity.push({ startsAt: cursor, endsAt: shift.endsAt });
  }

  return {
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    breaks,
    capacity,
  };
}

@Injectable()
export class ScheduleService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getPublishedSchedule(date?: string): Promise<ManagerPublishedScheduleResponse> {
    const demoNow = getDemoNow();
    const startsOn = getShanghaiLocalDate(demoNow);
    const endsOn = addLocalDays(startsOn, 13);
    const selectedDate = date ?? startsOn;

    if (!isLocalDate(selectedDate)) {
      throw new HttpException(
        { code: "INVALID_SCHEDULE_DATE", message: "排班日期必须使用 YYYY-MM-DD 格式。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (selectedDate < startsOn || selectedDate > endsOn) {
      throw new HttpException(
        {
          code: "OUTSIDE_SCHEDULE_WINDOW",
          message: `只能查看 ${startsOn} 至 ${endsOn} 的十四日已发布排班。`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

      const businessHoursResult = await client.query<BusinessHoursRow>(
        `
              SELECT weekday,
                     to_char(opens_at, 'HH24:MI') AS opens_at,
                     to_char(closes_at, 'HH24:MI') AS closes_at
              FROM store_business_hours
              ORDER BY weekday
            `,
      );
      const staffResult = await client.query<StaffRow>(
        `
              SELECT staff.id,
                     account.display_name,
                     staff.employee_number,
                     array_agg(
                       skill.skill_id
                       ORDER BY CASE skill.skill_id
                         WHEN 'dog-basic-care' THEN 1
                         WHEN 'dog-styling' THEN 2
                         WHEN 'cat-care' THEN 3
                         WHEN 'nail-care' THEN 4
                         WHEN 'deshedding-care' THEN 5
                         WHEN 'oral-care' THEN 6
                       END
                     ) AS skills
              FROM staff_members AS staff
              JOIN backoffice_accounts AS account ON account.id = staff.id
              JOIN staff_skills AS skill ON skill.staff_id = staff.id
              WHERE staff.active = true AND account.active = true
              GROUP BY staff.id, account.display_name, staff.employee_number
              ORDER BY staff.employee_number
            `,
      );
      const schedulesResult = await client.query<ScheduleRow>(
        `
              SELECT day.staff_id,
                     day.source,
                     day.exception_kind,
                     day.exception_note,
                     shift.id AS shift_id,
                     to_char(shift.starts_at, 'HH24:MI') AS shift_starts_at,
                     to_char(shift.ends_at, 'HH24:MI') AS shift_ends_at,
                     shift_break.id AS break_id,
                     to_char(shift_break.starts_at, 'HH24:MI') AS break_starts_at,
                     to_char(shift_break.ends_at, 'HH24:MI') AS break_ends_at
              FROM staff_schedule_days AS day
              LEFT JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
              LEFT JOIN staff_schedule_breaks AS shift_break ON shift_break.schedule_shift_id = shift.id
              WHERE day.local_date = $1
                AND day.publication_status = 'published'
                AND day.published_at IS NOT NULL
              ORDER BY day.staff_id, shift.starts_at, shift_break.starts_at
            `,
        [selectedDate],
      );
      const countsResult = await client.query<PublishedCountRow>(
        `
              SELECT to_char(day.local_date, 'YYYY-MM-DD') AS local_date,
                     count(DISTINCT day.staff_id)::text AS staff_count
              FROM staff_schedule_days AS day
              JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
              WHERE day.local_date BETWEEN $1 AND $2
                AND day.publication_status = 'published'
                AND day.published_at IS NOT NULL
              GROUP BY day.local_date
              ORDER BY day.local_date
            `,
        [startsOn, endsOn],
      );
      const draftResult = await client.query<CountRow>(
        `
              SELECT count(DISTINCT local_date)::text AS count
              FROM staff_schedule_days
              WHERE local_date BETWEEN $1 AND $2
                AND publication_status = 'draft'
            `,
        [startsOn, endsOn],
      );

      await client.query("COMMIT");

      const businessHoursByWeekday = new Map(
        businessHoursResult.rows.map((row) => [row.weekday, row]),
      );
      const countsByDate = new Map(
        countsResult.rows.map((row) => [row.local_date, Number(row.staff_count)]),
      );
      const scheduleMetadata = new Map<
        string,
        Pick<ScheduleRow, "source" | "exception_kind" | "exception_note">
      >();
      const shiftBuilders = new Map<string, ShiftBuilder>();

      for (const row of schedulesResult.rows) {
        scheduleMetadata.set(row.staff_id, row);

        if (!row.shift_id || !row.shift_starts_at || !row.shift_ends_at) {
          continue;
        }

        let builder = shiftBuilders.get(row.shift_id);

        if (!builder) {
          builder = {
            staffId: row.staff_id,
            id: row.shift_id,
            startsAt: row.shift_starts_at,
            endsAt: row.shift_ends_at,
            breaks: new Map(),
          };
          shiftBuilders.set(row.shift_id, builder);
        }

        if (row.break_id && row.break_starts_at && row.break_ends_at) {
          builder.breaks.set(row.break_id, {
            startsAt: row.break_starts_at,
            endsAt: row.break_ends_at,
          });
        }
      }

      const staffDays = staffResult.rows.map((staff) => {
        const metadata = scheduleMetadata.get(staff.id);
        const shifts = [...shiftBuilders.values()]
          .filter((shift) => shift.staffId === staff.id)
          .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
          .map(subtractBreaks);

        return {
          staff: {
            id: staff.id,
            displayName: staff.display_name,
            employeeNumber: staff.employee_number,
            skills: staff.skills,
          },
          scheduleStatus: shifts.length > 0 ? ("published" as const) : ("no_schedule" as const),
          source: metadata?.source ?? null,
          exception:
            metadata?.exception_kind && metadata.exception_note
              ? { kind: metadata.exception_kind, note: metadata.exception_note }
              : null,
          shifts,
        };
      });
      const windowDays = Array.from({ length: 14 }, (_, index) => {
        const windowDate = addLocalDays(startsOn, index);
        const weekday = getLocalWeekday(windowDate);

        return {
          date: windowDate,
          weekday,
          businessHours: toBusinessHours(businessHoursByWeekday.get(weekday)),
          publishedStaffCount: countsByDate.get(windowDate) ?? 0,
        };
      });
      const selectedWeekday = getLocalWeekday(selectedDate);

      return {
        timeZone: "Asia/Shanghai",
        demoNow,
        selectedDate,
        window: { startsOn, endsOn, days: windowDays },
        businessHours: toBusinessHours(businessHoursByWeekday.get(selectedWeekday)),
        draftDayCount: Number(draftResult.rows[0]?.count ?? 0),
        staffDays,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
