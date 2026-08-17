export { getShanghaiLocalDate } from "@rongguang/contracts";

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function asUtcDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

export function isLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) {
    return false;
  }

  const date = asUtcDate(value);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addLocalDays(localDate: string, amount: number): string {
  const date = asUtcDate(localDate);

  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function getLocalWeekday(localDate: string): number {
  return asUtcDate(localDate).getUTCDay();
}
