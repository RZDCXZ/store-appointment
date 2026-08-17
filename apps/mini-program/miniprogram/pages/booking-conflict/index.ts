import type { BookingConflictSuggestion } from "@rongguang/contracts";

import { clearBookingConflict, readBookingConflict } from "../../services/booking-conflict";
import {
  bookingFlowPaths,
  chooseBookingTime,
  clearBookingTime,
  readBookingDraft,
  recoveryForBookingStep,
} from "../../services/booking-draft";
import { formatBookingDate, formatBookingTime } from "../../services/booking-presentation";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";

type PageState = "loading" | "ready" | "empty" | "auth" | "recovery";

interface DisplaySuggestion extends BookingConflictSuggestion {
  dateLabel: string;
  timeLabel: string;
  staffLabel: string;
  nearest: boolean;
}

function displaySuggestion(
  suggestion: BookingConflictSuggestion,
  index: number,
): DisplaySuggestion {
  return {
    ...suggestion,
    dateLabel: formatBookingDate(suggestion.date).fullLabel,
    timeLabel: `${formatBookingTime(suggestion.startsAt)}–${formatBookingTime(suggestion.endsAt)}`,
    staffLabel: suggestion.staff.displayName,
    nearest: index === 0,
  };
}

Page({
  data: {
    pageState: "loading" as PageState,
    recoveryMessage: "",
    petLabel: "",
    serviceLabel: "",
    staffPreferenceLabel: "",
    requestedTimeLabel: "",
    suggestions: [] as DisplaySuggestion[],
  },
  onShow() {
    void this.loadConflict();
  },
  async loadConflict() {
    const draft = readBookingDraft();
    const recovery = recoveryForBookingStep("confirm", draft);
    const conflict = readBookingConflict();

    if (
      recovery ||
      !conflict ||
      !draft.selectedTime ||
      conflict.requestedStartsAt !== draft.selectedTime.startsAt
    ) {
      this.setData({
        pageState: "recovery",
        recoveryMessage: "冲突建议已经失效，请重新选择日期与时段。",
        suggestions: [],
      });
      return;
    }

    const customer = await loadCustomerContext(bookingFlowPaths.conflict);
    if (customer.kind === "expired" || customer.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }

    const requestedDate = formatBookingDate(draft.selectedTime.date).fullLabel;
    this.setData({
      pageState: conflict.suggestions.length > 0 ? "ready" : "empty",
      petLabel: conflict.petLabel,
      serviceLabel: conflict.serviceLabel,
      staffPreferenceLabel: conflict.staffPreferenceLabel,
      requestedTimeLabel: `${requestedDate} ${formatBookingTime(draft.selectedTime.startsAt)}–${formatBookingTime(draft.selectedTime.endsAt)}`,
      suggestions: conflict.suggestions.map(displaySuggestion),
      recoveryMessage: "",
    });
  },
  selectSuggestion(event: WechatMiniprogram.BaseEvent) {
    const startsAt = event.currentTarget.dataset.start as unknown;
    if (typeof startsAt !== "string") return;
    const conflict = readBookingConflict();
    const suggestion = conflict?.suggestions.find((candidate) => candidate.startsAt === startsAt);
    if (!suggestion) return;

    chooseBookingTime({
      date: suggestion.date,
      startsAt: suggestion.startsAt,
      endsAt: suggestion.endsAt,
      assignedStaffId: suggestion.staff.id,
    });
    clearBookingConflict();
    wx.redirectTo({ url: bookingFlowPaths.confirm });
  },
  chooseOtherDate() {
    clearBookingTime();
    clearBookingConflict();
    wx.redirectTo({ url: bookingFlowPaths.time });
  },
  recover() {
    clearBookingTime();
    clearBookingConflict();
    wx.redirectTo({ url: bookingFlowPaths.time });
  },
  chooseCustomer() {
    openCustomerSelector(bookingFlowPaths.conflict);
  },
});
