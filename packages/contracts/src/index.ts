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

export const backofficeRoles = {
  manager: {
    label: "店长",
    workspaceLabel: "店长后台",
    navigationLabel: "店长导航",
    loadingNavigationLabel: "店长导航加载中",
    landingPath: "/manager/workbench",
  },
  staff: {
    label: "员工",
    workspaceLabel: "员工工作台",
    navigationLabel: "员工导航",
    loadingNavigationLabel: "员工导航加载中",
    landingPath: "/staff/today",
  },
} as const satisfies Record<
  BackofficeRole,
  {
    label: string;
    workspaceLabel: string;
    navigationLabel: string;
    loadingNavigationLabel: string;
    landingPath: `/${string}`;
  }
>;

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

export interface DemoCustomerChoice {
  key: string;
  displayName: string;
  story: "正常预约" | "已有未来预约" | "取消或爽约历史";
  avatarInitial: string;
}

export interface MiniappCustomerProfile {
  displayName: string;
  phoneMasked: string;
  story: DemoCustomerChoice["story"];
  avatarInitial: string;
}

export interface DemoCustomerChoicesResponse {
  customers: DemoCustomerChoice[];
}

export interface MiniappSessionResponse {
  accessToken: string;
  expiresAt: string;
  customer: MiniappCustomerProfile;
}

export interface MiniappProfileResponse {
  customer: MiniappCustomerProfile;
}
