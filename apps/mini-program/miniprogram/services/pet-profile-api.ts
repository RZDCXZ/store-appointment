import type {
  BookingEntryResponse,
  PetListResponse,
  PetPhotoUploadResponse,
  PetProfileInput,
  PetProfileResponse,
  PrivacyConsentStatusResponse,
} from "@rongguang/contracts";

import type { RongguangApp } from "../types/customer";

interface RequestResponse {
  statusCode: number;
  data: unknown;
}

interface PetProfileRequestOptions {
  url: string;
  method: "GET" | "POST" | "PUT";
  data?: object;
  header: { Authorization: string };
  success(response: RequestResponse): void;
  fail(): void;
}

export interface PetProfileRequestClient {
  request(options: PetProfileRequestOptions): void;
}

export interface PetProfileApiContext {
  apiBaseUrl: string;
  accessToken: string;
}

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  fieldErrors?: unknown;
  booking?: unknown;
}

export class PetProfileApiError extends Error {
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

function defaultClient(): PetProfileRequestClient {
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

function defaultContext(): PetProfileApiContext {
  const state = getApp<RongguangApp>().globalData;
  const accessToken = state.customerSession?.accessToken;

  if (!accessToken) {
    throw new PetProfileApiError(401, "UNAUTHENTICATED", "请先选择一个演示顾客。");
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

function requestCustomerApi<T>(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  data?: object,
  client: PetProfileRequestClient = defaultClient(),
  context: PetProfileApiContext = defaultContext(),
): Promise<T> {
  return new Promise((resolve, reject) => {
    client.request({
      url: `${context.apiBaseUrl}${path}`,
      method,
      data,
      header: { Authorization: `Bearer ${context.accessToken}` },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T);
          return;
        }

        const error = (response.data ?? {}) as ApiErrorBody;
        reject(
          new PetProfileApiError(
            response.statusCode,
            typeof error.code === "string" ? error.code : "REQUEST_FAILED",
            typeof error.message === "string" ? error.message : "请求失败，请稍后重试。",
            stringRecord(error.fieldErrors),
            error.booking,
          ),
        );
      },
      fail() {
        reject(new PetProfileApiError(0, "NETWORK_ERROR", "暂时无法连接茸光本地 API。"));
      },
    });
  });
}

export function fetchPetProfiles(
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PetListResponse> {
  return requestCustomerApi("/miniapp/pets", "GET", undefined, client, context);
}

export function fetchPetProfile(
  petId: string,
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PetProfileResponse> {
  return requestCustomerApi(
    `/miniapp/pets/${encodeURIComponent(petId)}`,
    "GET",
    undefined,
    client,
    context,
  );
}

export function savePetProfile(
  petId: string | null,
  input: PetProfileInput,
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PetProfileResponse> {
  const path = petId ? `/miniapp/pets/${encodeURIComponent(petId)}` : "/miniapp/pets";
  return requestCustomerApi(path, petId ? "PUT" : "POST", input, client, context);
}

export function archivePetProfile(
  petId: string,
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PetProfileResponse> {
  return requestCustomerApi(
    `/miniapp/pets/${encodeURIComponent(petId)}/archive`,
    "POST",
    undefined,
    client,
    context,
  );
}

export function restorePetProfile(
  petId: string,
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PetProfileResponse> {
  return requestCustomerApi(
    `/miniapp/pets/${encodeURIComponent(petId)}/restore`,
    "POST",
    undefined,
    client,
    context,
  );
}

export function uploadPetPhoto(
  input: { fileName: string; mimeType: "image/jpeg" | "image/png"; base64Data: string },
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PetPhotoUploadResponse> {
  return requestCustomerApi("/miniapp/pet-photos", "POST", input, client, context);
}

export function fetchPrivacyConsent(
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<PrivacyConsentStatusResponse> {
  return requestCustomerApi("/miniapp/privacy-consent", "GET", undefined, client, context);
}

export function acceptPrivacyConsent(
  version: string,
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
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
  client?: PetProfileRequestClient,
  context?: PetProfileApiContext,
): Promise<BookingEntryResponse> {
  return requestCustomerApi("/miniapp/booking-entry", "GET", undefined, client, context);
}

export function displayPhotoPath(photoPath: string | null, apiBaseUrl?: string): string {
  if (!photoPath) {
    return "/assets/brand/rongguang-hero-shiba.jpg";
  }

  if (photoPath.startsWith("/uploads/")) {
    const baseUrl = apiBaseUrl ?? getApp<RongguangApp>().globalData.apiBaseUrl;
    return `${baseUrl}${photoPath}`;
  }

  return photoPath;
}
