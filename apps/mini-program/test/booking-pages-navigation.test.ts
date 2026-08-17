import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface FlowPageInstance {
  data: Record<string, unknown>;
}

interface FlowPageDefinition {
  data: Record<string, unknown>;
  continueFlow?(this: FlowPageInstance): void;
  recover?(this: FlowPageInstance): void;
}

describe("MP-06 至 MP-09 页面导航", () => {
  const definitions: FlowPageDefinition[] = [];
  const navigateTo = vi.fn();
  const redirectTo = vi.fn();

  beforeAll(async () => {
    vi.stubGlobal("Page", (definition: FlowPageDefinition) => definitions.push(definition));
    await import("../miniprogram/pages/booking-pet/index");
    await import("../miniprogram/pages/booking-service/index");
    await import("../miniprogram/pages/booking-staff/index");
    await import("../miniprogram/pages/booking-time/index");
  });

  beforeEach(() => {
    navigateTo.mockReset();
    redirectTo.mockReset();
    vi.stubGlobal("wx", { navigateTo, redirectTo });
  });

  it("每一步前进都压入独立页面，因此可使用原生返回恢复上一页", () => {
    const [petPage, servicePage, staffPage] = definitions;

    petPage?.continueFlow?.call({ data: { ...petPage.data, selectedPetId: "pet-tuanzi" } });
    servicePage?.continueFlow?.call({ data: { ...servicePage.data, quote: {} } });
    staffPage?.continueFlow?.call({ data: { ...staffPage.data, preferenceKey: "fastest" } });

    expect(navigateTo.mock.calls).toEqual([
      [{ url: "/pages/booking-service/index" }],
      [{ url: "/pages/booking-staff/index" }],
      [{ url: "/pages/booking-time/index" }],
    ]);
  });

  it("直接访问缺少前置选择时可逐级回到准确恢复页", () => {
    const [, servicePage, staffPage, timePage] = definitions;

    servicePage?.recover?.call({ data: { ...servicePage.data, recoveryPath: "" } });
    staffPage?.recover?.call({ data: { ...staffPage.data, recoveryPath: "" } });
    timePage?.recover?.call({ data: { ...timePage.data, recoveryPath: "" } });

    expect(redirectTo.mock.calls).toEqual([
      [{ url: "/pages/booking-pet/index" }],
      [{ url: "/pages/booking-service/index" }],
      [{ url: "/pages/booking-staff/index" }],
    ]);
  });
});
