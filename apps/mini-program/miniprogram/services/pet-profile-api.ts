import type {
  PetListResponse,
  PetPhotoUploadResponse,
  PetProfileInput,
  PetProfileResponse,
} from "@rongguang/contracts";

import {
  CustomerApiError,
  requestCustomerApi,
  resolveCustomerApiContext,
  type CustomerApiContext,
  type CustomerApiRequestClient,
} from "./customer-api";

export function fetchPetProfiles(
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PetListResponse> {
  return requestCustomerApi("/miniapp/pets", "GET", undefined, client, context);
}

export function fetchPetProfile(
  petId: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PetProfileResponse> {
  return requestCustomerApi(
    `/miniapp/pets/${encodeURIComponent(petId)}`,
    "GET",
    undefined,
    client,
    context,
  );
}

export function savePetProfile(
  petId: string | null,
  input: PetProfileInput,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PetProfileResponse> {
  const path = petId ? `/miniapp/pets/${encodeURIComponent(petId)}` : "/miniapp/pets";
  return requestCustomerApi(path, petId ? "PUT" : "POST", input, client, context);
}

export function archivePetProfile(
  petId: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PetProfileResponse> {
  return requestCustomerApi(
    `/miniapp/pets/${encodeURIComponent(petId)}/archive`,
    "POST",
    undefined,
    client,
    context,
  );
}

export function restorePetProfile(
  petId: string,
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PetProfileResponse> {
  return requestCustomerApi(
    `/miniapp/pets/${encodeURIComponent(petId)}/restore`,
    "POST",
    undefined,
    client,
    context,
  );
}

export function uploadPetPhoto(
  input: { fileName: string; mimeType: "image/jpeg" | "image/png"; base64Data: string },
  client?: CustomerApiRequestClient,
  context?: CustomerApiContext,
): Promise<PetPhotoUploadResponse> {
  return requestCustomerApi("/miniapp/pet-photos", "POST", input, client, context);
}

export function displayPhotoPath(photoPath: string | null): string {
  if (!photoPath) {
    return "/assets/brand/rongguang-hero-shiba.jpg";
  }

  if (photoPath.startsWith("/miniapp/pet-photos/")) {
    return "/assets/brand/rongguang-hero-shiba.jpg";
  }

  return photoPath;
}

export function loadPetPhotoPath(
  photoPath: string | null,
  context?: CustomerApiContext,
): Promise<string> {
  if (!photoPath?.startsWith("/miniapp/pet-photos/")) {
    return Promise.resolve(displayPhotoPath(photoPath));
  }

  const resolvedContext = resolveCustomerApiContext(context);

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${resolvedContext.apiBaseUrl}${photoPath}`,
      header: { Authorization: `Bearer ${resolvedContext.accessToken}` },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.tempFilePath);
          return;
        }

        reject(
          new CustomerApiError(response.statusCode, "PHOTO_DOWNLOAD_FAILED", "宠物照片加载失败。"),
        );
      },
      fail() {
        reject(new CustomerApiError(0, "NETWORK_ERROR", "宠物照片暂时无法加载。"));
      },
    });
  });
}
