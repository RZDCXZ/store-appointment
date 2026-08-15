export type CustomerStory = "正常预约" | "已有未来预约" | "取消或爽约历史";

export interface DemoCustomerChoice {
  key: string;
  displayName: string;
  phoneMasked: string;
  story: CustomerStory;
  avatarInitial: string;
}

export type CustomerProfile = Omit<DemoCustomerChoice, "key">;

export interface StoredCustomerSession {
  accessToken: string;
  expiresAt: string;
  customer: CustomerProfile;
}

export type CustomerSessionStatus = "active" | "expired" | "missing";

export interface RongguangApp {
  globalData: {
    apiBaseUrl: string;
    customerSession: StoredCustomerSession | null;
    customerSessionStatus: CustomerSessionStatus;
  };
}
