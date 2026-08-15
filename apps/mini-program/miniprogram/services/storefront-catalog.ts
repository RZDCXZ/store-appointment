import type {
  PetSize,
  PetSpecies,
  PrimaryService,
  ServiceAddon,
  ServiceSpecification,
  StorefrontCatalogResponse,
  StorefrontStore,
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

function isCatalogItem(value: unknown, primary: boolean): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.applicableSpecies) &&
    value.applicableSpecies.every((species) => species === "dog" || species === "cat") &&
    Array.isArray(value.specifications) &&
    value.specifications.every(isSpecification) &&
    (!primary ||
      (Array.isArray(value.availableAddonIds) &&
        value.availableAddonIds.every((id) => typeof id === "string")))
  );
}

function isStorefrontCatalogResponse(value: unknown): value is StorefrontCatalogResponse {
  if (!isRecord(value) || !isRecord(value.store)) {
    return false;
  }

  const store = value.store;
  return (
    typeof store.brandName === "string" &&
    store.city === "上海" &&
    typeof store.address === "string" &&
    typeof store.contactPhone === "string" &&
    store.timeZone === "Asia/Shanghai" &&
    Array.isArray(store.weeklyBusinessHours) &&
    store.weeklyBusinessHours.every(
      (hours) =>
        isRecord(hours) &&
        Number.isInteger(hours.weekday) &&
        typeof hours.label === "string" &&
        (hours.openAt === null || typeof hours.openAt === "string") &&
        (hours.closeAt === null || typeof hours.closeAt === "string"),
    ) &&
    Array.isArray(value.primaryServices) &&
    value.primaryServices.every((service) => isCatalogItem(service, true)) &&
    Array.isArray(value.addons) &&
    value.addons.every((addon) => isCatalogItem(addon, false))
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

export function formatCny(priceCents: number): string {
  return `¥${(priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

const petSizeLabels: Record<PetSize, string> = {
  small: "小型",
  medium: "中型",
  large: "大型",
};

const serviceImagePaths: Record<string, string> = {
  "dog-basic-care": "/assets/brand/pet-tuanzi-shiba.png",
  "dog-styling": "/assets/brand/pet-lizi-golden.png",
  "cat-care": "/assets/brand/pet-bohe-british-shorthair.png",
};

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

export interface DisplaySpecification {
  petSize: PetSize;
  petSizeLabel: string;
  priceLabel: string;
  durationLabel: string;
}

export interface PrimaryServiceDisplay {
  id: string;
  name: string;
  description: string;
  imagePath: string;
  speciesLabel: string;
  availableAddonIds: string[];
  specifications: DisplaySpecification[];
}

export interface ServiceAddonDisplay {
  id: string;
  name: string;
  description: string;
  speciesLabel: string;
  specifications: DisplaySpecification[];
}

export interface StoreBusinessSummary {
  statusLabel: string;
  hoursLabel: string;
  dateLabel: string;
  isOpen: boolean;
}

function speciesLabel(species: PetSpecies[]): string {
  if (species.includes("dog") && species.includes("cat")) {
    return "适用犬猫";
  }

  return species.includes("dog") ? "适用犬类" : "适用猫咪";
}

function displaySpecifications(specifications: ServiceSpecification[]): DisplaySpecification[] {
  return specifications.map((specification) => ({
    petSize: specification.petSize,
    petSizeLabel: petSizeLabels[specification.petSize],
    priceLabel: formatCny(specification.priceCents),
    durationLabel: `${specification.durationMinutes} 分钟`,
  }));
}

export function displayPrimaryService(service: PrimaryService): PrimaryServiceDisplay {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    imagePath: serviceImagePaths[service.id] ?? "/assets/brand/rongguang-hero-shiba.png",
    speciesLabel: speciesLabel(service.applicableSpecies),
    availableAddonIds: service.availableAddonIds,
    specifications: displaySpecifications(service.specifications),
  };
}

export function displayServiceAddon(addon: ServiceAddon): ServiceAddonDisplay {
  return {
    id: addon.id,
    name: addon.name,
    description: addon.description,
    speciesLabel: speciesLabel(addon.applicableSpecies),
    specifications: displaySpecifications(addon.specifications),
  };
}

function timeToMinutes(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function getStoreBusinessSummary(
  store: StorefrontStore,
  now: Date = new Date(),
): StoreBusinessSummary {
  const shanghaiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = shanghaiNow.getUTCDay();
  const dateLabel = `${shanghaiNow.getUTCMonth() + 1}月${shanghaiNow.getUTCDate()}日 ${weekdayLabels[weekday]}`;
  const hours = store.weeklyBusinessHours.find((item) => item.weekday === weekday);

  if (!hours?.openAt || !hours.closeAt) {
    return { statusLabel: "今日闭店", hoursLabel: "周一固定闭店", dateLabel, isOpen: false };
  }

  const minuteOfDay = shanghaiNow.getUTCHours() * 60 + shanghaiNow.getUTCMinutes();
  const isOpen =
    minuteOfDay >= timeToMinutes(hours.openAt) && minuteOfDay < timeToMinutes(hours.closeAt);
  const statusLabel = isOpen
    ? "营业中"
    : minuteOfDay < timeToMinutes(hours.openAt)
      ? "今日营业"
      : "今日营业已结束";

  return {
    statusLabel,
    hoursLabel: `${hours.openAt}–${hours.closeAt}`,
    dateLabel,
    isOpen,
  };
}

export function serviceDetailPath(serviceId: string): string {
  return `/pages/service-detail/index?id=${encodeURIComponent(serviceId)}`;
}

export function classifyPetSize(weightKg: number): PetSize {
  if (weightKg <= 10) {
    return "small";
  }

  if (weightKg <= 25) {
    return "medium";
  }

  return "large";
}

export function selectServiceSpecification(
  service: PrimaryService,
  species: PetSpecies,
  weightKg: number,
): ServiceSpecification {
  if (!service.applicableSpecies.includes(species)) {
    throw new Error("该主要服务不适用于这只宠物。");
  }

  const petSize = classifyPetSize(weightKg);
  const specification = service.specifications.find((item) => item.petSize === petSize);

  if (!specification) {
    throw new Error("没有找到这只宠物对应的服务规格。");
  }

  return specification;
}
