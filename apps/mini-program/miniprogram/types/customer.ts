import type {
  DemoCustomerChoice,
  MiniappCustomerProfile,
  MiniappSessionResponse,
} from "@rongguang/contracts";

export type CustomerProfile = MiniappCustomerProfile;
export type StoredCustomerSession = MiniappSessionResponse;
export type { DemoCustomerChoice };

export type CustomerSessionStatus = "active" | "expired" | "missing";

export interface RongguangApp {
  globalData: {
    apiBaseUrl: string;
    customerSession: StoredCustomerSession | null;
    customerSessionStatus: CustomerSessionStatus;
  };
}
