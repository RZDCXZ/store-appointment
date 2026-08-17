import type { PetProfile } from "@rongguang/contracts";

import { bookingFlowPaths, chooseBookingPet, readBookingDraft } from "../../services/booking-draft";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import { fetchPetProfiles, loadPetPhotoPath } from "../../services/pet-profile-api";
import { petSizeLabel } from "../../services/pet-profile-presentation";
import { fetchBookingEntry } from "../../services/privacy-consent-api";

type PageState = "loading" | "ready" | "empty" | "error" | "auth";

interface BookingPetCard extends PetProfile {
  photoUrl: string;
  profileLine: string;
  careTagsLabel: string;
}

Page({
  data: {
    pageState: "loading" as PageState,
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    pets: [] as BookingPetCard[],
    selectedPetId: "",
    errorMessage: "",
  },
  onShow() {
    void this.loadPets();
  },
  async loadPets() {
    const context = await loadCustomerContext(bookingFlowPaths.pet);
    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ pageState: "auth", authState: context.kind });
      return;
    }

    try {
      const entry = await fetchBookingEntry();
      if (!entry.canContinue) {
        wx.redirectTo({
          url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(bookingFlowPaths.pet)}`,
        });
        return;
      }
      const response = await fetchPetProfiles();
      const pets = await Promise.all(
        response.active.map(async (pet) => ({
          ...pet,
          photoUrl: await loadPetPhotoPath(pet.photoPath),
          profileLine: `${pet.species === "dog" ? "犬" : "猫"}${pet.breed ? ` · ${pet.breed}` : ""} · ${pet.weightKg}kg · ${petSizeLabel(pet.petSize)}`,
          careTagsLabel: pet.careTags.join("、"),
        })),
      );
      const draft = readBookingDraft();
      this.setData({
        pageState: pets.length > 0 ? "ready" : "empty",
        authState: context.kind,
        pets,
        selectedPetId: pets.some((pet) => pet.id === draft.petId) ? (draft.petId ?? "") : "",
        errorMessage: "",
      });
    } catch (error) {
      this.setData({
        pageState: "error",
        errorMessage: error instanceof Error ? error.message : "宠物档案加载失败，请重试。",
      });
    }
  },
  selectPet(event: WechatMiniprogram.BaseEvent) {
    const petId = event.currentTarget.dataset.id as unknown;
    if (typeof petId !== "string") return;
    chooseBookingPet(petId);
    this.setData({ selectedPetId: petId });
  },
  continueFlow() {
    if (!this.data.selectedPetId) return;
    wx.navigateTo({ url: bookingFlowPaths.service });
  },
  addPet() {
    wx.navigateTo({ url: "/pages/pet-form/index" });
  },
  retry() {
    void this.loadPets();
  },
  chooseCustomer() {
    openCustomerSelector(bookingFlowPaths.pet);
  },
});
