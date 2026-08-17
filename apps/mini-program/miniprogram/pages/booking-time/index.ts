import type { BookingAvailabilityResponse, BookingAvailableSlot } from "@rongguang/contracts";

import { fetchBookingAvailability } from "../../services/booking-availability-api";
import {
  bookingFlowPaths,
  clearBookingTime,
  chooseBookingTime,
  readBookingDraft,
  recoveryForBookingStep,
} from "../../services/booking-draft";
import {
  findRestorableBookingSlot,
  formatBookingDate,
  formatBookingTime,
} from "../../services/booking-presentation";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { fetchBookingEntry } from "../../services/privacy-consent-api";
import { formatCny } from "../../services/storefront-presentation";

type PageState = "loading" | "ready" | "error" | "auth" | "recovery";

interface DisplaySlot extends BookingAvailableSlot {
  startsAtLabel: string;
  endsAtLabel: string;
  selected: boolean;
}

interface DisplayDay {
  date: string;
  shortDate: string;
  weekdayLabel: string;
  reason: string | null;
  reasonLabel: string;
  selected: boolean;
  slots: DisplaySlot[];
}

Page({
  data: {
    pageState: "loading" as PageState,
    recoveryPath: "",
    recoveryMessage: "",
    errorMessage: "",
    staleSelectionMessage: "",
    response: null as BookingAvailabilityResponse | null,
    days: [] as DisplayDay[],
    selectedDate: "",
    selectedStartsAt: "",
    selectedDay: null as DisplayDay | null,
    summary: "",
    totalPriceLabel: "",
  },
  onShow() {
    void this.loadSlots();
  },
  async loadSlots() {
    const draft = readBookingDraft();
    const recovery = recoveryForBookingStep("time", draft);
    if (recovery) {
      this.setData({
        pageState: "recovery",
        recoveryPath: recovery.path,
        recoveryMessage: recovery.message,
      });
      return;
    }
    const context = await loadCustomerContext(bookingFlowPaths.time);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }
    try {
      const entry = await fetchBookingEntry();
      if (!entry.canContinue) {
        wx.redirectTo({
          url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(bookingFlowPaths.time)}`,
        });
        return;
      }
      const response = await fetchBookingAvailability(draft);
      const restoredSlot = findRestorableBookingSlot(response.days, draft.selectedTime);
      const restoredDate = restoredSlot ? (draft.selectedTime?.date ?? "") : "";
      const staleSelectionMessage =
        draft.selectedTime && !restoredSlot
          ? response.days.some((day) => day.date === draft.selectedTime?.date)
            ? "原选时段已不可约，请重新选择。"
            : "原选日期已超出开放窗口，请重新选择。"
          : "";
      if (draft.selectedTime && !restoredSlot) {
        clearBookingTime();
      }
      const selectedDate = restoredDate
        ? restoredDate
        : (response.days.find((day) => day.reason === null)?.date ?? response.days[0]?.date ?? "");
      this.setData({
        pageState: "ready",
        response,
        selectedDate,
        selectedStartsAt: restoredSlot?.startsAt ?? "",
        staleSelectionMessage,
        summary: `${response.selection.pet.name} · ${response.selection.primaryService.name} · ${response.selection.serviceDurationMinutes} 分钟`,
        totalPriceLabel: formatCny(response.selection.totalPriceCents),
        errorMessage: "",
      });
      this.refreshDays();
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "可约时段加载失败，请重试。",
      });
    }
  },
  refreshDays() {
    const response = this.data.response;
    if (!response) return;
    const days = response.days.map((day) => {
      const date = formatBookingDate(day.date);
      return {
        date: day.date,
        shortDate: date.shortDate,
        weekdayLabel: date.weekday,
        reason: day.reason,
        reasonLabel: day.reasonLabel,
        selected: day.date === this.data.selectedDate,
        slots: day.slots.map((slot) => ({
          ...slot,
          startsAtLabel: formatBookingTime(slot.startsAt),
          endsAtLabel: formatBookingTime(slot.endsAt),
          selected: slot.startsAt === this.data.selectedStartsAt,
        })),
      };
    });
    this.setData({ days, selectedDay: days.find((day) => day.selected) ?? null });
  },
  selectDate(event: WechatMiniprogram.BaseEvent) {
    const date = event.currentTarget.dataset.date as unknown;
    if (typeof date !== "string") return;
    clearBookingTime();
    this.setData({ selectedDate: date, selectedStartsAt: "", staleSelectionMessage: "" });
    this.refreshDays();
  },
  selectTime(event: WechatMiniprogram.BaseEvent) {
    const startsAt = event.currentTarget.dataset.start as unknown;
    const slot = this.data.selectedDay?.slots.find((item) => item.startsAt === startsAt);
    if (!slot) return;
    chooseBookingTime({
      date: this.data.selectedDate,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      assignedStaffId: slot.staff.id,
    });
    this.setData({ selectedStartsAt: slot.startsAt });
    this.refreshDays();
  },
  saveTime() {
    if (!this.data.selectedStartsAt) return;
    wx.showToast({ title: "可约时段已保存", icon: "success" });
  },
  recover() {
    wx.redirectTo({ url: this.data.recoveryPath || bookingFlowPaths.staff });
  },
  retry() {
    void this.loadSlots();
  },
  chooseCustomer() {
    openCustomerSelector(bookingFlowPaths.time);
  },
});
