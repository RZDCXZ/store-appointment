import type {
  BookingAvailabilityResponse,
  BookingDetailResponse,
  CreateBookingResponse,
} from "@rongguang/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerApiError } from "../miniprogram/services/customer-api";

const mocks = vi.hoisted(() => ({
  clearBookingDraft: vi.fn(),
  createConfirmedBooking: vi.fn(),
  fetchBookingAvailability: vi.fn(),
  fetchBookingDetail: vi.fn(),
  fetchBookingEntry: vi.fn(),
  loadCustomerContext: vi.fn(),
  openCustomerSelector: vi.fn(),
  readBookingDraft: vi.fn(),
  writeBookingConflict: vi.fn(),
}));
vi.mock("../miniprogram/services/booking-conflict", () => ({
  writeBookingConflict: mocks.writeBookingConflict,
}));

vi.mock("../miniprogram/services/booking-api", () => ({
  createConfirmedBooking: mocks.createConfirmedBooking,
  fetchBookingDetail: mocks.fetchBookingDetail,
}));
vi.mock("../miniprogram/services/booking-availability-api", () => ({
  fetchBookingAvailability: mocks.fetchBookingAvailability,
}));
vi.mock("../miniprogram/services/booking-draft", () => ({
  bookingFlowPaths: {
    pet: "/pages/booking-pet/index",
    service: "/pages/booking-service/index",
    staff: "/pages/booking-staff/index",
    time: "/pages/booking-time/index",
    conflict: "/pages/booking-conflict/index",
    confirm: "/pages/booking-confirm/index",
  },
  clearBookingDraft: mocks.clearBookingDraft,
  readBookingDraft: mocks.readBookingDraft,
  recoveryForBookingStep: vi.fn(() => null),
}));
vi.mock("../miniprogram/services/customer-session", () => ({
  loadCustomerContext: mocks.loadCustomerContext,
  openCustomerSelector: mocks.openCustomerSelector,
}));
vi.mock("../miniprogram/services/privacy-consent-api", () => ({
  fetchBookingEntry: mocks.fetchBookingEntry,
}));

interface PageInstance {
  data: Record<string, unknown>;
  setData(next: Record<string, unknown>): void;
}

interface ConfirmPageDefinition {
  data: Record<string, unknown>;
  loadConfirmation(this: PageInstance): Promise<void>;
  submitBooking(this: PageInstance): Promise<void>;
}

interface SuccessPageDefinition {
  data: Record<string, unknown>;
  loadBooking(this: PageInstance): Promise<void>;
}

function pageInstance(definition: { data: Record<string, unknown> }): PageInstance {
  return {
    data: structuredClone(definition.data),
    setData(next) {
      Object.assign(this.data, next);
    },
  };
}

const draft = {
  version: 1,
  idempotencyKey: null,
  petId: "pet-tuanzi",
  primaryServiceId: "dog-basic-care",
  addonIds: ["oral-care"],
  staffPreference: { kind: "fastest" as const },
  selectedTime: {
    date: "2026-08-26",
    startsAt: "2026-08-26T05:00:00.000Z",
    endsAt: "2026-08-26T06:15:00.000Z",
    assignedStaffId: "zhaohang",
  },
};

const availability = {
  selection: {
    pet: {
      id: "pet-tuanzi",
      name: "团子",
      species: "dog",
      weightKg: 8.4,
      petSize: "small",
    },
    primaryService: {
      id: "dog-basic-care",
      name: "犬基础洗护",
      priceCents: 12800,
      durationMinutes: 60,
    },
    addons: [{ id: "oral-care", name: "口腔清洁", priceCents: 3500, durationMinutes: 15 }],
    totalPriceCents: 16300,
    serviceDurationMinutes: 75,
    requiredSkillIds: ["dog-basic-care", "oral-care"],
  },
  days: [
    {
      date: "2026-08-26",
      weekday: 3,
      reason: null,
      reasonLabel: "可预约",
      slots: [
        {
          startsAt: "2026-08-26T05:00:00.000Z",
          endsAt: "2026-08-26T06:15:00.000Z",
          turnoverEndsAt: "2026-08-26T06:30:00.000Z",
          staff: { id: "zhaohang", displayName: "赵航", employeeNumber: 4 },
        },
      ],
    },
  ],
} as BookingAvailabilityResponse;

const booking = {
  id: "booking-created",
  status: "confirmed",
  pet: availability.selection.pet,
  primaryService: availability.selection.primaryService,
  addons: availability.selection.addons,
  staff: { id: "zhaohang", displayName: "赵航" },
  startsAt: "2026-08-26T05:00:00.000Z",
  endsAt: "2026-08-26T06:15:00.000Z",
  turnoverEndsAt: "2026-08-26T06:30:00.000Z",
  totalPriceCents: 16300,
  serviceDurationMinutes: 75,
  turnoverMinutes: 15,
  originalSchedule: {
    startsAt: "2026-08-26T05:00:00.000Z",
    endsAt: "2026-08-26T06:15:00.000Z",
    occupancyStartsAt: "2026-08-26T05:00:00.000Z",
    occupancyEndsAt: "2026-08-26T06:30:00.000Z",
  },
  createdAt: "2026-08-13T02:50:00.000Z",
} as const;

