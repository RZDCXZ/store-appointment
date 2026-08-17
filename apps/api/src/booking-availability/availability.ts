const halfHourMinutes = 30;
const shanghaiOffsetMinutes = 8 * 60;

export interface AvailabilityInterval {
  startsAtMinutes: number;
  endsAtMinutes: number;
}

export interface AvailabilityStaff {
  id: string;
  displayName: string;
  employeeNumber: number;
  skills: string[];
  capacity: AvailabilityInterval[];
}

export interface AvailabilityBooking {
  petId: string;
  staffId: string;
  startsAtMinutes: number;
  endsAtMinutes: number;
  occupancyStartsAtMinutes: number;
  occupancyEndsAtMinutes: number;
  serviceMinutes: number;
}

export type StaffPreference = { kind: "fastest" } | { kind: "specified"; staffId: string };

export type UnavailableDayReason =
  "closed" | "no_qualified_staff" | "fully_booked" | "outside_open_window";

export interface DayAvailabilitySlot {
  startsAtMinutes: number;
  endsAtMinutes: number;
  occupancyEndsAtMinutes: number;
  staffId: string;
}

interface DiscoverDayAvailabilityInput {
  date: string;
  window: { startsOn: string; endsOn: string };
  businessHours: AvailabilityInterval | null;
  earliestStartsAtMinutes: number;
  petId: string;
  requiredSkills: string[];
  serviceMinutes: number;
  turnoverMinutes: number;
  staffPreference: StaffPreference;
  staff: AvailabilityStaff[];
  bookings: AvailabilityBooking[];
}

export interface DayAvailability {
  date: string;
  reason: UnavailableDayReason | null;
  qualifiedStaffIds: string[];
  slots: DayAvailabilitySlot[];
}

