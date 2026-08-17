import { fetchBookingDetail } from "../../services/booking-api";
import { formatBookingDate, formatBookingTime } from "../../services/booking-presentation";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { formatCny } from "../../services/storefront-presentation";

type PageState = "loading" | "ready" | "error" | "auth" | "missing";

Page({
  data: {
    pageState: "loading" as PageState,
    bookingId: "",
    errorMessage: "",
    statusLabel: "",
    petName: "",
    dateLabel: "",
    timeLabel: "",
    serviceLabel: "",
    staffLabel: "",
    priceLabel: "",
  },
  onLoad(options: Record<string, string | undefined>) {
    const bookingId = options.id ?? "";
    if (!bookingId) {
      this.setData({ pageState: "missing" });
      return;
    }
    this.setData({ bookingId });
    void this.loadBooking();
  },
  async loadBooking() {
    if (!this.data.bookingId) {
      this.setData({ pageState: "missing" });
      return;
    }
    const path = `/pages/booking-success/index?id=${encodeURIComponent(this.data.bookingId)}`;
    const context = await loadCustomerContext(path);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }
    try {
      const { booking } = await fetchBookingDetail(this.data.bookingId);
      const localDate = new Date(new Date(booking.startsAt).getTime() + 8 * 60 * 60_000)
        .toISOString()
        .slice(0, 10);
      this.setData({
        pageState: "ready",
        statusLabel: "预约已确认",
        petName: booking.pet.name,
        dateLabel: formatBookingDate(localDate).fullLabel,
        timeLabel: `${formatBookingTime(booking.startsAt)}–${formatBookingTime(booking.endsAt)}`,
        serviceLabel: [
          booking.primaryService.name,
          ...booking.addons.map((addon) => addon.name),
        ].join(" + "),
        staffLabel: booking.staff.displayName,
        priceLabel: formatCny(booking.totalPriceCents),
        errorMessage: "",
      });
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "预约事实恢复失败，请重试。",
      });
    }
  },
  retry() {
    this.setData({ pageState: "loading" });
    void this.loadBooking();
  },
  chooseCustomer() {
    openCustomerSelector(
      `/pages/booking-success/index?id=${encodeURIComponent(this.data.bookingId)}`,
    );
  },
  viewAppointments() {
    wx.switchTab({ url: "/pages/appointments/index" });
  },
  goHome() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
