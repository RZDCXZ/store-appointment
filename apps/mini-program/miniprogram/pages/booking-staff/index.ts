import type { BookingAvailabilityResponse } from "@rongguang/contracts";

import { fetchBookingAvailability } from "../../services/booking-availability-api";
import {
  bookingFlowPaths,
  chooseBookingStaff,
  readBookingDraft,
  recoveryForBookingStep,
} from "../../services/booking-draft";
import { formatEarliestSlot } from "../../services/booking-presentation";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { fetchBookingEntry } from "../../services/privacy-consent-api";
import { formatCny } from "../../services/storefront-presentation";

type PageState = "loading" | "ready" | "error" | "auth" | "recovery";

Page({
  data: {
    pageState: "loading" as PageState,
    recoveryPath: "",
    recoveryMessage: "",
    errorMessage: "",
    response: null as BookingAvailabilityResponse | null,
    staffOptions: [] as {
      id: string;
      displayName: string;
      avatarInitial: string;
      earliestLabel: string;
    }[],
    preferenceKey: "",
    summary: "",
    totalPriceLabel: "",
  },
  onShow() {
    void this.loadStaff();
  },
  async loadStaff() {
    const draft = readBookingDraft();
    const recovery = recoveryForBookingStep("staff", draft);
    if (recovery) {
      this.setData({
        pageState: "recovery",
        recoveryPath: recovery.path,
        recoveryMessage: recovery.message,
      });
      return;
    }
    const context = await loadCustomerContext(bookingFlowPaths.staff);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }
    try {
      const entry = await fetchBookingEntry();
      if (!entry.canContinue) {
        wx.redirectTo({
          url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(bookingFlowPaths.staff)}`,
        });
        return;
      }
      const response = await fetchBookingAvailability({ ...draft, staffPreference: null });
      this.setData({
        pageState: "ready",
        response,
        staffOptions: response.staffOptions.map((staff) => ({
          id: staff.id,
          displayName: staff.displayName,
          avatarInitial: staff.displayName.slice(0, 1),
          earliestLabel: formatEarliestSlot(staff.earliestSlot?.startsAt ?? null),
        })),
        preferenceKey:
          draft.staffPreference?.kind === "specified"
            ? draft.staffPreference.staffId
            : draft.staffPreference?.kind === "fastest"
              ? "fastest"
              : "",
        summary: `${response.selection.primaryService.name}${response.selection.addons.length ? ` + ${response.selection.addons.map((addon) => addon.name).join(" + ")}` : ""} · ${response.selection.serviceDurationMinutes} 分钟`,
        totalPriceLabel: formatCny(response.selection.totalPriceCents),
        errorMessage: "",
      });
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "员工可约情况加载失败，请重试。",
      });
    }
  },
  selectPreference(event: WechatMiniprogram.BaseEvent) {
    const key = event.currentTarget.dataset.id as unknown;
    if (typeof key !== "string") return;
    chooseBookingStaff(
      key === "fastest" ? { kind: "fastest" } : { kind: "specified", staffId: key },
    );
    this.setData({ preferenceKey: key });
  },
  continueFlow() {
    if (this.data.preferenceKey) wx.navigateTo({ url: bookingFlowPaths.time });
  },
  recover() {
    wx.redirectTo({ url: this.data.recoveryPath || bookingFlowPaths.service });
  },
  retry() {
    void this.loadStaff();
  },
  chooseCustomer() {
    openCustomerSelector(bookingFlowPaths.staff);
  },
});
