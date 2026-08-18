import type {
  BookingDetailResponse,
  CustomerBooking,
  CustomerBookingHistoryResponse,
  CustomerMessageDetailResponse,
  CustomerMessagesResponse,
} from "@rongguang/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerApiError } from "../miniprogram/services/customer-api";

const mocks = vi.hoisted(() => ({
  fetchBookingDetail: vi.fn(),
  fetchBookingHistory: vi.fn(),
  fetchCustomerMessage: vi.fn(),
  fetchCustomerMessages: vi.fn(),
  loadCustomerContext: vi.fn(),
  openCustomerSelector: vi.fn(),
}));

vi.mock("../miniprogram/services/booking-api", () => ({
  fetchBookingDetail: mocks.fetchBookingDetail,
  fetchBookingHistory: mocks.fetchBookingHistory,
  fetchCustomerMessage: mocks.fetchCustomerMessage,
  fetchCustomerMessages: mocks.fetchCustomerMessages,
}));

vi.mock("../miniprogram/services/customer-session", () => ({
  loadCustomerContext: mocks.loadCustomerContext,
  openCustomerSelector: mocks.openCustomerSelector,
}));

interface PageInstance {
  data: Record<string, unknown>;
  setData(next: Record<string, unknown>): void;
}

interface AppointmentsDefinition {
  data: Record<string, unknown>;
  loadAppointments(this: PageInstance): Promise<void>;
  openBooking(this: PageInstance, event: WechatMiniprogram.BaseEvent): void;
}

interface DetailDefinition {
  data: Record<string, unknown>;
  onLoad(this: PageInstance, options: Record<string, string | undefined>): void;
  loadBooking(this: PageInstance): Promise<void>;
  openReschedule(this: PageInstance): void;
  openCancel(this: PageInstance): void;
}

interface MessagesDefinition {
  data: Record<string, unknown>;
  loadMessages(this: PageInstance): Promise<void>;
  openMessage(this: PageInstance, event: WechatMiniprogram.BaseEvent): Promise<void>;
}

function pageInstance(definition: { data: Record<string, unknown> }): PageInstance {
  return {
    data: structuredClone(definition.data),
    setData(next) {
      Object.assign(this.data, next);
    },
  };
}

