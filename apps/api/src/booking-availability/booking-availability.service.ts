import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  BookingAvailabilityDay,
  BookingAvailabilityReason,
  BookingAvailabilityResponse,
  BookingSelectionQuote,
  PetSize,
  StaffSkillId,
} from "@rongguang/contracts";

import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { addLocalDays, getLocalWeekday } from "../schedule/schedule-date.js";
import { ServiceCatalogService } from "../service-catalog/service-catalog.service.js";
import {
  bookingWindowFor,
  discoverDayAvailability,
  earliestCustomerCandidate,
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
  staff_id: string | null;
  starts_at_minutes: number;
  ends_at_minutes: number;
  occupancy_ends_at_minutes: number;
  service_minutes: number;
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

function minuteOfDayInShanghai(instant: string): number {
  const shifted = new Date(new Date(instant).getTime() + 8 * 60 * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
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

  async discover(input: DiscoveryInput): Promise<BookingAvailabilityResponse> {
    const petId = requiredId(input.petId, "宠物");
    const primaryServiceId = requiredId(input.primaryServiceId, "主要服务");
    const addonIds = parseAddonIds(input.addonIds);
    const staffId = input.staffId ? requiredId(input.staffId, "员工") : null;
    const demoNow = getDemoNow();
    const window = bookingWindowFor(demoNow);
    const earliestStartsAt = earliestCustomerCandidate(demoNow);
    const client = await this.database.pool.connect();

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
                     extract(hour FROM (ends_at + interval '15 minutes') AT TIME ZONE 'Asia/Shanghai') * 60
                     + extract(minute FROM (ends_at + interval '15 minutes') AT TIME ZONE 'Asia/Shanghai')
                   )::int AS occupancy_ends_at_minutes,
                   coalesce(
                     service_duration_minutes,
                     extract(epoch FROM (ends_at - starts_at))::int / 60
                   )::int AS service_minutes
            FROM bookings
            WHERE status NOT IN ('cancelled', 'no_show')
              AND starts_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
              AND ends_at > ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
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

      const bookingsByDate = new Map<string, AvailabilityBooking[]>();
      for (const row of bookingResult.rows) {
        const dateBookings = bookingsByDate.get(row.local_date) ?? [];
        dateBookings.push({
          petId: row.pet_id,
          staffId: row.staff_id ?? "",
          startsAtMinutes: row.starts_at_minutes,
          endsAtMinutes: row.ends_at_minutes,
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
          capacity: capacityByStaffDate.get(`${date}:${staff.id}`) ?? [],
        }));
        return discoverDayAvailability({
          date,
          window,
          businessHours,
          earliestStartsAtMinutes:
            date === window.startsOn ? minuteOfDayInShanghai(earliestStartsAt) : 0,
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
      client.release();
    }
  }

  private quote(pet: PetRow, primaryServiceId: string, addonIds: string[]): BookingSelectionQuote {
    const catalog = this.catalog.getStorefront();
    const primaryService = catalog.primaryServices.find(
      (service) => service.id === primaryServiceId,
    );
    if (!primaryService || !primaryService.applicableSpecies.includes(pet.species)) {
      selectionError("这项主要服务不适用于所选宠物。");
    }

    const petSize = petSizeFor(Number(pet.weight_kg));
    const primarySpecification = primaryService.specifications.find(
      (specification) => specification.petSize === petSize,
    );
    if (!primarySpecification) {
      selectionError("没有找到这只宠物对应的服务规格。");
    }

    const allowedAddonIds = new Set(primaryService.availableAddonIds);
    const addons = addonIds.map((addonId) => {
      const addon = catalog.addons.find((item) => item.id === addonId);
      const specification = addon?.specifications.find((item) => item.petSize === petSize);
      if (
        !addon ||
        !allowedAddonIds.has(addon.id) ||
        !addon.applicableSpecies.includes(pet.species) ||
        !specification
      ) {
        selectionError("所选增项与主要服务或宠物不兼容。");
      }
      return {
        id: addon.id,
        name: addon.name,
        priceCents: specification.priceCents,
        durationMinutes: specification.durationMinutes,
      };
    });
    const primaryLine = {
      id: primaryService.id,
      name: primaryService.name,
      priceCents: primarySpecification.priceCents,
      durationMinutes: primarySpecification.durationMinutes,
    };

    return {
      pet: {
        id: pet.id,
        name: pet.name,
        species: pet.species,
        petSize,
        weightKg: Number(pet.weight_kg),
      },
      primaryService: primaryLine,
      addons,
      totalPriceCents:
        primaryLine.priceCents + addons.reduce((total, addon) => total + addon.priceCents, 0),
      serviceDurationMinutes:
        primaryLine.durationMinutes +
        addons.reduce((total, addon) => total + addon.durationMinutes, 0),
      requiredSkillIds: [primaryService.id, ...addonIds] as StaffSkillId[],
    };
  }
}
