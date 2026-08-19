import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ManagerBookingDetailResponse,
  ManagerBookingFact,
  ManagerBookingListFilters,
  ManagerBookingListResponse,
  ManagerBookingStatus,
  ManagerBookingStatusSummary,
  ManagerCalendarBlock,
  ManagerCalendarResponse,
  ManagerCapacitySummary,
  ManagerStaffDay,
  ManagerProxyBookingOptionsResponse,
  ManagerWorkbenchResponse,
  ManagerWorkbenchRisk,
  StoreServiceRecord,
} from "@rongguang/contracts";

import { getDemoNow } from "../config/environment.js";
import {
  bookingWindowFor,
  earliestManagerCandidate,
} from "../booking-availability/availability.js";
import { managerBookingActions } from "../booking/manager-booking-actions.js";
import { DatabaseService } from "../database/database.service.js";
import { getShanghaiLocalDate, isLocalDate } from "../schedule/schedule-date.js";
import { ScheduleService } from "../schedule/schedule.service.js";
import { ServiceCatalogService } from "../service-catalog/service-catalog.service.js";

interface BookingRow {
  id: string;
  customer_id: string;
  customer_display_name: string;
  customer_phone: string;
  pet_id: string;
  pet_name_snapshot: string;
  pet_species_snapshot: "dog" | "cat";
  pet_photo_path: string | null;
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  addon_snapshots: Array<{ id: string; name: string }>;
  staff_id: string;
  staff_display_name_snapshot: string;
  status: ManagerBookingStatus;
  starts_at: Date;
  ends_at: Date;
  occupancy_starts_at: Date | null;
  occupancy_ends_at: Date | null;
  total_price_cents: number;
  service_duration_minutes: number;
  turnover_minutes: number;
  verification_code_version: number;
}

interface CapacityBlockRow {
  id: string;
  staff_id: string | null;
  kind: "time_off" | "store_closure";
  status: "pending" | "active";
  starts_at: string;
  ends_at: string;
  reason: string;
}

interface FailedNotificationRow {
  id: string;
  booking_id: string;
  attempt_count: number;
  pet_name_snapshot: string;
}

interface PendingCapacityRiskRow {
  id: string;
  kind: "time_off" | "store_closure";
  local_date: string;
  starts_at: string;
  ends_at: string;
  staff_display_name: string | null;
  affected_booking_count: number;
}

interface ManagerPetProfileRow {
  weight_kg: string;
  breed: string | null;
  care_notes: string | null;
  care_tags: string[];
}

interface ManagerBookingEventRow {
  id: string;
  event_type: string;
  actor_type: "customer" | "staff" | "manager" | "system";
  actor_id: string | null;
  payload: {
    reason?: string | null;
    previous?: ManagerBookingDetailResponse["changeHistory"][number]["previous"];
    next?: ManagerBookingDetailResponse["changeHistory"][number]["next"];
  };
  occurred_at: Date;
}

interface ManagerNotificationRow {
  id: string;
  notification_type: string;
  status: "pending" | "processing" | "sent" | "retry" | "failed";
  attempt_count: number;
  created_at: Date;
}

interface ManagerServiceRecordRow {
  id: string;
  booking_id: string;
  pet_snapshot: StoreServiceRecord["pet"];
  primary_service_snapshot: StoreServiceRecord["primaryService"];
  addon_snapshots: StoreServiceRecord["addons"];
  staff_snapshot: StoreServiceRecord["staff"];
  actual_starts_at: Date;
  actual_ends_at: Date;
  care_tags: StoreServiceRecord["careTags"];
  internal_text: string | null;
  created_at: Date;
}

interface ManagerServiceRecordNoteRow {
  id: string;
  kind: "staff_note" | "manager_correction";
  note_text: string;
  author_type: "staff" | "manager";
  author_id: string;
  author_display_name: string;
  created_at: Date;
}

