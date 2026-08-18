import type {
  BookingConflictSuggestion,
  CustomerBooking,
  CustomerBookingSchedule,
} from "@rongguang/contracts";

import { fetchRescheduleOptions, rescheduleBooking } from "../../services/booking-api";
import {
  clearCustomerChangeIdempotencyKey,
  clearCustomerRescheduleDraft,
  ensureCustomerChangeIdempotencyKey,
  loadCustomerRescheduleDraft,
  rotateCustomerChangeIdempotencyKey,
  saveCustomerRescheduleDraft,
} from "../../services/customer-booking-change";
import {
  formatBookingDate,
  formatBookingLocalDate,
  formatBookingTime,
  presentCustomerBookingActionMessage,
} from "../../services/booking-presentation";
import { CustomerApiError } from "../../services/customer-api";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";

type PageState =
  | "loading"
  | "ready"
  | "submitting"
  | "success"
  | "contact"
  | "error"
  | "auth"
  | "missing"
  | "forbidden";

interface SlotDisplay {
  key: string;
  startsAt: string;
  staffId: string;
  dateLabel: string;
  timeLabel: string;
  staffLabel: string;
}

function dateLabel(instant: string): string {
  return formatBookingDate(formatBookingLocalDate(instant)).fullLabel;
}

function scheduleLabel(schedule: CustomerBookingSchedule): string {
  return `${dateLabel(schedule.startsAt)} · ${formatBookingTime(schedule.startsAt)}–${formatBookingTime(schedule.endsAt)} · ${schedule.staff.displayName}`;
}

function suggestionDisplay(suggestion: BookingConflictSuggestion): SlotDisplay {
  return {
    key: `${suggestion.startsAt}:${suggestion.staff.id}`,
    startsAt: suggestion.startsAt,
    staffId: suggestion.staff.id,
    dateLabel: dateLabel(suggestion.startsAt),
    timeLabel: `${formatBookingTime(suggestion.startsAt)}–${formatBookingTime(suggestion.endsAt)}`,
    staffLabel: suggestion.staff.displayName,
  };
}

function saveDraft(
  bookingId: string,
  selectedStaffId: string,
  selectedStartsAt: string,
  conflictMessage: string,
  suggestions: SlotDisplay[],
): void {
  if (!bookingId) return;
  saveCustomerRescheduleDraft(bookingId, {
    selectedStaffId,
    selectedStartsAt,
    conflictMessage,
    suggestions,
  });
}

function isCustomerBooking(value: unknown): value is CustomerBooking {
  if (!value || typeof value !== "object") return false;
  const booking = value as Partial<CustomerBooking>;
  return (
    typeof booking.startsAt === "string" &&
    typeof booking.endsAt === "string" &&
    Boolean(booking.staff) &&
    typeof booking.staff?.displayName === "string" &&
    Boolean(booking.pet) &&
    typeof booking.pet?.name === "string" &&
    Boolean(booking.primaryService) &&
    typeof booking.primaryService?.name === "string"
  );
}

