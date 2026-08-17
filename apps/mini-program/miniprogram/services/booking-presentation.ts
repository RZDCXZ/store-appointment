const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function formatBookingDate(localDate: string): {
  shortDate: string;
  weekday: string;
  fullLabel: string;
} {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const shortDate = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  const weekday = weekdays[date.getUTCDay()] ?? "周日";
  return {
    shortDate,
    weekday,
    fullLabel: `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${weekday}`,
  };
}

export function formatBookingTime(instant: string): string {
  const date = new Date(new Date(instant).getTime() + 8 * 60 * 60_000);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatEarliestSlot(instant: string | null): string {
  if (!instant) return "十四日内暂无可约时段";
  const date = new Date(new Date(instant).getTime() + 8 * 60 * 60_000);
  return `最近可约 · ${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${formatBookingTime(instant)}`;
}
