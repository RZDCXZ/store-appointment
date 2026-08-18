import type { PetCoatType, PetProfileInput, PetSex, PetSpecies } from "@rongguang/contracts";

import { CustomerApiError } from "../../services/customer-api";
import { loadCustomerContext, openCustomerSelector } from "../../services/customer-session";
import {
  archivePetProfile,
  fetchPetProfile,
  loadPetPhotoPath,
  restorePetProfile,
  savePetProfile,
  uploadPetPhoto,
} from "../../services/pet-profile-api";
import {
  demoDateInShanghai,
  formatShanghaiDateTime,
  readPetFormRoute,
  sizeSummaryForWeightInput,
} from "../../services/pet-profile-presentation";
import { fetchStorefrontCatalog } from "../../services/storefront-catalog";

type PageState = "loading" | "ready" | "error" | "forbidden" | "auth";

// 微信原生编译器不会把 workspace 包打进小程序运行时；保持值常量在端内，类型仍由 contracts 约束。
const petCareTags = [
  "怕吹风",
  "对陌生犬敏感",
  "不喜欢碰脚",
  "易紧张",
  "需要慢速吹干",
  "耳部需轻柔",
] as const;

interface PetFormData {
  name: string;
  species: PetSpecies;
  weightKg: string;
  breed: string;
  sex: PetSex | "";
  birthDate: string;
  coatType: PetCoatType | "";
  careNotes: string;
}

const emptyForm: PetFormData = {
  name: "",
  species: "dog",
  weightKg: "",
  breed: "",
  sex: "",
  birthDate: "",
  coatType: "",
  careNotes: "",
};

function readFileAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: "base64",
      success(result) {
        if (typeof result.data === "string") {
          resolve(result.data);
        } else {
          reject(new Error("无法读取这张照片，请重新选择。"));
        }
      },
      fail() {
        reject(new Error("无法读取这张照片，请重新选择。"));
      },
    });
  });
}

