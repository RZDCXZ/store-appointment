export type { BackofficeAccount, BackofficeRole } from "@rongguang/contracts";

import type { ApiErrorResponse } from "@rongguang/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createApiUrl(path: string): string {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  return new URL(path.replace(/^\//, ""), apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`)
    .href;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(createApiUrl(path), { ...init, credentials: "include" });
}

export async function readApiError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorResponse> = {};

  try {
    body = (await response.json()) as Partial<ApiErrorResponse>;
  } catch {
    // A non-JSON upstream response is reported with a stable recoverable message below.
  }

  return new ApiError(
    response.status,
    body.code ?? "REQUEST_FAILED",
    body.message ?? `请求失败（HTTP ${response.status}），请稍后重试。`,
  );
}
