import { describe, expect, it, vi } from "vitest";

import {
  CustomerApiError,
  type CustomerApiRequestClient,
} from "../miniprogram/services/customer-api";
import {
  fetchPetProfiles,
  loadPetPhotoPath,
  savePetProfile,
} from "../miniprogram/services/pet-profile-api";
import { fetchBookingEntry } from "../miniprogram/services/privacy-consent-api";

const context = { apiBaseUrl: "http://api.local", accessToken: "signed-token" };

describe("宠物档案小程序 API", () => {
  it("只通过 Bearer 会话读取当前顾客的宠物列表", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client: CustomerApiRequestClient = {
      request(options) {
        requests.push(options as unknown as Record<string, unknown>);
        options.success({ statusCode: 200, data: { active: [], archived: [] } });
      },
    };

    await expect(fetchPetProfiles(client, context)).resolves.toEqual({ active: [], archived: [] });
    expect(requests[0]).toMatchObject({
      url: "http://api.local/miniapp/pets",
      method: "GET",
      header: { Authorization: "Bearer signed-token" },
    });
  });

  it("保留服务端字段错误，供表单关联展示且写入失败不伪装成成功", async () => {
    const client: CustomerApiRequestClient = {
      request(options) {
        options.success({
          statusCode: 400,
          data: {
            code: "VALIDATION_ERROR",
            message: "请检查宠物资料中的字段。",
            fieldErrors: { weightKg: "当前体重需为 0.1 至 99.99kg。" },
          },
        });
      },
    };

    const error = await savePetProfile(
      null,
      {
        name: "团子",
        species: "dog",
        weightKg: 0,
        breed: null,
        sex: null,
        birthDate: null,
        coatType: null,
        photoId: null,
        careTags: [],
        careNotes: null,
      },
      client,
      context,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CustomerApiError);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { weightKg: "当前体重需为 0.1 至 99.99kg。" },
    });
  });

  it("预约入口以服务端当前隐私版本门禁结果为准", async () => {
    const client: CustomerApiRequestClient = {
      request(options) {
        options.success({
          statusCode: 200,
          data: { canContinue: false, requiredPrivacyNoticeVersion: "2026.09" },
        });
      },
    };

    await expect(fetchBookingEntry(client, context)).resolves.toEqual({
      canContinue: false,
      requiredPrivacyNoticeVersion: "2026.09",
    });
  });

  it("下载上传照片时携带当前顾客 Bearer 会话", async () => {
    const downloadFile = vi.fn(
      (options: { success(response: { statusCode: number; tempFilePath: string }): void }) => {
        options.success({ statusCode: 200, tempFilePath: "/tmp/pet-photo.png" });
      },
    );
    vi.stubGlobal("wx", { downloadFile });

    await expect(loadPetPhotoPath("/miniapp/pet-photos/photo-1/content", context)).resolves.toBe(
      "/tmp/pet-photo.png",
    );
    expect(downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://api.local/miniapp/pet-photos/photo-1/content",
        header: { Authorization: "Bearer signed-token" },
      }),
    );
    vi.unstubAllGlobals();
  });
});
