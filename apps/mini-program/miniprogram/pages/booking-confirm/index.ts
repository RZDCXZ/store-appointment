import type { BookingAvailabilityResponse } from "@rongguang/contracts";

import { createConfirmedBooking } from "../../services/booking-api";
import { fetchBookingAvailability } from "../../services/booking-availability-api";
import {
  bookingFlowPaths,
  clearBookingDraft,
  clearBookingTime,
  readBookingDraft,
  recoveryForBookingStep,
} from "../../services/booking-draft";
import {
  findRestorableBookingSlot,
  formatBookingDate,
  formatBookingTime,
} from "../../services/booking-presentation";
import { CustomerApiError } from "../../services/customer-api";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { fetchBookingEntry } from "../../services/privacy-consent-api";
import { formatCny } from "../../services/storefront-presentation";

type PageState = "loading" | "ready" | "error" | "auth" | "recovery";

function speciesLabel(species: "dog" | "cat"): string {
  return species === "dog" ? "犬" : "猫";
}

function sizeLabel(size: "small" | "medium" | "large"): string {
  return { small: "小型", medium: "中型", large: "大型" }[size];
}

function actionFor(code: string): { path: string; label: string } | null {
  if (code === "SERVICE_NOT_AVAILABLE") {
    return { path: bookingFlowPaths.service, label: "重新选择服务" };
  }
  if (code === "STAFF_NOT_QUALIFIED") {
    return { path: bookingFlowPaths.staff, label: "重新选择员工" };
  }
  if (
    code === "STAFF_TIME_CONFLICT" ||
    code === "PET_TIME_CONFLICT" ||
    code === "SLOT_NO_LONGER_AVAILABLE" ||
    code === "SLOT_OUTSIDE_OPEN_WINDOW"
  ) {
    return { path: bookingFlowPaths.time, label: "重新选择时段" };
  }
  return null;
}

Page({
  data: {
    pageState: "loading" as PageState,
    recoveryPath: "",
    recoveryMessage: "",
    errorMessage: "",
    submissionError: "",
    submissionActionPath: "",
    submissionActionLabel: "",
    submitting: false,
    response: null as BookingAvailabilityResponse | null,
    petLabel: "",
    serviceLabel: "",
    serviceDetail: "",
    staffLabel: "",
    dateLabel: "",
    timeLabel: "",
    priceLabel: "",
    durationLabel: "",
    privacyVersion: "",
  },
  onShow() {
    void this.loadConfirmation();
  },
  async loadConfirmation() {
    const draft = readBookingDraft();
    const recovery = recoveryForBookingStep("confirm", draft);
    if (recovery) {
      this.setData({
        pageState: "recovery",
        recoveryPath: recovery.path,
        recoveryMessage: recovery.message,
      });
      return;
    }
    const context = await loadCustomerContext(bookingFlowPaths.confirm);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }
    try {
      const entry = await fetchBookingEntry();
      if (!entry.canContinue) {
        wx.redirectTo({
          url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(bookingFlowPaths.confirm)}`,
        });
        return;
      }
      const response = await fetchBookingAvailability(draft);
      const slot = findRestorableBookingSlot(response.days, draft.selectedTime);
      if (!slot || !draft.selectedTime) {
        clearBookingTime();
        this.setData({
          pageState: "recovery",
          recoveryPath: bookingFlowPaths.time,
          recoveryMessage: "原选时段已不可约，请重新选择。",
        });
        return;
      }
      const selection = response.selection;
      const date = formatBookingDate(draft.selectedTime.date);
      const serviceNames = [
        selection.primaryService.name,
        ...selection.addons.map((addon) => addon.name),
      ];
      this.setData({
        pageState: "ready",
        response,
        petLabel: `${selection.pet.name} · ${speciesLabel(selection.pet.species)} · ${selection.pet.weightKg}kg · ${sizeLabel(selection.pet.petSize)}`,
        serviceLabel: serviceNames.join(" + "),
        serviceDetail: `${selection.primaryService.name} ${formatCny(selection.primaryService.priceCents)}${selection.addons.length ? `；增项 ${selection.addons.map((addon) => `${addon.name} ${formatCny(addon.priceCents)}`).join("、")}` : "；无增项"}`,
        staffLabel: slot.staff.displayName,
        dateLabel: date.fullLabel,
        timeLabel: `${formatBookingTime(slot.startsAt)}–${formatBookingTime(slot.endsAt)}`,
        priceLabel: formatCny(selection.totalPriceCents),
        durationLabel: `${selection.serviceDurationMinutes} 分钟`,
        privacyVersion: entry.requiredPrivacyNoticeVersion,
        errorMessage: "",
        submissionError: "",
        submissionActionPath: "",
        submissionActionLabel: "",
      });
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "预约事实恢复失败，请重试。",
      });
    }
  },
  async submitBooking() {
    if (this.data.submitting || this.data.pageState !== "ready") return;
    const draft = readBookingDraft();
    const recovery = recoveryForBookingStep("confirm", draft);
    if (recovery) {
      this.setData({
        pageState: "recovery",
        recoveryPath: recovery.path,
        recoveryMessage: recovery.message,
      });
      return;
    }
    this.setData({
      submitting: true,
      submissionError: "",
      submissionActionPath: "",
      submissionActionLabel: "",
    });
    try {
      const result = await createConfirmedBooking(draft);
      clearBookingDraft();
      wx.redirectTo({
        url: `/pages/booking-success/index?id=${encodeURIComponent(result.booking.id)}`,
      });
    } catch (error) {
      if (error instanceof CustomerApiError && error.code === "PRIVACY_CONSENT_REQUIRED") {
        wx.redirectTo({
          url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(bookingFlowPaths.confirm)}`,
        });
        return;
      }
      const action = error instanceof CustomerApiError ? actionFor(error.code) : null;
      this.setData({
        submitting: false,
        submissionError: error instanceof Error ? error.message : "预约提交失败，请重试。",
        submissionActionPath: action?.path ?? "",
        submissionActionLabel: action?.label ?? "",
      });
    }
  },
  resolveSubmissionError() {
    if (this.data.submissionActionPath) {
      wx.redirectTo({ url: this.data.submissionActionPath });
    }
  },
  recover() {
    wx.redirectTo({ url: this.data.recoveryPath || bookingFlowPaths.time });
  },
  retry() {
    void this.loadConfirmation();
  },
  chooseCustomer() {
    openCustomerSelector(bookingFlowPaths.confirm);
  },
  showSuccess(bookingId: string) {
    wx.redirectTo({
      url: `/pages/booking-success/index?id=${encodeURIComponent(bookingId)}`,
    });
  },
});
