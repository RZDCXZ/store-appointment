import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ManagerBookingDetailResponse,
  ManagerBookingFact,
  ManagerBookingStatus,
  ManagerBookingStatusSummary,
  ManagerCalendarBlock,
  ManagerCalendarResponse,
  ManagerCapacitySummary,
  ManagerStaffDay,
  ManagerWorkbenchResponse,
  ManagerWorkbenchRisk,
} from "@rongguang/contracts";

import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { getShanghaiLocalDate } from "../schedule/schedule-date.js";
import { ScheduleService } from "../schedule/schedule.service.js";

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
  occupancy_starts_at: Date;
  occupancy_ends_at: Date;
  total_price_cents: number;
  service_duration_minutes: number;
  turnover_minutes: number;
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

interface BookingRead {
  fact: ManagerBookingFact;
  occupancyMinutes: number;
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
  booking.turnover_minutes
`;

function phoneMasked(phone: string): string {
  if (phone.length < 7) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function bookingRead(row: BookingRow): BookingRead {
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
      turnoverEndsAt: row.occupancy_ends_at.toISOString(),
      totalPriceCents: row.total_price_cents,
      serviceDurationMinutes: row.service_duration_minutes,
      turnoverMinutes: row.turnover_minutes,
    },
    occupancyMinutes: Math.round(
      (row.occupancy_ends_at.getTime() - row.occupancy_starts_at.getTime()) / 60_000,
    ),
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

function publishedMinutes(shifts: ManagerStaffDay["shifts"]): number {
  return shifts.reduce((total, shift) => {
    const shiftMinutes = clockMinutes(shift.endsAt) - clockMinutes(shift.startsAt);
    const breakMinutes = shift.breaks.reduce(
      (sum, shiftBreak) =>
        sum + clockMinutes(shiftBreak.endsAt) - clockMinutes(shiftBreak.startsAt),
      0,
    );
    return total + shiftMinutes - breakMinutes;
  }, 0);
}

function capacitySummary(published: number, occupied: number): ManagerCapacitySummary {
  return {
    publishedMinutes: published,
    occupiedMinutes: occupied,
    remainingMinutes: Math.max(0, published - occupied),
  };
}

function affectsBooking(block: ManagerCalendarBlock, booking: ManagerBookingFact): boolean {
  const startsAt = localClockMinutes(booking.startsAt);
  const endsAt = localClockMinutes(booking.turnoverEndsAt);
  return startsAt < clockMinutes(block.endsAt) && endsAt > clockMinutes(block.startsAt);
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

@Injectable()
export class ManagerLiveBookingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

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
      const published = publishedMinutes(day.shifts);
      const occupied = dayBookingReads
        .filter((item) => !["cancelled", "no_show"].includes(item.fact.status))
        .reduce((total, item) => total + item.occupancyMinutes, 0);

      return {
        ...day,
        staff: {
          ...day.staff,
          avatarPath: `/assets/brand/staff-${day.staff.id}.png`,
        },
        bookings: dayBookingReads.map((item) => item.fact),
        blocks: blocks
          .filter((block) => !block.staffId || block.staffId === day.staff.id)
          .map(({ id, kind, status, startsAt, endsAt, reason, affectedBookingCount }) => ({
            id,
            kind,
            status,
            startsAt,
            endsAt,
            reason,
            affectedBookingCount,
          })),
        capacity: capacitySummary(published, occupied),
      };
    });
    const totalPublished = staffDays.reduce(
      (total, day) => total + day.capacity.publishedMinutes,
      0,
    );
    const totalOccupied = staffDays.reduce((total, day) => total + day.capacity.occupiedMinutes, 0);

    return {
      timeZone: schedule.timeZone,
      demoNow: schedule.demoNow,
      selectedDate: schedule.selectedDate,
      window: schedule.window,
      businessHours: schedule.businessHours,
      staffDays,
      capacity: capacitySummary(totalPublished, totalOccupied),
    };
  }

  async workbench(): Promise<ManagerWorkbenchResponse> {
    const demoNow = getDemoNow();
    const localDate = getShanghaiLocalDate(demoNow);
    const [calendar, failedNotifications] = await Promise.all([
      this.calendar(localDate),
      this.failedNotifications(),
    ]);
    const bookings = calendar.staffDays.flatMap((day) => day.bookings);
    const summary = bookings.reduce((counts, booking) => {
      counts[booking.status] += 1;
      return counts;
    }, emptyStatusSummary());
    const risks: ManagerWorkbenchRisk[] = [];

    for (const day of calendar.staffDays) {
      for (const block of day.blocks) {
        if (block.kind !== "time_off" || block.status !== "pending") continue;
        if (risks.some((risk) => risk.id === `time-off:${block.id}`)) continue;
        risks.push({
          id: `time-off:${block.id}`,
          kind: "pending_time_off",
          title: "待处理停班",
          detail: `${day.staff.displayName} ${block.startsAt}–${block.endsAt}，影响 ${block.affectedBookingCount} 笔预约`,
          href: `/manager/appointments/calendar?date=${localDate}`,
        });
      }
    }

    for (const notification of failedNotifications) {
      risks.push({
        id: `notification:${notification.id}`,
        kind: "failed_notification",
        title: "通知最终失败",
        detail: `${notification.pet_name_snapshot}的预约通知，自动发送 ${notification.attempt_count} 次失败`,
        href: `/manager/appointments/${notification.booking_id}`,
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

    return { booking: bookingRead(row).fact };
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

  private localTime(instant: string): string {
    const local = new Date(Date.parse(instant) + 8 * 60 * 60_000);
    return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  }
}
