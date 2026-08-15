import { afterEach, describe, expect, it, vi } from "vitest";

import { restoreCustomerSession } from "../miniprogram/services/customer-session";
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
});
