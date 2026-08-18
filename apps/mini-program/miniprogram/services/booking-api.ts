import type {
  BookingDetailResponse,
  CancelBookingInput,
  CancelBookingResponse,
  CreateBookingInput,
  CreateBookingResponse,
  CustomerBookingHistoryResponse,
  CustomerMessageDetailResponse,
  CustomerMessagesResponse,
  RescheduleBookingInput,
  RescheduleBookingOptionsResponse,
  RescheduleBookingResponse,
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

export function fetchRescheduleOptions(
  bookingId: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<RescheduleBookingOptionsResponse> {
  if (!/^[A-Za-z0-9-]{2,80}$/.test(bookingId)) {
    return Promise.reject(new Error("预约身份无效，请从预约记录重新打开。"));
  }
  return requestCustomerApi<RescheduleBookingOptionsResponse>(
    `/miniapp/bookings/${encodeURIComponent(bookingId)}/reschedule-options`,
    "GET",
    undefined,
    client,
    context,
  );
}

export function rescheduleBooking(
  bookingId: string,
  input: RescheduleBookingInput,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<RescheduleBookingResponse> {
  if (!/^[A-Za-z0-9-]{2,80}$/.test(bookingId)) {
    return Promise.reject(new Error("预约身份无效，请从预约记录重新打开。"));
  }
  return requestCustomerApi<RescheduleBookingResponse>(
    `/miniapp/bookings/${encodeURIComponent(bookingId)}/reschedule`,
    "POST",
    input,
    client,
    context,
  );
}

export function cancelBooking(
  bookingId: string,
  input: CancelBookingInput,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CancelBookingResponse> {
  if (!/^[A-Za-z0-9-]{2,80}$/.test(bookingId)) {
    return Promise.reject(new Error("预约身份无效，请从预约记录重新打开。"));
  }
  return requestCustomerApi<CancelBookingResponse>(
    `/miniapp/bookings/${encodeURIComponent(bookingId)}/cancel`,
    "POST",
    input,
    client,
    context,
  );
}

export function fetchBookingHistory(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CustomerBookingHistoryResponse> {
  return requestCustomerApi<CustomerBookingHistoryResponse>(
    "/miniapp/bookings",
    "GET",
    undefined,
    client,
    context,
  );
}

export function fetchCustomerMessages(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CustomerMessagesResponse> {
  return requestCustomerApi<CustomerMessagesResponse>(
    "/miniapp/messages",
    "GET",
    undefined,
    client,
    context,
  );
}

export function fetchCustomerMessage(
  messageId: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CustomerMessageDetailResponse> {
  if (!/^[A-Za-z0-9-]{2,80}$/.test(messageId)) {
    return Promise.reject(new Error("消息身份无效，请从消息列表重新打开。"));
  }
  return requestCustomerApi<CustomerMessageDetailResponse>(
    `/miniapp/messages/${encodeURIComponent(messageId)}`,
    "GET",
    undefined,
    client,
    context,
  );
}
