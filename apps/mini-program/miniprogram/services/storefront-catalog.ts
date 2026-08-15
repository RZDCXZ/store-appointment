import type {
  PetSize,
  PrimaryService,
  ServiceAddon,
  StorefrontCatalogResponse,
} from "@rongguang/contracts";

import type { RongguangApp } from "../types/customer";

interface CatalogRequestResponse {
  statusCode: number;
  data: unknown;
}

interface CatalogRequestOptions {
  url: string;
  success(response: CatalogRequestResponse): void;
  fail(): void;
}

export interface CatalogRequestClient {
  request(options: CatalogRequestOptions): void;
}

export class CatalogQueryError extends Error {
  readonly retryable = true;

  constructor(
    readonly code: "NETWORK_ERROR" | "SERVER_ERROR" | "REQUEST_ERROR" | "INVALID_RESPONSE",
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSpecification(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.petSize === "small" || value.petSize === "medium" || value.petSize === "large") &&
    Number.isInteger(value.priceCents) &&
    Number(value.priceCents) >= 0 &&
    Number.isInteger(value.durationMinutes) &&
    Number(value.durationMinutes) > 0
  );
}

const petSizes: PetSize[] = ["small", "medium", "large"];

function hasCompleteSpecifications(value: unknown[]): boolean {
  if (value.length !== petSizes.length || !value.every(isSpecification)) {
    return false;
  }

  const sizes = new Set(
    value.map((specification) => (specification as Record<string, unknown>).petSize),
  );
  return petSizes.every((petSize) => sizes.has(petSize));
}

function isCatalogItem(value: unknown, primary: boolean): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.applicableSpecies) &&
    value.applicableSpecies.length > 0 &&
    value.applicableSpecies.every((species) => species === "dog" || species === "cat") &&
    Array.isArray(value.specifications) &&
    hasCompleteSpecifications(value.specifications) &&
    (!primary ||
      (Array.isArray(value.availableAddonIds) &&
        value.availableAddonIds.every((id) => typeof id === "string")))
  );
}

function isBusinessHours(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const hasClosedPair = value.openAt === null && value.closeAt === null;
  const hasOpenPair =
    typeof value.openAt === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.openAt) &&
    typeof value.closeAt === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.closeAt);

  return (
    Number.isInteger(value.weekday) &&
    Number(value.weekday) >= 0 &&
    Number(value.weekday) <= 6 &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    (hasClosedPair || hasOpenPair)
  );
}

function hasCompleteBusinessWeek(value: unknown[]): boolean {
  if (value.length !== 7 || !value.every(isBusinessHours)) {
    return false;
  }

  return new Set(value.map((hours) => (hours as Record<string, unknown>).weekday)).size === 7;
}

function isStorefrontCatalogResponse(value: unknown): value is StorefrontCatalogResponse {
  if (!isRecord(value) || !isRecord(value.store)) {
    return false;
  }

  const store = value.store;
  const isStructurallyValid =
    typeof store.brandName === "string" &&
    store.city === "上海" &&
    typeof store.demoNow === "string" &&
    !Number.isNaN(Date.parse(store.demoNow)) &&
    typeof store.address === "string" &&
    typeof store.contactPhone === "string" &&
    store.timeZone === "Asia/Shanghai" &&
    Array.isArray(store.weeklyBusinessHours) &&
    hasCompleteBusinessWeek(store.weeklyBusinessHours) &&
    Array.isArray(value.primaryServices) &&
    value.primaryServices.every((service) => isCatalogItem(service, true)) &&
    Array.isArray(value.addons) &&
    value.addons.every((addon) => isCatalogItem(addon, false));

  if (!isStructurallyValid) {
    return false;
  }

  const primaryServices = value.primaryServices as PrimaryService[];
  const addons = value.addons as ServiceAddon[];
  const serviceIds = primaryServices
    .map((service) => service.id)
    .concat(addons.map((addon) => addon.id));
  const addonIds = new Set(addons.map((addon) => addon.id));

  return (
    new Set(serviceIds).size === serviceIds.length &&
    primaryServices.every((service) =>
      service.availableAddonIds.every((addonId) => addonIds.has(addonId)),
    )
  );
}

function defaultRequestClient(): CatalogRequestClient {
  return {
    request(options) {
      wx.request({
        url: options.url,
        method: "GET",
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

export function fetchStorefrontCatalog(
  client: CatalogRequestClient = defaultRequestClient(),
  apiBaseUrl: string = getApp<RongguangApp>().globalData.apiBaseUrl,
): Promise<StorefrontCatalogResponse> {
  return new Promise((resolve, reject) => {
    client.request({
      url: `${apiBaseUrl}/miniapp/storefront`,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (!isStorefrontCatalogResponse(response.data)) {
            reject(new CatalogQueryError("INVALID_RESPONSE", "门店服务数据不完整，请稍后重试。"));
            return;
          }

          resolve(response.data);
          return;
        }

        reject(
          response.statusCode >= 500
            ? new CatalogQueryError("SERVER_ERROR", "门店服务暂时无法加载，请稍后重试。")
            : new CatalogQueryError("REQUEST_ERROR", "门店服务请求失败，请重试。"),
        );
      },
      fail() {
        reject(new CatalogQueryError("NETWORK_ERROR", "暂时无法连接茸光本地 API。"));
      },
    });
  });
}
