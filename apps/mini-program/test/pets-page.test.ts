import { beforeAll, describe, expect, it, vi } from "vitest";

interface PetsPageInstance {
  data: { bookingMode: boolean };
  setData(patch: Record<string, unknown>): void;
}

interface PetsPageDefinition {
  data: PetsPageInstance["data"];
  onLoad(this: PetsPageInstance, options: Record<string, string | undefined>): void;
  ensureBookingConsent(this: PetsPageInstance): Promise<boolean>;
}

describe("预约选宠入口", () => {
  let definition: PetsPageDefinition;
  const redirectTo = vi.fn();

  beforeAll(async () => {
    vi.stubGlobal("Page", (value: PetsPageDefinition) => {
      definition = value;
    });
    vi.stubGlobal("getApp", () => ({
      globalData: {
        apiBaseUrl: "http://api.local",
        customerSession: { accessToken: "signed-token" },
      },
    }));
    vi.stubGlobal("wx", {
      request(options: {
        success(response: { statusCode: number; data: Record<string, unknown> }): void;
      }) {
        options.success({
          statusCode: 200,
          data: { canContinue: false, requiredPrivacyNoticeVersion: "2026.09" },
        });
      },
      redirectTo,
    });
    await import("../miniprogram/pages/pets/index");
  });

  it("即使直接打开 booking 模式也重新执行当前隐私版本门禁", async () => {
    const data = { ...definition.data, bookingMode: true };
    const instance: PetsPageInstance = {
      data,
      setData(patch) {
        Object.assign(data, patch);
      },
    };

    await expect(definition.ensureBookingConsent.call(instance)).resolves.toBe(false);
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/privacy-consent/index?returnTo=%2Fpages%2Fpets%2Findex%3Fmode%3Dbooking",
    });
  });

  it("页面生命周期可从直接访问参数恢复预约选宠模式", () => {
    const data = { ...definition.data, bookingMode: false };
    const instance: PetsPageInstance = {
      data,
      setData(patch) {
        Object.assign(data, patch);
      },
    };

    definition.onLoad.call(instance, { mode: "booking" });

    expect(data.bookingMode).toBe(true);
  });
});
