import { describe, expect, it } from "vitest";
import type { PrimaryService } from "@rongguang/contracts";

import {
  classifyPetSize,
  fetchStorefrontCatalog,
  formatCny,
  selectServiceSpecification,
  type CatalogRequestClient,
} from "../miniprogram/services/storefront-catalog";

const dogBasicCare: PrimaryService = {
  id: "dog-basic-care",
  name: "犬基础洗护",
  description: "洗护、基础梳理、耳部与眼周清洁。",
  applicableSpecies: ["dog"],
  availableAddonIds: [],
  specifications: [
    { petSize: "small", priceCents: 12_800, durationMinutes: 60 },
    { petSize: "medium", priceCents: 16_800, durationMinutes: 90 },
    { petSize: "large", priceCents: 22_800, durationMinutes: 120 },
  ],
};

describe("小程序服务目录逻辑", () => {
  it("严格按 10kg 与 25kg 边界确定体型", () => {
    expect([9.99, 10, 10.01, 25, 25.01].map(classifyPetSize)).toEqual([
      "small",
      "small",
      "medium",
      "medium",
      "large",
    ]);
  });

  it("按宠物种类和体重选择唯一的确定服务规格", () => {
    expect(selectServiceSpecification(dogBasicCare, "dog", 10.01)).toEqual({
      petSize: "medium",
      priceCents: 16_800,
      durationMinutes: 90,
    });
  });

  it("只从人民币分格式化确定金额", () => {
    expect([formatCny(12_800), formatCny(12_850)]).toEqual(["¥128", "¥128.50"]);
  });

  it("把网络失败与服务端失败映射为不同的可重试目录错误", async () => {
    const networkClient: CatalogRequestClient = {
      request(options) {
        options.fail();
      },
    };
    const serverClient: CatalogRequestClient = {
      request(options) {
        options.success({ statusCode: 503, data: { code: "SERVICE_UNAVAILABLE" } });
      },
    };

    const errors = await Promise.all([
      fetchStorefrontCatalog(networkClient, "http://api.local").catch((error: unknown) => error),
      fetchStorefrontCatalog(serverClient, "http://api.local").catch((error: unknown) => error),
    ]);

    expect(errors).toEqual([
      expect.objectContaining({ code: "NETWORK_ERROR", retryable: true }),
      expect.objectContaining({ code: "SERVER_ERROR", retryable: true }),
    ]);
  });

  it("把不完整的成功响应映射为查询错误而不是无服务", async () => {
    const invalidResponseClient: CatalogRequestClient = {
      request(options) {
        options.success({ statusCode: 200, data: { primaryServices: [] } });
      },
    };

    await expect(
      fetchStorefrontCatalog(invalidResponseClient, "http://api.local"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
  });
});
