export type ManagerBookingChangeCommand = "reschedule" | "cancel" | "terminate" | "correction";

export function managerChangeIdempotencyKey(
  bookingId: string,
  command: ManagerBookingChangeCommand,
): string {
  const storageKey = `manager-booking-change:${bookingId}:${command}`;
  const saved = sessionStorage.getItem(storageKey);
  if (saved) return saved;
  const generated = `manager-${command}-${globalThis.crypto.randomUUID()}`;
  sessionStorage.setItem(storageKey, generated);
  return generated;
}

export function discardManagerChangeIdempotencyKey(
  bookingId: string,
  command: ManagerBookingChangeCommand,
): void {
  sessionStorage.removeItem(`manager-booking-change:${bookingId}:${command}`);
}

export function isManagerBookingFactConflict(status: number, code: string): boolean {
  return (
    status === 409 && (code === "BOOKING_CHANGE_NOT_ALLOWED" || code === "BOOKING_FACT_CHANGED")
  );
}
