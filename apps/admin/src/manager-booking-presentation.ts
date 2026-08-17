import type { ManagerBookingStatus } from "@rongguang/contracts";

export const managerBookingStatusLabels: Record<ManagerBookingStatus, string> = {
  confirmed: "已确认",
  checked_in: "已到店",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "已爽约",
  terminated: "已终止",
};

export function clockMinutes(value: string): number {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function formatShanghaiClock(value: string): string {
  const local = new Date(Date.parse(value) + 8 * 60 * 60_000);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}
