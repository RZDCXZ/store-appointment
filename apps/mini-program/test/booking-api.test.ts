import type { CreateBookingResponse } from "@rongguang/contracts";
import { describe, expect, it, vi } from "vitest";

import { createConfirmedBooking, fetchBookingDetail } from "../miniprogram/services/booking-api";
import {
  chooseBookingPet,
  chooseBookingService,
  chooseBookingStaff,
  chooseBookingTime,
  readBookingDraft,
  type BookingDraftStorage,
} from "../miniprogram/services/booking-draft";
import type { CustomerApiRequestClient } from "../miniprogram/services/customer-api";

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
      startsAt: "2026-08-26T05:00:00.000Z",
    });
    expect(request.mock.calls[1]?.[0].data).toEqual(request.mock.calls[0]?.[0].data);
  });
});
