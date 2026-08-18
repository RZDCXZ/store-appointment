import type {
  BookingDetailResponse,
  CustomerBooking,
  CustomerBookingChange,
  RescheduleBookingOptionsResponse,
  RescheduleBookingResponse,
} from "@rongguang/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerApiError } from "../miniprogram/services/customer-api";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  fetchBookingDetail: vi.fn(),
  fetchRescheduleOptions: vi.fn(),
  loadCustomerContext: vi.fn(),
  openCustomerSelector: vi.fn(),
  rescheduleBooking: vi.fn(),
}));

vi.mock("../miniprogram/services/booking-api", () => ({
  cancelBooking: mocks.cancelBooking,
  fetchBookingDetail: mocks.fetchBookingDetail,
  fetchRescheduleOptions: mocks.fetchRescheduleOptions,
  rescheduleBooking: mocks.rescheduleBooking,
}));

vi.mock("../miniprogram/services/customer-session", () => ({
  loadCustomerContext: mocks.loadCustomerContext,
  openCustomerSelector: mocks.openCustomerSelector,
}));

interface PageInstance {
  data: Record<string, unknown>;
  setData(next: Record<string, unknown>): void;
}

interface RescheduleDefinition {
  data: Record<string, unknown>;
  onLoad(this: PageInstance, options: Record<string, string | undefined>): void;
  loadOptions(this: PageInstance): Promise<void>;
  selectSlot(this: PageInstance, event: WechatMiniprogram.BaseEvent): void;
  chooseSuggestion(this: PageInstance, event: WechatMiniprogram.BaseEvent): void;
  submit(this: PageInstance): Promise<void>;
  keepOriginal(this: PageInstance): void;
  viewBooking(this: PageInstance): void;
}

interface CancelDefinition {
  data: Record<string, unknown>;
  onLoad(this: PageInstance, options: Record<string, string | undefined>): void;
  loadBooking(this: PageInstance): Promise<void>;
  chooseReason(this: PageInstance, event: WechatMiniprogram.BaseEvent): void;
  submit(this: PageInstance): Promise<void>;
  keepBooking(this: PageInstance): void;
  viewBooking(this: PageInstance): void;
}

function pageInstance(definition: { data: Record<string, unknown> }): PageInstance {
  return {
    data: structuredClone(definition.data),
    setData(next) {
      Object.assign(this.data, next);
    },
  };
}

const booking: CustomerBooking = {
  id: "booking-future",
  status: "confirmed",
  pet: { id: "pet-bohe", name: "薄荷", species: "cat", weightKg: 4.8, petSize: "small" },
  primaryService: {
    id: "cat-care",
    name: "猫咪洗护",
    priceCents: 16800,
    durationMinutes: 90,
  },
  addons: [],
  staff: { id: "chenjia", displayName: "陈嘉" },
  startsAt: "2026-08-14T03:00:00.000Z",
  endsAt: "2026-08-14T04:30:00.000Z",
  turnoverEndsAt: "2026-08-14T04:45:00.000Z",
  totalPriceCents: 16800,
  serviceDurationMinutes: 90,
  turnoverMinutes: 15,
  originalSchedule: {
    startsAt: "2026-08-14T03:00:00.000Z",
    endsAt: "2026-08-14T04:30:00.000Z",
    occupancyStartsAt: "2026-08-14T03:00:00.000Z",
    occupancyEndsAt: "2026-08-14T04:45:00.000Z",
  },
  completedAt: null,
  createdAt: "2026-08-13T02:42:00.000Z",
};

const customerActions = {
  canCancel: true,
  canReschedule: true,
  cutoffAt: "2026-08-13T15:00:00.000Z",
  message: "可在截止时间前自行改期或取消。",
};

const verificationWindow = {
  opensAt: "2026-08-14T02:30:00.000Z",
  closesAt: "2026-08-14T03:15:00.000Z",
  description: "可在开始前 30 分钟至开始后 15 分钟内出示" as const,
};

const detail: BookingDetailResponse = {
  booking,
  verificationCode: "729416",
  verificationWindow,
  customerActions,
  changeHistory: [],
};

const options: RescheduleBookingOptionsResponse = {
  booking,
  customerActions,
  availability: {
    timeZone: "Asia/Shanghai",
    demoNow: "2026-08-13T02:50:00.000Z",
    window: {
      startsOn: "2026-08-13",
      endsOn: "2026-08-26",
      earliestStartsAt: "2026-08-13T05:00:00.000Z",
    },
    selection: {
      pet: booking.pet,
      primaryService: booking.primaryService,
      addons: [],
      totalPriceCents: 16800,
      serviceDurationMinutes: 90,
      requiredSkillIds: ["cat-care"],
    },
    staffOptions: [],
    days: [
      {
        date: "2026-08-15",
        weekday: 6,
        reason: null,
        reasonLabel: "可预约",
        slots: [
          {
            startsAt: "2026-08-15T02:00:00.000Z",
            endsAt: "2026-08-15T03:30:00.000Z",
            turnoverEndsAt: "2026-08-15T03:45:00.000Z",
            staff: { id: "zhouning", displayName: "周宁", employeeNumber: 3 },
          },
        ],
      },
    ],
  },
};

