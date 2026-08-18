import type { ManagerBookingStatus } from "./manager-live-booking.js";
import type { ScheduleWindowDay } from "./index.js";

export type CapacityChangeKind = "time_off" | "store_closure";
export type CapacityChangeStatus = "pending" | "active";

export interface CapacityChangeInput {
  kind: CapacityChangeKind;
  staffId?: string;
  localDate: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface CapacityChangeAffectedBooking {
  id: string;
  revision: number;
  status: ManagerBookingStatus;
  customerName: string;
  petName: string;
  serviceName: string;
  staff: {
    id: string;
    displayName: string;
  };
  startsAt: string;
  endsAt: string;
  turnoverEndsAt: string;
}

export interface CapacityChangePreviewResponse {
  target: {
    kind: CapacityChangeKind;
    label: string;
    staff: { id: string; displayName: string } | null;
  };
  interval: {
    localDate: string;
    startsAt: string;
    endsAt: string;
  };
  reason: string;
  targetCapacityMinutes: number;
  affectedBookingCount: number;
  affectedBookings: CapacityChangeAffectedBooking[];
  outcome: CapacityChangeStatus;
  consequence: string;
}

export interface CapacityChangeFact extends CapacityChangePreviewResponse {
  id: string;
  kind: CapacityChangeKind;
  status: CapacityChangeStatus;
  createdAt: string;
}

export interface CapacityChangeCreateResponse {
  change: CapacityChangeFact;
  nextStep: {
    label: string;
    href: string;
  };
}

export interface ManagerCapacityChangeOptionsResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  window: {
    startsOn: string;
    endsOn: string;
    days: ScheduleWindowDay[];
  };
  staff: Array<{
    id: string;
    displayName: string;
    employeeNumber: number;
  }>;
}
