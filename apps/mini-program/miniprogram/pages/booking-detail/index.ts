import type { CustomerBooking } from "@rongguang/contracts";

import { fetchBookingDetail } from "../../services/booking-api";
import {
  bookingServiceLabel,
  bookingStatusPresentation,
  formatBookingDate,
  formatBookingLocalDate,
  formatBookingTime,
  presentCustomerBookingActionMessage,
} from "../../services/booking-presentation";
import { CustomerApiError } from "../../services/customer-api";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { formatCny } from "../../services/storefront-presentation";

type DetailPageState = "loading" | "ready" | "error" | "forbidden" | "auth" | "missing";

function petLabel(booking: CustomerBooking): string {
  const species = booking.pet.species === "dog" ? "犬" : "猫";
  const size = { small: "小型", medium: "中型", large: "大型" }[booking.pet.petSize];
  return `${booking.pet.name} · ${species} · ${booking.pet.weightKg}kg · ${size}`;
}

Page({
  data: {
    pageState: "loading" as DetailPageState,
    bookingId: "",
    errorMessage: "",
    statusLabel: "",
    statusTone: "neutral",
    statusTitle: "",
    nextStep: "",
    verificationCode: "",
    verificationWindowLabel: "",
    verificationWindowDescription: "",
    petLabel: "",
    serviceLabel: "",
    priceLabel: "",
    durationLabel: "",
    staffLabel: "",
    dateLabel: "",
    timeLabel: "",
    completedAtLabel: "",
    canChange: false,
    changeMessage: "",
    refreshing: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    const bookingId = options.id ?? "";
    this.setData({ bookingId, pageState: bookingId ? "loading" : "missing" });
  },
  onShow() {
    if (this.data.bookingId) void this.loadBooking();
  },
  async loadBooking() {
    if (!this.data.bookingId) {
      this.setData({ pageState: "missing" });
      return;
    }
    const path = `/pages/booking-detail/index?id=${encodeURIComponent(this.data.bookingId)}`;
    const context = await loadCustomerContext(path);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth", refreshing: false });
      return;
    }
    const keepsContent = this.data.pageState === "ready";
    this.setData({
      pageState: keepsContent ? "ready" : "loading",
      errorMessage: "",
      refreshing: keepsContent,
    });
    try {
      const result = await fetchBookingDetail(this.data.bookingId);
      const { booking } = result;
      const status = bookingStatusPresentation(booking.status);
      const completedAtLabel = booking.completedAt
        ? `${formatBookingDate(formatBookingLocalDate(booking.completedAt)).fullLabel} ${formatBookingTime(booking.completedAt)}`
        : "";
      this.setData({
        pageState: "ready",
        statusLabel: status.label,
        statusTone: status.tone,
        statusTitle: status.title,
        nextStep: status.nextStep,
        verificationCode: result.verificationCode ?? "",
        verificationWindowLabel: result.verificationWindow
          ? `${formatBookingTime(result.verificationWindow.opensAt)}–${formatBookingTime(result.verificationWindow.closesAt)} 有效`
          : "",
        verificationWindowDescription: result.verificationWindow?.description ?? "",
        petLabel: petLabel(booking),
        serviceLabel: bookingServiceLabel(booking),
        priceLabel: formatCny(booking.totalPriceCents),
        durationLabel: `${booking.serviceDurationMinutes} 分钟`,
        staffLabel: booking.staff.displayName,
        dateLabel: formatBookingDate(formatBookingLocalDate(booking.startsAt)).fullLabel,
        timeLabel: `${formatBookingTime(booking.startsAt)}–${formatBookingTime(booking.endsAt)}`,
        completedAtLabel,
        canChange: result.customerActions.canCancel && result.customerActions.canReschedule,
        changeMessage: presentCustomerBookingActionMessage(result.customerActions),
        errorMessage: "",
        refreshing: false,
      });
    } catch (error) {
      const forbidden =
        error instanceof CustomerApiError &&
        (error.statusCode === 403 || error.code === "BOOKING_NOT_FOUND");
      this.setData({
        pageState: forbidden ? "forbidden" : keepsContent ? "ready" : "error",
        errorMessage: error instanceof Error ? error.message : "预约详情没有加载出来，请稍后重试。",
        refreshing: false,
      });
    }
  },
  retry() {
    void this.loadBooking();
  },
  onPullDownRefresh() {
    void this.loadBooking().finally(() => wx.stopPullDownRefresh());
  },
  chooseCustomer() {
    openCustomerSelector(
      `/pages/booking-detail/index?id=${encodeURIComponent(this.data.bookingId)}`,
    );
  },
  viewAppointments() {
    wx.switchTab({ url: "/pages/appointments/index" });
  },
  openReschedule() {
    wx.navigateTo({
      url: `/pages/booking-reschedule/index?id=${encodeURIComponent(this.data.bookingId)}`,
    });
  },
  openCancel() {
    wx.navigateTo({
      url: `/pages/booking-cancel/index?id=${encodeURIComponent(this.data.bookingId)}`,
    });
  },
});
