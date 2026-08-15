export interface HealthResponse {
  service: "rongguang-api";
  status: "ok";
  database: "ready";
  timestamp: string;
}

export const backofficeNavigation = {
  manager: [
    { key: "workbench", label: "工作台" },
    { key: "appointments", label: "预约" },
    { key: "schedule", label: "排班" },
    { key: "services", label: "服务" },
    { key: "customers", label: "顾客" },
    { key: "business", label: "经营" },
    { key: "system", label: "系统" },
  ],
  staff: [
    { key: "today", label: "今日工作" },
    { key: "appointments", label: "我的预约" },
  ],
} as const;

export type BackofficeRole = keyof typeof backofficeNavigation;
export type BackofficeNavigationKey = (typeof backofficeNavigation)[BackofficeRole][number]["key"];

export interface BackofficeAccount {
  id: string;
  username: string;
  displayName: string;
  role: BackofficeRole;
}

export interface BackofficeAuthResponse {
  account: BackofficeAccount;
}

export interface BackofficeLandingResponse extends BackofficeAuthResponse {
  navigation: string[];
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}
