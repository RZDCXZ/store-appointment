import { describe, expect, it } from "vitest";

import {
  bookingWindowFor,
  discoverDayAvailability,
  earliestCustomerCandidate,
  type AvailabilityBooking,
  type AvailabilityStaff,
} from "../src/booking-availability/availability.js";

const openDay = { startsAtMinutes: 9 * 60 + 30, endsAtMinutes: 19 * 60 };

function staff(
  id: string,
  employeeNumber: number,
  skills: string[],
  capacity = [openDay],
): AvailabilityStaff {
  return { id, displayName: id, employeeNumber, skills, capacity };
}

function booking(
  petId: string,
  staffId: string,
  startsAtMinutes: number,
  serviceMinutes: number,
): AvailabilityBooking {
  return {
    petId,
    staffId,
    startsAtMinutes,
    endsAtMinutes: startsAtMinutes + serviceMinutes,
    occupancyEndsAtMinutes: startsAtMinutes + serviceMinutes + 15,
    serviceMinutes,
  };
}

describe("顾客查询真实可约时段领域规则", () => {
  it("按上海自然日建立含首尾的十四日窗口，并把两小时提前量向上取整到三十分钟候选点", () => {
    const now = "2026-08-13T02:50:00.000Z";

    expect(bookingWindowFor(now)).toEqual({ startsOn: "2026-08-13", endsOn: "2026-08-26" });
    expect(earliestCustomerCandidate(now)).toBe("2026-08-13T05:00:00.000Z");
  });

  it("要求服务与十五分钟周转完整位于同一可用区间，并允许左闭右开区间首尾相邻", () => {
    const linxia = staff(
      "linxia",
      1,
      ["dog-basic-care"],
      [{ startsAtMinutes: 9 * 60 + 30, endsAtMinutes: 13 * 60 }],
    );
    const result = discoverDayAvailability({
      date: "2026-08-14",
      window: { startsOn: "2026-08-13", endsOn: "2026-08-26" },
      businessHours: openDay,
      earliestStartsAtMinutes: 0,
      petId: "pet-tuanzi",
      requiredSkills: ["dog-basic-care"],
      serviceMinutes: 60,
      turnoverMinutes: 15,
      staffPreference: { kind: "specified", staffId: "linxia" },
      staff: [linxia],
      bookings: [booking("pet-other", "linxia", 10 * 60 + 15, 60)],
    });

    expect(result.slots.map((slot) => slot.startsAtMinutes)).toContain(11 * 60 + 30);
    expect(result.slots.map((slot) => slot.startsAtMinutes)).not.toContain(12 * 60);
    expect(result.slots.every((slot) => slot.staffId === "linxia")).toBe(true);
  });

  it("只让覆盖全部技能的员工参与，并按服务分钟数与固定员工编号选择最快可约", () => {
    const baseInput = {
      date: "2026-08-14",
      window: { startsOn: "2026-08-13", endsOn: "2026-08-26" },
      businessHours: openDay,
      earliestStartsAtMinutes: 0,
      petId: "pet-tuanzi",
      requiredSkills: ["dog-basic-care", "oral-care"],
      serviceMinutes: 60,
      turnoverMinutes: 15,
      staffPreference: { kind: "fastest" as const },
      staff: [
        staff("linxia", 1, ["dog-basic-care", "oral-care"]),
        staff("chenjia", 2, ["dog-basic-care"]),
        staff("zhaohang", 4, ["dog-basic-care", "oral-care"]),
      ],
    };
    const lowerLoad = discoverDayAvailability({
      ...baseInput,
      bookings: [
        booking("pet-a", "linxia", 15 * 60, 120),
        booking("pet-b", "zhaohang", 15 * 60, 30),
      ],
    });

    expect(lowerLoad.slots[0]).toMatchObject({ staffId: "zhaohang" });
    expect(lowerLoad.qualifiedStaffIds).toEqual(["linxia", "zhaohang"]);

    const employeeNumberTie = discoverDayAvailability({
      ...baseInput,
      bookings: [
        booking("pet-a", "linxia", 15 * 60, 30),
        booking("pet-b", "zhaohang", 15 * 60, 30),
      ],
    });

    expect(employeeNumberTie.slots[0]).toMatchObject({ staffId: "linxia" });
  });

  it("同一宠物的重叠服务排除所有员工，不同宠物仍可由另一员工同时服务", () => {
    const staffMembers = [staff("linxia", 1, ["cat-care"]), staff("zhouning", 3, ["cat-care"])];
    const common = {
      date: "2026-08-14",
      window: { startsOn: "2026-08-13", endsOn: "2026-08-26" },
      businessHours: openDay,
      earliestStartsAtMinutes: 10 * 60,
      requiredSkills: ["cat-care"],
      serviceMinutes: 90,
      turnoverMinutes: 15,
      staffPreference: { kind: "fastest" as const },
      staff: staffMembers,
    };

    const samePet = discoverDayAvailability({
      ...common,
      petId: "pet-bohe",
      bookings: [booking("pet-bohe", "linxia", 10 * 60, 90)],
    });
    const otherPet = discoverDayAvailability({
      ...common,
      petId: "pet-tuanzi",
      bookings: [booking("pet-bohe", "linxia", 10 * 60, 90)],
    });

    expect(samePet.slots.find((slot) => slot.startsAtMinutes === 10 * 60)).toBeUndefined();
    expect(otherPet.slots.find((slot) => slot.startsAtMinutes === 10 * 60)).toMatchObject({
      staffId: "zhouning",
    });
  });

  it("无时段时区分周一闭店、暂无合格员工、已约满和超出开放窗口", () => {
    const common = {
      window: { startsOn: "2026-08-13", endsOn: "2026-08-26" },
      earliestStartsAtMinutes: 0,
      petId: "pet-tuanzi",
      requiredSkills: ["dog-styling"],
      serviceMinutes: 120,
      turnoverMinutes: 15,
      staffPreference: { kind: "fastest" as const },
      bookings: [] as AvailabilityBooking[],
    };

    expect(
      discoverDayAvailability({
        ...common,
        date: "2026-08-17",
        businessHours: null,
        staff: [staff("linxia", 1, ["dog-styling"])],
      }).reason,
    ).toBe("closed");
    expect(
      discoverDayAvailability({
        ...common,
        date: "2026-08-16",
        businessHours: openDay,
        staff: [staff("zhouning", 3, ["cat-care"])],
      }).reason,
    ).toBe("no_qualified_staff");
    expect(
      discoverDayAvailability({
        ...common,
        date: "2026-08-14",
        businessHours: openDay,
        staff: [staff("linxia", 1, ["dog-styling"])],
        bookings: [booking("pet-other", "linxia", 9 * 60 + 30, 9 * 60)],
      }).reason,
    ).toBe("fully_booked");
    expect(
      discoverDayAvailability({
        ...common,
        date: "2026-08-27",
        businessHours: openDay,
        staff: [staff("linxia", 1, ["dog-styling"])],
      }).reason,
    ).toBe("outside_open_window");
  });
});
