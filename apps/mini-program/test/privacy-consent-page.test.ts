import { beforeAll, describe, expect, it, vi } from "vitest";

interface PrivacyPageData {
  returnTo: string;
}

interface PrivacyPageInstance {
  data: PrivacyPageData;
  setData(patch: Record<string, unknown>): void;
  loadStatus(): void;
}

interface PrivacyPageDefinition {
  data: PrivacyPageData;
  onLoad(this: PrivacyPageInstance, options: Record<string, string | undefined>): void;
}

describe("隐私同意页路由生命周期", () => {
  let definition: PrivacyPageDefinition;

  beforeAll(async () => {
    vi.stubGlobal("Page", (value: PrivacyPageDefinition) => {
      definition = value;
    });
    await import("../miniprogram/pages/privacy-consent/index");
  });

  it("直接访问时只恢复允许的预约返回路径并触发状态加载", () => {
    const data = structuredClone(definition.data);
    const loadStatus = vi.fn();
    const instance: PrivacyPageInstance = {
      data,
      loadStatus,
      setData(patch) {
        Object.assign(data, patch);
      },
    };

    definition.onLoad.call(instance, { returnTo: "/pages/pets/index?mode=booking" });

    expect(data.returnTo).toBe("/pages/pets/index?mode=booking");
    expect(loadStatus).toHaveBeenCalledOnce();
  });

  it("允许从日期与时段独立页返回，隐私版本更新后不丢失预约步骤", () => {
    const data = structuredClone(definition.data);
    const loadStatus = vi.fn();
    const instance: PrivacyPageInstance = {
      data,
      loadStatus,
      setData(patch) {
        Object.assign(data, patch);
      },
    };

    definition.onLoad.call(instance, { returnTo: "/pages/booking-time/index" });

    expect(data.returnTo).toBe("/pages/booking-time/index");
    expect(loadStatus).toHaveBeenCalledOnce();
  });
});
