import { classifyPetSize } from "./storefront-presentation";

const petSizeLabels = {
  small: "小型",
  medium: "中型",
  large: "大型",
} as const;

export function petSizeLabel(size: keyof typeof petSizeLabels): string {
  return petSizeLabels[size];
}

export function demoDateInShanghai(instant: string): string {
  const shifted = new Date(new Date(instant).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function formatShanghaiDateTime(instant: string): string {
  const shifted = new Date(new Date(instant).getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${year}年${month}月${day}日 ${hours}:${minutes}`;
}

export function petFormPath(petId?: string): string {
  return petId ? `/pages/pet-form/index?id=${encodeURIComponent(petId)}` : "/pages/pet-form/index";
}

export function readPetFormRoute(options: Record<string, string | undefined>): {
  petId: string | null;
} {
  const petId = typeof options.id === "string" && options.id.length <= 80 ? options.id : null;
  return { petId };
}

export function sizeSummaryForWeightInput(value: string): string | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return null;
  }

  const weightKg = Number(value);

  if (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 99.99) {
    return null;
  }

  return `${weightKg}kg · ${petSizeLabel(classifyPetSize(weightKg))}`;
}
