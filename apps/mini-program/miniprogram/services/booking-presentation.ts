import type {
  BookingAvailabilityDay,
  BookingAvailableSlot,
  CustomerBooking,
  CustomerBookingActions,
  CustomerBookingStatus,
  CustomerMessage,
} from "@rongguang/contracts";

import type { BookingDraftTime } from "./booking-draft";

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export function findRestorableBookingSlot(
  days: BookingAvailabilityDay[],
  selectedTime: BookingDraftTime | null,
): BookingAvailableSlot | null {
  if (!selectedTime) return null;
  const day = days.find((item) => item.date === selectedTime.date);
  return (
    day?.slots.find(
      (slot) =>
        slot.startsAt === selectedTime.startsAt &&
        slot.endsAt === selectedTime.endsAt &&
        slot.staff.id === selectedTime.assignedStaffId,
    ) ?? null
  );
}

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

export interface CustomerBookingRecordDisplay {
  id: string;
  day: string;
  dateContext: string;
  timeLabel: string;
  statusLabel: string;
  statusTone: string;
  petServiceLabel: string;
  staffLabel: string;
}

const statusPresentation: Record<
  CustomerBookingStatus,
  { label: string; tone: string; title: string; nextStep: string }
> = {
  confirmed: {
    label: "已确认",
    tone: "info",
    title: "到店时请出示核销码",
    nextStep: "核销后将更新为已到店，请按计划时间到店。",
  },
  checked_in: {
    label: "已到店",
    tone: "success",
    title: "已到店，等待服务完成",
    nextStep: "核销码已经失效，服务完成后状态会再次更新。",
  },
  completed: {
    label: "已完成",
    tone: "success",
    title: "本次服务已完成",
    nextStep: "这里仅展示顾客可见的预约事实与实际完成时间。",
  },
  terminated: {
    label: "已终止",
    tone: "danger",
    title: "本次服务已终止",
    nextStep: "如需了解后续安排，请联系门店。",
  },
  cancelled: {
    label: "已取消",
    tone: "neutral",
    title: "本次预约已取消",
    nextStep: "该时段已经释放，可重新创建预约。",
  },
  no_show: {
    label: "已爽约",
    tone: "warning",
    title: "本次预约记为爽约",
    nextStep: "如有疑问，请联系门店核对。",
  },
};

function localDate(instant: string): Date {
  return new Date(new Date(instant).getTime() + 8 * 60 * 60_000);
}

export function formatBookingLocalDate(instant: string): string {
  const date = localDate(instant);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function bookingStatusPresentation(status: CustomerBookingStatus) {
  return statusPresentation[status];
}

export function presentCustomerBookingActionMessage(actions: CustomerBookingActions): string {
  if (!actions.canCancel || !actions.canReschedule) return actions.message;
  const date = formatBookingDate(formatBookingLocalDate(actions.cutoffAt)).fullLabel;
  return `可在 ${date} ${formatBookingTime(actions.cutoffAt)} 前自行改期或取消。`;
}

export function bookingServiceLabel(booking: CustomerBooking): string {
  return [booking.primaryService.name, ...booking.addons.map((addon) => addon.name)].join(" + ");
}

export function presentCustomerBookingRecord(
  booking: CustomerBooking,
): CustomerBookingRecordDisplay {
  const date = localDate(booking.startsAt);
  const status = bookingStatusPresentation(booking.status);
  return {
    id: booking.id,
    day: String(date.getUTCDate()),
    dateContext: `${date.getUTCMonth() + 1}月 · ${weekdays[date.getUTCDay()] ?? "周日"}`,
    timeLabel: `${formatBookingTime(booking.startsAt)}–${formatBookingTime(booking.endsAt)}`,
    statusLabel: status.label,
    statusTone: status.tone,
    petServiceLabel: `${booking.pet.name} · ${bookingServiceLabel(booking)}`,
    staffLabel: booking.staff.displayName,
  };
}

export interface CustomerMessageDisplay extends CustomerMessage {
  timeLabel: string;
  iconLabel: string;
}

export function presentCustomerMessage(message: CustomerMessage): CustomerMessageDisplay {
  const date = localDate(message.occurredAt);
  const today = localDate(new Date().toISOString());
  const sameDay =
    date.getUTCFullYear() === today.getUTCFullYear() &&
    date.getUTCMonth() === today.getUTCMonth() &&
    date.getUTCDate() === today.getUTCDate();
  return {
    ...message,
    timeLabel: sameDay
      ? `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
      : `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`,
    iconLabel:
      message.kind === "booking_reminder"
        ? "铃"
        : message.kind === "booking_cancelled"
          ? "消"
          : "约",
  };
}
