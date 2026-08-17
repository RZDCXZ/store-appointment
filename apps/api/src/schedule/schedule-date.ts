const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function asUtcDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

export function isLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) {
    return false;
  }

  return asUtcDate(value).toISOString().slice(0, 10) === value;
}

export function addLocalDays(localDate: string, amount: number): string {
  const date = asUtcDate(localDate);

  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function getLocalWeekday(localDate: string): number {
  return asUtcDate(localDate).getUTCDay();
}

export function getShanghaiLocalDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
