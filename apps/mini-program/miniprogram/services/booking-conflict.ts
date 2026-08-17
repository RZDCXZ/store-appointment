import type { BookingConflictSuggestion } from "@rongguang/contracts";

import {
  isValidBookingConflictInstant,
  isValidBookingConflictLabel,
  parseBookingConflictSuggestions,
} from "./booking-conflict-suggestion";

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

function parseContext(value: unknown): (BookingConflictContext & { version: 1 }) | null {
  if (!value || typeof value !== "object") return null;
  const context = value as Partial<BookingConflictContext> & { version?: unknown };
  const suggestions = parseBookingConflictSuggestions(context.suggestions);
  if (
    context.version !== 1 ||
    !isValidBookingConflictInstant(context.requestedStartsAt) ||
    !isValidBookingConflictLabel(context.petLabel) ||
    !isValidBookingConflictLabel(context.serviceLabel) ||
    !isValidBookingConflictLabel(context.staffPreferenceLabel) ||
    !Array.isArray(context.suggestions) ||
    suggestions.length !== context.suggestions.length
  ) {
    return null;
  }
  return {
    version: 1,
    requestedStartsAt: context.requestedStartsAt,
    petLabel: context.petLabel,
    serviceLabel: context.serviceLabel,
    staffPreferenceLabel: context.staffPreferenceLabel,
    suggestions,
  };
}

export function writeBookingConflict(
  context: BookingConflictContext,
  storage: BookingConflictStorage = localStorage,
): void {
  const stored = parseContext({ version: 1 as const, ...context });
  if (!stored) {
    throw new Error("无法保存无效的时段冲突上下文。");
  }
  storage.set(stored);
}

export function readBookingConflict(
  storage: BookingConflictStorage = localStorage,
): BookingConflictContext | null {
  const stored = parseContext(storage.get());
  if (!stored) {
    storage.remove();
    return null;
  }
  return {
    requestedStartsAt: stored.requestedStartsAt,
    petLabel: stored.petLabel,
    serviceLabel: stored.serviceLabel,
    staffPreferenceLabel: stored.staffPreferenceLabel,
    suggestions: stored.suggestions,
  };
}

export function clearBookingConflict(storage: BookingConflictStorage = localStorage): void {
  storage.remove();
}