interface ManagerProxyOptionRow {
  customer_id: string;
  customer_display_name: string;
  customer_phone: string;
  pet_id: string | null;
  pet_name: string | null;
  pet_species: "dog" | "cat" | null;
  pet_weight_kg: string | null;
}

interface ManagerProxyStaffRow {
  id: string;
  display_name: string;
  skills: ManagerProxyBookingOptionsResponse["staff"][number]["skills"];
}

interface ClockInterval {
  startsAt: number;
  endsAt: number;
}

interface BookingRead {
  fact: ManagerBookingFact;
  occupancy: ClockInterval | null;
}

const bookingSelect = `
  booking.id,
  booking.customer_id,
  customer.display_name AS customer_display_name,
  customer.phone AS customer_phone,
  booking.pet_id,
  booking.pet_name_snapshot,
  booking.pet_species_snapshot,
  pet.seed_photo_path AS pet_photo_path,
  booking.primary_service_id_snapshot,
  booking.primary_service_name_snapshot,
  booking.addon_snapshots,
  booking.staff_id,
  booking.staff_display_name_snapshot,
  booking.status,
  booking.starts_at,
  booking.ends_at,
  booking.occupancy_starts_at,
  booking.occupancy_ends_at,
  booking.total_price_cents,
  booking.service_duration_minutes,
  booking.turnover_minutes,
  booking.verification_code_version
`;

function phoneMasked(phone: string): string {
  if (phone.length < 7) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function bookingRead(row: BookingRow): BookingRead {
  const plannedTurnoverEndsAt = new Date(
    row.ends_at.getTime() + row.turnover_minutes * 60_000,
  ).toISOString();
  return {
    fact: {
      id: row.id,
      status: row.status,
      customer: {
        id: row.customer_id,
        displayName: row.customer_display_name,
        phoneMasked: phoneMasked(row.customer_phone),
      },
      pet: {
        id: row.pet_id,
        name: row.pet_name_snapshot,
        species: row.pet_species_snapshot,
        photoPath: row.pet_photo_path,
      },
      primaryService: {
        id: row.primary_service_id_snapshot,
        name: row.primary_service_name_snapshot,
      },
      addons: row.addon_snapshots.map((addon) => ({ id: addon.id, name: addon.name })),
      staff: { id: row.staff_id, displayName: row.staff_display_name_snapshot },
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      turnoverEndsAt: row.occupancy_ends_at?.toISOString() ?? plannedTurnoverEndsAt,
      totalPriceCents: row.total_price_cents,
      serviceDurationMinutes: row.service_duration_minutes,
      turnoverMinutes: row.turnover_minutes,
    },
    occupancy:
      row.occupancy_starts_at && row.occupancy_ends_at
        ? {
            startsAt: localClockMinutes(row.occupancy_starts_at.toISOString()),
            endsAt: localClockMinutes(row.occupancy_ends_at.toISOString()),
          }
        : null,
  };
}

function clockMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localClockMinutes(value: string): number {
  const local = new Date(new Date(value).getTime() + 8 * 60 * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function mergeIntervals(intervals: ClockInterval[]): ClockInterval[] {
  const sorted = intervals
    .filter((interval) => interval.endsAt > interval.startsAt)
    .sort((left, right) => left.startsAt - right.startsAt);
  const merged: ClockInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.startsAt > previous.endsAt) {
      merged.push({ ...interval });
      continue;
    }
    previous.endsAt = Math.max(previous.endsAt, interval.endsAt);
  }
  return merged;
}

function workingIntervals(shifts: ManagerStaffDay["shifts"]): ClockInterval[] {
  const intervals = shifts.flatMap((shift) => {
    const shiftStartsAt = clockMinutes(shift.startsAt);
    const shiftEndsAt = clockMinutes(shift.endsAt);
    const breaks = mergeIntervals(
      shift.breaks.map((shiftBreak) => ({
        startsAt: Math.max(shiftStartsAt, clockMinutes(shiftBreak.startsAt)),
        endsAt: Math.min(shiftEndsAt, clockMinutes(shiftBreak.endsAt)),
      })),
    );
    const available: ClockInterval[] = [];
    let cursor = shiftStartsAt;

    for (const shiftBreak of breaks) {
      if (shiftBreak.startsAt > cursor) {
        available.push({ startsAt: cursor, endsAt: shiftBreak.startsAt });
      }
      cursor = Math.max(cursor, shiftBreak.endsAt);
    }
    if (cursor < shiftEndsAt) available.push({ startsAt: cursor, endsAt: shiftEndsAt });
    return available;
  });
  return mergeIntervals(intervals);
}

function intervalMinutes(intervals: ClockInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.endsAt - interval.startsAt, 0);
}

