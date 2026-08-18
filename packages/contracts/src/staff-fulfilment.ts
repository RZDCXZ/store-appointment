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
  booking: StaffBookingSummary & {
    customer: StaffBookingSummary["customer"] & { id: string };
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
    occurredAt: string;
  }>;
  petServiceHistory: Array<{
    bookingId: string;
    serviceName: string;
    addonNames: string[];
    staffName: string;
    completedAt: string;
  }>;
}

export interface StaffPhoneRevealResponse {
  bookingId: string;
  customerId: string;
  phone: string;
  revealedAt: string;
}
