import type {
  CustomerDataDeletionResponse,
  CustomerDataExport,
  CustomerDataRightsStatusResponse,
} from "@rongguang/contracts";

import {
  requestCustomerApi,
  type CustomerApiContext,
  type CustomerApiRequestClient,
} from "./customer-api";

export function fetchCustomerDataRights(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CustomerDataRightsStatusResponse> {
  return requestCustomerApi("/miniapp/data-rights", "GET", undefined, client, context);
}

export function fetchCustomerDataExport(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CustomerDataExport> {
  return requestCustomerApi("/miniapp/data-export", "GET", undefined, client, context);
}

export function deleteCustomerData(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<CustomerDataDeletionResponse> {
  return requestCustomerApi(
    "/miniapp/data-deletion",
    "POST",
    { confirmAnonymization: true },
    client,
    context,
  );
}
