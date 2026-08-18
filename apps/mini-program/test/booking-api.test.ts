import type { CreateBookingResponse } from "@rongguang/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createConfirmedBooking,
  cancelBooking,
  fetchBookingDetail,
  fetchBookingHistory,
  fetchRescheduleOptions,
  fetchCustomerMessage,
  fetchCustomerMessages,
  rescheduleBooking,
} from "../miniprogram/services/booking-api";
import {
  chooseBookingPet,
  chooseBookingService,
  chooseBookingStaff,
  chooseBookingTime,
  readBookingDraft,
  type BookingDraftStorage,
} from "../miniprogram/services/booking-draft";
import type { CustomerApiRequestClient } from "../miniprogram/services/customer-api";
import { CustomerApiError } from "../miniprogram/services/customer-api";

function memoryStorage(): BookingDraftStorage {
  let value: unknown;
  return {
    get: () => value,
    set: (next) => {
      value = structuredClone(next);
    },
    remove: () => {
      value = undefined;
    },
  };
}

describe("预约创建客户端", () => {
  it("预约记录、详情和模拟消息都使用顾客作用域的直接读取路径", async () => {
    const request = vi.fn((options: Parameters<CustomerApiRequestClient["request"]>[0]) => {
      options.success({ statusCode: 200, data: {} });
    });
    const client = { request };
    const context = { apiBaseUrl: "http://api.test", accessToken: "token" };

    await fetchBookingHistory(client, context);
    await fetchBookingDetail("booking-mine", client, context);
    await fetchCustomerMessages(client, context);
    await fetchCustomerMessage("message-mine", client, context);
    await fetchRescheduleOptions("booking-mine", client, context);
    await rescheduleBooking(
      "booking-mine",
      {
        idempotencyKey: "reschedule-client-key",
        staffId: "chenjia",
        startsAt: "2026-08-15T03:00:00.000Z",
      },
      client,
      context,
    );
    await cancelBooking(
      "booking-mine",
      { idempotencyKey: "cancel-client-key", reason: "行程变化" },
      client,
      context,
    );

    expect(request.mock.calls.map(([options]) => [options.method, options.url])).toEqual([
      ["GET", "http://api.test/miniapp/bookings"],
      ["GET", "http://api.test/miniapp/bookings/booking-mine"],
      ["GET", "http://api.test/miniapp/messages"],
      ["GET", "http://api.test/miniapp/messages/message-mine"],
      ["GET", "http://api.test/miniapp/bookings/booking-mine/reschedule-options"],
      ["POST", "http://api.test/miniapp/bookings/booking-mine/reschedule"],
      ["POST", "http://api.test/miniapp/bookings/booking-mine/cancel"],
    ]);
    expect(request.mock.calls.at(-2)?.[0].data).toEqual({
      idempotencyKey: "reschedule-client-key",
      staffId: "chenjia",
      startsAt: "2026-08-15T03:00:00.000Z",
    });
    expect(request.mock.calls.at(-1)?.[0].data).toEqual({
      idempotencyKey: "cancel-client-key",
      reason: "行程变化",
    });
  });

  it("为完整草稿附加稳定幂等键，并可按预约身份重新读取服务端事实", async () => {
    const storage = memoryStorage();
    chooseBookingPet("pet-tuanzi", storage);
    chooseBookingService("dog-basic-care", ["oral-care"], storage);
    chooseBookingStaff({ kind: "fastest" }, storage);
    chooseBookingTime(
      {
        date: "2026-08-26",
        startsAt: "2026-08-26T05:00:00.000Z",
        endsAt: "2026-08-26T06:15:00.000Z",
        assignedStaffId: "zhaohang",
      },
      storage,
    );
    const response = {
      verificationCode: "729416",
      verificationWindow: {
        opensAt: "2026-08-26T04:30:00.000Z",
        closesAt: "2026-08-26T05:15:00.000Z",
        description: "可在开始前 30 分钟至开始后 15 分钟内出示",
      },
      booking: { id: "booking-created" },
    } as CreateBookingResponse;
    const request = vi.fn((options: Parameters<CustomerApiRequestClient["request"]>[0]) => {
      options.success({ statusCode: 200, data: response });
    });
    const client = { request };
    const context = { apiBaseUrl: "http://api.test", accessToken: "token" };

    await createConfirmedBooking(readBookingDraft(storage), {
      storage,
      generateIdempotencyKey: () => "booking-stable-key",
      client,
      context,
    });
    await createConfirmedBooking(readBookingDraft(storage), {
      storage,
      generateIdempotencyKey: () => "unused-retry-key",
      client,
      context,
    });
    await fetchBookingDetail("booking-created", client, context);

    expect(request.mock.calls.map(([options]) => [options.method, options.url])).toEqual([
      ["POST", "http://api.test/miniapp/bookings"],
      ["POST", "http://api.test/miniapp/bookings"],
      ["GET", "http://api.test/miniapp/bookings/booking-created"],
    ]);
    expect(request.mock.calls[0]?.[0].data).toEqual({
      idempotencyKey: "booking-stable-key",
      petId: "pet-tuanzi",
      primaryServiceId: "dog-basic-care",
      addonIds: ["oral-care"],
      staffId: "zhaohang",
      staffPreference: { kind: "fastest" },
      startsAt: "2026-08-26T05:00:00.000Z",
    });
    expect(request.mock.calls[1]?.[0].data).toEqual(request.mock.calls[0]?.[0].data);
  });

  it("把结构合法的统一冲突建议暴露给页面", async () => {
    const storage = memoryStorage();
    chooseBookingPet("pet-tuanzi", storage);
    chooseBookingService("dog-basic-care", ["oral-care"], storage);
    chooseBookingStaff({ kind: "fastest" }, storage);
    chooseBookingTime(
      {
        date: "2026-08-26",
        startsAt: "2026-08-26T05:00:00.000Z",
        endsAt: "2026-08-26T06:15:00.000Z",
        assignedStaffId: "zhaohang",
      },
      storage,
    );
    const suggestions = [
      {
        date: "2026-08-26",
        startsAt: "2026-08-26T07:00:00.000Z",
        endsAt: "2026-08-26T08:15:00.000Z",
        staff: { id: "zhaohang", displayName: "赵航" },
      },
    ];
    const client: CustomerApiRequestClient = {
      request(options) {
        options.success({
          statusCode: 409,
          data: {
            code: "BOOKING_TIME_CONFLICT",
            message: "刚刚有人选走了这个时段。",
            suggestions,
          },
        });
      },
    };

    await expect(
      createConfirmedBooking(readBookingDraft(storage), {
        storage,
        generateIdempotencyKey: () => "booking-conflict-key",
        client,
        context: { apiBaseUrl: "http://api.test", accessToken: "token" },
      }),
    ).rejects.toMatchObject({
      code: "BOOKING_TIME_CONFLICT",
      suggestions,
    } satisfies Partial<CustomerApiError>);
  });

  it("API 与持久化边界使用同一规则拒绝空员工标签的冲突建议", async () => {
    const client: CustomerApiRequestClient = {
      request(options) {
        options.success({
          statusCode: 409,
          data: {
            code: "BOOKING_TIME_CONFLICT",
            message: "刚刚有人选走了这个时段。",
            suggestions: [
              {
                date: "2026-08-26",
                startsAt: "2026-08-26T07:00:00.000Z",
                endsAt: "2026-08-26T08:15:00.000Z",
                staff: { id: "zhaohang", displayName: "" },
              },
            ],
          },
        });
      },
    };

    await expect(
      fetchBookingDetail("booking-conflict", client, {
        apiBaseUrl: "http://api.test",
        accessToken: "token",
      }),
    ).rejects.toMatchObject({
      code: "BOOKING_TIME_CONFLICT",
      suggestions: [],
    } satisfies Partial<CustomerApiError>);
  });
});
