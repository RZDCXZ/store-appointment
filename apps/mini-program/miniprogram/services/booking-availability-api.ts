import type { BookingAvailabilityResponse } from "@rongguang/contracts";

import { requestCustomerApi } from "./customer-api";
import type { BookingDraft } from "./booking-draft";

export function fetchBookingAvailability(
  draft: BookingDraft,
): Promise<BookingAvailabilityResponse> {
  if (!draft.petId || !draft.primaryServiceId) {
    return Promise.reject(new Error("请先选择宠物和主要服务。"));
  }

  const query = [
    `petId=${encodeURIComponent(draft.petId)}`,
    `primaryServiceId=${encodeURIComponent(draft.primaryServiceId)}`,
  ];
  if (draft.addonIds.length > 0) {
    query.push(`addonIds=${encodeURIComponent(draft.addonIds.join(","))}`);
  }
  if (draft.staffPreference?.kind === "specified") {
    query.push(`staffId=${encodeURIComponent(draft.staffPreference.staffId)}`);
  }

  return requestCustomerApi(`/miniapp/available-slots?${query.join("&")}`);
}
