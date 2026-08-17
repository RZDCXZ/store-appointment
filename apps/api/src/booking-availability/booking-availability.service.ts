import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { quoteBookingSelection } from "@rongguang/contracts";
import type {
  BookingAvailabilityDay,
  BookingAvailabilityReason,
  BookingAvailabilityResponse,
  BookingSelectionQuote,
  PetSize,
  StaffSkillId,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { addLocalDays, getLocalWeekday } from "../schedule/schedule-date.js";
import { ServiceCatalogService } from "../service-catalog/service-catalog.service.js";
import {
  bookingWindowFor,
  discoverDayAvailability,
  earliestCandidateMinutesForDate,
  earliestCustomerCandidate,
  subtractAvailabilityIntervals,
  type AvailabilityBooking,
  type AvailabilityInterval,
  type AvailabilityStaff,
  type StaffPreference,
} from "./availability.js";

interface DiscoveryInput {
  customerId: string;
  petId?: string;
  primaryServiceId?: string;
  addonIds?: string;
  staffId?: string;
}

interface PetRow {
  id: string;
  name: string;
  species: "dog" | "cat";
  weight_kg: string;
  archived_at: Date | null;
}

interface StaffRow {
  id: string;
  display_name: string;
  employee_number: number;
  skills: StaffSkillId[];
}

interface BusinessHoursRow {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
}

interface ScheduleRow {
  local_date: string;
  staff_id: string;
  shift_id: string;
  shift_starts_at: string;
  shift_ends_at: string;
  break_id: string | null;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface BookingRow {
  local_date: string;
  pet_id: string;
  staff_id: string;
  starts_at_minutes: number;
  ends_at_minutes: number;
  occupancy_starts_at_minutes: number;
  occupancy_ends_at_minutes: number;
  service_minutes: number;
}

interface CapacityBlockRow {
  local_date: string;
  starts_at: string;
  ends_at: string;
}

interface StaffCapacityBlockRow extends CapacityBlockRow {
  staff_id: string;
}

interface ShiftBuilder {
  localDate: string;
  staffId: string;
  startsAtMinutes: number;
  endsAtMinutes: number;
  breaks: Map<string, AvailabilityInterval>;
}

const reasonLabels: Record<BookingAvailabilityReason, string> = {
  closed: "周一闭店",
  no_qualified_staff: "暂无合格员工",
  fully_booked: "已约满",
  outside_open_window: "超出开放窗口",
};

function selectionError(message: string): never {
  throw new HttpException({ code: "INVALID_BOOKING_SELECTION", message }, HttpStatus.BAD_REQUEST);
}

function requiredId(value: string | undefined, label: string): string {
  if (!value || value.length > 80) {
    selectionError(`请选择有效的${label}。`);
  }
  return value;
}

function parseAddonIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const addonIds = value.split(",");
  if (
    addonIds.length > 3 ||
    addonIds.some((id) => !id || id.length > 80) ||
    new Set(addonIds).size !== addonIds.length
  ) {
    selectionError("增项选择无效，请重新选择。");
  }
  return addonIds;
}

function petSizeFor(weightKg: number): PetSize {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function subtractBreaks(shift: ShiftBuilder): AvailabilityInterval[] {
  const capacity: AvailabilityInterval[] = [];
  const breaks = [...shift.breaks.values()].sort(
    (left, right) => left.startsAtMinutes - right.startsAtMinutes,
  );
  let cursor = shift.startsAtMinutes;

  for (const shiftBreak of breaks) {
    if (shiftBreak.endsAtMinutes <= cursor || shiftBreak.startsAtMinutes >= shift.endsAtMinutes) {
      continue;
    }

    const startsAtMinutes = Math.max(shiftBreak.startsAtMinutes, shift.startsAtMinutes);
    const endsAtMinutes = Math.min(shiftBreak.endsAtMinutes, shift.endsAtMinutes);

    if (startsAtMinutes > cursor) {
      capacity.push({ startsAtMinutes: cursor, endsAtMinutes: startsAtMinutes });
    }
    cursor = Math.max(cursor, endsAtMinutes);
  }

  if (cursor < shift.endsAtMinutes) {
    capacity.push({ startsAtMinutes: cursor, endsAtMinutes: shift.endsAtMinutes });
  }
  return capacity;
}

function localInstant(localDate: string, minuteOfDay: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hours - 8, minutes),
  ).toISOString();
}

