import type { RongguangApp } from "../types/customer";

interface RequestResponse {
  statusCode: number;
  data: unknown;
}

interface CustomerApiRequestOptions {
  url: string;
  method: "GET" | "POST" | "PUT";
  data?: object;
  header: { Authorization: string };
  success(response: RequestResponse): void;
  fail(): void;
}

export interface CustomerApiRequestClient {
  request(options: CustomerApiRequestOptions): void;
}

export interface CustomerApiContext {
  apiBaseUrl: string;
  accessToken: string;
}

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  fieldErrors?: unknown;
  booking?: unknown;
}

export class CustomerApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    readonly booking: unknown = null,
  ) {
    super(message);
  }
}

function defaultClient(): CustomerApiRequestClient {
  return {
    request(options) {
      wx.request({
        url: options.url,
        method: options.method,
        data: options.data,
        header: options.header,
        success(response) {
          options.success({ statusCode: response.statusCode, data: response.data });
        },
        fail() {
          options.fail();
        },
      });
    },
  };
}

export function resolveCustomerApiContext(context?: CustomerApiContext): CustomerApiContext {
  if (context) {
    return context;
  }

  const state = getApp<RongguangApp>().globalData;
  const accessToken = state.customerSession?.accessToken;

  if (!accessToken) {
    throw new CustomerApiError(401, "UNAUTHENTICATED", "请先选择一个演示顾客。");
  }

  return { apiBaseUrl: state.apiBaseUrl, accessToken };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function requestCustomerApi<T>(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  data?: object,
  client: CustomerApiRequestClient = defaultClient(),
  context?: CustomerApiContext,
): Promise<T> {
  const resolvedContext = resolveCustomerApiContext(context);

  return new Promise((resolve, reject) => {
    client.request({
      url: `${resolvedContext.apiBaseUrl}${path}`,
      method,
      data,
      header: { Authorization: `Bearer ${resolvedContext.accessToken}` },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T);
          return;
        }

        const error = (response.data ?? {}) as ApiErrorBody;
        reject(
          new CustomerApiError(
            response.statusCode,
            typeof error.code === "string" ? error.code : "REQUEST_FAILED",
            typeof error.message === "string" ? error.message : "请求失败，请稍后重试。",
            stringRecord(error.fieldErrors),
            error.booking,
          ),
        );
      },
      fail() {
        reject(new CustomerApiError(0, "NETWORK_ERROR", "暂时无法连接茸光本地 API。"));
      },
    });
  });
}
