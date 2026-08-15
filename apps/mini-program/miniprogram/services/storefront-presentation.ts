import type {
  PetSize,
  PetSpecies,
  PrimaryService,
  ServiceAddon,
  ServiceSpecification,
  StorefrontStore,
} from "@rongguang/contracts";

export function formatCny(priceCents: number): string {
  return `¥${(priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

const petSizeLabels: Record<PetSize, string> = {
  small: "小型",
  medium: "中型",
  large: "大型",
};

const serviceImagePaths: Record<string, string> = {
  "dog-basic-care": "/assets/brand/pet-tuanzi-shiba.jpg",
  "dog-styling": "/assets/brand/pet-lizi-golden.jpg",
  "cat-care": "/assets/brand/pet-bohe-british-shorthair.jpg",
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
    imagePath: serviceImagePaths[service.id] ?? "/assets/brand/rongguang-hero-shiba.jpg",
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

export function getStoreBusinessSummary(store: StorefrontStore, now: Date): StoreBusinessSummary {
  const shanghaiNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const weekday = shanghaiNow.getUTCDay();
  const dateLabel = `${shanghaiNow.getUTCMonth() + 1}月${shanghaiNow.getUTCDate()}日 ${weekdayLabels[weekday]}`;
  const hours = store.weeklyBusinessHours.find((item) => item.weekday === weekday);

  if (!hours?.openAt || !hours.closeAt) {
    return {
      statusLabel: "今日闭店",
      hoursLabel: `${hours?.label ?? weekdayLabels[weekday]}固定闭店`,
      dateLabel,
      isOpen: false,
    };
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
