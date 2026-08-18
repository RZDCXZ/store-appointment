import type { StaffBookingSummary } from "@rongguang/contracts";
import { describe, expect, it } from "vitest";

import { matchesStaffAppointmentFilter } from "./staff-booking-presentation";

const overdueBooking: StaffBookingSummary = {
  id: "booking-overdue",
  status: "confirmed",
  action: "late",
  customer: { displayName: "顾客", phoneMasked: "138****0000" },
  pet: { id: "pet", name: "小满", species: "cat", photoPath: null, careTags: [] },
  service: { id: "cat-care", name: "猫咪洗护", addonNames: [], durationMinutes: 90 },
  staff: { id: "linxia", displayName: "林夏" },
  startsAt: "2026-08-12T03:00:00.000Z",
  endsAt: "2026-08-12T04:30:00.000Z",
};

describe("员工本人预约筛选", () => {
  it("让跨日仍未处理的迟到预约出现在待处理范围", () => {
    const demoNow = "2026-08-13T02:50:00.000Z";

    expect(matchesStaffAppointmentFilter(overdueBooking, "attention", demoNow)).toBe(true);
    expect(matchesStaffAppointmentFilter(overdueBooking, "today", demoNow)).toBe(false);
    expect(matchesStaffAppointmentFilter(overdueBooking, "upcoming", demoNow)).toBe(false);
    expect(matchesStaffAppointmentFilter(overdueBooking, "ended", demoNow)).toBe(false);
  });
});
