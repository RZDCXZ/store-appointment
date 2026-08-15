import { restoreCustomerSession } from "./services/customer-session";

App({
  globalData: {
    apiBaseUrl: "http://127.0.0.1:3000",
    customerSession: null,
    customerSessionStatus: "missing",
  },
  onLaunch() {
    restoreCustomerSession();
  },
});
