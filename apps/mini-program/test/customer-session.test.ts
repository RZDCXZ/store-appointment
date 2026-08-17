import { afterEach, describe, expect, it, vi } from "vitest";

import {
  rememberRecoveryPath,
  restoreCustomerSession,
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
});