Page({
  data: {
    pageState: "loading" as PageState,
    authState: "loading" as "active" | "expired" | "missing" | "unavailable" | "loading",
    petId: null as string | null,
    isEditing: false,
    isArchived: false,
    futureBookingLabel: "",
    maximumBirthDate: "",
    form: { ...emptyForm },
    selectedTags: [] as string[],
    tagOptions: petCareTags.map((label) => ({ label, selected: false })),
    coatTypeOptions: ["暂不填写", "短毛", "长毛", "双层毛", "卷毛", "无毛", "其他"],
    coatTypeIndex: 0,
    sizeSummary: "",
    photoId: null as string | null,
    photoPreview: "",
    pendingPhotoPath: "",
    uploadingPhoto: false,
    photoError: "",
    saving: false,
    fieldErrors: {} as Record<string, string>,
    submitError: "",
    loadError: "",
    archiving: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    void this.initialize(options);
  },
  async initialize(options: Record<string, string | undefined>) {
    const { petId } = readPetFormRoute(options);
    const pagePath = petId
      ? `/pages/pet-form/index?id=${encodeURIComponent(petId)}`
      : "/pages/pet-form/index";
    this.setData({ petId, isEditing: Boolean(petId), pageState: "loading" });
    const context = await loadCustomerContext(pagePath);

    if (context.kind === "expired" || context.kind === "missing") {
      this.setData({ authState: context.kind, pageState: "auth" });
      return;
    }

    this.setData({ authState: context.kind });

    try {
      const catalog = await fetchStorefrontCatalog();
      this.setData({ maximumBirthDate: demoDateInShanghai(catalog.store.demoNow) });

      if (!petId) {
        this.setData({ pageState: "ready" });
        return;
      }

      const { pet } = await fetchPetProfile(petId);
      const photoPreview = await loadPetPhotoPath(pet.photoPath);
      const selectedTags = [...pet.careTags];
      this.setData({
        pageState: "ready",
        isArchived: pet.archivedAt !== null,
        futureBookingLabel: pet.futureBooking
          ? `关联预约：${formatShanghaiDateTime(pet.futureBooking.startsAt)}`
          : "",
        form: {
          name: pet.name,
          species: pet.species,
          weightKg: String(pet.weightKg),
          breed: pet.breed ?? "",
          sex: pet.sex ?? "",
          birthDate: pet.birthDate ?? "",
          coatType: pet.coatType ?? "",
          careNotes: pet.careNotes ?? "",
        },
        selectedTags,
        tagOptions: petCareTags.map((label) => ({ label, selected: selectedTags.includes(label) })),
        coatTypeIndex: ["", "short", "long", "double", "curly", "hairless", "other"].indexOf(
          pet.coatType ?? "",
        ),
        sizeSummary: sizeSummaryForWeightInput(String(pet.weightKg)) ?? "",
        photoId: pet.photoId,
        photoPreview,
      });
    } catch (error) {
      const forbidden =
        error instanceof CustomerApiError &&
        (error.statusCode === 403 || error.code === "PET_NOT_FOUND");
      this.setData({
        pageState: forbidden ? "forbidden" : "error",
        loadError: error instanceof Error ? error.message : "宠物档案加载失败，请重试。",
      });
    }
  },
  chooseCustomer() {
    const pagePath = this.data.petId
      ? `/pages/pet-form/index?id=${encodeURIComponent(this.data.petId)}`
      : "/pages/pet-form/index";
    openCustomerSelector(pagePath);
  },
  retryLoad() {
    void this.initialize(this.data.petId ? { id: this.data.petId } : {});
  },
  onTextInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as unknown;
    if (typeof field === "string") {
      this.setData({ [`form.${field}`]: event.detail.value });
    }
  },
  onWeightInput(event: WechatMiniprogram.Input) {
    const weightKg = event.detail.value;
    this.setData({
      "form.weightKg": weightKg,
      sizeSummary: sizeSummaryForWeightInput(weightKg) ?? "",
    });
  },
  onSpeciesChange(event: WechatMiniprogram.RadioGroupChange) {
    this.setData({ "form.species": event.detail.value });
  },
  onSexChange(event: WechatMiniprogram.RadioGroupChange) {
    this.setData({ "form.sex": event.detail.value });
  },
  onCoatTypeChange(event: WechatMiniprogram.PickerChange) {
    const values: Array<PetCoatType | ""> = [
      "",
      "short",
      "long",
      "double",
      "curly",
      "hairless",
      "other",
    ];
    const coatTypeIndex = Number(event.detail.value);
    this.setData({
      "form.coatType": values[coatTypeIndex] ?? "",
      coatTypeIndex,
    });
  },
  onBirthDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ "form.birthDate": String(event.detail.value) });
  },
  clearBirthDate() {
    this.setData({ "form.birthDate": "" });
  },
  toggleTag(event: WechatMiniprogram.BaseEvent) {
    const tag = event.currentTarget.dataset.tag as unknown;
    if (typeof tag !== "string") {
      return;
    }

    const selectedTags = this.data.selectedTags.includes(tag)
      ? this.data.selectedTags.filter((value) => value !== tag)
      : [...this.data.selectedTags, tag];
    this.setData({
      selectedTags,
      tagOptions: petCareTags.map((label) => ({ label, selected: selectedTags.includes(label) })),
    });
  },
  choosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      success: (result) => {
        const file = result.tempFiles[0];
        if (!file) {
          return;
        }

        this.setData({ pendingPhotoPath: file.tempFilePath, photoPreview: file.tempFilePath });
        void this.uploadPendingPhoto();
      },
    });
  },
  async uploadPendingPhoto() {
    const filePath = this.data.pendingPhotoPath;
    if (!filePath || this.data.uploadingPhoto) {
      return;
    }

    this.setData({ uploadingPhoto: true, photoError: "" });
    try {
      const base64Data = await readFileAsBase64(filePath);
      const mimeType = filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const { photo } = await uploadPetPhoto({
        fileName: filePath.split("/").pop() ?? "pet-photo",
        mimeType,
        base64Data,
      });
      this.setData({ photoId: photo.id, pendingPhotoPath: "", photoError: "" });
    } catch (error) {
      this.setData({
        photoError: error instanceof Error ? error.message : "照片上传失败，请重试。",
      });
    } finally {
      this.setData({ uploadingPhoto: false });
    }
  },
  retryPhotoUpload() {
    void this.uploadPendingPhoto();
  },
  async submit() {
    if (this.data.saving || this.data.uploadingPhoto) {
      return;
    }

    const input: PetProfileInput = {
      name: this.data.form.name,
      species: this.data.form.species,
      weightKg: Number(this.data.form.weightKg),
      breed: this.data.form.breed || null,
      sex: this.data.form.sex || null,
      birthDate: this.data.form.birthDate || null,
      coatType: this.data.form.coatType || null,
      photoId: this.data.photoId,
      careTags: this.data.selectedTags as PetProfileInput["careTags"],
      careNotes: this.data.form.careNotes || null,
    };
    this.setData({ saving: true, fieldErrors: {}, submitError: "" });

    try {
      await savePetProfile(this.data.petId, input);
      wx.showToast({ title: "宠物档案已保存", icon: "success" });
      wx.navigateBack();
    } catch (error) {
      this.setData({
        fieldErrors: error instanceof CustomerApiError ? error.fieldErrors : {},
        submitError: error instanceof Error ? error.message : "保存失败，表单内容已保留。",
      });
    } finally {
      this.setData({ saving: false });
    }
  },
  archiveOrRestore() {
    if (!this.data.petId || this.data.archiving) {
      return;
    }

    if (this.data.isArchived) {
      void this.changeArchivedState(true);
      return;
    }

    wx.showModal({
      title: "归档这只宠物？",
      content: this.data.futureBookingLabel || "归档后不会出现在新预约选择中，之后仍可恢复。",
      confirmText: "归档",
      confirmColor: "#9b4d45",
      success: (result) => {
        if (result.confirm) {
          void this.changeArchivedState(false);
        }
      },
    });
  },
  async changeArchivedState(restore: boolean) {
    const petId = this.data.petId;
    if (!petId) {
      return;
    }

    this.setData({ archiving: true, submitError: "" });
    try {
      const { pet } = restore ? await restorePetProfile(petId) : await archivePetProfile(petId);
      this.setData({ isArchived: pet.archivedAt !== null });
      wx.showToast({ title: restore ? "宠物已恢复" : "宠物已归档", icon: "success" });
    } catch (error) {
      this.setData({ submitError: error instanceof Error ? error.message : "操作失败，请重试。" });
    } finally {
      this.setData({ archiving: false });
    }
  },
});
