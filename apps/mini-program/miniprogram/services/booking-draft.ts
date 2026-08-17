export const bookingFlowPaths = {
  pet: "/pages/booking-pet/index",
  service: "/pages/booking-service/index",
  staff: "/pages/booking-staff/index",
  time: "/pages/booking-time/index",
  conflict: "/pages/booking-conflict/index",
  confirm: "/pages/booking-confirm/index",
} as const;

export type BookingFlowStep = keyof typeof bookingFlowPaths;

export type BookingStaffPreference = { kind: "fastest" } | { kind: "specified"; staffId: string };

export interface BookingDraftTime {
  date: string;
  startsAt: string;
  endsAt: string;
  assignedStaffId: string;
}

export interface BookingDraft {
  version: 1;
  idempotencyKey: string | null;
  petId: string | null;
  primaryServiceId: string | null;
  addonIds: string[];
  staffPreference: BookingStaffPreference | null;
  selectedTime: BookingDraftTime | null;
}

export interface BookingDraftStorage {
  get(): unknown;
  set(draft: BookingDraft): void;
  remove(): void;
}

const storageKey = "rongguang.booking-draft.v1";
const localStorage: BookingDraftStorage = {
  get() {
    return wx.getStorageSync(storageKey) as unknown;
  },
  set(draft) {
    wx.setStorageSync(storageKey, draft);
  },
  remove() {
    wx.removeStorageSync(storageKey);
  },
};

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80;
}

function validPreference(value: unknown): value is BookingStaffPreference {
  if (!value || typeof value !== "object") {
    return false;
  }
  const preference = value as Partial<BookingStaffPreference>;
  return (
    preference.kind === "fastest" ||
    (preference.kind === "specified" && validId(preference.staffId))
  );
}

function validTime(value: unknown): value is BookingDraftTime {
  if (!value || typeof value !== "object") {
    return false;
  }
  const time = value as Partial<BookingDraftTime>;
  return (
    typeof time.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(time.date) &&
    typeof time.startsAt === "string" &&
    Number.isFinite(Date.parse(time.startsAt)) &&
    typeof time.endsAt === "string" &&
    Number.isFinite(Date.parse(time.endsAt)) &&
    Date.parse(time.endsAt) > Date.parse(time.startsAt) &&
    validId(time.assignedStaffId)
  );
}