Page({
  data: {
    pageState: "loading" as PageState,
    bookingId: "",
    errorMessage: "",
    contactMessage: "",
    originalDateLabel: "",
    originalTimeLabel: "",
    originalStaffLabel: "",
    petServiceLabel: "",
    slots: [] as SlotDisplay[],
    selectedStaffId: "",
    selectedStartsAt: "",
    selectedKey: "",
    conflictMessage: "",
    suggestions: [] as SlotDisplay[],
    previousScheduleLabel: "",
    nextScheduleLabel: "",
    verificationCode: "",
  },
  onLoad(options: Record<string, string | undefined>) {
    const bookingId = options.id ?? "";
    const draft = bookingId ? loadCustomerRescheduleDraft(bookingId) : null;
    this.setData({
      bookingId,
      pageState: bookingId ? "loading" : "missing",
      selectedStaffId: draft?.selectedStaffId ?? "",
      selectedStartsAt: draft?.selectedStartsAt ?? "",
      selectedKey:
        draft?.selectedStaffId && draft.selectedStartsAt
          ? `${draft.selectedStartsAt}:${draft.selectedStaffId}`
          : "",
      conflictMessage: draft?.conflictMessage ?? "",
      suggestions: draft?.suggestions ?? [],
    });
  },
  onShow() {
    if (
      this.data.bookingId &&
      this.data.pageState !== "success" &&
      this.data.pageState !== "ready"
    ) {
      void this.loadOptions();
    }
  },
  async loadOptions() {
    if (!this.data.bookingId) {
      this.setData({ pageState: "missing" });
      return;
    }
    const path = `/pages/booking-reschedule/index?id=${encodeURIComponent(this.data.bookingId)}`;
    const context = await loadCustomerContext(path);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }
    this.setData({ pageState: "loading", errorMessage: "" });
    try {
      const result = await fetchRescheduleOptions(this.data.bookingId);
      const { booking } = result;
      if (!result.customerActions.canReschedule) {
        this.setData({
          pageState: "contact",
          contactMessage: presentCustomerBookingActionMessage(result.customerActions),
          originalDateLabel: dateLabel(booking.startsAt),
          originalTimeLabel: `${formatBookingTime(booking.startsAt)}–${formatBookingTime(booking.endsAt)}`,
          originalStaffLabel: booking.staff.displayName,
          petServiceLabel: `${booking.pet.name} · ${booking.primaryService.name}`,
        });
        return;
      }
      if (!result.availability) {
        throw new Error("可约安排没有加载出来，请稍后重试。");
      }
      const slots: SlotDisplay[] = result.availability.days.flatMap((day) =>
        day.slots.map((slot) => ({
          key: `${slot.startsAt}:${slot.staff.id}`,
          startsAt: slot.startsAt,
          staffId: slot.staff.id,
          dateLabel: dateLabel(slot.startsAt),
          timeLabel: `${formatBookingTime(slot.startsAt)}–${formatBookingTime(slot.endsAt)}`,
          staffLabel: slot.staff.displayName,
        })),
      );
      this.setData({
        pageState: "ready",
        originalDateLabel: dateLabel(booking.startsAt),
        originalTimeLabel: `${formatBookingTime(booking.startsAt)}–${formatBookingTime(booking.endsAt)}`,
        originalStaffLabel: booking.staff.displayName,
        petServiceLabel: `${booking.pet.name} · ${booking.primaryService.name}`,
        slots,
        errorMessage: "",
      });
    } catch (error) {
      if (
        error instanceof CustomerApiError &&
        (error.statusCode === 403 || error.code === "BOOKING_NOT_FOUND")
      ) {
        this.setData({ pageState: "forbidden", errorMessage: error.message });
        return;
      }
      const contact =
        error instanceof CustomerApiError &&
        (error.code === "BOOKING_CHANGE_CUTOFF_PASSED" ||
          error.code === "BOOKING_CHANGE_NOT_ALLOWED");
      this.setData({
        pageState: contact ? "contact" : "error",
        contactMessage: contact && error instanceof Error ? error.message : "",
        errorMessage: error instanceof Error ? error.message : "改期安排没有加载出来，请稍后重试。",
      });
    }
  },
  selectSlot(event: WechatMiniprogram.BaseEvent) {
    const staffId = String(event.currentTarget.dataset.staffId ?? "");
    const startsAt = String(event.currentTarget.dataset.startsAt ?? "");
    if (!staffId || !startsAt) return;
    if (staffId !== this.data.selectedStaffId || startsAt !== this.data.selectedStartsAt) {
      rotateCustomerChangeIdempotencyKey("reschedule", this.data.bookingId);
    }
    this.setData({
      selectedStaffId: staffId,
      selectedStartsAt: startsAt,
      selectedKey: `${startsAt}:${staffId}`,
      conflictMessage: "",
      suggestions: [],
      errorMessage: "",
    });
    saveDraft(this.data.bookingId, staffId, startsAt, "", []);
  },
  chooseSuggestion(event: WechatMiniprogram.BaseEvent) {
    const staffId = String(event.currentTarget.dataset.staffId ?? "");
    const startsAt = String(event.currentTarget.dataset.startsAt ?? "");
    if (!staffId || !startsAt) return;
    if (staffId !== this.data.selectedStaffId || startsAt !== this.data.selectedStartsAt) {
      rotateCustomerChangeIdempotencyKey("reschedule", this.data.bookingId);
    }
    this.setData({
      selectedStaffId: staffId,
      selectedStartsAt: startsAt,
      selectedKey: `${startsAt}:${staffId}`,
      conflictMessage: "",
      suggestions: [],
      errorMessage: "",
    });
    saveDraft(this.data.bookingId, staffId, startsAt, "", []);
  },
  async submit() {
    if (
      !this.data.selectedStaffId ||
      !this.data.selectedStartsAt ||
      this.data.pageState === "submitting"
    ) {
      this.setData({ errorMessage: "请先选择一个新安排。" });
      return;
    }
    this.setData({ pageState: "submitting", errorMessage: "" });
    try {
      const result = await rescheduleBooking(this.data.bookingId, {
        idempotencyKey: ensureCustomerChangeIdempotencyKey("reschedule", this.data.bookingId),
        staffId: this.data.selectedStaffId,
        startsAt: this.data.selectedStartsAt,
      });
      const change = result.changeHistory.find((item) => item.kind === "customer_rescheduled");
      if (!change?.next) {
        throw new Error("改期结果缺少前后安排，请返回详情确认。");
      }
      clearCustomerChangeIdempotencyKey("reschedule", this.data.bookingId);
      clearCustomerRescheduleDraft(this.data.bookingId);
      this.setData({
        pageState: "success",
        previousScheduleLabel: scheduleLabel(change.previous),
        nextScheduleLabel: scheduleLabel(change.next),
        verificationCode: result.verificationCode,
        conflictMessage: "",
      });
    } catch (error) {
      if (error instanceof CustomerApiError && error.code === "BOOKING_TIME_CONFLICT") {
        rotateCustomerChangeIdempotencyKey("reschedule", this.data.bookingId);
        const suggestions = error.suggestions.map(suggestionDisplay);
        saveDraft(
          this.data.bookingId,
          this.data.selectedStaffId,
          this.data.selectedStartsAt,
          error.message,
          suggestions,
        );
        const latestBooking = isCustomerBooking(error.booking) ? error.booking : null;
        this.setData({
          pageState: "ready",
          conflictMessage: error.message,
          suggestions,
          ...(latestBooking
            ? {
                originalDateLabel: dateLabel(latestBooking.startsAt),
                originalTimeLabel: `${formatBookingTime(latestBooking.startsAt)}–${formatBookingTime(latestBooking.endsAt)}`,
                originalStaffLabel: latestBooking.staff.displayName,
                petServiceLabel: `${latestBooking.pet.name} · ${latestBooking.primaryService.name}`,
              }
            : {}),
        });
        return;
      }
      if (error instanceof CustomerApiError && error.statusCode >= 400 && error.statusCode < 500) {
        rotateCustomerChangeIdempotencyKey("reschedule", this.data.bookingId);
      }
      const contact =
        error instanceof CustomerApiError &&
        (error.code === "BOOKING_CHANGE_CUTOFF_PASSED" ||
          error.code === "BOOKING_CHANGE_NOT_ALLOWED");
      this.setData({
        pageState: contact ? "contact" : "ready",
        contactMessage: contact && error instanceof Error ? error.message : "",
        errorMessage: contact ? "" : error instanceof Error ? error.message : "改期没有提交成功。",
      });
    }
  },
  retry() {
    void this.loadOptions();
  },
  onPullDownRefresh() {
    void this.loadOptions().finally(() => wx.stopPullDownRefresh());
  },
  chooseCustomer() {
    openCustomerSelector(
      `/pages/booking-reschedule/index?id=${encodeURIComponent(this.data.bookingId)}`,
    );
  },
  keepOriginal() {
    wx.redirectTo({
      url: `/pages/booking-detail/index?id=${encodeURIComponent(this.data.bookingId)}`,
    });
  },
  viewBooking() {
    wx.redirectTo({
      url: `/pages/booking-detail/index?id=${encodeURIComponent(this.data.bookingId)}`,
    });
  },
});
