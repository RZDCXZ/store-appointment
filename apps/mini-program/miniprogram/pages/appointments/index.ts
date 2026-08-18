import { fetchBookingHistory } from "../../services/booking-api";
import {
  formatBookingDate,
  formatBookingLocalDate,
  formatBookingTime,
  presentCustomerBookingRecord,
  type CustomerBookingRecordDisplay,
} from "../../services/booking-presentation";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import type { CustomerProfile } from "../../types/customer";

type AppointmentPageState = "loading" | "ready" | "empty" | "error" | "auth";
type AppointmentSegment = "upcoming" | "history";

Page({
  data: {
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    customer: null as CustomerProfile | null,
    pageState: "loading" as AppointmentPageState,
    activeSegment: "upcoming" as AppointmentSegment,
    demoTimeLabel: "读取演示时间",
    upcoming: [] as CustomerBookingRecordDisplay[],
    history: [] as CustomerBookingRecordDisplay[],
    errorMessage: "",
    refreshing: false,
  },
  async onShow() {
    await this.loadAppointments();
  },
  async loadAppointments() {
    const context = await loadCustomerContext("/pages/appointments/index");
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({
        authState: context.kind,
        customer: null,
        pageState: "auth",
        refreshing: false,
      });
      return;
    }
    const hasRecords = this.data.upcoming.length + this.data.history.length > 0;
    this.setData({
      authState: context.kind,
      customer: context.customer,
      pageState: hasRecords ? "ready" : "loading",
      errorMessage: "",
      refreshing: hasRecords,
    });
    try {
      const response = await fetchBookingHistory();
      const upcoming = response.upcoming.map(presentCustomerBookingRecord);
      const history = response.history.map(presentCustomerBookingRecord);
      const demoDate = formatBookingDate(formatBookingLocalDate(response.demoNow)).fullLabel;
      this.setData({
        pageState: upcoming.length + history.length > 0 ? "ready" : "empty",
        demoTimeLabel: `演示时间 · ${demoDate} ${formatBookingTime(response.demoNow)}`,
        upcoming,
        history,
        errorMessage: "",
        refreshing: false,
      });
    } catch (error) {
      this.setData({
        pageState: hasRecords ? "ready" : "error",
        errorMessage: error instanceof Error ? error.message : "预约记录没有加载出来，请重试。",
        refreshing: false,
      });
    }
  },
  switchSegment(event: WechatMiniprogram.BaseEvent) {
    const segment = event.currentTarget.dataset.segment as unknown;
    if (segment === "upcoming" || segment === "history") {
      this.setData({ activeSegment: segment });
    }
  },
  openBooking(event: WechatMiniprogram.BaseEvent) {
    const bookingId = event.currentTarget.dataset.id as unknown;
    if (typeof bookingId === "string") {
      wx.navigateTo({
        url: `/pages/booking-detail/index?id=${encodeURIComponent(bookingId)}`,
      });
    }
  },
  retry() {
    void this.loadAppointments();
  },
  onPullDownRefresh() {
    void this.loadAppointments().finally(() => wx.stopPullDownRefresh());
  },
  startBooking() {
    wx.navigateTo({ url: "/pages/booking-pet/index" });
  },
  chooseCustomer() {
    openCustomerSelector("/pages/appointments/index");
  },
});
