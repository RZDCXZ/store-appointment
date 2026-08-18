export type CustomerBookingChangeCommand = "cancel" | "reschedule";

interface ChangeStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export interface CustomerRescheduleDraftSuggestion {
  key: string;
  startsAt: string;
  staffId: string;
  dateLabel: string;
  timeLabel: string;
  staffLabel: string;
}

export interface CustomerRescheduleDraft {
  selectedStaffId: string;
  selectedStartsAt: string;
  conflictMessage: string;
  suggestions: CustomerRescheduleDraftSuggestion[];
}

function defaultStorage(): ChangeStorage {
  return {
    get: (key) => wx.getStorageSync(key),
    set: (key, value) => wx.setStorageSync(key, value),
    remove: (key) => wx.removeStorageSync(key),
  };
}

function storageKey(command: CustomerBookingChangeCommand, bookingId: string): string {
  return `customer-booking-change:${command}:${bookingId}`;
}

function draftStorageKey(bookingId: string): string {
  return `customer-booking-change:reschedule-draft:${bookingId}`;
}

function isDraftSuggestion(value: unknown): value is CustomerRescheduleDraftSuggestion {
  if (!value || typeof value !== "object") return false;
  const suggestion = value as Partial<CustomerRescheduleDraftSuggestion>;
  return [
    suggestion.key,
    suggestion.startsAt,
    suggestion.staffId,
    suggestion.dateLabel,
    suggestion.timeLabel,
    suggestion.staffLabel,
  ].every((field) => typeof field === "string");
}

function createKey(command: CustomerBookingChangeCommand): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  return `customer-${command}-${time}-${random}`;
}

export function ensureCustomerChangeIdempotencyKey(
  command: CustomerBookingChangeCommand,
  bookingId: string,
  storage: ChangeStorage = defaultStorage(),
): string {
  const key = storageKey(command, bookingId);
  const existing = storage.get(key);
  if (typeof existing === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(existing)) {
    return existing;
  }
  const created = createKey(command);
  storage.set(key, created);
  return created;
}

export function rotateCustomerChangeIdempotencyKey(
  command: CustomerBookingChangeCommand,
  bookingId: string,
  storage: ChangeStorage = defaultStorage(),
): string {
  storage.remove(storageKey(command, bookingId));
  return ensureCustomerChangeIdempotencyKey(command, bookingId, storage);
}

export function clearCustomerChangeIdempotencyKey(
  command: CustomerBookingChangeCommand,
  bookingId: string,
  storage: ChangeStorage = defaultStorage(),
): void {
  storage.remove(storageKey(command, bookingId));
}

export function loadCustomerRescheduleDraft(
  bookingId: string,
  storage: ChangeStorage = defaultStorage(),
): CustomerRescheduleDraft | null {
  const value = storage.get(draftStorageKey(bookingId));
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<CustomerRescheduleDraft>;
  if (
    typeof draft.selectedStaffId !== "string" ||
    typeof draft.selectedStartsAt !== "string" ||
    typeof draft.conflictMessage !== "string" ||
    !Array.isArray(draft.suggestions) ||
    !draft.suggestions.every(isDraftSuggestion)
  ) {
    storage.remove(draftStorageKey(bookingId));
    return null;
  }
  return {
    selectedStaffId: draft.selectedStaffId,
    selectedStartsAt: draft.selectedStartsAt,
    conflictMessage: draft.conflictMessage,
    suggestions: draft.suggestions,
  };
}

export function saveCustomerRescheduleDraft(
  bookingId: string,
  draft: CustomerRescheduleDraft,
  storage: ChangeStorage = defaultStorage(),
): void {
  storage.set(draftStorageKey(bookingId), draft);
}

export function clearCustomerRescheduleDraft(
  bookingId: string,
  storage: ChangeStorage = defaultStorage(),
): void {
  storage.remove(draftStorageKey(bookingId));
}
