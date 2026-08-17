import type { BookingConflictSuggestion } from "@rongguang/contracts";

function validLabel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function validInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseBookingConflictSuggestion(value: unknown): BookingConflictSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const suggestion = value as Record<string, unknown>;
  const staff =
    suggestion.staff && typeof suggestion.staff === "object"
      ? (suggestion.staff as Record<string, unknown>)
      : null;
  if (
    typeof suggestion.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(suggestion.date) ||
    !validInstant(suggestion.startsAt) ||
    !validInstant(suggestion.endsAt) ||
    Date.parse(suggestion.endsAt) <= Date.parse(suggestion.startsAt) ||
    !validLabel(staff?.id) ||
    !validLabel(staff.displayName)
  ) {
    return null;
  }
  return {
    date: suggestion.date,
    startsAt: suggestion.startsAt,
    endsAt: suggestion.endsAt,
    staff: { id: staff.id, displayName: staff.displayName },
  };
}

export function parseBookingConflictSuggestions(value: unknown): BookingConflictSuggestion[] {
  if (!Array.isArray(value) || value.length > 5) return [];
  return value.flatMap((candidate) => {
    const suggestion = parseBookingConflictSuggestion(candidate);
    return suggestion ? [suggestion] : [];
  });
}
