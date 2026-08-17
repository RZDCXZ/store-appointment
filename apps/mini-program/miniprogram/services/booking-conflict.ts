import type { BookingConflictSuggestion } from "@rongguang/contracts";

export interface BookingConflictContext {
  requestedStartsAt: string;
  petLabel: string;
  serviceLabel: string;
  staffPreferenceLabel: string;
  suggestions: BookingConflictSuggestion[];
}

export interface BookingConflictStorage {
  get(): unknown;
  set(context: BookingConflictContext & { version: 1 }): void;
  remove(): void;
}

const storageKey = "rongguang.booking-conflict.v1";
const localStorage: BookingConflictStorage = {
  get() {
    return wx.getStorageSync(storageKey) as unknown;
  },
  set(context) {
    wx.setStorageSync(storageKey, context);
  },
  remove() {
    wx.removeStorageSync(storageKey);
  },
};

function validLabel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validSuggestion(value: unknown): value is BookingConflictSuggestion {
  if (!value || typeof value !== "object") return false;
  const suggestion = value as Partial<BookingConflictSuggestion>;
  const staff = suggestion.staff as Partial<BookingConflictSuggestion["staff"]> | undefined;
  return (
    typeof suggestion.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(suggestion.date) &&
    validInstant(suggestion.startsAt) &&
    validInstant(suggestion.endsAt) &&
    Date.parse(suggestion.endsAt) > Date.parse(suggestion.startsAt) &&
    validLabel(staff?.id) &&
    validLabel(staff?.displayName)
  );
}

function validContext(value: unknown): value is BookingConflictContext & { version: 1 } {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<BookingConflictContext> & { version?: unknown };
  return (
    context.version === 1 &&
    validInstant(context.requestedStartsAt) &&
    validLabel(context.petLabel) &&
    validLabel(context.serviceLabel) &&
    validLabel(context.staffPreferenceLabel) &&
    Array.isArray(context.suggestions) &&
    context.suggestions.length <= 5 &&
    context.suggestions.every(validSuggestion)
  );
}

export function writeBookingConflict(
  context: BookingConflictContext,
  storage: BookingConflictStorage = localStorage,
): void {
  const stored = { version: 1 as const, ...context };
  if (!validContext(stored)) {
    throw new Error("无法保存无效的时段冲突上下文。");
  }
  storage.set({
    ...stored,
    suggestions: stored.suggestions.map((suggestion) => ({
      ...suggestion,
      staff: { ...suggestion.staff },
    })),
  });
}

export function readBookingConflict(
  storage: BookingConflictStorage = localStorage,
): BookingConflictContext | null {
  const stored = storage.get();
  if (!validContext(stored)) {
    storage.remove();
    return null;
  }
  return {
    requestedStartsAt: stored.requestedStartsAt,
    petLabel: stored.petLabel,
    serviceLabel: stored.serviceLabel,
    staffPreferenceLabel: stored.staffPreferenceLabel,
    suggestions: stored.suggestions.map((suggestion) => ({
      ...suggestion,
      staff: { ...suggestion.staff },
    })),
  };
}

export function clearBookingConflict(storage: BookingConflictStorage = localStorage): void {
  storage.remove();
}
