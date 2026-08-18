import type { ConfirmedBooking, ManagerBookingActions } from "@rongguang/contracts";

export function managerBookingActions(status: ConfirmedBooking["status"]): ManagerBookingActions {
  const allowed = status === "confirmed";
  return {
    canReschedule: allowed,
    canCancel: allowed,
    canCorrectContent: allowed,
    message: allowed
      ? "可依据已经与顾客达成的线下约定纠正内容、改期或取消。"
      : status === "checked_in"
        ? "预约已经到店核销，不能纠正内容、改期或取消；请继续完成服务或记录服务终止。"
        : "当前预约状态不支持店长纠正内容、改期或取消。",
  };
}