function validDraft(value: unknown): value is BookingDraft {
  if (!value || typeof value !== "object") {
    return false;
  }
  const draft = value as Partial<BookingDraft>;
  return (
    draft.version === 1 &&
    (draft.idempotencyKey === undefined ||
      draft.idempotencyKey === null ||
      (typeof draft.idempotencyKey === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(draft.idempotencyKey))) &&
    (draft.petId === null || validId(draft.petId)) &&
    (draft.primaryServiceId === null || validId(draft.primaryServiceId)) &&
    Array.isArray(draft.addonIds) &&
    draft.addonIds.length <= 3 &&
    draft.addonIds.every(validId) &&
    new Set(draft.addonIds).size === draft.addonIds.length &&
    (draft.staffPreference === null || validPreference(draft.staffPreference)) &&
    (draft.selectedTime === null || validTime(draft.selectedTime))
  );
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function emptyBookingDraft(): BookingDraft {
  return {
    version: 1,
    idempotencyKey: null,
    petId: null,
    primaryServiceId: null,
    addonIds: [],
    staffPreference: null,
    selectedTime: null,
  };
}

export function clearBookingDraft(storage: BookingDraftStorage = localStorage): BookingDraft {
  storage.remove();
  return emptyBookingDraft();
}

export function readBookingDraft(storage: BookingDraftStorage = localStorage): BookingDraft {
  const stored = storage.get();
  if (!validDraft(stored)) {
    storage.remove();
    return emptyBookingDraft();
  }
  return {
    ...stored,
    idempotencyKey: stored.idempotencyKey ?? null,
    addonIds: [...stored.addonIds],
    staffPreference: stored.staffPreference ? { ...stored.staffPreference } : null,
    selectedTime: stored.selectedTime ? { ...stored.selectedTime } : null,
  };
}

export function chooseBookingPet(
  petId: string,
  storage: BookingDraftStorage = localStorage,
): BookingDraft {
  const draft = readBookingDraft(storage);
  if (draft.petId === petId) return draft;
  const next = { ...emptyBookingDraft(), petId };
  storage.set(next);
  return next;
}

export function chooseBookingService(
  primaryServiceId: string,
  addonIds: string[],
  storage: BookingDraftStorage = localStorage,
): BookingDraft {
  const draft = readBookingDraft(storage);
  if (draft.primaryServiceId === primaryServiceId && sameIds(draft.addonIds, addonIds)) {
    return draft;
  }
  const next: BookingDraft = {
    ...draft,
    primaryServiceId,
    addonIds: [...addonIds],
    idempotencyKey: null,
    staffPreference: null,
    selectedTime: null,
  };
  storage.set(next);
  return next;
}

export function chooseBookingStaff(
  staffPreference: BookingStaffPreference,
  storage: BookingDraftStorage = localStorage,
): BookingDraft {
  const draft = readBookingDraft(storage);
  const unchanged =
    draft.staffPreference?.kind === staffPreference.kind &&
    (staffPreference.kind === "fastest" ||
      (draft.staffPreference?.kind === "specified" &&
        draft.staffPreference.staffId === staffPreference.staffId));
  if (unchanged) return draft;
  const next = {
    ...draft,
    idempotencyKey: null,
    staffPreference: { ...staffPreference },
    selectedTime: null,
  };
  storage.set(next);
  return next;
}

export function chooseBookingTime(
  selectedTime: BookingDraftTime,
  storage: BookingDraftStorage = localStorage,
): BookingDraft {
  const draft = readBookingDraft(storage);
  const unchanged =
    draft.selectedTime?.date === selectedTime.date &&
    draft.selectedTime.startsAt === selectedTime.startsAt &&
    draft.selectedTime.endsAt === selectedTime.endsAt &&
    draft.selectedTime.assignedStaffId === selectedTime.assignedStaffId;
  const next = {
    ...draft,
    idempotencyKey: unchanged ? draft.idempotencyKey : null,
    selectedTime: { ...selectedTime },
  };
  storage.set(next);
  return next;
}

function generateIdempotencyKey(): string {
  return `booking-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ensureBookingIdempotencyKey(
  storage: BookingDraftStorage = localStorage,
  generate: () => string = generateIdempotencyKey,
): string {
  const draft = readBookingDraft(storage);
  if (draft.idempotencyKey) return draft.idempotencyKey;
  const key = generate();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) {
    throw new Error("无法生成有效的预约幂等键。");
  }
  storage.set({ ...draft, idempotencyKey: key });
  return key;
}

export function clearBookingTime(storage: BookingDraftStorage = localStorage): BookingDraft {
  const draft = readBookingDraft(storage);
  if (!draft.selectedTime) return draft;
  const next = { ...draft, idempotencyKey: null, selectedTime: null };
  storage.set(next);
  return next;
}

export function recoveryForBookingStep(
  step: BookingFlowStep,
  draft: BookingDraft,
): { path: string; message: string } | null {
  if (step === "pet") return null;
  if (!draft.petId) {
    return { path: bookingFlowPaths.pet, message: "请先选择这次要服务的宠物。" };
  }
  if (step === "service") return null;
  if (!draft.primaryServiceId) {
    return { path: bookingFlowPaths.service, message: "请先选择主要服务与增项。" };
  }
  if (step === "staff") return null;
  if (!draft.staffPreference) {
    return { path: bookingFlowPaths.staff, message: "请先选择员工偏好。" };
  }
  if (step === "time") return null;
  if (!draft.selectedTime) {
    return { path: bookingFlowPaths.time, message: "请先选择仍然可约的日期与时段。" };
  }
  return null;
}
