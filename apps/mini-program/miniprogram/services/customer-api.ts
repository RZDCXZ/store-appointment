import type { BookingConflictSuggestion } from "@rongguang/contracts";

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
  suggestions?: unknown;
}

export class CustomerApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: Record<string, string> = {},
    readonly booking: unknown = null,
    readonly suggestions: BookingConflictSuggestion[] = [],
  ) {
    super(message);
  }
}

function bookingConflictSuggestions(value: unknown): BookingConflictSuggestion[] {
  if (!Array.isArray(value) || value.length > 5) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const suggestion = candidate as Record<string, unknown>;
    const staff =
      suggestion.staff && typeof suggestion.staff === "object"
        ? (suggestion.staff as Record<string, unknown>)
        : null;
    if (
      typeof suggestion.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(suggestion.date) ||
      typeof suggestion.startsAt !== "string" ||
      !Number.isFinite(Date.parse(suggestion.startsAt)) ||
      typeof suggestion.endsAt !== "string" ||
      !Number.isFinite(Date.parse(suggestion.endsAt)) ||
      Date.parse(suggestion.endsAt) <= Date.parse(suggestion.startsAt) ||
      typeof staff?.id !== "string" ||
      typeof staff.displayName !== "string"
    ) {
      return [];
    }
    return [
      {
        date: suggestion.date,
        startsAt: suggestion.startsAt,
        endsAt: suggestion.endsAt,
        staff: { id: staff.id, displayName: staff.displayName },
      },
    ];
  });
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
            bookingConflictSuggestions(error.suggestions),
          ),
        );
      },
      fail() {
        reject(new CustomerApiError(0, "NETWORK_ERROR", "暂时无法连接茸光本地 API。"));
      },
    });
  });
}