function unavailableMinutes(working: ClockInterval[], unavailable: ClockInterval[]): number {
  const intersections = working.flatMap((window) =>
    unavailable.map((interval) => ({
      startsAt: Math.max(window.startsAt, interval.startsAt),
      endsAt: Math.min(window.endsAt, interval.endsAt),
    })),
  );
  return intervalMinutes(mergeIntervals(intersections));
}

function capacitySummary(
  shifts: ManagerStaffDay["shifts"],
  bookingIntervals: ClockInterval[],
  capacityBlocks: ClockInterval[],
): ManagerCapacitySummary {
  const working = workingIntervals(shifts);
  const published = intervalMinutes(working);
  const occupied = unavailableMinutes(working, bookingIntervals);
  const unavailable = unavailableMinutes(working, [...bookingIntervals, ...capacityBlocks]);
  return {
    publishedMinutes: published,
    occupiedMinutes: occupied,
    remainingMinutes: Math.max(0, published - unavailable),
  };
}

function affectsBooking(block: ManagerCalendarBlock, booking: ManagerBookingFact): boolean {
  const startsAt = localClockMinutes(booking.startsAt);
  const endsAt = localClockMinutes(booking.turnoverEndsAt);
  return startsAt < clockMinutes(block.endsAt) && endsAt > clockMinutes(block.startsAt);
}

function bookingAffectsCapacity(status: ManagerBookingStatus): boolean {
  return status !== "cancelled" && status !== "no_show";
}

function petSize(weightKg: number): "small" | "medium" | "large" {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function emptyStatusSummary(): ManagerBookingStatusSummary {
  return {
    confirmed: 0,
    checked_in: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0,
    terminated: 0,
  };
}

const bookingStatuses = new Set<ManagerBookingStatus>([
  "confirmed",
  "checked_in",
  "completed",
  "cancelled",
  "no_show",
  "terminated",
]);

function bookingListFilters(input: {
  date?: string;
  status?: string;
  staffId?: string;
  primaryServiceId?: string;
  query?: string;
}): ManagerBookingListFilters {
  const fieldErrors: Record<string, string> = {};
  const date = input.date?.trim() || null;
  const status = input.status?.trim() || null;
  const staffId = input.staffId?.trim() || null;
  const primaryServiceId = input.primaryServiceId?.trim() || null;
  const query = input.query?.trim() ?? "";

  if (date && !isLocalDate(date)) {
    fieldErrors.date = "请选择有效日期。";
  }
  if (status && !bookingStatuses.has(status as ManagerBookingStatus)) {
    fieldErrors.status = "请选择有效预约状态。";
  }
  if (staffId && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(staffId)) {
    fieldErrors.staffId = "请选择有效员工。";
  }
  if (primaryServiceId && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(primaryServiceId)) {
    fieldErrors.primaryServiceId = "请选择有效主要服务。";
  }
  if (query.length > 50) {
    fieldErrors.query = "搜索关键字不能超过 50 个字符。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message: "预约筛选条件无效。", fieldErrors },
      HttpStatus.BAD_REQUEST,
    );
  }

  return {
    date,
    status: status as ManagerBookingStatus | null,
    staffId,
    primaryServiceId,
    query,
  };
}

