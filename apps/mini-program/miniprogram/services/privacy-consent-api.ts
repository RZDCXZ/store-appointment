import type { BookingEntryResponse, PrivacyConsentStatusResponse } from "@rongguang/contracts";

import {
  requestCustomerApi,
  type CustomerApiContext,
  type CustomerApiRequestClient,
} from "./customer-api";

export function fetchPrivacyConsent(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PrivacyConsentStatusResponse> {
  return requestCustomerApi("/miniapp/privacy-consent", "GET", undefined, client, context);
}

export function acceptPrivacyConsent(
  version: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PrivacyConsentStatusResponse> {
  return requestCustomerApi(
    "/miniapp/privacy-consent",
    "POST",
    { version, accepted: true },
    client,
    context,
  );
}

export function fetchBookingEntry(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<BookingEntryResponse> {
  return requestCustomerApi("/miniapp/booking-entry", "GET", undefined, client, context);
}
