import { loadCustomerTabState, openCustomerSelector } from "../../services/customer-session";
import type { CustomerProfile } from "../../types/customer";

Page({
  data: {
    businessHours: "设计样例营业 · 09:30–19:00",
    demoTime: "2026年8月13日 周四 10:50",
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    customer: null as CustomerProfile | null,
    connectionMessage: "",
  },
  async onShow() {
    this.setData(await loadCustomerTabState("/pages/home/index"));
  },
  primaryAction() {
    if (this.data.customer) {
      wx.switchTab({ url: "/pages/appointments/index" });
      return;
    }

    openCustomerSelector("/pages/home/index");
  },
  goAppointments() {
    wx.switchTab({ url: "/pages/appointments/index" });
  },
  chooseCustomer() {
    openCustomerSelector("/pages/home/index");
  },
});
