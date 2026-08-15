import { restoreCustomerSession } from "./services/customer-session";
import type { RongguangApp } from "./types/customer";

App({
  globalData: {
    apiBaseUrl: "http://127.0.0.1:3000",
    customerSession: null,
    customerSessionStatus: "missing",
  },
  onLaunch() {
    restoreCustomerSession(this.globalData as RongguangApp["globalData"]);
  },
});
