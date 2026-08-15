import { describe, expect, it } from "vitest";
import type { PrimaryService, StorefrontCatalogResponse } from "@rongguang/contracts";

import {
  fetchStorefrontCatalog,
  type CatalogRequestClient,
} from "../miniprogram/services/storefront-catalog";
import {
  classifyPetSize,
  formatCny,
  getStoreBusinessSummary,
  selectServiceSpecification,
} from "../miniprogram/services/storefront-presentation";

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

const completeCatalog: StorefrontCatalogResponse = {
  store: {
    brandName: "茸光宠物洗护",
    city: "上海",
    demoNow: "2026-08-13T02:50:00.000Z",
    address: "上海市徐汇区暖茸路 18 号",
    contactPhone: "021-6488 2618",
    timeZone: "Asia/Shanghai",
    weeklyBusinessHours: [
      { weekday: 0, label: "周日", openAt: "09:30", closeAt: "19:00" },
      { weekday: 1, label: "周一", openAt: null, closeAt: null },
      { weekday: 2, label: "周二", openAt: "09:30", closeAt: "19:00" },
      { weekday: 3, label: "周三", openAt: "09:30", closeAt: "19:00" },
      { weekday: 4, label: "周四", openAt: "09:30", closeAt: "19:00" },
      { weekday: 5, label: "周五", openAt: "09:30", closeAt: "19:00" },
      { weekday: 6, label: "周六", openAt: "09:30", closeAt: "19:00" },
    ],
  },
  primaryServices: [dogBasicCare],
  addons: [],
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

  it("拒绝缺少任一体型规格的成功响应", async () => {
    const incompleteSpecificationClient: CatalogRequestClient = {
      request(options) {
        options.success({
          statusCode: 200,
          data: {
            ...completeCatalog,
            primaryServices: [
              {
                ...dogBasicCare,
                specifications: dogBasicCare.specifications.slice(0, 2),
              },
            ],
          },
        });
      },
    };

    await expect(
      fetchStorefrontCatalog(incompleteSpecificationClient, "http://api.local"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
  });

  it("拒绝缺少任一天营业时间的成功响应", async () => {
    const incompleteHoursClient: CatalogRequestClient = {
      request(options) {
        options.success({
          statusCode: 200,
          data: {
            ...completeCatalog,
            store: {
              ...completeCatalog.store,
              weeklyBusinessHours: completeCatalog.store.weeklyBusinessHours.slice(0, 6),
            },
          },
        });
      },
    };

    await expect(
      fetchStorefrontCatalog(incompleteHoursClient, "http://api.local"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
  });

  it("按演示时间和当天排班生成闭店摘要", () => {
    const store = {
      ...completeCatalog.store,
      weeklyBusinessHours: completeCatalog.store.weeklyBusinessHours.map((hours) =>
        hours.weekday === 0 ? { ...hours, openAt: null, closeAt: null } : hours,
      ),
    };

    expect(getStoreBusinessSummary(store, new Date("2026-08-16T02:50:00.000Z"))).toEqual({
      statusLabel: "今日闭店",
      hoursLabel: "周日固定闭店",
      dateLabel: "8月16日 周日",
      isOpen: false,
    });
  });

  it("拒绝主要服务引用不存在的增项", async () => {
    const danglingAddonClient: CatalogRequestClient = {
      request(options) {
        options.success({
          statusCode: 200,
          data: {
            ...completeCatalog,
            primaryServices: [{ ...dogBasicCare, availableAddonIds: ["missing-addon"] }],
          },
        });
      },
    };

    await expect(
      fetchStorefrontCatalog(danglingAddonClient, "http://api.local"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", retryable: true });
  });
});