const change: CustomerBookingChange = {
  id: "change-rescheduled",
  kind: "customer_rescheduled",
  actor: { type: "customer", id: "customer-cheng-mo" },
  reason: "顾客自行改期",
  previous: {
    staff: booking.staff,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    turnoverEndsAt: booking.turnoverEndsAt,
  },
  next: {
    staff: { id: "zhouning", displayName: "周宁" },
    startsAt: "2026-08-15T02:00:00.000Z",
    endsAt: "2026-08-15T03:30:00.000Z",
    turnoverEndsAt: "2026-08-15T03:45:00.000Z",
  },
  occurredAt: "2026-08-13T02:50:00.000Z",
};

describe("MP-15 顾客改期与取消页面", () => {
  const definitions: Array<RescheduleDefinition | CancelDefinition> = [];
  const redirectTo = vi.fn();
  const storage = new Map<string, unknown>();

  beforeAll(async () => {
    vi.stubGlobal("Page", (definition: RescheduleDefinition | CancelDefinition) =>
      definitions.push(definition),
    );
    await import("../miniprogram/pages/booking-reschedule/index");
    await import("../miniprogram/pages/booking-cancel/index");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    mocks.loadCustomerContext.mockResolvedValue({
      kind: "active",
      customer: { displayName: "程墨" },
    });
    mocks.fetchRescheduleOptions.mockResolvedValue(options);
    mocks.fetchBookingDetail.mockResolvedValue(detail);
    mocks.rescheduleBooking.mockResolvedValue({
      ...detail,
      booking: {
        ...booking,
        staff: change.next?.staff ?? booking.staff,
        startsAt: change.next?.startsAt ?? booking.startsAt,
        endsAt: change.next?.endsAt ?? booking.endsAt,
        turnoverEndsAt: change.next?.turnoverEndsAt ?? booking.turnoverEndsAt,
      },
      verificationCode: "184205",
      changeHistory: [change],
    } satisfies RescheduleBookingResponse);
    mocks.cancelBooking.mockResolvedValue({
      ...detail,
      booking: { ...booking, status: "cancelled" },
      verificationCode: null,
      verificationWindow: null,
      customerActions: {
        ...customerActions,
        canCancel: false,
        canReschedule: false,
      },
      changeHistory: [
        { ...change, id: "change-cancelled", kind: "customer_cancelled", next: null },
      ],
    });
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, value),
      removeStorageSync: (key: string) => storage.delete(key),
      redirectTo,
      stopPullDownRefresh: vi.fn(),
    });
  });

  it("改期页从预约 ID 恢复原安排，成功后展示前后对比与新核销码", async () => {
    const definition = definitions[0] as RescheduleDefinition;
    const instance = pageInstance(definition);
    definition.onLoad.call(instance, { id: "booking-future" });
    await definition.loadOptions.call(instance);

    expect(mocks.fetchRescheduleOptions).toHaveBeenCalledWith("booking-future");
    expect(instance.data).toMatchObject({
      pageState: "ready",
      bookingId: "booking-future",
      originalDateLabel: "8月14日 周五",
      originalTimeLabel: "11:00–12:30",
      originalStaffLabel: "陈嘉",
      petServiceLabel: "薄荷 · 猫咪洗护",
      slots: [
        expect.objectContaining({
          startsAt: "2026-08-15T02:00:00.000Z",
          dateLabel: "8月15日 周六",
          timeLabel: "10:00–11:30",
          staffLabel: "周宁",
        }),
      ],
    });
    definition.selectSlot.call(instance, {
      currentTarget: {
        dataset: { staffId: "zhouning", startsAt: "2026-08-15T02:00:00.000Z" },
      },
    } as unknown as WechatMiniprogram.BaseEvent);
    await definition.submit.call(instance);

    expect(mocks.rescheduleBooking).toHaveBeenCalledWith(
      "booking-future",
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^customer-reschedule-/),
        staffId: "zhouning",
        startsAt: "2026-08-15T02:00:00.000Z",
      }),
    );
    expect(instance.data).toMatchObject({
      pageState: "success",
      previousScheduleLabel: "8月14日 周五 · 11:00–12:30 · 陈嘉",
      nextScheduleLabel: "8月15日 周六 · 10:00–11:30 · 周宁",
      verificationCode: "184205",
    });
    definition.viewBooking.call(instance);
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/booking-detail/index?id=booking-future",
    });
  });

  it("改期冲突保留顾客选择并允许一键采用相近建议或保留原安排", async () => {
    const definition = definitions[0] as RescheduleDefinition;
    const instance = pageInstance(definition);
    definition.onLoad.call(instance, { id: "booking-future" });
    await definition.loadOptions.call(instance);
    definition.selectSlot.call(instance, {
      currentTarget: {
        dataset: { staffId: "zhouning", startsAt: "2026-08-15T02:00:00.000Z" },
      },
    } as unknown as WechatMiniprogram.BaseEvent);
    mocks.rescheduleBooking.mockRejectedValueOnce(
      new CustomerApiError(
        409,
        "BOOKING_TIME_CONFLICT",
        "刚刚有人选走了这个安排，原安排保持不变。",
        {},
        {
          ...booking,
          startsAt: "2026-08-14T04:00:00.000Z",
          endsAt: "2026-08-14T05:30:00.000Z",
          staff: { id: "zhouning", displayName: "周宁" },
        },
        [
          {
            date: "2026-08-15",
            startsAt: "2026-08-15T04:00:00.000Z",
            endsAt: "2026-08-15T05:30:00.000Z",
            staff: { id: "chenjia", displayName: "陈嘉" },
          },
        ],
      ),
    );

    await definition.submit.call(instance);

    expect(instance.data).toMatchObject({
      pageState: "ready",
      selectedStaffId: "zhouning",
      selectedStartsAt: "2026-08-15T02:00:00.000Z",
      conflictMessage: "刚刚有人选走了这个安排，原安排保持不变。",
      suggestions: [
        expect.objectContaining({
          staffId: "chenjia",
          startsAt: "2026-08-15T04:00:00.000Z",
          timeLabel: "12:00–13:30",
        }),
      ],
      originalTimeLabel: "12:00–13:30",
      originalStaffLabel: "周宁",
    });
    const restored = pageInstance(definition);
    definition.onLoad.call(restored, { id: "booking-future" });
    await definition.loadOptions.call(restored);
    expect(restored.data).toMatchObject({
      selectedStaffId: "zhouning",
      selectedStartsAt: "2026-08-15T02:00:00.000Z",
      conflictMessage: "刚刚有人选走了这个安排，原安排保持不变。",
      suggestions: [
        expect.objectContaining({
          staffId: "chenjia",
          startsAt: "2026-08-15T04:00:00.000Z",
        }),
      ],
    });
    definition.chooseSuggestion.call(restored, {
      currentTarget: {
        dataset: { staffId: "chenjia", startsAt: "2026-08-15T04:00:00.000Z" },
      },
    } as unknown as WechatMiniprogram.BaseEvent);
    expect(restored.data).toMatchObject({
      selectedStaffId: "chenjia",
      selectedStartsAt: "2026-08-15T04:00:00.000Z",
      conflictMessage: "",
    });
    definition.keepOriginal.call(restored);
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/booking-detail/index?id=booking-future",
    });
  });

  it("确定性业务失败后更换时段会使用新幂等键，网络未知失败仍保留原键", async () => {
    const definition = definitions[0] as RescheduleDefinition;
    const instance = pageInstance(definition);
    definition.onLoad.call(instance, { id: "booking-future" });
    await definition.loadOptions.call(instance);
    definition.selectSlot.call(instance, {
      currentTarget: {
        dataset: { staffId: "zhouning", startsAt: "2026-08-15T02:00:00.000Z" },
      },
    } as unknown as WechatMiniprogram.BaseEvent);

    mocks.rescheduleBooking.mockRejectedValueOnce(
      new CustomerApiError(409, "SLOT_NO_LONGER_AVAILABLE", "这个时段刚刚不可用了。"),
    );
    await definition.submit.call(instance);
    const firstKey = mocks.rescheduleBooking.mock.calls[0]?.[1].idempotencyKey;

    definition.selectSlot.call(instance, {
      currentTarget: {
        dataset: { staffId: "chenjia", startsAt: "2026-08-15T04:00:00.000Z" },
      },
    } as unknown as WechatMiniprogram.BaseEvent);
    mocks.rescheduleBooking.mockRejectedValueOnce(
      new CustomerApiError(0, "NETWORK_ERROR", "暂时无法连接茸光本地 API。"),
    );
    mocks.rescheduleBooking.mockRejectedValueOnce(
      new CustomerApiError(0, "NETWORK_ERROR", "暂时无法连接茸光本地 API。"),
    );
    await definition.submit.call(instance);
    const secondKey = mocks.rescheduleBooking.mock.calls[1]?.[1].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);

    await definition.submit.call(instance);
    expect(mocks.rescheduleBooking.mock.calls[2]?.[1].idempotencyKey).toBe(secondKey);

    definition.selectSlot.call(instance, {
      currentTarget: {
        dataset: { staffId: "zhouning", startsAt: "2026-08-15T02:00:00.000Z" },
      },
    } as unknown as WechatMiniprogram.BaseEvent);
    await definition.submit.call(instance);
    expect(mocks.rescheduleBooking.mock.calls[3]?.[1].idempotencyKey).not.toBe(secondKey);
  });

  it("取消页从预约 ID 恢复后果，提交后显示终态；截止后改为联系门店", async () => {
    const definition = definitions[1] as CancelDefinition;
    const instance = pageInstance(definition);
    definition.onLoad.call(instance, { id: "booking-future" });
    await definition.loadBooking.call(instance);

    expect(mocks.fetchBookingDetail).toHaveBeenCalledWith("booking-future");
    expect(instance.data).toMatchObject({
      pageState: "ready",
      petServiceLabel: "薄荷 · 猫咪洗护",
      scheduleLabel: "8月14日 周五 · 11:00–12:30 · 陈嘉",
      consequenceLabel: "取消后将释放该时段，六位核销码立即失效。",
      selectedReason: "行程变化",
    });
    definition.chooseReason.call(instance, {
      currentTarget: { dataset: { reason: "宠物临时不适" } },
    } as unknown as WechatMiniprogram.BaseEvent);
    await definition.submit.call(instance);
    expect(mocks.cancelBooking).toHaveBeenCalledWith(
      "booking-future",
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^customer-cancel-/),
        reason: "宠物临时不适",
      }),
    );
    expect(instance.data).toMatchObject({ pageState: "success", statusLabel: "已取消" });

    mocks.fetchBookingDetail.mockResolvedValueOnce({
      ...detail,
      booking: { ...booking, status: "cancelled" },
      verificationCode: null,
      verificationWindow: null,
      customerActions: {
        ...customerActions,
        canCancel: false,
        canReschedule: false,
        message: "当前预约状态不支持顾客自行改期或取消，如需帮助请联系门店。",
      },
    });
    const reopened = pageInstance(definition);
    definition.onLoad.call(reopened, { id: "booking-future" });
    await definition.loadBooking.call(reopened);
    expect(reopened.data).toMatchObject({ pageState: "success", statusLabel: "已取消" });

    mocks.fetchBookingDetail.mockResolvedValueOnce({
      ...detail,
      customerActions: {
        canCancel: false,
        canReschedule: false,
        cutoffAt: customerActions.cutoffAt,
        message: "开始前已不足 12 小时，请联系门店处理。",
      },
    });
    const afterCutoff = pageInstance(definition);
    definition.onLoad.call(afterCutoff, { id: "booking-future" });
    await definition.loadBooking.call(afterCutoff);
    expect(afterCutoff.data).toMatchObject({
      pageState: "contact",
      contactMessage: "开始前已不足 12 小时，请联系门店处理。",
    });
    definition.keepBooking.call(afterCutoff);
    expect(redirectTo).toHaveBeenCalledWith({
      url: "/pages/booking-detail/index?id=booking-future",
    });
  });

  it("跨顾客直达改期或取消时显示无权访问状态", async () => {
    const rescheduleDefinition = definitions[0] as RescheduleDefinition;
    const cancelDefinition = definitions[1] as CancelDefinition;
    mocks.fetchRescheduleOptions.mockRejectedValueOnce(
      new CustomerApiError(404, "BOOKING_NOT_FOUND", "找不到这笔预约。"),
    );
    mocks.fetchBookingDetail.mockRejectedValueOnce(
      new CustomerApiError(404, "BOOKING_NOT_FOUND", "找不到这笔预约。"),
    );

    const reschedule = pageInstance(rescheduleDefinition);
    rescheduleDefinition.onLoad.call(reschedule, { id: "booking-other" });
    await rescheduleDefinition.loadOptions.call(reschedule);
    const cancel = pageInstance(cancelDefinition);
    cancelDefinition.onLoad.call(cancel, { id: "booking-other" });
    await cancelDefinition.loadBooking.call(cancel);

    expect(reschedule.data).toMatchObject({
      pageState: "forbidden",
      errorMessage: "找不到这笔预约。",
    });
    expect(cancel.data).toMatchObject({
      pageState: "forbidden",
      errorMessage: "找不到这笔预约。",
    });
  });
});
