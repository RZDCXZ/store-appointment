import type {
  BookingSelectionQuote,
  PetProfile,
  StaffSkillId,
  StorefrontCatalogResponse,
} from "@rongguang/contracts";

export function quoteBookingSelection(
  pet: PetProfile,
  catalog: StorefrontCatalogResponse,
  primaryServiceId: string,
  addonIds: string[],
): BookingSelectionQuote {
  const primaryService = catalog.primaryServices.find((service) => service.id === primaryServiceId);
  const primarySpecification = primaryService?.specifications.find(
    (specification) => specification.petSize === pet.petSize,
  );
  if (
    !primaryService ||
    !primaryService.applicableSpecies.includes(pet.species) ||
    !primarySpecification
  ) {
    throw new Error("这项主要服务不适用于所选宠物。");
  }

  const allowedAddonIds = new Set(primaryService.availableAddonIds);
  const addons = addonIds.map((addonId) => {
    const addon = catalog.addons.find((item) => item.id === addonId);
    const specification = addon?.specifications.find((item) => item.petSize === pet.petSize);
    if (
      !addon ||
      !allowedAddonIds.has(addon.id) ||
      !addon.applicableSpecies.includes(pet.species) ||
      !specification
    ) {
      throw new Error("所选增项与主要服务或宠物不兼容。");
    }
    return {
      id: addon.id,
      name: addon.name,
      priceCents: specification.priceCents,
      durationMinutes: specification.durationMinutes,
    };
  });
  const primaryLine = {
    id: primaryService.id,
    name: primaryService.name,
    priceCents: primarySpecification.priceCents,
    durationMinutes: primarySpecification.durationMinutes,
  };

  return {
    pet: {
      id: pet.id,
      name: pet.name,
      species: pet.species,
      petSize: pet.petSize,
      weightKg: pet.weightKg,
    },
    primaryService: primaryLine,
    addons,
    totalPriceCents:
      primaryLine.priceCents + addons.reduce((total, addon) => total + addon.priceCents, 0),
    serviceDurationMinutes:
      primaryLine.durationMinutes +
      addons.reduce((total, addon) => total + addon.durationMinutes, 0),
    requiredSkillIds: [primaryService.id, ...addonIds] as StaffSkillId[],
  };
}
