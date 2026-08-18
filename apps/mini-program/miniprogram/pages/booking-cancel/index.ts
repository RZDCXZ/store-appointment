import { cancelBooking, fetchBookingDetail } from "../../services/booking-api";
import {
  clearCustomerChangeIdempotencyKey,
  ensureCustomerChangeIdempotencyKey,
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

const reasons = ["行程变化", "宠物临时不适", "其他"] as const;

Page({
  data: {
    pageState: "loading" as PageState,
    bookingId: "",
    errorMessage: "",
    contactMessage: "",
    petServiceLabel: "",
    scheduleLabel: "",
    consequenceLabel: "取消后将释放该时段，六位核销码立即失效。",
    reasons,
    selectedReason: reasons[0] as string,
    statusLabel: "",
  },
  onLoad(options: Record<string, string | undefined>) {
    const bookingId = options.id ?? "";
    this.setData({ bookingId, pageState: bookingId ? "loading" : "missing" });
  },
  onShow() {
    if (
      this.data.bookingId &&
      this.data.pageState !== "success" &&
      this.data.pageState !== "ready"
    ) {
      void this.loadBooking();
    }
  },
  async loadBooking() {
    if (!this.data.bookingId) {
      this.setData({ pageState: "missing" });
      return;
    }
    const path = `/pages/booking-cancel/index?id=${encodeURIComponent(this.data.bookingId)}`;
    const context = await loadCustomerContext(path);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }
    this.setData({ pageState: "loading", errorMessage: "" });
    try {
      const result = await fetchBookingDetail(this.data.bookingId);
      const { booking } = result;
      const date = formatBookingDate(formatBookingLocalDate(booking.startsAt)).fullLabel;
      const scheduleLabel = `${date} · ${formatBookingTime(booking.startsAt)}–${formatBookingTime(booking.endsAt)} · ${booking.staff.displayName}`;
      this.setData({
        pageState:
          booking.status === "cancelled"
            ? "success"
            : result.customerActions.canCancel
              ? "ready"
              : "contact",
        contactMessage: result.customerActions.canCancel
          ? ""
          : presentCustomerBookingActionMessage(result.customerActions),
        petServiceLabel: `${booking.pet.name} · ${booking.primaryService.name}`,
        scheduleLabel,
        statusLabel: booking.status === "cancelled" ? "已取消" : "",
      });
    } catch (error) {
      if (
        error instanceof CustomerApiError &&
        (error.statusCode === 403 || error.code === "BOOKING_NOT_FOUND")
      ) {
        this.setData({ pageState: "forbidden", errorMessage: error.message });
        return;
      }
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "预约详情没有加载出来。",
      });
    }
  },
  chooseReason(event: WechatMiniprogram.BaseEvent) {
    const reason = String(event.currentTarget.dataset.reason ?? "");
    if (reasons.includes(reason as (typeof reasons)[number])) {
      this.setData({ selectedReason: reason, errorMessage: "" });
    }
  },
  async submit() {
    if (this.data.pageState === "submitting") return;
    this.setData({ pageState: "submitting", errorMessage: "" });
    try {
      await cancelBooking(this.data.bookingId, {
        idempotencyKey: ensureCustomerChangeIdempotencyKey("cancel", this.data.bookingId),
        reason: this.data.selectedReason,
      });
      clearCustomerChangeIdempotencyKey("cancel", this.data.bookingId);
      this.setData({ pageState: "success", statusLabel: "已取消" });
    } catch (error) {
      const contact =
        error instanceof CustomerApiError &&
        (error.code === "BOOKING_CHANGE_CUTOFF_PASSED" ||
          error.code === "BOOKING_CHANGE_NOT_ALLOWED");
      this.setData({
        pageState: contact ? "contact" : "ready",
        contactMessage: contact && error instanceof Error ? error.message : "",
        errorMessage: contact ? "" : error instanceof Error ? error.message : "取消没有提交成功。",
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
      `/pages/booking-cancel/index?id=${encodeURIComponent(this.data.bookingId)}`,
    );
  },
  keepBooking() {
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
