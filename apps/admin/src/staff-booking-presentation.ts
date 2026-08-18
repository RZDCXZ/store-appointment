import type {
  StaffBookingAction,
  StaffBookingStatus,
  StaffBookingSummary,
} from "@rongguang/contracts";

import { createApiUrl } from "./api";

export type StaffAppointmentFilter = "today" | "attention" | "upcoming" | "ended";

export const staffStatusLabels: Record<StaffBookingStatus, string> = {
  confirmed: "已确认",
  checked_in: "已到店",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "已爽约",
  terminated: "已终止",
};

export const staffActionLabels: Record<StaffBookingAction, string> = {
  late: "迟到待处理",
  check_in: "待核销",
  complete: "待完成",
  upcoming: "稍后开始",
  ended: "已结束",
};

export function formatShanghaiClock(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function formatShanghaiDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function formatShanghaiDateTime(value: string): string {
  return `${formatShanghaiDate(value)} ${formatShanghaiClock(value)}`;
}

export function serviceLabel(service: { name: string; addonNames: string[] }): string {
  return [service.name, ...service.addonNames].join(" + ");
}

function shanghaiDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function matchesStaffAppointmentFilter(
  booking: StaffBookingSummary,
  filter: StaffAppointmentFilter,
  demoNow: string,
): boolean {
  if (filter === "today") return shanghaiDate(booking.startsAt) === shanghaiDate(demoNow);
  if (filter === "attention") {
    return (
      booking.action === "late" || booking.action === "check_in" || booking.action === "complete"
    );
  }
  if (filter === "upcoming") {
    return booking.action !== "ended" && Date.parse(booking.startsAt) > Date.parse(demoNow);
  }
  return booking.action === "ended";
}

export function staffPhotoSource(path: string): string {
  return path.startsWith("/backoffice/") ? createApiUrl(path) : path;
}