function hasAllSkills(staff: StaffRow, requiredSkills: StaffSkillId[]): boolean {
  const skills = new Set(staff.skills);
  return requiredSkills.every((skill) => skills.has(skill));
}

@Injectable()
export class BookingAvailabilityService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ServiceCatalogService) private readonly catalog: ServiceCatalogService,
  ) {}

  async discover(
    input: DiscoveryInput,
    existingClient?: PoolClient,
  ): Promise<BookingAvailabilityResponse> {
    const petId = requiredId(input.petId, "宠物");
    const primaryServiceId = requiredId(input.primaryServiceId, "主要服务");
    const addonIds = parseAddonIds(input.addonIds);
    const staffId = input.staffId ? requiredId(input.staffId, "员工") : null;
    const demoNow = getDemoNow();
    const window = bookingWindowFor(demoNow);
    const earliestStartsAt = earliestCustomerCandidate(demoNow);
    const client = existingClient ?? (await this.database.pool.connect());
    const ownsClient = !existingClient;

    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const petResult = await client.query<PetRow>(
        `
          SELECT id, name, species, weight_kg::text, archived_at
          FROM pets
          WHERE id = $1 AND customer_id = $2
        `,
        [petId, input.customerId],
      );
      const pet = petResult.rows[0];

      if (!pet) {
        throw new HttpException(
          { code: "PET_NOT_FOUND", message: "找不到这份宠物档案，或当前顾客无权访问。" },
          HttpStatus.NOT_FOUND,
        );
      }
      if (pet.archived_at) {
        throw new HttpException(
          { code: "PET_ARCHIVED", message: "已归档宠物不能用于新预约，请先恢复使用。" },
          HttpStatus.CONFLICT,
        );
      }

      const selection = this.quote(pet, primaryServiceId, addonIds);
      const staffResult = await client.query<StaffRow>(
        `
            SELECT staff.id,
                   account.display_name,
                   staff.employee_number,
                   array_agg(skill.skill_id ORDER BY skill.skill_id) AS skills
            FROM staff_members AS staff
            JOIN backoffice_accounts AS account ON account.id = staff.id
            JOIN staff_skills AS skill ON skill.staff_id = staff.id
            WHERE staff.active = true AND account.active = true
            GROUP BY staff.id, account.display_name, staff.employee_number
            ORDER BY staff.employee_number
          `,
      );
      const businessHoursResult = await client.query<BusinessHoursRow>(
        `
            SELECT weekday,
                   to_char(opens_at, 'HH24:MI') AS opens_at,
                   to_char(closes_at, 'HH24:MI') AS closes_at
            FROM store_business_hours
            ORDER BY weekday
          `,
      );
      const scheduleResult = await client.query<ScheduleRow>(
        `
            SELECT to_char(day.local_date, 'YYYY-MM-DD') AS local_date,
                   day.staff_id,
                   shift.id AS shift_id,
                   to_char(shift.starts_at, 'HH24:MI') AS shift_starts_at,
                   to_char(shift.ends_at, 'HH24:MI') AS shift_ends_at,
                   shift_break.id AS break_id,
                   to_char(shift_break.starts_at, 'HH24:MI') AS break_starts_at,
                   to_char(shift_break.ends_at, 'HH24:MI') AS break_ends_at
            FROM staff_schedule_days AS day
            JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
            LEFT JOIN staff_schedule_breaks AS shift_break ON shift_break.schedule_shift_id = shift.id
            WHERE day.local_date BETWEEN $1 AND $2
              AND day.publication_status = 'published'
              AND day.published_at IS NOT NULL
            ORDER BY day.local_date, day.staff_id, shift.starts_at, shift_break.starts_at
          `,
        [window.startsOn, window.endsOn],
      );
      const bookingResult = await client.query<BookingRow>(
        `
            SELECT to_char(starts_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS local_date,
                   pet_id,
                   staff_id,
                   (
                     extract(hour FROM starts_at AT TIME ZONE 'Asia/Shanghai') * 60
                     + extract(minute FROM starts_at AT TIME ZONE 'Asia/Shanghai')
                   )::int AS starts_at_minutes,
                   (
                     extract(hour FROM ends_at AT TIME ZONE 'Asia/Shanghai') * 60
                     + extract(minute FROM ends_at AT TIME ZONE 'Asia/Shanghai')
                   )::int AS ends_at_minutes,
                   (
                     extract(hour FROM occupancy_starts_at AT TIME ZONE 'Asia/Shanghai') * 60
                     + extract(minute FROM occupancy_starts_at AT TIME ZONE 'Asia/Shanghai')
                   )::int AS occupancy_starts_at_minutes,
                   (
                     extract(hour FROM occupancy_ends_at AT TIME ZONE 'Asia/Shanghai') * 60
                     + extract(minute FROM occupancy_ends_at AT TIME ZONE 'Asia/Shanghai')
                   )::int AS occupancy_ends_at_minutes,
                   service_duration_minutes::int AS service_minutes
            FROM bookings
            WHERE status NOT IN ('cancelled', 'no_show')
              AND starts_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
              AND ends_at > ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
          `,
        [window.startsOn, window.endsOn],
      );
      const timeOffResult = await client.query<StaffCapacityBlockRow>(
        `
          SELECT to_char(local_date, 'YYYY-MM-DD') AS local_date,
                 staff_id,
                 to_char(starts_at, 'HH24:MI') AS starts_at,
                 to_char(ends_at, 'HH24:MI') AS ends_at
          FROM staff_time_off_intervals
          WHERE local_date BETWEEN $1 AND $2
            AND status IN ('pending', 'active')
          ORDER BY local_date, staff_id, starts_at
        `,
        [window.startsOn, window.endsOn],
      );
      const closureResult = await client.query<CapacityBlockRow>(
        `
          SELECT to_char(local_date, 'YYYY-MM-DD') AS local_date,
                 to_char(starts_at, 'HH24:MI') AS starts_at,
                 to_char(ends_at, 'HH24:MI') AS ends_at
          FROM store_closure_intervals
          WHERE local_date BETWEEN $1 AND $2
            AND status IN ('pending', 'active')
          ORDER BY local_date, starts_at
        `,
        [window.startsOn, window.endsOn],
      );
      await client.query("COMMIT");

      const businessHoursByWeekday = new Map(
        businessHoursResult.rows.map((row) => [row.weekday, row]),
      );
      const shiftBuilders = new Map<string, ShiftBuilder>();

      for (const row of scheduleResult.rows) {
        let shift = shiftBuilders.get(row.shift_id);
        if (!shift) {
          shift = {
            localDate: row.local_date,
            staffId: row.staff_id,
            startsAtMinutes: timeToMinutes(row.shift_starts_at),
            endsAtMinutes: timeToMinutes(row.shift_ends_at),
            breaks: new Map(),
          };
          shiftBuilders.set(row.shift_id, shift);
        }
        if (row.break_id && row.break_starts_at && row.break_ends_at) {
          shift.breaks.set(row.break_id, {
            startsAtMinutes: timeToMinutes(row.break_starts_at),
            endsAtMinutes: timeToMinutes(row.break_ends_at),
          });
        }
      }

      const capacityByStaffDate = new Map<string, AvailabilityInterval[]>();
      for (const shift of shiftBuilders.values()) {
        const key = `${shift.localDate}:${shift.staffId}`;
        capacityByStaffDate.set(key, [
          ...(capacityByStaffDate.get(key) ?? []),
          ...subtractBreaks(shift),
        ]);
      }

      const timeOffByStaffDate = new Map<string, AvailabilityInterval[]>();
      for (const row of timeOffResult.rows) {
        const key = `${row.local_date}:${row.staff_id}`;
        timeOffByStaffDate.set(key, [
          ...(timeOffByStaffDate.get(key) ?? []),
          {
            startsAtMinutes: timeToMinutes(row.starts_at),
            endsAtMinutes: timeToMinutes(row.ends_at),
          },
        ]);
      }
      const closuresByDate = new Map<string, AvailabilityInterval[]>();
      for (const row of closureResult.rows) {
        closuresByDate.set(row.local_date, [
          ...(closuresByDate.get(row.local_date) ?? []),
          {
            startsAtMinutes: timeToMinutes(row.starts_at),
            endsAtMinutes: timeToMinutes(row.ends_at),
          },
        ]);
      }

      const bookingsByDate = new Map<string, AvailabilityBooking[]>();
      for (const row of bookingResult.rows) {
        const dateBookings = bookingsByDate.get(row.local_date) ?? [];
        dateBookings.push({
          petId: row.pet_id,
          staffId: row.staff_id,
          startsAtMinutes: row.starts_at_minutes,
          endsAtMinutes: row.ends_at_minutes,
          occupancyStartsAtMinutes: row.occupancy_starts_at_minutes,
          occupancyEndsAtMinutes: row.occupancy_ends_at_minutes,
          serviceMinutes: row.service_minutes,
        });
        bookingsByDate.set(row.local_date, dateBookings);
      }

      const qualifiedStaff = staffResult.rows.filter((staff) =>
        hasAllSkills(staff, selection.requiredSkillIds),
      );
      const preference: StaffPreference = staffId
        ? { kind: "specified", staffId }
        : { kind: "fastest" };
      const dates = Array.from({ length: 14 }, (_, index) => addLocalDays(window.startsOn, index));
      const availabilityFor = (date: string, staffPreference: StaffPreference) => {
        const weekday = getLocalWeekday(date);
        const hours = businessHoursByWeekday.get(weekday);
        const businessHours =
          hours?.opens_at && hours.closes_at
            ? {
                startsAtMinutes: timeToMinutes(hours.opens_at),
                endsAtMinutes: timeToMinutes(hours.closes_at),
              }
            : null;
        const dateStaff: AvailabilityStaff[] = staffResult.rows.map((staff) => ({
          id: staff.id,
          displayName: staff.display_name,
          employeeNumber: staff.employee_number,
          skills: staff.skills,
          capacity: subtractAvailabilityIntervals(
            capacityByStaffDate.get(`${date}:${staff.id}`) ?? [],
            [
              ...(closuresByDate.get(date) ?? []),
              ...(timeOffByStaffDate.get(`${date}:${staff.id}`) ?? []),
            ],
          ),
        }));
        return discoverDayAvailability({
          date,
          window,
          businessHours,
          earliestStartsAtMinutes: earliestCandidateMinutesForDate(date, earliestStartsAt),
          petId: selection.pet.id,
          requiredSkills: selection.requiredSkillIds,
          serviceMinutes: selection.serviceDurationMinutes,
          turnoverMinutes: 15,
          staffPreference,
          staff: dateStaff,
          bookings: bookingsByDate.get(date) ?? [],
        });
      };
      const staffById = new Map(staffResult.rows.map((staff) => [staff.id, staff]));
      const days: BookingAvailabilityDay[] = dates.map((date) => {
        const result = availabilityFor(date, preference);
        return {
          date,
          weekday: getLocalWeekday(date),
          reason: result.reason,
          reasonLabel: result.reason ? reasonLabels[result.reason] : "可预约",
          slots: result.slots.map((slot) => {
            const assignedStaff = staffById.get(slot.staffId);
            if (!assignedStaff) {
              throw new Error(`可约时段引用了不存在的员工 ${slot.staffId}。`);
            }
            return {
              startsAt: localInstant(date, slot.startsAtMinutes),
              endsAt: localInstant(date, slot.endsAtMinutes),
              turnoverEndsAt: localInstant(date, slot.occupancyEndsAtMinutes),
              staff: {
                id: assignedStaff.id,
                displayName: assignedStaff.display_name,
                employeeNumber: assignedStaff.employee_number,
              },
            };
          }),
        };
      });
      const staffOptions = qualifiedStaff.map((staff) => {
        let earliestSlot: { startsAt: string; endsAt: string } | null = null;
        for (const date of dates) {
          const slot = availabilityFor(date, { kind: "specified", staffId: staff.id }).slots[0];
          if (slot) {
            earliestSlot = {
              startsAt: localInstant(date, slot.startsAtMinutes),
              endsAt: localInstant(date, slot.endsAtMinutes),
            };
            break;
          }
        }
        return {
          id: staff.id,
          displayName: staff.display_name,
          employeeNumber: staff.employee_number,
          earliestSlot,
        };
      });

      return {
        timeZone: "Asia/Shanghai",
        demoNow,
        window: { ...window, earliestStartsAt },
        selection,
        staffOptions,
        days,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      if (ownsClient) {
        client.release();
      }
    }
  }

  private quote(pet: PetRow, primaryServiceId: string, addonIds: string[]): BookingSelectionQuote {
    try {
      return quoteBookingSelection(
        {
          id: pet.id,
          name: pet.name,
          species: pet.species,
          petSize: petSizeFor(Number(pet.weight_kg)),
          weightKg: Number(pet.weight_kg),
        },
        this.catalog.getStorefront(),
        primaryServiceId,
        addonIds,
      );
    } catch (error) {
      selectionError(error instanceof Error ? error.message : "服务组合无效，请重新选择。");
    }
  }
}
