import { addLocalDays, getShanghaiLocalDate } from "../schedule/schedule-date.js";

export type BusinessBookingStatus =
  "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show" | "terminated";

export interface BusinessBookingFact {
  customerId: string;
  status: BusinessBookingStatus;
  serviceMinutes: number;
  priceCents: number;
}

export interface BusinessClockInterval {
  startsAtMinutes: number;
  endsAtMinutes: number;
}

export interface BusinessCapacityDayFact {
  staffId: string;
  localDate: string;
  shifts: BusinessClockInterval[];
  breaks: BusinessClockInterval[];
  activeTimeOff: BusinessClockInterval[];
}

export interface BusinessSnapshot {
  bookingCount: number;
  completedBookingCount: number;
  completedServiceMinutes: number;
  availableStaffMinutes: number;
  utilizationRate: number | null;
  completedListPriceCents: number;
  cancellationCount: number;
  cancellationDenominator: number;
  cancellationRate: number | null;
  noShowCount: number;
  noShowDenominator: number;
  noShowRate: number | null;
  terminationCount: number;
  terminationDenominator: number;
  terminationRate: number | null;
  completedCustomerCount: number;
  revisitCustomerCount: number;
  revisitRate: number | null;
}

export interface BusinessDateWindow {
  startsOn: string;
  endsOn: string;
}

function mergeIntervals(intervals: BusinessClockInterval[]): BusinessClockInterval[] {
  const sorted = intervals
    .filter((interval) => interval.endsAtMinutes > interval.startsAtMinutes)
    .toSorted((left, right) => left.startsAtMinutes - right.startsAtMinutes);
  const merged: BusinessClockInterval[] = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.startsAtMinutes > previous.endsAtMinutes) {
      merged.push({ ...interval });
      continue;
    }

    previous.endsAtMinutes = Math.max(previous.endsAtMinutes, interval.endsAtMinutes);
  }

  return merged;
}

function intervalMinutes(intervals: BusinessClockInterval[]): number {
  return intervals.reduce(
    (total, interval) => total + interval.endsAtMinutes - interval.startsAtMinutes,
    0,
  );
}

function availableMinutes(day: BusinessCapacityDayFact): number {
  const working = mergeIntervals(day.shifts);
  const unavailable = mergeIntervals([...day.breaks, ...day.activeTimeOff]);
  const unavailableInsideWorking = mergeIntervals(
    working.flatMap((shift) =>
      unavailable.map((interval) => ({
        startsAtMinutes: Math.max(shift.startsAtMinutes, interval.startsAtMinutes),
        endsAtMinutes: Math.min(shift.endsAtMinutes, interval.endsAtMinutes),
      })),
    ),
  );

  return intervalMinutes(working) - intervalMinutes(unavailableInsideWorking);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function calculateBusinessSnapshot(input: {
  bookings: BusinessBookingFact[];
  capacityDays: BusinessCapacityDayFact[];
}): BusinessSnapshot {
  const completed = input.bookings.filter((booking) => booking.status === "completed");
  const cancellationCount = input.bookings.filter(
    (booking) => booking.status === "cancelled",
  ).length;
  const noShowCount = input.bookings.filter((booking) => booking.status === "no_show").length;
  const terminationCount = input.bookings.filter(
    (booking) => booking.status === "terminated",
  ).length;
  const completedCountsByCustomer = new Map<string, number>();

  for (const booking of completed) {
    completedCountsByCustomer.set(
      booking.customerId,
      (completedCountsByCustomer.get(booking.customerId) ?? 0) + 1,
    );
  }

  const bookingCount = input.bookings.length;
  const completedServiceMinutes = completed.reduce(
    (total, booking) => total + booking.serviceMinutes,
    0,
  );
  const availableStaffMinutes = input.capacityDays.reduce(
    (total, day) => total + availableMinutes(day),
    0,
  );
  const completedCustomerCount = completedCountsByCustomer.size;
  const revisitCustomerCount = [...completedCountsByCustomer.values()].filter(
    (count) => count >= 2,
  ).length;
  const noShowDenominator = bookingCount - cancellationCount;

  return {
    bookingCount,
    completedBookingCount: completed.length,
    completedServiceMinutes,
    availableStaffMinutes,
    utilizationRate: rate(completedServiceMinutes, availableStaffMinutes),
    completedListPriceCents: completed.reduce((total, booking) => total + booking.priceCents, 0),
    cancellationCount,
    cancellationDenominator: bookingCount,
    cancellationRate: rate(cancellationCount, bookingCount),
    noShowCount,
    noShowDenominator,
    noShowRate: rate(noShowCount, noShowDenominator),
    terminationCount,
    terminationDenominator: bookingCount,
    terminationRate: rate(terminationCount, bookingCount),
    completedCustomerCount,
    revisitCustomerCount,
    revisitRate: rate(revisitCustomerCount, completedCustomerCount),
  };
}

export function businessPeriodWindows(
  now: string,
  periodDays: number,
): { current: BusinessDateWindow; previous: BusinessDateWindow } {
  const endsOn = getShanghaiLocalDate(now);
  const startsOn = addLocalDays(endsOn, -(periodDays - 1));
  const previousEndsOn = addLocalDays(startsOn, -1);

  return {
    current: { startsOn, endsOn },
    previous: {
      startsOn: addLocalDays(previousEndsOn, -(periodDays - 1)),
      endsOn: previousEndsOn,
    },
  };
}
