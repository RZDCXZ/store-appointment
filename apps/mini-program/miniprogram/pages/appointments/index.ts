import { loadCustomerTabState, openCustomerSelector } from "../../services/customer-session";
import type { CustomerProfile } from "../../types/customer";

Page({
  data: {
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    customer: null as CustomerProfile | null,
    connectionMessage: "",
  },
  async onShow() {
    this.setData(await loadCustomerTabState("/pages/appointments/index"));
  },
  chooseCustomer() {
    openCustomerSelector("/pages/appointments/index");
  },
});
