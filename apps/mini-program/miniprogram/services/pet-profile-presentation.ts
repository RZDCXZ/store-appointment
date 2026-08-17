import { classifyPetSize } from "./storefront-presentation";

const petSizeLabels = {
  small: "小型",
  medium: "中型",
  large: "大型",
} as const;

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

  return `${weightKg}kg · ${petSizeLabels[classifyPetSize(weightKg)]}`;
}