function shanghaiLocalDate(instant: Date): string {
  return new Date(instant.getTime() + shanghaiOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function addUtcDays(localDate: string, amount: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function bookingWindowFor(now: string | Date): { startsOn: string; endsOn: string } {
  const instant = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(instant.getTime())) {
    throw new Error("无法为无效时刻建立预约开放窗口。");
  }

  const startsOn = shanghaiLocalDate(instant);
  return { startsOn, endsOn: addUtcDays(startsOn, 13) };
}

export function earliestCustomerCandidate(now: string | Date): string {
  const instant = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(instant.getTime())) {
    throw new Error("无法从无效时刻计算最早可约时段。");
  }

  const afterLeadTime = instant.getTime() + 2 * 60 * 60_000;
  const intervalMilliseconds = halfHourMinutes * 60_000;
  return new Date(
    Math.ceil(afterLeadTime / intervalMilliseconds) * intervalMilliseconds,
  ).toISOString();
}

export function earliestCandidateMinutesForDate(
  localDate: string,
  earliestStartsAt: string,
): number {
  const earliest = new Date(earliestStartsAt);
  if (Number.isNaN(earliest.getTime())) {
    throw new Error("无法从无效时刻计算当日最早可约分钟。");
  }

  const earliestLocalDate = shanghaiLocalDate(earliest);
  if (localDate < earliestLocalDate) return 24 * 60;
  if (localDate > earliestLocalDate) return 0;

  const shifted = new Date(earliest.getTime() + shanghaiOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function subtractAvailabilityIntervals(
  capacity: AvailabilityInterval[],
  blocks: AvailabilityInterval[],
): AvailabilityInterval[] {
  return [...blocks]
    .sort((left, right) => left.startsAtMinutes - right.startsAtMinutes)
    .reduce<AvailabilityInterval[]>(
      (remaining, block) => {
        return remaining.flatMap((interval) => {
          if (!overlaps(interval, block)) return [interval];

          const fragments: AvailabilityInterval[] = [];
          if (interval.startsAtMinutes < block.startsAtMinutes) {
            fragments.push({
              startsAtMinutes: interval.startsAtMinutes,
              endsAtMinutes: Math.min(interval.endsAtMinutes, block.startsAtMinutes),
            });
          }
          if (block.endsAtMinutes < interval.endsAtMinutes) {
            fragments.push({
              startsAtMinutes: Math.max(interval.startsAtMinutes, block.endsAtMinutes),
              endsAtMinutes: interval.endsAtMinutes,
            });
          }
          return fragments;
        });
      },
      capacity.map((interval) => ({ ...interval })),
    );
}

function contains(container: AvailabilityInterval, interval: AvailabilityInterval): boolean {
  return (
    container.startsAtMinutes <= interval.startsAtMinutes &&
    interval.endsAtMinutes <= container.endsAtMinutes
  );
}

function overlaps(left: AvailabilityInterval, right: AvailabilityInterval): boolean {
  return left.startsAtMinutes < right.endsAtMinutes && right.startsAtMinutes < left.endsAtMinutes;
}

function hasAllSkills(staffMember: AvailabilityStaff, requiredSkills: string[]): boolean {
  const staffSkills = new Set(staffMember.skills);
  return requiredSkills.every((skill) => staffSkills.has(skill));
}

function bookedServiceMinutes(staffId: string, bookings: AvailabilityBooking[]): number {
  return bookings
    .filter((booking) => booking.staffId === staffId)
    .reduce((total, booking) => total + booking.serviceMinutes, 0);
}

function nextHalfHour(value: number): number {
  return Math.ceil(value / halfHourMinutes) * halfHourMinutes;
}

export function discoverDayAvailability(input: DiscoverDayAvailabilityInput): DayAvailability {
  if (input.date < input.window.startsOn || input.date > input.window.endsOn) {
    return {
      date: input.date,
      reason: "outside_open_window",
      qualifiedStaffIds: [],
      slots: [],
    };
  }

  const preferenceStaffId =
    input.staffPreference.kind === "specified" ? input.staffPreference.staffId : null;
  const skillQualifiedStaff = input.staff
    .filter((staffMember) => !preferenceStaffId || staffMember.id === preferenceStaffId)
    .filter((staffMember) => hasAllSkills(staffMember, input.requiredSkills))
    .sort((left, right) => left.employeeNumber - right.employeeNumber);
  const qualifiedStaffIds = skillQualifiedStaff.map((staffMember) => staffMember.id);

  if (!input.businessHours) {
    return { date: input.date, reason: "closed", qualifiedStaffIds, slots: [] };
  }

  const qualifiedStaff = skillQualifiedStaff.filter(
    (staffMember) => staffMember.capacity.length > 0,
  );

  if (qualifiedStaff.length === 0) {
    return { date: input.date, reason: "no_qualified_staff", qualifiedStaffIds, slots: [] };
  }

  const slots: DayAvailabilitySlot[] = [];
  const firstCandidate = nextHalfHour(
    Math.max(input.businessHours.startsAtMinutes, input.earliestStartsAtMinutes),
  );

  for (
    let startsAtMinutes = firstCandidate;
    startsAtMinutes < input.businessHours.endsAtMinutes;
    startsAtMinutes += halfHourMinutes
  ) {
    const service = {
      startsAtMinutes,
      endsAtMinutes: startsAtMinutes + input.serviceMinutes,
    };
    const occupancy = {
      startsAtMinutes,
      endsAtMinutes: service.endsAtMinutes + input.turnoverMinutes,
    };

    if (!contains(input.businessHours, occupancy)) {
      continue;
    }

    const petConflict = input.bookings.some(
      (booking) =>
        booking.petId === input.petId &&
        overlaps(service, {
          startsAtMinutes: booking.startsAtMinutes,
          endsAtMinutes: booking.endsAtMinutes,
        }),
    );

    if (petConflict) {
      continue;
    }

    const availableStaff = qualifiedStaff
      .filter((staffMember) =>
        staffMember.capacity.some((capacity) => contains(capacity, occupancy)),
      )
      .filter(
        (staffMember) =>
          !input.bookings.some(
            (booking) =>
              booking.staffId === staffMember.id &&
              overlaps(occupancy, {
                startsAtMinutes: booking.occupancyStartsAtMinutes,
                endsAtMinutes: booking.occupancyEndsAtMinutes,
              }),
          ),
      )
      .sort((left, right) => {
        const workloadDifference =
          bookedServiceMinutes(left.id, input.bookings) -
          bookedServiceMinutes(right.id, input.bookings);
        return workloadDifference || left.employeeNumber - right.employeeNumber;
      });

    const assignedStaff = availableStaff[0];
    if (assignedStaff) {
      slots.push({
        startsAtMinutes,
        endsAtMinutes: service.endsAtMinutes,
        occupancyEndsAtMinutes: occupancy.endsAtMinutes,
        staffId: assignedStaff.id,
      });
    }
  }

  return {
    date: input.date,
    reason: slots.length > 0 ? null : "fully_booked",
    qualifiedStaffIds,
    slots,
  };
}
