import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  businessPeriods,
  type BusinessPeriodDays,
  type BusinessPeriodSnapshot,
  type BusinessRevisitSnapshot,
  type ManagerBusinessMetricsResponse,
  type ManagerBusinessSeriesResponse,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import type { BackofficeIdentity } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { addLocalDays } from "../schedule/schedule-date.js";
import {
  businessPeriodWindows,
  calculateBusinessSnapshot,
  type BusinessBookingFact,
  type BusinessBookingStatus,
  type BusinessCapacityDayFact,
  type BusinessClockInterval,
  type BusinessSnapshot,
} from "./business-metrics.js";

export interface BusinessExportFile {
  filename: string;
  contentType: string;
  body: string;
}

interface DatedBookingFact extends BusinessBookingFact {
  localDate: string;
}

interface BookingRow {
  local_date: string;
  customer_id: string;
  status: BusinessBookingStatus;
  service_duration_minutes: number;
  total_price_cents: number;
}

interface ScheduleRow {
  staff_id: string;
  local_date: string;
  shift_starts_at: string;
  shift_ends_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface TimeOffRow {
  staff_id: string;
  local_date: string;
  starts_at: string;
  ends_at: string;
}

function clockMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function interval(startsAt: string, endsAt: string): BusinessClockInterval {
  return { startsAtMinutes: clockMinutes(startsAt), endsAtMinutes: clockMinutes(endsAt) };
}

function inWindow(localDate: string, window: { startsOn: string; endsOn: string }): boolean {
  return localDate >= window.startsOn && localDate <= window.endsOn;
}

function shanghaiWindowBounds(startsOn: string, endsOn: string): [string, string] {
  return [
    new Date(`${startsOn}T00:00:00+08:00`).toISOString(),
    new Date(`${addLocalDays(endsOn, 1)}T00:00:00+08:00`).toISOString(),
  ];
}

function currentPeriodRevision(
  bookings: DatedBookingFact[],
  capacityDays: BusinessCapacityDayFact[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ bookings, capacityDays }))
    .digest("hex")
    .slice(0, 16);
}

function periodSnapshot(snapshot: BusinessSnapshot): BusinessPeriodSnapshot {
  return {
    bookingCount: snapshot.bookingCount,
    completedBookingCount: snapshot.completedBookingCount,
    completedServiceMinutes: snapshot.completedServiceMinutes,
    availableStaffMinutes: snapshot.availableStaffMinutes,
    utilizationRate: snapshot.utilizationRate,
    completedListPriceCents: snapshot.completedListPriceCents,
    cancellationCount: snapshot.cancellationCount,
    cancellationDenominator: snapshot.cancellationDenominator,
    cancellationRate: snapshot.cancellationRate,
    noShowCount: snapshot.noShowCount,
    noShowDenominator: snapshot.noShowDenominator,
    noShowRate: snapshot.noShowRate,
    terminationCount: snapshot.terminationCount,
    terminationDenominator: snapshot.terminationDenominator,
    terminationRate: snapshot.terminationRate,
  };
}

function revisitSnapshot(snapshot: BusinessSnapshot): BusinessRevisitSnapshot {
  return {
    completedCustomerCount: snapshot.completedCustomerCount,
    revisitCustomerCount: snapshot.revisitCustomerCount,
    revisitRate: snapshot.revisitRate,
  };
}