const futureBooking: CustomerBooking = {
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

const completedBooking: CustomerBooking = {
  ...futureBooking,
  id: "booking-completed",
  status: "completed",
  startsAt: "2026-08-06T02:00:00.000Z",
  endsAt: "2026-08-06T03:30:00.000Z",
  completedAt: "2026-08-06T03:22:00.000Z",
};

const verificationWindow = {
  opensAt: "2026-08-14T02:30:00.000Z",
  closesAt: "2026-08-14T03:15:00.000Z",
  description: "可在开始前 30 分钟至开始后 15 分钟内出示" as const,
};

const availableActions = {
  canCancel: true,
  canReschedule: true,
  cutoffAt: "2026-08-13T15:00:00.000Z",
  message: "可在截止时间前自行改期或取消。",
};

describe("MP-13、MP-14 与 MP-16 页面", () => {
  const definitions: Array<AppointmentsDefinition | DetailDefinition | MessagesDefinition> = [];
  const navigateTo = vi.fn();

  beforeAll(async () => {
    vi.stubGlobal(
      "Page",
      (definition: AppointmentsDefinition | DetailDefinition | MessagesDefinition) =>
        definitions.push(definition),
    );
    await import("../miniprogram/pages/appointments/index");
    await import("../miniprogram/pages/booking-detail/index");
    await import("../miniprogram/pages/messages/index");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadCustomerContext.mockResolvedValue({
      kind: "active",
      customer: { displayName: "程墨" },
    });
    mocks.fetchBookingHistory.mockResolvedValue({
      demoNow: "2026-08-13T02:50:00.000Z",
      upcoming: [futureBooking],
      history: [completedBooking],
    } satisfies CustomerBookingHistoryResponse);
    mocks.fetchBookingDetail.mockResolvedValue({
      booking: futureBooking,
      verificationCode: "729416",
      verificationWindow,
      customerActions: availableActions,
      changeHistory: [],
    } satisfies BookingDetailResponse);
    mocks.fetchCustomerMessages.mockResolvedValue({
      messages: [
        {
          id: "message-confirmed",
          kind: "booking_confirmed",
          title: "预约已确认",
          body: "薄荷的猫咪洗护已确认，员工为陈嘉。",
          occurredAt: "2026-08-13T02:42:00.000Z",
          bookingId: "booking-future",
          actionLabel: "查看预约",
        },
      ],
    } satisfies CustomerMessagesResponse);
    mocks.fetchCustomerMessage.mockResolvedValue({
      message: {
        id: "message-confirmed",
        kind: "booking_confirmed",
        title: "预约已确认",
        body: "薄荷的猫咪洗护已确认，员工为陈嘉。",
        occurredAt: "2026-08-13T02:42:00.000Z",
        bookingId: "booking-future",
        actionLabel: "查看预约",
      },
    } satisfies CustomerMessageDetailResponse);
    navigateTo.mockReset();
    vi.stubGlobal("wx", {
      navigateTo,
      stopPullDownRefresh: vi.fn(),
      switchTab: vi.fn(),
    });
  });

  it("预约记录按未来与历史分段，并从真实卡片进入独立详情路由", async () => {
    const appointments = definitions[0] as AppointmentsDefinition;
    const instance = pageInstance(appointments);

    await appointments.loadAppointments.call(instance);
    appointments.openBooking.call(instance, {
      currentTarget: { dataset: { id: "booking-future" } },
    } as unknown as WechatMiniprogram.BaseEvent);

    expect(instance.data).toMatchObject({
      pageState: "ready",
      demoTimeLabel: "演示时间 · 8月13日 周四 10:50",
      upcoming: [
        expect.objectContaining({
          id: "booking-future",
          statusLabel: "已确认",
          petServiceLabel: "薄荷 · 猫咪洗护",
          staffLabel: "陈嘉",
        }),
      ],
      history: [expect.objectContaining({ id: "booking-completed", statusLabel: "已完成" })],
    });
    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/booking-detail/index?id=booking-future",
    });
  });

  it("详情仅凭预约身份刷新恢复核销码，并在状态变化后重新拉取", async () => {
    const detail = definitions[1] as DetailDefinition;
    const instance = pageInstance(detail);
    detail.onLoad.call(instance, { id: "booking-future" });

    await detail.loadBooking.call(instance);
    expect(mocks.fetchBookingDetail).toHaveBeenCalledWith("booking-future");
    expect(instance.data).toMatchObject({
      pageState: "ready",
      statusLabel: "已确认",
      statusTitle: "到店时请出示核销码",
      verificationCode: "729416",
      verificationWindowLabel: "10:30–11:15 有效",
      verificationWindowDescription: "可在开始前 30 分钟至开始后 15 分钟内出示",
      canChange: true,
      changeMessage: "可在 8月13日 周四 23:00 前自行改期或取消。",
      petLabel: "薄荷 · 猫 · 4.8kg · 小型",
      serviceLabel: "猫咪洗护",
      priceLabel: "¥168",
      durationLabel: "90 分钟",
      staffLabel: "陈嘉",
      timeLabel: "11:00–12:30",
    });

    mocks.fetchBookingDetail.mockResolvedValueOnce({
      booking: completedBooking,
      verificationCode: null,
      verificationWindow: null,
      customerActions: {
        canCancel: false,
        canReschedule: false,
        cutoffAt: "2026-08-05T14:00:00.000Z",
        message: "当前预约状态不支持顾客自行改期或取消，如需帮助请联系门店。",
      },
      changeHistory: [],
    } satisfies BookingDetailResponse);
    await detail.loadBooking.call(instance);
    expect(instance.data).toMatchObject({
      statusLabel: "已完成",
      verificationCode: "",
      completedAtLabel: "8月6日 周四 11:22",
    });
  });

  it("详情把允许的顾客操作导向可直接刷新的独立改期与取消路由", async () => {
    const detail = definitions[1] as DetailDefinition;
    const instance = pageInstance(detail);
    detail.onLoad.call(instance, { id: "booking-future" });
    await detail.loadBooking.call(instance);

    detail.openReschedule.call(instance);
    detail.openCancel.call(instance);

    expect(navigateTo.mock.calls).toEqual([
      [{ url: "/pages/booking-reschedule/index?id=booking-future" }],
      [{ url: "/pages/booking-cancel/index?id=booking-future" }],
    ]);
  });

  it("替换为不属于当前顾客的预约标识时显示无权限状态", async () => {
    const detail = definitions[1] as DetailDefinition;
    const instance = pageInstance(detail);
    detail.onLoad.call(instance, { id: "booking-other" });
    mocks.fetchBookingDetail.mockRejectedValueOnce(
      new CustomerApiError(404, "BOOKING_NOT_FOUND", "找不到这笔预约。"),
    );

    await detail.loadBooking.call(instance);

    expect(instance.data).toMatchObject({
      pageState: "forbidden",
      errorMessage: "找不到这笔预约。",
    });
  });

  it("无预约、无消息和可重试错误都有独立状态", async () => {
    const appointments = definitions[0] as AppointmentsDefinition;
    const messages = definitions[2] as MessagesDefinition;
    const appointmentInstance = pageInstance(appointments);
    const messageInstance = pageInstance(messages);
    mocks.fetchBookingHistory.mockResolvedValueOnce({
      demoNow: "2026-08-13T02:50:00.000Z",
      upcoming: [],
      history: [],
    } satisfies CustomerBookingHistoryResponse);
    mocks.fetchCustomerMessages.mockResolvedValueOnce({ messages: [] });

    await appointments.loadAppointments.call(appointmentInstance);
    await messages.loadMessages.call(messageInstance);
    expect(appointmentInstance.data.pageState).toBe("empty");
    expect(messageInstance.data.pageState).toBe("empty");

    mocks.fetchBookingHistory.mockRejectedValueOnce(new Error("网络暂不可用"));
    await appointments.loadAppointments.call(appointmentInstance);
    expect(appointmentInstance.data).toMatchObject({
      pageState: "error",
      errorMessage: "网络暂不可用",
    });
  });

  it("模拟消息明确关联预约，并在打开时重新校验消息所有权", async () => {
    const messages = definitions[2] as MessagesDefinition;
    const instance = pageInstance(messages);

    await messages.loadMessages.call(instance);
    await messages.openMessage.call(instance, {
      currentTarget: { dataset: { id: "message-confirmed" } },
    } as unknown as WechatMiniprogram.BaseEvent);

    expect(instance.data).toMatchObject({
      pageState: "ready",
      messages: [
        expect.objectContaining({
          title: "预约已确认",
          bookingId: "booking-future",
          actionLabel: "查看预约",
        }),
      ],
    });
    expect(mocks.fetchCustomerMessage).toHaveBeenCalledWith("message-confirmed");
    expect(navigateTo).toHaveBeenCalledWith({
      url: "/pages/booking-detail/index?id=booking-future",
    });
  });
});
