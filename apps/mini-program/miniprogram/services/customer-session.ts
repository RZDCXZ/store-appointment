import type {
  DemoCustomerChoicesResponse,
  MiniappProfileResponse,
  MiniappSessionResponse,
} from "@rongguang/contracts";

import type {
  CustomerProfile,
  DemoCustomerChoice,
  RongguangApp,
  StoredCustomerSession,
} from "../types/customer";
import { clearBookingConflict } from "./booking-conflict";
import { clearBookingDraft } from "./booking-draft";

const SESSION_STORAGE_KEY = "rongguang.customer-session";
const RECOVERY_PATH_STORAGE_KEY = "rongguang.customer-recovery-path";
const tabPaths = new Set([
  "/pages/home/index",
  "/pages/appointments/index",
  "/pages/messages/index",
  "/pages/profile/index",
]);
const recoverablePagePaths = new Set([
  ...tabPaths,
  "/pages/pets/index",
  "/pages/pet-form/index",
  "/pages/privacy-consent/index",
  "/pages/data-rights/index",
  "/pages/booking-pet/index",
  "/pages/booking-service/index",
  "/pages/booking-staff/index",
  "/pages/booking-time/index",
  "/pages/booking-conflict/index",
  "/pages/booking-confirm/index",
  "/pages/booking-success/index",
  "/pages/booking-detail/index",
]);

function isRecoverablePath(value: string): boolean {
  if (value.length > 240 || value.includes("#")) {
    return false;
  }

  return recoverablePagePaths.has(value.split("?", 1)[0] ?? "");
}

interface ApiErrorBody {
  code?: string;
  message?: string;
}

export type CustomerContext =
  | { kind: "active"; customer: CustomerProfile }
  | { kind: "expired" }
  | { kind: "missing" }
  | { kind: "unavailable"; customer: CustomerProfile; message: string };

export interface CustomerTabState {
  authState: CustomerContext["kind"];
  customer: CustomerProfile | null;
  connectionMessage: string;
}

class MiniappApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isCustomerProfile(value: unknown): value is CustomerProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const profile = value as Partial<CustomerProfile>;
  return (
    typeof profile.displayName === "string" &&
    typeof profile.phoneMasked === "string" &&
    (profile.story === "正常预约" ||
      profile.story === "已有未来预约" ||
      profile.story === "取消或爽约历史") &&
    typeof profile.avatarInitial === "string"
  );
}

function isStoredSession(value: unknown): value is StoredCustomerSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<StoredCustomerSession>;
  return (
    typeof session.accessToken === "string" &&
    typeof session.expiresAt === "string" &&
    typeof session.customerKey === "string" &&
    isCustomerProfile(session.customer)
  );
}

function appState(): RongguangApp["globalData"] {
  return getApp<RongguangApp>().globalData;
}

