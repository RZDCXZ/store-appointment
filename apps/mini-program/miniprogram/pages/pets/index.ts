import type { PetProfile } from "@rongguang/contracts";

import { CustomerApiError } from "../../services/customer-api";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import {
  archivePetProfile,
  fetchPetProfiles,
  loadPetPhotoPath,
  restorePetProfile,
} from "../../services/pet-profile-api";
import {
  formatShanghaiDateTime,
  petFormPath,
  petSizeLabel,
} from "../../services/pet-profile-presentation";
import { fetchBookingEntry } from "../../services/privacy-consent-api";

type PageState = "loading" | "ready" | "empty" | "error" | "forbidden" | "auth";

interface PetCard extends PetProfile {
  photoUrl: string;
  speciesLabel: string;
  petSizeLabel: string;
  profileLine: string;
  futureBookingLabel: string;
}

async function toPetCard(pet: PetProfile): Promise<PetCard> {
  const speciesLabel = pet.species === "dog" ? "犬" : "猫";
  const sizeLabel = petSizeLabel(pet.petSize);
  return {
    ...pet,
    photoUrl: await loadPetPhotoPath(pet.photoPath),
    speciesLabel,
    petSizeLabel: sizeLabel,
    profileLine: `${speciesLabel}${pet.breed ? ` · ${pet.breed}` : ""} · ${pet.weightKg}kg · ${sizeLabel}`,
    futureBookingLabel: pet.futureBooking
      ? `${formatShanghaiDateTime(pet.futureBooking.startsAt)} 有预约`
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

    if (!(await this.ensureBookingConsent())) {
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
      const [activePets, archivedPets] = await Promise.all([
        Promise.all(response.active.map(toPetCard)),
        Promise.all(response.archived.map(toPetCard)),
      ]);
      this.setData({
        activePets,
        archivedPets,
        pageState: activePets.length + archivedPets.length > 0 ? "ready" : "empty",
        refreshing: false,
      });
    } catch (error) {
      const forbidden = error instanceof CustomerApiError && error.statusCode === 403;
      this.setData({
        pageState: forbidden ? "forbidden" : hasData ? "ready" : "error",
        queryError: error instanceof Error ? error.message : "宠物档案加载失败，请重试。",
        refreshing: false,
      });
    }
  },
  async ensureBookingConsent(): Promise<boolean> {
    if (!this.data.bookingMode) {
      return true;
    }

    try {
      const entry = await fetchBookingEntry();

      if (entry.canContinue) {
        return true;
      }

      const returnTo = "/pages/pets/index?mode=booking";
      wx.redirectTo({
        url: `/pages/privacy-consent/index?returnTo=${encodeURIComponent(returnTo)}`,
      });
      return false;
    } catch (error) {
      this.setData({
        pageState: "error",
        queryError: error instanceof Error ? error.message : "预约入口检查失败，请稍后重试。",
        refreshing: false,
      });
      return false;
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
        error instanceof CustomerApiError && error.code === "PET_HAS_FUTURE_BOOKING"
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
