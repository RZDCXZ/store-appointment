import { loadCustomerContext, rememberRecoveryPath } from "../../services/customer-session";
import type { CustomerProfile } from "../../types/customer";

Page({
  data: {
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    customer: null as CustomerProfile | null,
    connectionMessage: "",
  },
  async onShow() {
    const context = await loadCustomerContext("/pages/messages/index");
    this.setData({
      authState: context.kind,
      customer: "customer" in context ? context.customer : null,
      connectionMessage: context.kind === "unavailable" ? context.message : "",
    });
  },
  chooseCustomer() {
    rememberRecoveryPath("/pages/messages/index");
    wx.switchTab({ url: "/pages/profile/index" });
  },
});
