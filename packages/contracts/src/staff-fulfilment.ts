export type StaffBookingStatus =
  "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show" | "terminated";

export type StaffBookingAction = "late" | "check_in" | "complete" | "upcoming" | "ended";

export interface StaffBookingSummary {
  id: string;
  status: StaffBookingStatus;
  action: StaffBookingAction;
  customer: {
    displayName: string;
    phoneMasked: string;
  };
  pet: {
    id: string;
    name: string;
    species: "dog" | "cat";
    photoPath: string | null;
    careTags: string[];
  };
  service: {
    id: string;
    name: string;
    addonNames: string[];
    durationMinutes: number;
  };
  staff: {
    id: string;
    displayName: string;
  };
  startsAt: string;
  endsAt: string;
}

export interface StaffShift {
  startsAt: string;
  endsAt: string;
  breaks: Array<{ startsAt: string; endsAt: string }>;
}

export interface StaffTodayResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  localDate: string;
  identity: {
    id: string;
    displayName: string;
  };
  shifts: StaffShift[];
  nextBooking: StaffBookingSummary | null;
  actionQueue: StaffBookingSummary[];
  bookings: StaffBookingSummary[];
}

export interface StaffBookingListResponse {
  demoNow: string;
  bookings: StaffBookingSummary[];
}

export interface StaffBookingDetailResponse {
  demoNow: string;
  booking: StaffBookingSummary & {
    pet: StaffBookingSummary["pet"] & {
      weightKg: number;
      petSize: "small" | "medium" | "large";
      breed: string | null;
      sex: "male" | "female" | null;
      birthDate: string | null;
      coatType: "short" | "long" | "double" | "curly" | "hairless" | "other" | null;
      careNotes: string | null;
    };
  };
  statusHistory: Array<{
    id: string;
    type: string;
    actorType: "customer" | "staff" | "manager" | "system";
    actorId: string | null;
    actorDisplayName: string | null;
    reason: string | null;
    occurredAt: string;
  }>;
  petServiceHistory: Array<{
    bookingId: string;
    serviceName: string;
    addonNames: string[];
    staffName: string;
    completedAt: string;
  }>;
  serviceRecord: StoreServiceRecord | null;
}

export interface StaffPhoneRevealResponse {
  bookingId: string;
  phone: string;
  revealedAt: string;
}

export interface BookingCheckInInput {
  idempotencyKey: string;
  verificationCode: string;
}

export interface BookingLateActionInput {
  idempotencyKey: string;
  reason: string;
}

export const storeServiceCareTags = ["情绪稳定", "需要慢速吹风", "换毛期"] as const;

export type StoreServiceCareTag = (typeof storeServiceCareTags)[number];

export interface BookingCompletionInput {
  idempotencyKey: string;
  careTags: StoreServiceCareTag[];
  internalText: string | null;
}

export interface StoreServiceRecord {
  id: string;
  bookingId: string;
  pet: {
    id: string;
    name: string;
    species: "dog" | "cat";
    weightKg: number;
    petSize: "small" | "medium" | "large";
  };
  primaryService: {
    id: string;
    name: string;
    durationMinutes: number;
  };
  addons: Array<{
    id: string;
    name: string;
    durationMinutes: number;
  }>;
  staff: {
    id: string;
    displayName: string;
  };
  actualStartsAt: string;
  actualEndsAt: string;
  careTags: StoreServiceCareTag[];
  internalText: string | null;
  createdAt: string;
  notes: StoreServiceRecordNote[];
}

export interface StoreServiceRecordNote {
  id: string;
  kind: "staff_note" | "manager_correction";
  text: string;
  author: {
    type: "staff" | "manager";
    id: string;
    displayName: string;
  };
  createdAt: string;
}

export interface StoreServiceRecordNoteInput {
  idempotencyKey: string;
  text: string;
}

export interface StoreServiceRecordNoteResponse {
  bookingId: string;
  serviceRecordId: string;
  occurredAt: string;
  note: StoreServiceRecordNote;
}

export interface BookingCompletionResponse {
  bookingId: string;
  status: "completed";
  outcome: "completed";
  occurredAt: string;
  actor: {
    type: "staff";
    id: string;
    displayName: string;
  };
  actualOccupancy: {
    startsAt: string;
    endsAt: string;
  };
  originalSchedule: {
    startsAt: string;
    endsAt: string;
    occupancyStartsAt: string;
    occupancyEndsAt: string;
  };
  serviceRecord: StoreServiceRecord;
}

export interface BookingTerminationInput {
  idempotencyKey: string;
  reason: string;
}

export interface BookingTerminationResponse {
  bookingId: string;
  status: "terminated";
  outcome: "terminated";
  occurredAt: string;
  actor: {
    type: "staff" | "manager";
    id: string;
    displayName: string;
  };
  reason: string;
  actualOccupancy: {
    startsAt: string;
    endsAt: string;
  } | null;
  originalSchedule: {
    startsAt: string;
    endsAt: string;
    occupancyStartsAt: string;
    occupancyEndsAt: string;
  };
}

export interface BookingFulfilmentResponse {
  bookingId: string;
  status: "checked_in" | "no_show";
  outcome: "checked_in" | "no_show";
  occurredAt: string;
  actor: {
    type: "staff" | "manager";
    id: string;
    displayName: string;
  };
  reason: string | null;
  actualOccupancy: {
    startsAt: string;
    endsAt: string;
  } | null;
  originalSchedule: {
    startsAt: string;
    endsAt: string;
    occupancyStartsAt: string;
    occupancyEndsAt: string;
  };
}
