import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearCustomerSessionAfterDeletion: vi.fn(),
  deleteCustomerData: vi.fn(),
  fetchCustomerDataRights: vi.fn(),
  loadCustomerContext: vi.fn(),
  openCustomerSelector: vi.fn(),
}));

vi.mock("../miniprogram/services/data-rights-api", () => ({
  fetchCustomerDataRights: mocks.fetchCustomerDataRights,
  fetchCustomerDataExport: vi.fn(),
  deleteCustomerData: mocks.deleteCustomerData,
}));
vi.mock("../miniprogram/services/customer-session", () => ({
  loadCustomerContext: mocks.loadCustomerContext,
  openCustomerSelector: mocks.openCustomerSelector,
  clearCustomerSessionAfterDeletion: mocks.clearCustomerSessionAfterDeletion,
}));

interface PageInstance {
  data: Record<string, unknown>;
  setData(next: Record<string, unknown>): void;
  loadRights(): Promise<void>;
  applyRights(value: unknown): void;
}

interface DataRightsPageDefinition {
  data: Record<string, unknown>;
  onShow(this: PageInstance): Promise<void>;
  loadRights(this: PageInstance): Promise<void>;
  applyRights(this: PageInstance, value: unknown): void;
  openDeletionConfirmation(this: PageInstance): void;
  advanceDeletionConfirmation(this: PageInstance): void;
  closeDeletionConfirmation(this: PageInstance): void;
  openFutureBooking(this: PageInstance, event: WechatMiniprogram.BaseEvent): void;
  updateDeletionAcknowledgement(
    this: PageInstance,
    event: WechatMiniprogram.CheckboxGroupChange,
  ): void;
  submitDeletion(this: PageInstance): Promise<void>;
}

function pageInstance(definition: DataRightsPageDefinition): PageInstance {
  return {
    data: structuredClone(definition.data),
    setData(next) {
      Object.assign(this.data, next);
    },
    loadRights: definition.loadRights,
    applyRights: definition.applyRights,
  };
}

describe("MP-18 数据权利页", () => {
  let definition: DataRightsPageDefinition;

  beforeAll(async () => {
    vi.stubGlobal("Page", (value: DataRightsPageDefinition) => {
      definition = value;
    });
    await import("../miniprogram/pages/data-rights/index");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("wx", { navigateTo: vi.fn(), showModal: vi.fn(), switchTab: vi.fn() });
    mocks.loadCustomerContext.mockResolvedValue({ kind: "active", customer: {} });
    mocks.fetchCustomerDataRights.mockResolvedValue({
      customer: { displayName: "程墨", phoneMasked: "139****0341" },
      dataSummary: { petCount: 1, privacyConsentCount: 1, bookingCount: 2, messageCount: 3 },
      futureBookings: [
        {
          id: "booking-future",
          petName: "薄荷",
          primaryServiceName: "猫咪洗护",
          startsAt: "2026-08-14T03:00:00.000Z",
          endsAt: "2026-08-14T04:30:00.000Z",
        },
      ],
      canDelete: false,
      retentionPolicy: { anonymized: [], retained: [], disclaimer: "演示规则" },
    });
    mocks.deleteCustomerData.mockResolvedValue({
      anonymizedAt: "2026-08-13T02:50:00.000Z",
      retained: { bookingCount: 2, completedBookingCount: 0, totalPriceCents: 45600 },
      sessionsRevoked: true,
    });
  });

  it("直接访问或刷新时按当前会话重新读取服务端事实", async () => {
    const instance = pageInstance(definition);

    await definition.onShow.call(instance);

    expect(mocks.loadCustomerContext).toHaveBeenCalledWith("/pages/data-rights/index");
    expect(mocks.fetchCustomerDataRights).toHaveBeenCalledOnce();
    expect(instance.data).toMatchObject({ pageState: "ready", canDelete: false });
  });

  it("阻断列表可返回预约详情，可删除时使用两步确认", () => {
    const instance = pageInstance(definition);

    definition.openFutureBooking.call(instance, {
      currentTarget: { dataset: { id: "booking-future" } },
    } as unknown as WechatMiniprogram.BaseEvent);
    expect(wx.navigateTo).toHaveBeenCalledWith({
      url: "/pages/booking-detail/index?id=booking-future",
    });

    instance.data.canDelete = true;
    definition.openDeletionConfirmation.call(instance);
    expect(instance.data.confirmationStep).toBe(1);
    definition.advanceDeletionConfirmation.call(instance);
    expect(instance.data.confirmationStep).toBe(2);
    definition.closeDeletionConfirmation.call(instance);
    expect(instance.data).toMatchObject({ confirmationStep: 0, deletionAcknowledged: false });
  });

  it("最终确认成功后清除本地身份与旧预约草稿", async () => {
    const instance = pageInstance(definition);
    instance.data.confirmationStep = 2;
    definition.updateDeletionAcknowledgement.call(instance, {
      detail: { value: ["confirmed"] },
    } as WechatMiniprogram.CheckboxGroupChange);

    await definition.submitDeletion.call(instance);

    expect(mocks.deleteCustomerData).toHaveBeenCalledOnce();
    expect(mocks.clearCustomerSessionAfterDeletion).toHaveBeenCalledOnce();
    expect(instance.data).toMatchObject({
      pageState: "deleted",
      deleting: false,
      confirmationStep: 0,
    });
  });
});
