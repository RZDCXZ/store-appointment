import type { ManagerBookingStatus } from "./manager-live-booking.js";
import type {
  BookingConflictSuggestion,
  CustomerBookingSchedule,
  ScheduleWindowDay,
} from "./index.js";

export type CapacityChangeKind = "time_off" | "store_closure";
export type CapacityChangeStatus = "pending" | "active" | "cancelled";
export type CapacityChangeResolutionAction = "change_staff" | "reschedule" | "cancel";

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
  outcome: Exclude<CapacityChangeStatus, "cancelled">;
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

export interface CapacityChangeResolution {
  id: string;
  action: CapacityChangeResolutionAction;
  operator: { id: string; displayName: string };
  reason: string;
  result: CustomerBookingSchedule | null;
  bookingEventId: string;
  resolvedAt: string;
}

export interface CapacityChangeImpactedBooking extends CapacityChangeAffectedBooking {
  bookingRevision: number;
  sameTimeStaffCandidates: Array<{ id: string; displayName: string }>;
  rescheduleSuggestions: BookingConflictSuggestion[];
  cancelNotificationPreview: {
    kind: "booking_cancelled";
    recipient: string;
    message: string;
  };
  resolution: CapacityChangeResolution | null;
}

export interface CapacityChangeDetailResponse {
  change: CapacityChangeFact;
  progress: { resolved: number; total: number };
  impactedBookings: CapacityChangeImpactedBooking[];
  canRevoke: boolean;
}

export interface ResolveCapacityChangeBookingInput {
  action: CapacityChangeResolutionAction;
  staffId?: string;
  startsAt?: string;
  reason: string;
  idempotencyKey: string;
  expectedBookingRevision: number;
}

export interface ResolveCapacityChangeBookingResponse {
  change: CapacityChangeFact;
  progress: { resolved: number; total: number };
  resolvedBooking: CapacityChangeResolution & { bookingId: string };
}

export interface RevokeCapacityChangeInput {
  reason: string;
}

export interface RevokeCapacityChangeResponse {
  change: CapacityChangeFact & { status: "cancelled" };
  retainedResolutions: Array<CapacityChangeResolution & { bookingId: string }>;
}