describe("MP-10 确认与 MP-11 成功页面", () => {
  const definitions: Array<ConfirmPageDefinition | SuccessPageDefinition> = [];

  beforeAll(async () => {
    vi.stubGlobal("Page", (definition: ConfirmPageDefinition | SuccessPageDefinition) =>
      definitions.push(definition),
    );
    await import("../miniprogram/pages/booking-confirm/index");
    await import("../miniprogram/pages/booking-success/index");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBookingDraft.mockReturnValue(structuredClone(draft));
    mocks.loadCustomerContext.mockResolvedValue({ kind: "active", customer: {} });
    mocks.fetchBookingEntry.mockResolvedValue({
      canContinue: true,
      requiredPrivacyNoticeVersion: "2026.08",
    });
    mocks.fetchBookingAvailability.mockResolvedValue(availability);
    mocks.createConfirmedBooking.mockResolvedValue({
      verificationCode: "729416",
      booking,
    } satisfies CreateBookingResponse);
    mocks.fetchBookingDetail.mockResolvedValue({ booking } satisfies BookingDetailResponse);
    vi.stubGlobal("wx", { redirectTo: vi.fn() });
  });

  it("确认页刷新后从服务端恢复完整复核事实并在成功前清除草稿", async () => {
    const confirm = definitions[0] as ConfirmPageDefinition;
    const instance = pageInstance(confirm);

    await confirm.loadConfirmation.call(instance);
    await confirm.submitBooking.call(instance);

    expect(instance.data).toMatchObject({
      pageState: "ready",
      petLabel: "团子 · 犬 · 8.4kg · 小型",
      serviceLabel: "犬基础洗护 + 口腔清洁",
      staffLabel: "赵航",
      dateLabel: "8月26日 周三",
      timeLabel: "13:00–14:15",
      priceLabel: "¥163",
      durationLabel: "75 分钟",
      privacyVersion: "2026.08",
    });
    expect(mocks.clearBookingDraft).toHaveBeenCalledOnce();
    expect(wx.redirectTo).toHaveBeenCalledWith({
      url: "/pages/booking-success/index?id=booking-created",
    });
  });

  it("成功页仅凭预约身份刷新恢复服务端当前事实", async () => {
    const success = definitions[1] as SuccessPageDefinition;
    const instance = pageInstance(success);
    instance.data.bookingId = "booking-created";

    await success.loadBooking.call(instance);

    expect(mocks.fetchBookingDetail).toHaveBeenCalledWith("booking-created");
    expect(instance.data).toMatchObject({
      pageState: "ready",
      petName: "团子",
      statusLabel: "预约已确认",
      dateLabel: "8月26日 周三",
      timeLabel: "13:00–14:15",
      serviceLabel: "犬基础洗护 + 口腔清洁",
      staffLabel: "赵航",
      priceLabel: "¥163",
    });
  });

  it("时段冲突保留草稿与员工偏好，并把实时建议交给 MP-12", async () => {
    const confirm = definitions[0] as ConfirmPageDefinition;
    const instance = pageInstance(confirm);
    await confirm.loadConfirmation.call(instance);
    mocks.createConfirmedBooking.mockRejectedValue(
      Object.assign(
        new CustomerApiError(409, "BOOKING_TIME_CONFLICT", "刚刚有人选走了这个时段。"),
        {
          suggestions: [
            {
              date: "2026-08-26",
              startsAt: "2026-08-26T07:00:00.000Z",
              endsAt: "2026-08-26T08:15:00.000Z",
              staff: { id: "zhaohang", displayName: "赵航" },
            },
          ],
        },
      ),
    );

    await confirm.submitBooking.call(instance);

    expect(mocks.clearBookingDraft).not.toHaveBeenCalled();
    expect(mocks.writeBookingConflict).toHaveBeenCalledWith({
      requestedStartsAt: "2026-08-26T05:00:00.000Z",
      petLabel: "团子 · 犬 · 8.4kg · 小型",
      serviceLabel: "犬基础洗护 + 口腔清洁",
      staffPreferenceLabel: "最快可约",
      suggestions: [
        {
          date: "2026-08-26",
          startsAt: "2026-08-26T07:00:00.000Z",
          endsAt: "2026-08-26T08:15:00.000Z",
          staff: { id: "zhaohang", displayName: "赵航" },
        },
      ],
    });
    expect(wx.redirectTo).toHaveBeenCalledWith({
      url: "/pages/booking-conflict/index",
    });
  });
});
