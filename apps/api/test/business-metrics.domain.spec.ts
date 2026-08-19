import { describe, expect, it } from "vitest";

import {
  businessPeriodWindows,
  calculateBusinessSnapshot,
} from "../src/business/business-metrics.js";

describe("经营看板领域公式", () => {
  it("从已完成预约和扣除休息、生效停班后的排班得到唯一经营指标", () => {
    const snapshot = calculateBusinessSnapshot({
      bookings: [
        {
          customerId: "customer-repeat",
          status: "completed",
          serviceMinutes: 60,
          priceCents: 12_800,
        },
        {
          customerId: "customer-repeat",
          status: "completed",
          serviceMinutes: 90,
          priceCents: 16_800,
        },
        {
          customerId: "customer-once",
          status: "completed",
          serviceMinutes: 60,
          priceCents: 12_800,
        },
        {
          customerId: "customer-cancelled",
          status: "cancelled",
          serviceMinutes: 120,
          priceCents: 22_800,
        },
        {
          customerId: "customer-no-show",
          status: "no_show",
          serviceMinutes: 90,
          priceCents: 16_800,
        },
        {
          customerId: "customer-terminated",
          status: "terminated",
          serviceMinutes: 60,
          priceCents: 12_800,
        },
      ],
      capacityDays: [
        {
          staffId: "linxia",
          localDate: "2026-08-12",
          shifts: [{ startsAtMinutes: 570, endsAtMinutes: 1080 }],
          breaks: [{ startsAtMinutes: 780, endsAtMinutes: 840 }],
          activeTimeOff: [{ startsAtMinutes: 900, endsAtMinutes: 990 }],
        },
        {
          staffId: "chenjia",
          localDate: "2026-08-13",
          shifts: [{ startsAtMinutes: 600, endsAtMinutes: 720 }],
          breaks: [{ startsAtMinutes: 630, endsAtMinutes: 660 }],
          activeTimeOff: [{ startsAtMinutes: 645, endsAtMinutes: 690 }],
        },
      ],
    });

    expect(snapshot).toEqual({
      bookingCount: 6,
      completedBookingCount: 3,
      completedServiceMinutes: 210,
      availableStaffMinutes: 420,
      utilizationRate: 0.5,
      completedListPriceCents: 42_400,
      cancellationCount: 1,
      cancellationDenominator: 6,
      cancellationRate: 1 / 6,
      noShowCount: 1,
      noShowDenominator: 5,
      noShowRate: 0.2,
      terminationCount: 1,
      terminationDenominator: 6,
      terminationRate: 1 / 6,
      completedCustomerCount: 2,
      revisitCustomerCount: 1,
      revisitRate: 0.5,
    });
  });

  it("空周期把计数和金额保持为零，并让没有分母的比例明确为空", () => {
    expect(calculateBusinessSnapshot({ bookings: [], capacityDays: [] })).toEqual({
      bookingCount: 0,
      completedBookingCount: 0,
      completedServiceMinutes: 0,
      availableStaffMinutes: 0,
      utilizationRate: null,
      completedListPriceCents: 0,
      cancellationCount: 0,
      cancellationDenominator: 0,
      cancellationRate: null,
      noShowCount: 0,
      noShowDenominator: 0,
      noShowRate: null,
      terminationCount: 0,
      terminationDenominator: 0,
      terminationRate: null,
      completedCustomerCount: 0,
      revisitCustomerCount: 0,
      revisitRate: null,
    });
  });

  it("以上海自然日决定含首尾周期，并在上海午夜确定切换边界", () => {
    expect(businessPeriodWindows("2026-08-13T15:59:59.999Z", 7)).toEqual({
      current: { startsOn: "2026-08-07", endsOn: "2026-08-13" },
      previous: { startsOn: "2026-07-31", endsOn: "2026-08-06" },
    });
    expect(businessPeriodWindows("2026-08-13T16:00:00.000Z", 7)).toEqual({
      current: { startsOn: "2026-08-08", endsOn: "2026-08-14" },
      previous: { startsOn: "2026-08-01", endsOn: "2026-08-07" },
    });
  });
});
