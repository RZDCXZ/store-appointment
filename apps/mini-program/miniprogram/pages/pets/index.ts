import type { PetProfile } from "@rongguang/contracts";

import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import {
  archivePetProfile,
  displayPhotoPath,
  fetchPetProfiles,
  PetProfileApiError,
  restorePetProfile,
} from "../../services/pet-profile-api";
import { petFormPath } from "../../services/pet-profile-presentation";

type PageState = "loading" | "ready" | "empty" | "error" | "forbidden" | "auth";

interface PetCard extends PetProfile {
  photoUrl: string;
  speciesLabel: string;
  petSizeLabel: string;
  profileLine: string;
  futureBookingLabel: string;
}

const petSizeLabels = { small: "小型", medium: "中型", large: "大型" } as const;

function formatBookingTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const month = local.getUTCMonth() + 1;
  const day = local.getUTCDate();
  const hours = String(local.getUTCHours()).padStart(2, "0");
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hours}:${minutes}`;
}

function toPetCard(pet: PetProfile): PetCard {
  const speciesLabel = pet.species === "dog" ? "犬" : "猫";
  const petSizeLabel = petSizeLabels[pet.petSize];
  return {
    ...pet,
    photoUrl: displayPhotoPath(pet.photoPath),
    speciesLabel,
    petSizeLabel,
    profileLine: `${speciesLabel}${pet.breed ? ` · ${pet.breed}` : ""} · ${pet.weightKg}kg · ${petSizeLabel}`,
    futureBookingLabel: pet.futureBooking
      ? `${formatBookingTime(pet.futureBooking.startsAt)} 有预约`
      : "",
  };
}

Page({
  data: {
    pageState: "loading" as PageState,
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    bookingMode: false,
    activePets: [] as PetCard[],
    archivedPets: [] as PetCard[],
    queryError: "",
    actionError: "",
    refreshing: false,
    actionPetId: "",
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ bookingMode: options.mode === "booking" });
  },
  onShow() {
    void this.loadPets();
  },
  async loadPets() {
    const pagePath = this.data.bookingMode ? "/pages/pets/index?mode=booking" : "/pages/pets/index";
    const context = await loadCustomerContext(pagePath);

    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ authState: context.kind, pageState: "auth", refreshing: false });
      return;
    }

    const hasData = this.data.activePets.length + this.data.archivedPets.length > 0;
    this.setData({
      authState: context.kind,
      pageState: hasData ? this.data.pageState : "loading",
      queryError: "",
      refreshing: hasData,
    });

    try {
      const response = await fetchPetProfiles();
      const activePets = response.active.map(toPetCard);
      const archivedPets = response.archived.map(toPetCard);
      this.setData({
        activePets,
        archivedPets,
        pageState: activePets.length + archivedPets.length > 0 ? "ready" : "empty",
        refreshing: false,
      });
    } catch (error) {
      const forbidden = error instanceof PetProfileApiError && error.statusCode === 403;
      this.setData({
        pageState: forbidden ? "forbidden" : hasData ? "ready" : "error",
        queryError: error instanceof Error ? error.message : "宠物档案加载失败，请重试。",
        refreshing: false,
      });
    }
  },
  chooseCustomer() {
    openCustomerSelector(
      this.data.bookingMode ? "/pages/pets/index?mode=booking" : "/pages/pets/index",
    );
  },
  addPet() {
    wx.navigateTo({ url: petFormPath() });
  },
  editPet(event: WechatMiniprogram.BaseEvent) {
    const petId = event.currentTarget.dataset.id as unknown;
    if (typeof petId === "string") {
      wx.navigateTo({ url: petFormPath(petId) });
    }
  },
  retry() {
    void this.loadPets();
  },
  archivePet(event: WechatMiniprogram.BaseEvent) {
    const petId = event.currentTarget.dataset.id as unknown;
    if (typeof petId !== "string" || this.data.actionPetId) {
      return;
    }

    wx.showModal({
      title: "归档这只宠物？",
      content: "归档后不会出现在新预约选择中，之后仍可恢复。",
      confirmText: "归档",
      confirmColor: "#9b4d45",
      success: (result) => {
        if (result.confirm) {
          void this.performArchive(petId);
        }
      },
    });
  },
  async performArchive(petId: string) {
    this.setData({ actionPetId: petId, actionError: "" });
    try {
      await archivePetProfile(petId);
      await this.loadPets();
      wx.showToast({ title: "宠物已归档", icon: "success" });
    } catch (error) {
      const detail =
        error instanceof PetProfileApiError && error.code === "PET_HAS_FUTURE_BOOKING"
          ? "请先处理卡片中标出的未来预约。"
          : "";
      this.setData({
        actionError: `${error instanceof Error ? error.message : "归档失败，请重试。"}${detail}`,
      });
    } finally {
      this.setData({ actionPetId: "" });
    }
  },
  async restorePet(event: WechatMiniprogram.BaseEvent) {
    const petId = event.currentTarget.dataset.id as unknown;
    if (typeof petId !== "string" || this.data.actionPetId) {
      return;
    }

    this.setData({ actionPetId: petId, actionError: "" });
    try {
      await restorePetProfile(petId);
      await this.loadPets();
      wx.showToast({ title: "宠物已恢复", icon: "success" });
    } catch (error) {
      this.setData({
        actionError: error instanceof Error ? error.message : "恢复失败，请重试。",
      });
    } finally {
      this.setData({ actionPetId: "" });
    }
  },
});