@Injectable()
export class ManagerLiveBookingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
    @Inject(ServiceCatalogService) private readonly catalog: ServiceCatalogService,
  ) {}

  async bookings(input: {
    date?: string;
    status?: string;
    staffId?: string;
    primaryServiceId?: string;
    query?: string;
  }): Promise<ManagerBookingListResponse> {
    const filters = bookingListFilters(input);
    const result = await this.database.pool.query<BookingRow>(
      `
        SELECT ${bookingSelect}
        FROM bookings AS booking
        JOIN customers AS customer ON customer.id = booking.customer_id
        JOIN pets AS pet ON pet.id = booking.pet_id
        WHERE ($1::date IS NULL OR (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date)
          AND ($2::text IS NULL OR booking.status = $2)
          AND ($3::text IS NULL OR booking.staff_id = $3)
          AND ($4::text IS NULL OR booking.primary_service_id_snapshot = $4)
          AND (
            $5::text = ''
            OR customer.display_name ILIKE '%' || $5 || '%'
            OR booking.pet_name_snapshot ILIKE '%' || $5 || '%'
          )
        ORDER BY booking.starts_at DESC, booking.id
        LIMIT 200
      `,
      [filters.date, filters.status, filters.staffId, filters.primaryServiceId, filters.query],
    );
    const staff = await this.database.pool.query<{ id: string; display_name: string }>(
      `
        SELECT staff.id, account.display_name
        FROM staff_members AS staff
        JOIN backoffice_accounts AS account ON account.id = staff.id
        WHERE staff.active = true AND account.active = true
        ORDER BY staff.employee_number
      `,
    );

    return {
      appliedFilters: filters,
      bookings: result.rows.map((row) => bookingRead(row).fact),
      filterOptions: {
        staff: staff.rows.map((member) => ({
          id: member.id,
          displayName: member.display_name,
        })),
        primaryServices: this.catalog.getStorefront().primaryServices.map((service) => ({
          id: service.id,
          name: service.name,
        })),
      },
    };
  }

  async proxyBookingOptions(): Promise<ManagerProxyBookingOptionsResponse> {
    const [profileResult, staffResult, noticeResult] = await Promise.all([
      this.database.pool.query<ManagerProxyOptionRow>(
        `
          SELECT customer.id AS customer_id,
                 customer.display_name AS customer_display_name,
                 customer.phone AS customer_phone,
                 pet.id AS pet_id,
                 pet.name AS pet_name,
                 pet.species AS pet_species,
                 pet.weight_kg::text AS pet_weight_kg
          FROM customers AS customer
          LEFT JOIN pets AS pet
            ON pet.customer_id = customer.id
           AND pet.archived_at IS NULL
          ORDER BY customer.display_name, customer.id, pet.created_at, pet.id
        `,
      ),
      this.database.pool.query<ManagerProxyStaffRow>(
        `
          SELECT staff.id,
                 account.display_name,
                 COALESCE(
                   array_agg(skill.skill_id ORDER BY skill.skill_id)
                     FILTER (WHERE skill.skill_id IS NOT NULL),
                   '{}'
                 ) AS skills
          FROM staff_members AS staff
          JOIN backoffice_accounts AS account ON account.id = staff.id
          LEFT JOIN staff_skills AS skill ON skill.staff_id = staff.id
          WHERE staff.active = true AND account.active = true
          GROUP BY staff.id, account.display_name, staff.employee_number
          ORDER BY staff.employee_number
        `,
      ),
      this.database.pool.query<{ version: string; title: string; summary: string }>(
        "SELECT version, title, summary FROM privacy_notices WHERE is_current = true",
      ),
    ]);
    const notice = noticeResult.rows[0];
    if (!notice) {
      throw new Error("当前隐私说明不存在，无法准备代客预约页面。");
    }
    const customers = new Map<string, ManagerProxyBookingOptionsResponse["customers"][number]>();
    for (const row of profileResult.rows) {
      const customer = customers.get(row.customer_id) ?? {
        id: row.customer_id,
        displayName: row.customer_display_name,
        phoneMasked: phoneMasked(row.customer_phone),
        pets: [],
      };
      if (row.pet_id && row.pet_name && row.pet_species && row.pet_weight_kg) {
        const weightKg = Number(row.pet_weight_kg);
        customer.pets.push({
          id: row.pet_id,
          name: row.pet_name,
          species: row.pet_species,
          weightKg,
          petSize: petSize(weightKg),
        });
      }
      customers.set(row.customer_id, customer);
    }
    const demoNow = getDemoNow();
    const window = bookingWindowFor(demoNow);
    const catalog = this.catalog.getStorefront();

    return {
      demoNow,
      privacyNotice: notice,
      window: { ...window, earliestStartsAt: earliestManagerCandidate(demoNow) },
      customers: [...customers.values()],
      staff: staffResult.rows.map((staff) => ({
        id: staff.id,
        displayName: staff.display_name,
        skills: staff.skills,
      })),
      primaryServices: catalog.primaryServices.map((service) => ({
        id: service.id,
        name: service.name,
        applicableSpecies: service.applicableSpecies,
        availableAddonIds: service.availableAddonIds,
      })),
      addons: catalog.addons.map((addon) => ({ id: addon.id, name: addon.name })),
    };
  }

  async calendar(date?: string): Promise<ManagerCalendarResponse> {
    const schedule = await this.schedules.getPublishedSchedule(date);
    const [bookingReads, blockRows] = await Promise.all([
      this.dayBookings(schedule.selectedDate),
      this.capacityBlocks(schedule.selectedDate),
    ]);
    const bookings = bookingReads.map((item) => item.fact);
    const blocks = blockRows.map((row) => {
      const affected = bookings.filter(
        (booking) =>
          bookingAffectsCapacity(booking.status) &&
          (!row.staff_id || booking.staff.id === row.staff_id) &&
          affectsBooking(
            {
              id: row.id,
              kind: row.kind,
              status: row.status,
              startsAt: row.starts_at.slice(0, 5),
              endsAt: row.ends_at.slice(0, 5),
              reason: row.reason,
              affectedBookingCount: 0,
            },
            booking,
          ),
      ).length;

      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        startsAt: row.starts_at.slice(0, 5),
        endsAt: row.ends_at.slice(0, 5),
        reason: row.reason,
        affectedBookingCount: affected,
        staffId: row.staff_id,
      };
    });

    const staffDays = schedule.staffDays.map<ManagerStaffDay>((day) => {
      const dayBookingReads = bookingReads.filter((item) => item.fact.staff.id === day.staff.id);
      const dayBlocks = blocks.filter((block) => !block.staffId || block.staffId === day.staff.id);
      const bookingIntervals = dayBookingReads
        .filter(
          (item): item is BookingRead & { occupancy: ClockInterval } =>
            bookingAffectsCapacity(item.fact.status) && Boolean(item.occupancy),
        )
        .map((item) => item.occupancy);
      const blockIntervals = dayBlocks.map((block) => ({
        startsAt: clockMinutes(block.startsAt),
        endsAt: clockMinutes(block.endsAt),
      }));

      return {
        ...day,
        staff: {
          ...day.staff,
          avatarPath: `/assets/brand/staff-${day.staff.id}.png`,
        },
        bookings: dayBookingReads.map((item) => item.fact),
        blocks: dayBlocks.map(
          ({ id, kind, status, startsAt, endsAt, reason, affectedBookingCount }) => ({
            id,
            kind,
            status,
            startsAt,
            endsAt,
            reason,
            affectedBookingCount,
          }),
        ),
        capacity: capacitySummary(day.shifts, bookingIntervals, blockIntervals),
      };
    });
    const totalPublished = staffDays.reduce(
      (total, day) => total + day.capacity.publishedMinutes,
      0,
    );
    const totalOccupied = staffDays.reduce((total, day) => total + day.capacity.occupiedMinutes, 0);
    const totalRemaining = staffDays.reduce(
      (total, day) => total + day.capacity.remainingMinutes,
      0,
    );

    return {
      timeZone: schedule.timeZone,
      demoNow: schedule.demoNow,
      selectedDate: schedule.selectedDate,
      window: schedule.window,
      businessHours: schedule.businessHours,
      staffDays,
      capacity: {
        publishedMinutes: totalPublished,
        occupiedMinutes: totalOccupied,
        remainingMinutes: totalRemaining,
      },
    };
  }

  async workbench(): Promise<ManagerWorkbenchResponse> {
    const demoNow = getDemoNow();
    const localDate = getShanghaiLocalDate(demoNow);
    const [calendar, failedNotifications, pendingCapacityRisks] = await Promise.all([
      this.calendar(localDate),
      this.failedNotifications(),
      this.pendingCapacityRisks(localDate),
    ]);
    const bookings = calendar.staffDays.flatMap((day) => day.bookings);
    const summary = bookings.reduce((counts, booking) => {
      counts[booking.status] += 1;
      return counts;
    }, emptyStatusSummary());
    const risks: ManagerWorkbenchRisk[] = [];

    for (const change of pendingCapacityRisks) {
      const isTimeOff = change.kind === "time_off";
      risks.push({
        id: `${change.kind}:${change.id}`,
        kind: isTimeOff ? "pending_time_off" : "pending_store_closure",
        title: isTimeOff ? "待处理停班" : "待处理临时闭店",
        detail: `${change.local_date} ${isTimeOff ? `${change.staff_display_name ?? "员工"} ` : ""}${change.starts_at}–${change.ends_at}，影响 ${change.affected_booking_count} 笔预约`,
        href: `/manager/schedule/capacity-changes/${change.kind}/${change.id}`,
      });
    }

    for (const notification of failedNotifications) {
      risks.push({
        id: `notification:${notification.id}`,
        kind: "failed_notification",
        title: "通知最终失败",
        detail: `${notification.pet_name_snapshot}的预约通知，自动发送 ${notification.attempt_count} 次失败`,
        href: `/manager/system/notifications/${notification.id}`,
      });
    }

    const now = Date.parse(demoNow);
    for (const booking of bookings) {
      if (booking.status !== "confirmed" || now <= Date.parse(booking.startsAt) + 15 * 60_000) {
        continue;
      }
      risks.push({
        id: `late:${booking.id}`,
        kind: "late_booking",
        title: "迟到待处理",
        detail: `${booking.pet.name}，原定 ${this.localTime(booking.startsAt)}，负责人${booking.staff.displayName}`,
        href: `/manager/appointments/${booking.id}`,
      });
    }

    return {
      timeZone: "Asia/Shanghai",
      demoNow,
      localDate,
      risks,
      statusSummary: summary,
      staffDays: calendar.staffDays,
      capacity: calendar.capacity,
    };
  }

  async bookingDetail(bookingId: string): Promise<ManagerBookingDetailResponse> {
    const result = await this.database.pool.query<BookingRow>(
      `
        SELECT ${bookingSelect}
        FROM bookings AS booking
        JOIN customers AS customer ON customer.id = booking.customer_id
        JOIN pets AS pet ON pet.id = booking.pet_id
        WHERE booking.id = $1
      `,
      [bookingId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new HttpException(
        { code: "BOOKING_NOT_FOUND", message: "找不到这笔预约。" },
        HttpStatus.NOT_FOUND,
      );
    }

    const [petProfileResult, eventResult, notificationResult, serviceRecordResult] =
      await Promise.all([
        this.database.pool.query<ManagerPetProfileRow>(
          `
            SELECT pet.weight_kg::text,
                   pet.breed,
                   pet.care_notes,
                   COALESCE(
                     (
                       SELECT jsonb_agg(tag.tag ORDER BY tag.tag)
                       FROM pet_care_tags AS tag
                       WHERE tag.pet_id = pet.id
                     ),
                     '[]'::jsonb
                   ) AS care_tags
            FROM pets AS pet
            WHERE pet.id = $1
          `,
          [row.pet_id],
        ),
        this.database.pool.query<ManagerBookingEventRow>(
          `
            SELECT id, event_type, actor_type, actor_id, payload, occurred_at
            FROM booking_events
            WHERE booking_id = $1
            ORDER BY occurred_at, sequence
          `,
          [bookingId],
        ),
        this.database.pool.query<ManagerNotificationRow>(
          `
            SELECT id, notification_type, status, attempt_count, created_at
            FROM notification_outbox
            WHERE booking_id = $1
            ORDER BY created_at, sequence
          `,
          [bookingId],
        ),
        this.database.pool.query<ManagerServiceRecordRow>(
          `
            SELECT id, booking_id, pet_snapshot, primary_service_snapshot,
                   addon_snapshots, staff_snapshot, actual_starts_at,
                   actual_ends_at, care_tags, internal_text, created_at
            FROM store_service_records
            WHERE booking_id = $1
          `,
          [bookingId],
        ),
      ]);
    const profile = petProfileResult.rows[0];
    if (!profile) {
      throw new Error(`预约 ${bookingId} 引用了不存在的宠物档案。`);
    }
    const serviceRecordRow = serviceRecordResult.rows[0];
    const serviceRecordNotes = serviceRecordRow
      ? await this.database.pool.query<ManagerServiceRecordNoteRow>(
          `
            SELECT id, kind, note_text, author_type, author_id,
                   author_display_name, created_at
            FROM store_service_record_notes
            WHERE service_record_id = $1
            ORDER BY created_at, id
          `,
          [serviceRecordRow.id],
        )
      : null;
    const weightKg = Number(profile.weight_kg);

    return {
      booking: bookingRead(row).fact,
      bookingRevision: row.verification_code_version,
      managerActions: managerBookingActions(row.status),
      petProfile: {
        weightKg,
        petSize: petSize(weightKg),
        breed: profile.breed,
        careTags: profile.care_tags,
        careNotes: profile.care_notes,
      },
      serviceRecord: serviceRecordRow
        ? {
            id: serviceRecordRow.id,
            bookingId: serviceRecordRow.booking_id,
            pet: serviceRecordRow.pet_snapshot,
            primaryService: serviceRecordRow.primary_service_snapshot,
            addons: serviceRecordRow.addon_snapshots,
            staff: serviceRecordRow.staff_snapshot,
            actualStartsAt: serviceRecordRow.actual_starts_at.toISOString(),
            actualEndsAt: serviceRecordRow.actual_ends_at.toISOString(),
            careTags: serviceRecordRow.care_tags,
            internalText: serviceRecordRow.internal_text,
            createdAt: serviceRecordRow.created_at.toISOString(),
            notes:
              serviceRecordNotes?.rows.map((note) => ({
                id: note.id,
                kind: note.kind,
                text: note.note_text,
                author: {
                  type: note.author_type,
                  id: note.author_id,
                  displayName: note.author_display_name,
                },
                createdAt: note.created_at.toISOString(),
              })) ?? [],
          }
        : null,
      changeHistory: eventResult.rows.map((event) => ({
        id: event.id,
        type: event.event_type,
        actorType: event.actor_type,
        actorId: event.actor_id,
        reason: event.payload.reason ?? null,
        previous: event.payload.previous ?? null,
        next: event.payload.next ?? null,
        occurredAt: event.occurred_at.toISOString(),
      })),
      notifications: notificationResult.rows.map((notification) => ({
        id: notification.id,
        type: notification.notification_type,
        status: notification.status,
        attemptCount: notification.attempt_count,
        createdAt: notification.created_at.toISOString(),
      })),
    };
  }

  private async dayBookings(localDate: string): Promise<BookingRead[]> {
    const result = await this.database.pool.query<BookingRow>(
      `
        SELECT ${bookingSelect}
        FROM bookings AS booking
        JOIN customers AS customer ON customer.id = booking.customer_id
        JOIN pets AS pet ON pet.id = booking.pet_id
        WHERE (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date
        ORDER BY booking.starts_at, booking.id
      `,
      [localDate],
    );
    return result.rows.map(bookingRead);
  }

  private async capacityBlocks(localDate: string): Promise<CapacityBlockRow[]> {
    const result = await this.database.pool.query<CapacityBlockRow>(
      `
        SELECT id, staff_id, 'time_off'::text AS kind, status,
               to_char(starts_at, 'HH24:MI') AS starts_at,
               to_char(ends_at, 'HH24:MI') AS ends_at,
               reason
        FROM staff_time_off_intervals
        WHERE local_date = $1::date AND status IN ('pending', 'active')
        UNION ALL
        SELECT id, NULL AS staff_id, 'store_closure'::text AS kind, status,
               to_char(starts_at, 'HH24:MI') AS starts_at,
               to_char(ends_at, 'HH24:MI') AS ends_at,
               reason
        FROM store_closure_intervals
        WHERE local_date = $1::date AND status IN ('pending', 'active')
        ORDER BY starts_at, id
      `,
      [localDate],
    );
    return result.rows;
  }

  private async failedNotifications(): Promise<FailedNotificationRow[]> {
    const result = await this.database.pool.query<FailedNotificationRow>(
      `
        SELECT notification.id,
               notification.booking_id,
               notification.attempt_count,
               booking.pet_name_snapshot
        FROM notification_outbox AS notification
        JOIN bookings AS booking ON booking.id = notification.booking_id
        WHERE notification.status = 'failed'
        ORDER BY notification.available_at, notification.id
        LIMIT 5
      `,
    );
    return result.rows;
  }

  private async pendingCapacityRisks(localDate: string): Promise<PendingCapacityRiskRow[]> {
    const result = await this.database.pool.query<PendingCapacityRiskRow>(
      `WITH pending_change AS (
         SELECT time_off.id,
                'time_off'::text AS kind,
                time_off.local_date,
                time_off.starts_at,
                time_off.ends_at,
                time_off.staff_id,
                account.display_name AS staff_display_name
         FROM staff_time_off_intervals AS time_off
         JOIN backoffice_accounts AS account ON account.id = time_off.staff_id
         WHERE time_off.status = 'pending'
           AND time_off.local_date BETWEEN $1::date AND ($1::date + 13)
         UNION ALL
         SELECT closure.id,
                'store_closure'::text AS kind,
                closure.local_date,
                closure.starts_at,
                closure.ends_at,
                NULL AS staff_id,
                NULL AS staff_display_name
         FROM store_closure_intervals AS closure
         WHERE closure.status = 'pending'
           AND closure.local_date BETWEEN $1::date AND ($1::date + 13)
       )
       SELECT pending_change.id,
              pending_change.kind,
              to_char(pending_change.local_date, 'YYYY-MM-DD') AS local_date,
              to_char(pending_change.starts_at, 'HH24:MI') AS starts_at,
              to_char(pending_change.ends_at, 'HH24:MI') AS ends_at,
              pending_change.staff_display_name,
              (
                SELECT count(*)::int
                FROM bookings AS booking
                WHERE booking.status IN ('confirmed', 'checked_in')
                  AND (
                    pending_change.staff_id IS NULL
                    OR booking.staff_id = pending_change.staff_id
                  )
                  AND booking.occupancy_starts_at <
                    ((pending_change.local_date + pending_change.ends_at) AT TIME ZONE 'Asia/Shanghai')
                  AND booking.occupancy_ends_at >
                    ((pending_change.local_date + pending_change.starts_at) AT TIME ZONE 'Asia/Shanghai')
              ) AS affected_booking_count
       FROM pending_change
       ORDER BY local_date, starts_at, id`,
      [localDate],
    );
    return result.rows;
  }

  private localTime(instant: string): string {
    const local = new Date(Date.parse(instant) + 8 * 60 * 60_000);
    return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  }
}