export function parseBusinessPeriod(value: string | undefined): BusinessPeriodDays {
  const parsed = value === undefined || value === "" ? 30 : Number(value);
  if (!businessPeriods.some((period) => period === parsed)) {
    throw new HttpException(
      { code: "INVALID_BUSINESS_PERIOD", message: "经营周期只支持最近 7、30 或 90 天。" },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed as BusinessPeriodDays;
}

@Injectable()
export class BusinessService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  private async readSnapshot<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await read(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async bookings(
    client: PoolClient,
    startsOn: string,
    endsOn: string,
  ): Promise<DatedBookingFact[]> {
    const [startsAt, endsBefore] = shanghaiWindowBounds(startsOn, endsOn);
    const result = await client.query<BookingRow>(
      `SELECT to_char(booking.starts_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS local_date,
              booking.customer_id,
              booking.status,
              booking.service_duration_minutes,
              booking.total_price_cents
       FROM bookings AS booking
       WHERE booking.starts_at >= $1::timestamptz
         AND booking.starts_at < $2::timestamptz
       ORDER BY booking.starts_at, booking.id`,
      [startsAt, endsBefore],
    );

    return result.rows.map((row) => ({
      localDate: row.local_date,
      customerId: row.customer_id,
      status: row.status,
      serviceMinutes: row.service_duration_minutes,
      priceCents: row.total_price_cents,
    }));
  }

  private async capacityDays(
    client: PoolClient,
    startsOn: string,
    endsOn: string,
  ): Promise<BusinessCapacityDayFact[]> {
    const schedule = await client.query<ScheduleRow>(
      `SELECT day.staff_id,
                to_char(day.local_date, 'YYYY-MM-DD') AS local_date,
                to_char(shift.starts_at, 'HH24:MI') AS shift_starts_at,
                to_char(shift.ends_at, 'HH24:MI') AS shift_ends_at,
                to_char(shift_break.starts_at, 'HH24:MI') AS break_starts_at,
                to_char(shift_break.ends_at, 'HH24:MI') AS break_ends_at
         FROM staff_schedule_days AS day
         JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
         LEFT JOIN staff_schedule_breaks AS shift_break
           ON shift_break.schedule_shift_id = shift.id
         WHERE day.publication_status = 'published'
           AND day.published_at IS NOT NULL
           AND day.local_date BETWEEN $1::date AND $2::date
         ORDER BY day.local_date, day.staff_id, shift.starts_at, shift_break.starts_at`,
      [startsOn, endsOn],
    );
    const timeOff = await client.query<TimeOffRow>(
      `SELECT staff_id,
                to_char(local_date, 'YYYY-MM-DD') AS local_date,
                to_char(starts_at, 'HH24:MI') AS starts_at,
                to_char(ends_at, 'HH24:MI') AS ends_at
         FROM staff_time_off_intervals
         WHERE status = 'active'
           AND local_date BETWEEN $1::date AND $2::date
         ORDER BY local_date, staff_id, starts_at`,
      [startsOn, endsOn],
    );
    const builders = new Map<
      string,
      BusinessCapacityDayFact & { shiftKeys: Set<string>; breakKeys: Set<string> }
    >();

    function builder(staffId: string, localDate: string) {
      const key = `${localDate}\0${staffId}`;
      let current = builders.get(key);
      if (!current) {
        current = {
          staffId,
          localDate,
          shifts: [],
          breaks: [],
          activeTimeOff: [],
          shiftKeys: new Set(),
          breakKeys: new Set(),
        };
        builders.set(key, current);
      }
      return current;
    }

    for (const row of schedule.rows) {
      const current = builder(row.staff_id, row.local_date);
      const shiftKey = `${row.shift_starts_at}-${row.shift_ends_at}`;
      if (!current.shiftKeys.has(shiftKey)) {
        current.shifts.push(interval(row.shift_starts_at, row.shift_ends_at));
        current.shiftKeys.add(shiftKey);
      }
      if (row.break_starts_at && row.break_ends_at) {
        const breakKey = `${row.break_starts_at}-${row.break_ends_at}`;
        if (!current.breakKeys.has(breakKey)) {
          current.breaks.push(interval(row.break_starts_at, row.break_ends_at));
          current.breakKeys.add(breakKey);
        }
      }
    }
    for (const row of timeOff.rows) {
      builder(row.staff_id, row.local_date).activeTimeOff.push(
        interval(row.starts_at, row.ends_at),
      );
    }

    return [...builders.values()].map(({ staffId, localDate, shifts, breaks, activeTimeOff }) => ({
      staffId,
      localDate,
      shifts,
      breaks,
      activeTimeOff,
    }));
  }

  async metrics(periodDays: BusinessPeriodDays): Promise<ManagerBusinessMetricsResponse> {
    const demoNow = getDemoNow();
    const selectedWindows = businessPeriodWindows(demoNow, periodDays);
    const revisitWindows = businessPeriodWindows(demoNow, 90);
    return this.readSnapshot(async (client) => {
      const bookings = await this.bookings(
        client,
        revisitWindows.previous.startsOn,
        revisitWindows.current.endsOn,
      );
      const capacityDays = await this.capacityDays(
        client,
        selectedWindows.previous.startsOn,
        selectedWindows.current.endsOn,
      );
      const currentBookings = bookings.filter((booking) =>
        inWindow(booking.localDate, selectedWindows.current),
      );
      const currentCapacityDays = capacityDays.filter((day) =>
        inWindow(day.localDate, selectedWindows.current),
      );
      const selectedSnapshot = (window: { startsOn: string; endsOn: string }) =>
        calculateBusinessSnapshot({
          bookings: bookings.filter((booking) => inWindow(booking.localDate, window)),
          capacityDays: capacityDays.filter((day) => inWindow(day.localDate, window)),
        });
      const revisit = (window: { startsOn: string; endsOn: string }) =>
        calculateBusinessSnapshot({
          bookings: bookings.filter((booking) => inWindow(booking.localDate, window)),
          capacityDays: [],
        });

      return {
        timeZone: "Asia/Shanghai",
        demoNow,
        periodDays,
        currentPeriodRevision: currentPeriodRevision(currentBookings, currentCapacityDays),
        currentWindow: selectedWindows.current,
        previousWindow: selectedWindows.previous,
        current: periodSnapshot(selectedSnapshot(selectedWindows.current)),
        previous: periodSnapshot(selectedSnapshot(selectedWindows.previous)),
        revisit90Days: {
          periodDays: 90,
          currentWindow: revisitWindows.current,
          previousWindow: revisitWindows.previous,
          current: revisitSnapshot(revisit(revisitWindows.current)),
          previous: revisitSnapshot(revisit(revisitWindows.previous)),
        },
      };
    });
  }

  async series(periodDays: BusinessPeriodDays): Promise<ManagerBusinessSeriesResponse> {
    const window = businessPeriodWindows(getDemoNow(), periodDays).current;
    return this.readSnapshot(async (client) => {
      const bookings = await this.bookings(client, window.startsOn, window.endsOn);
      const capacityDays = await this.capacityDays(client, window.startsOn, window.endsOn);
      const revision = currentPeriodRevision(bookings, capacityDays);
      const points: ManagerBusinessSeriesResponse["points"] = [];

      for (let localDate = window.startsOn; localDate <= window.endsOn;) {
        const snapshot = calculateBusinessSnapshot({
          bookings: bookings.filter((booking) => booking.localDate === localDate),
          capacityDays: capacityDays.filter((day) => day.localDate === localDate),
        });
        points.push({ localDate, ...periodSnapshot(snapshot) });
        localDate = addLocalDays(localDate, 1);
      }

      return {
        timeZone: "Asia/Shanghai",
        periodDays,
        currentPeriodRevision: revision,
        window,
        points,
      };
    });
  }

  async exportCsv(
    identity: BackofficeIdentity,
    periodDays: BusinessPeriodDays,
  ): Promise<BusinessExportFile> {
    const series = await this.series(periodDays);
    const header = [
      "上海业务日期",
      "已完成预约数",
      "计划服务分钟数",
      "排班可服务分钟数",
      "服务工时利用率",
      "已完成服务标价（非实收金额）",
      "取消数",
      "全部预约数",
      "取消率",
      "爽约数",
      "未取消预约数",
      "爽约率",
      "服务终止数",
      "服务终止率",
    ];
    const rows = series.points.map((point) => [
      point.localDate,
      point.completedBookingCount,
      point.completedServiceMinutes,
      point.availableStaffMinutes,
      formatCsvRate(point.utilizationRate),
      (point.completedListPriceCents / 100).toFixed(2),
      point.cancellationCount,
      point.cancellationDenominator,
      formatCsvRate(point.cancellationRate),
      point.noShowCount,
      point.noShowDenominator,
      formatCsvRate(point.noShowRate),
      point.terminationCount,
      formatCsvRate(point.terminationRate),
    ]);
    await this.audits.append({
      eventType: "data_exported",
      actor: { type: "manager", id: identity.id },
      subject: { type: "store", id: "rongguang-store" },
      payload: {
        exportType: "business_metrics_csv",
        filters: { periodDays },
        recordCount: rows.length,
      },
      occurredAt: getDemoNow(),
    });

    return {
      filename: `rongguang-business-${periodDays}-days-${series.window.endsOn.replaceAll("-", "")}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: `\uFEFF${[header, ...rows].map(csvRow).join("\r\n")}\r\n`,
    };
  }
}

function formatCsvRate(value: number | null): string {
  return value === null ? "" : `${(value * 100).toFixed(2)}%`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(",");
}
