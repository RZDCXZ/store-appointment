import type {
  PetSpecies,
  BookingVerificationWindow,
  ConfirmedBooking,
  CustomerBookingSchedule,
  PublishedScheduleShift,
  ScheduleBusinessHours,
  ScheduleWindowDay,
  StaffSkillId,
} from "./index.js";
import type { StoreServiceRecord } from "./staff-fulfilment.js";

export type ManagerBookingStatus =
  "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show" | "terminated";

export interface ManagerBookingFact {
  id: string;
  status: ManagerBookingStatus;
  customer: {
    id: string;
    displayName: string;
    phoneMasked: string;
  };
  pet: {
    id: string;
    name: string;
    species: PetSpecies;
    photoPath: string | null;
  };
  primaryService: {
    id: string;
    name: string;
  };
  addons: Array<{
    id: string;
    name: string;
  }>;
  staff: {
    id: string;
    displayName: string;
  };
  startsAt: string;
  endsAt: string;
  turnoverEndsAt: string;
  totalPriceCents: number;
  serviceDurationMinutes: number;
  turnoverMinutes: number;
}

export interface ManagerCapacitySummary {
  publishedMinutes: number;
  occupiedMinutes: number;
  remainingMinutes: number;
}

export interface ManagerCalendarBlock {
  id: string;
  kind: "time_off" | "store_closure";
  status: "pending" | "active";
  startsAt: string;
  endsAt: string;
  reason: string;
  affectedBookingCount: number;
}

export interface ManagerStaffDay {
  staff: {
    id: string;
    displayName: string;
    employeeNumber: number;
    skills: StaffSkillId[];
    avatarPath: string;
  };
  scheduleStatus: "published" | "no_schedule";
  source: "weekly_template" | "date_exception" | null;
  exception: {
    kind: "adjusted_shift" | "special_break" | "day_off";
    note: string;
  } | null;
  shifts: PublishedScheduleShift[];
  bookings: ManagerBookingFact[];
  blocks: ManagerCalendarBlock[];
  capacity: ManagerCapacitySummary;
}

export interface ManagerCalendarResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  selectedDate: string;
  window: {
    startsOn: string;
    endsOn: string;
    days: ScheduleWindowDay[];
  };
  businessHours: ScheduleBusinessHours;
  staffDays: ManagerStaffDay[];
  capacity: ManagerCapacitySummary;
}

export interface ManagerWorkbenchRisk {
  id: string;
  kind: "pending_time_off" | "failed_notification" | "late_booking";
  title: string;
  detail: string;
  href: string;
}

export type ManagerBookingStatusSummary = Record<ManagerBookingStatus, number>;

export interface ManagerWorkbenchResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  localDate: string;
  risks: ManagerWorkbenchRisk[];
  statusSummary: ManagerBookingStatusSummary;
  staffDays: ManagerStaffDay[];
  capacity: ManagerCapacitySummary;
}

export interface ManagerBookingDetailResponse {
  booking: ManagerBookingFact;
  petProfile: {
    weightKg: number;
    petSize: "small" | "medium" | "large";
    breed: string | null;
    careTags: string[];
    careNotes: string | null;
  };
  serviceRecord: StoreServiceRecord | null;
  changeHistory: Array<{
    id: string;
    type: string;
    actorType: "customer" | "staff" | "manager" | "system";
    actorId: string | null;
    reason: string | null;
    previous: CustomerBookingSchedule | null;
    next: CustomerBookingSchedule | null;
    occurredAt: string;
  }>;
  notifications: Array<{
    id: string;
    type: string;
    status: "pending" | "processing" | "sent" | "retry" | "failed";
    attemptCount: number;
    createdAt: string;
  }>;
}

export interface ManagerBookingListFilters {
  date: string | null;
  status: ManagerBookingStatus | null;
  staffId: string | null;
  primaryServiceId: string | null;
  query: string;
}

export interface ManagerBookingListResponse {
  appliedFilters: ManagerBookingListFilters;
  bookings: ManagerBookingFact[];
  filterOptions: {
    staff: Array<{ id: string; displayName: string }>;
    primaryServices: Array<{ id: string; name: string }>;
  };
}

export type ManagerOfflineConsentSource = "phone" | "chat" | "in_store";

export interface ManagerProxyBookingResponse {
  booking: ConfirmedBooking;
  verificationCode: string;
  verificationWindow: BookingVerificationWindow;
  proxyRecord: {
    privacyNoticeVersion: string;
    offlineConsentSource: ManagerOfflineConsentSource;
    manager: { id: string; displayName: string };
    createdAt: string;
  };
}

export interface ManagerProxyBookingOptionsResponse {
  demoNow: string;
  privacyNotice: {
    version: string;
    title: string;
    summary: string;
  };
  window: {
    startsOn: string;
    endsOn: string;
    earliestStartsAt: string;
  };
  customers: Array<{
    id: string;
    displayName: string;
    phoneMasked: string;
    pets: Array<{
      id: string;
      name: string;
      species: PetSpecies;
      weightKg: number;
      petSize: "small" | "medium" | "large";
    }>;
  }>;
  staff: Array<{
    id: string;
    displayName: string;
    skills: StaffSkillId[];
  }>;
  primaryServices: Array<{
    id: string;
    name: string;
    applicableSpecies: PetSpecies[];
    availableAddonIds: string[];
  }>;
  addons: Array<{ id: string; name: string }>;
}

export interface ManagerRefreshHint {
  scope: "manager-live-bookings";
  reason: "connected" | "booking-changed" | "heartbeat";
}
