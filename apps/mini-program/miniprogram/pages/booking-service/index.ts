import type {
  BookingSelectionQuote,
  PetProfile,
  StorefrontCatalogResponse,
} from "@rongguang/contracts";

import {
  bookingFlowPaths,
  chooseBookingService,
  readBookingDraft,
  recoveryForBookingStep,
} from "../../services/booking-draft";
import { quoteBookingSelection } from "../../services/booking-selection";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { fetchPetProfile } from "../../services/pet-profile-api";
import { petSizeLabel } from "../../services/pet-profile-presentation";
import { fetchBookingEntry } from "../../services/privacy-consent-api";
import { fetchStorefrontCatalog } from "../../services/storefront-catalog";
import { formatCny } from "../../services/storefront-presentation";

type PageState = "loading" | "ready" | "error" | "auth" | "recovery";

Page({
  data: {
    pageState: "loading" as PageState,
    recoveryPath: "",
    recoveryMessage: "",
    errorMessage: "",
    pet: null as PetProfile | null,
    petSummary: "",
    catalog: null as StorefrontCatalogResponse | null,
    services: [] as { id: string; name: string; priceLabel: string; durationLabel: string }[],
    addons: [] as { id: string; name: string; detail: string; selected: boolean }[],
    selectedServiceId: "",
    selectedAddonIds: [] as string[],
    quote: null as BookingSelectionQuote | null,
    totalPriceLabel: "¥0",
  },
  onShow() {
    void this.loadOptions();
  },
  async loadOptions() {
    const draft = readBookingDraft();
    const recovery = recoveryForBookingStep("service", draft);
    if (recovery) {
      this.setData({
        pageState: "recovery",
        recoveryPath: recovery.path,
        recoveryMessage: recovery.message,
      });
      return;
    }
    const context = await loadCustomerContext(bookingFlowPaths.service);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth" });
      return;
    }

    try {
      const entry = await fetchBookingEntry();
      if (!entry.canContinue) {
        wx.redirectTo({
          url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(bookingFlowPaths.service)}`,
        });
        return;
      }
      const [petResponse, catalog] = await Promise.all([
        fetchPetProfile(draft.petId!),
        fetchStorefrontCatalog(),
      ]);
      const pet = petResponse.pet;
      const services = catalog.primaryServices
        .filter((service) => service.applicableSpecies.includes(pet.species))
        .map((service) => {
          const quote = quoteBookingSelection(pet, catalog, service.id, []);
          return {
            id: service.id,
            name: service.name,
            priceLabel: formatCny(quote.totalPriceCents),
            durationLabel: `${quote.serviceDurationMinutes} 分钟`,
          };
        });
      const selectedServiceId = services.some((service) => service.id === draft.primaryServiceId)
        ? draft.primaryServiceId!
        : "";
      this.setData({
        pageState: "ready",
        pet,
        petSummary: `${pet.name} · ${pet.weightKg}kg · ${petSizeLabel(pet.petSize)}`,
        catalog,
        services,
        selectedServiceId,
        selectedAddonIds: selectedServiceId ? draft.addonIds : [],
        errorMessage: "",
      });
      this.refreshQuote();
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "服务选择加载失败，请重试。",
      });
    }
  },
  selectService(event: WechatMiniprogram.BaseEvent) {
    const serviceId = event.currentTarget.dataset.id as unknown;
    if (typeof serviceId !== "string") return;
    chooseBookingService(serviceId, []);
    this.setData({ selectedServiceId: serviceId, selectedAddonIds: [] });
    this.refreshQuote();
  },
  toggleAddon(event: WechatMiniprogram.BaseEvent) {
    const addonId = event.currentTarget.dataset.id as unknown;
    if (typeof addonId !== "string" || !this.data.selectedServiceId) return;
    const selectedAddonIds = this.data.selectedAddonIds.includes(addonId)
      ? this.data.selectedAddonIds.filter((id) => id !== addonId)
      : [...this.data.selectedAddonIds, addonId];
    chooseBookingService(this.data.selectedServiceId, selectedAddonIds);
    this.setData({ selectedAddonIds });
    this.refreshQuote();
  },
  refreshQuote() {
    const { pet, catalog, selectedServiceId, selectedAddonIds } = this.data;
    if (!pet || !catalog || !selectedServiceId) {
      this.setData({ quote: null, addons: [], totalPriceLabel: "¥0" });
      return;
    }
    const quote = quoteBookingSelection(pet, catalog, selectedServiceId, selectedAddonIds);
    const service = catalog.primaryServices.find((item) => item.id === selectedServiceId)!;
    const availableAddonIds = new Set(service.availableAddonIds);
    const addons = catalog.addons
      .filter(
        (addon) => availableAddonIds.has(addon.id) && addon.applicableSpecies.includes(pet.species),
      )
      .map((addon) => {
        const line = quoteBookingSelection(pet, catalog, selectedServiceId, [addon.id]).addons[0]!;
        return {
          id: addon.id,
          name: addon.name,
          detail: `+${formatCny(line.priceCents)} · +${line.durationMinutes} 分钟`,
          selected: selectedAddonIds.includes(addon.id),
        };
      });
    this.setData({ quote, addons, totalPriceLabel: formatCny(quote.totalPriceCents) });
  },
  continueFlow() {
    if (this.data.quote) wx.navigateTo({ url: bookingFlowPaths.staff });
  },
  recover() {
    wx.redirectTo({ url: this.data.recoveryPath || bookingFlowPaths.pet });
  },
  retry() {
    void this.loadOptions();
  },
  chooseCustomer() {
    openCustomerSelector(bookingFlowPaths.service);
  },
});
