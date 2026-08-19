import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCustomerSessionAfterDeletion,
  rememberRecoveryPath,
  restoreCustomerSession,
  switchDemoCustomer,
  takeRecoveryPath,
} from "../miniprogram/services/customer-session";
import type { RongguangApp } from "../miniprogram/types/customer";

describe("小程序启动会话恢复", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("App 注册完成前可使用 onLaunch 提供的 globalData 恢复会话", () => {
    vi.stubGlobal("wx", {
      getStorageSync: () => null,
      removeStorageSync: vi.fn(),
    });
    const globalData: RongguangApp["globalData"] = {
      apiBaseUrl: "http://127.0.0.1:3000",
      customerSession: null,
      customerSessionStatus: "missing",
    };

    expect(restoreCustomerSession(globalData)).toEqual({ kind: "missing" });
    expect(globalData.customerSessionStatus).toBe("missing");
  });

  it("保留带宠物 ID 的独立编辑页，重新选择顾客后可恢复原路径", () => {
    const storage = new Map<string, unknown>();
    vi.stubGlobal("wx", {
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
    });

    rememberRecoveryPath("/pages/pet-form/index?id=pet-tuanzi");

    expect(takeRecoveryPath()).toBe("/pages/pet-form/index?id=pet-tuanzi");
  });

  it("会话失效后改选顾客时清除未绑定身份的旧预约草稿", async () => {
    const storage = new Map<string, unknown>([
      ["rongguang.booking-draft.v1", { version: 1, petId: "pet-old-customer" }],
    ]);
    const globalData: RongguangApp["globalData"] = {
      apiBaseUrl: "http://api.local",
      customerSession: null,
      customerSessionStatus: "expired",
    };
    vi.stubGlobal("getApp", () => ({ globalData }));
    vi.stubGlobal("wx", {
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
      request: (options: { success(response: { statusCode: number; data: unknown }): void }) =>
        options.success({
          statusCode: 201,
          data: {
            accessToken: "new-token",
            expiresAt: "2026-08-17T10:00:00.000Z",
            customerKey: "cheng-mo",
            customer: {
              displayName: "程墨",
              phoneMasked: "139****0341",
              story: "已有未来预约",
              avatarInitial: "程",
            },
          },
        }),
    });

    await switchDemoCustomer("cheng-mo");

    expect(storage.has("rongguang.booking-draft.v1")).toBe(false);
    expect(globalData.customerSession?.customerKey).toBe("cheng-mo");
  });

  it("匿名化成功后同步清除本地会话、恢复路径与预约上下文", () => {
    const storage = new Map<string, unknown>([
      ["rongguang.customer-session", { accessToken: "old-token" }],
      ["rongguang.customer-recovery-path", "/pages/data-rights/index"],
      ["rongguang.booking-draft.v1", { petId: "pet-lizi" }],
      ["rongguang.booking-conflict.v1", { bookingId: "booking-old" }],
    ]);
    const globalData = {
      apiBaseUrl: "http://api.local",
      customerSession: { accessToken: "old-token" },
      customerSessionStatus: "active",
    } as RongguangApp["globalData"];
    vi.stubGlobal("getApp", () => ({ globalData }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
    });

    clearCustomerSessionAfterDeletion();

    expect([...storage.keys()]).toEqual([]);
    expect(globalData).toMatchObject({ customerSession: null, customerSessionStatus: "missing" });
  });
});