function requestApi<T>(
  path: string,
  options: { method?: "GET" | "POST"; data?: object; accessToken?: string } = {},
): Promise<T> {
  const state = appState();

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${state.apiBaseUrl}${path}`,
      method: options.method ?? "GET",
      data: options.data,
      header: options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : undefined,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T);
          return;
        }

        const error = response.data as ApiErrorBody;
        reject(
          new MiniappApiError(
            response.statusCode,
            error.code ?? "REQUEST_FAILED",
            error.message ?? "请求失败，请稍后重试。",
          ),
        );
      },
      fail() {
        reject(new MiniappApiError(0, "NETWORK_ERROR", "暂时无法连接茸光本地 API。"));
      },
    });
  });
}

function persistSession(session: StoredCustomerSession): void {
  wx.setStorageSync(SESSION_STORAGE_KEY, session);
  const state = appState();
  state.customerSession = session;
  state.customerSessionStatus = "active";
}

export function restoreCustomerSession(
  state: RongguangApp["globalData"] = appState(),
): CustomerContext {
  const stored = wx.getStorageSync(SESSION_STORAGE_KEY) as unknown;

  if (!isStoredSession(stored)) {
    wx.removeStorageSync(SESSION_STORAGE_KEY);
    state.customerSession = null;

    if (state.customerSessionStatus === "expired") {
      return { kind: "expired" };
    }

    state.customerSessionStatus = "missing";
    return { kind: "missing" };
  }

  if (
    !Number.isFinite(Date.parse(stored.expiresAt)) ||
    Date.parse(stored.expiresAt) <= Date.now()
  ) {
    wx.removeStorageSync(SESSION_STORAGE_KEY);
    state.customerSession = null;
    state.customerSessionStatus = "expired";
    return { kind: "expired" };
  }

  state.customerSession = stored;
  state.customerSessionStatus = "active";
  return { kind: "active", customer: stored.customer };
}

export async function loadCustomerContext(pagePath: string): Promise<CustomerContext> {
  const restored = restoreCustomerSession();

  if (restored.kind !== "active") {
    if (restored.kind === "expired" && pagePath !== "/pages/profile/index") {
      rememberRecoveryPath(pagePath);
    }
    return restored;
  }

  const session = appState().customerSession;

  if (!session) {
    return { kind: "missing" };
  }

  try {
    const response = await requestApi<MiniappProfileResponse>("/miniapp/me", {
      accessToken: session.accessToken,
    });
    const updatedSession = { ...session, customer: response.customer };
    persistSession(updatedSession);
    return { kind: "active", customer: response.customer };
  } catch (error) {
    if (
      error instanceof MiniappApiError &&
      error.statusCode === 401 &&
      (error.code === "SESSION_EXPIRED" || error.code === "UNAUTHENTICATED")
    ) {
      wx.removeStorageSync(SESSION_STORAGE_KEY);
      const state = appState();
      state.customerSession = null;
      state.customerSessionStatus = error.code === "SESSION_EXPIRED" ? "expired" : "missing";
      rememberRecoveryPath(pagePath);
      return error.code === "SESSION_EXPIRED" ? { kind: "expired" } : { kind: "missing" };
    }

    return {
      kind: "unavailable",
      customer: session.customer,
      message: error instanceof Error ? error.message : "当前资料更新失败，请稍后重试。",
    };
  }
}

export async function loadCustomerTabState(pagePath: string): Promise<CustomerTabState> {
  const context = await loadCustomerContext(pagePath);
  return {
    authState: context.kind,
    customer: "customer" in context ? context.customer : null,
    connectionMessage: context.kind === "unavailable" ? context.message : "",
  };
}

export function openCustomerSelector(pagePath: string): void {
  rememberRecoveryPath(pagePath);
  wx.switchTab({ url: "/pages/profile/index" });
}

export async function fetchDemoCustomers(): Promise<DemoCustomerChoice[]> {
  const response = await requestApi<DemoCustomerChoicesResponse>("/miniapp/demo-customers");
  return response.customers;
}

export async function switchDemoCustomer(customerKey: string): Promise<CustomerProfile> {
  const previousCustomerKey = appState().customerSession?.customerKey ?? null;
  const session = await requestApi<MiniappSessionResponse>("/miniapp/demo-sessions", {
    method: "POST",
    data: { customerKey },
  });
  if (previousCustomerKey !== session.customerKey) {
    clearBookingDraft();
    clearBookingConflict();
  }
  persistSession(session);
  return session.customer;
}

export function rememberRecoveryPath(pagePath: string): void {
  const normalized = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;

  if (isRecoverablePath(normalized)) {
    wx.setStorageSync(RECOVERY_PATH_STORAGE_KEY, normalized);
  }
}

export function takeRecoveryPath(): string | null {
  const value = wx.getStorageSync(RECOVERY_PATH_STORAGE_KEY) as unknown;
  wx.removeStorageSync(RECOVERY_PATH_STORAGE_KEY);
  return typeof value === "string" && isRecoverablePath(value) ? value : null;
}

export function isCustomerTabPath(pagePath: string): boolean {
  return tabPaths.has(pagePath.split("?", 1)[0] ?? "");
}

export function clearCustomerSessionAfterDeletion(): void {
  wx.removeStorageSync(SESSION_STORAGE_KEY);
  wx.removeStorageSync(RECOVERY_PATH_STORAGE_KEY);
  clearBookingDraft();
  clearBookingConflict();
  const state = appState();
  state.customerSession = null;
  state.customerSessionStatus = "missing";
}
