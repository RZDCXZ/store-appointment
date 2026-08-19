export type { BackofficeAccount, BackofficeRole } from "@rongguang/contracts";

import type { ApiErrorResponse } from "@rongguang/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
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
  let body: Partial<ApiErrorResponse> & Record<string, unknown> = {};

  try {
    body = (await response.json()) as Partial<ApiErrorResponse> & Record<string, unknown>;
  } catch {
    // A non-JSON upstream response is reported with a stable recoverable message below.
  }

  return new ApiError(
    response.status,
    body.code ?? "REQUEST_FAILED",
    body.message ?? `请求失败（HTTP ${response.status}），请稍后重试。`,
    body,
  );
}

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];

  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return fallback;
    }
  }

  return plain ?? fallback;
}

export async function downloadApiFile(
  path: string,
  payload: Record<string, string>,
  fallbackFilename: string,
): Promise<string> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw await readApiError(response);

  const filename = responseFilename(response, fallbackFilename);
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return filename;
}
