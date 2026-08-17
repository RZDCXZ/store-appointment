import type {
  BookingDetailResponse,
  CreateBookingInput,
  CreateBookingResponse,
} from "@rongguang/contracts";

import {
  ensureBookingIdempotencyKey,
  type BookingDraft,
  type BookingDraftStorage,
} from "./booking-draft";
import {
  requestCustomerApi,
  type CustomerApiContext,
  type CustomerApiRequestClient,
} from "./customer-api";

interface CreateBookingOptions {
  storage?: BookingDraftStorage;
  generateIdempotencyKey?: () => string;
  client?: CustomerApiRequestClient;
  context?: CustomerApiContext;
}

function completeDraft(draft: BookingDraft): asserts draft is BookingDraft & {
  petId: string;
  primaryServiceId: string;
  staffPreference: NonNullable<BookingDraft["staffPreference"]>;
  selectedTime: NonNullable<BookingDraft["selectedTime"]>;
} {
  if (!draft.petId || !draft.primaryServiceId || !draft.staffPreference || !draft.selectedTime) {
    throw new Error("预约草稿尚未完成，请返回补全选择。");
  }
}

export function createConfirmedBooking(
  draft: BookingDraft,
  options: CreateBookingOptions = {},
): Promise<CreateBookingResponse> {
  completeDraft(draft);
  const idempotencyKey = ensureBookingIdempotencyKey(
    options.storage,
    options.generateIdempotencyKey,
  );
  const input: CreateBookingInput = {
    idempotencyKey,
    petId: draft.petId,
    primaryServiceId: draft.primaryServiceId,
    addonIds: [...draft.addonIds],
    staffId: draft.selectedTime.assignedStaffId,
    staffPreference: { ...draft.staffPreference },
    startsAt: draft.selectedTime.startsAt,
  };

  return requestCustomerApi<CreateBookingResponse>(
    "/miniapp/bookings",
    "POST",
    input,
    options.client,
    options.context,
  );
}

export function fetchBookingDetail(
  bookingId: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<BookingDetailResponse> {
  if (!/^[A-Za-z0-9-]{2,80}$/.test(bookingId)) {
    return Promise.reject(new Error("预约身份无效，请从预约记录重新打开。"));
  }
  return requestCustomerApi<BookingDetailResponse>(
    `/miniapp/bookings/${encodeURIComponent(bookingId)}`,
    "GET",
    undefined,
    client,
    context,
  );
}
