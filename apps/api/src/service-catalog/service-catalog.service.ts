import { Injectable } from "@nestjs/common";
import type { StorefrontCatalogResponse } from "@rongguang/contracts";

const weeklyBusinessHours: StorefrontCatalogResponse["store"]["weeklyBusinessHours"] = [
  { weekday: 1, label: "周一", openAt: null, closeAt: null },
  { weekday: 2, label: "周二", openAt: "09:30", closeAt: "19:00" },
  { weekday: 3, label: "周三", openAt: "09:30", closeAt: "19:00" },
  { weekday: 4, label: "周四", openAt: "09:30", closeAt: "19:00" },
  { weekday: 5, label: "周五", openAt: "09:30", closeAt: "19:00" },
  { weekday: 6, label: "周六", openAt: "09:30", closeAt: "19:00" },
  { weekday: 0, label: "周日", openAt: "09:30", closeAt: "19:00" },
];

const storefrontCatalog: StorefrontCatalogResponse = {
  store: {
    brandName: "茸光宠物洗护",
    city: "上海",
    address: "上海市徐汇区暖茸路 18 号",
    contactPhone: "021-6488 2618",
    timeZone: "Asia/Shanghai",
    weeklyBusinessHours,
  },
  primaryServices: [
    {
      id: "dog-basic-care",
      name: "犬基础洗护",
      description: "洗护、基础梳理、耳部与眼周清洁。",
      applicableSpecies: ["dog"],
      availableAddonIds: ["nail-care", "deshedding-care", "oral-care"],
      specifications: [
        { petSize: "small", priceCents: 12_800, durationMinutes: 60 },
        { petSize: "medium", priceCents: 16_800, durationMinutes: 90 },
        { petSize: "large", priceCents: 22_800, durationMinutes: 120 },
      ],
    },
    {
      id: "dog-styling",
      name: "犬造型美容",
      description: "在完整洗护基础上完成犬只造型修剪。",
      applicableSpecies: ["dog"],
      availableAddonIds: ["nail-care", "deshedding-care", "oral-care"],
      specifications: [
        { petSize: "small", priceCents: 22_800, durationMinutes: 120 },
        { petSize: "medium", priceCents: 32_800, durationMinutes: 150 },
        { petSize: "large", priceCents: 45_800, durationMinutes: 180 },
      ],
    },
    {
      id: "cat-care",
      name: "猫咪洗护",
      description: "为猫咪提供低刺激洗护、梳理与基础清洁。",
      applicableSpecies: ["cat"],
      availableAddonIds: ["nail-care", "deshedding-care", "oral-care"],
      specifications: [
        { petSize: "small", priceCents: 16_800, durationMinutes: 90 },
        { petSize: "medium", priceCents: 21_800, durationMinutes: 120 },
        { petSize: "large", priceCents: 28_800, durationMinutes: 150 },
      ],
    },
  ],
  addons: [
    {
      id: "nail-care",
      name: "修甲护理",
      description: "修整趾甲并检查足部状态。",
      applicableSpecies: ["dog", "cat"],
      specifications: [
        { petSize: "small", priceCents: 3_000, durationMinutes: 15 },
        { petSize: "medium", priceCents: 3_000, durationMinutes: 15 },
        { petSize: "large", priceCents: 3_000, durationMinutes: 15 },
      ],
    },
    {
      id: "deshedding-care",
      name: "除废毛护理",
      description: "按体型增加梳理时间，温和去除浮毛。",
      applicableSpecies: ["dog", "cat"],
      specifications: [
        { petSize: "small", priceCents: 6_000, durationMinutes: 30 },
        { petSize: "medium", priceCents: 9_000, durationMinutes: 45 },
        { petSize: "large", priceCents: 12_000, durationMinutes: 60 },
      ],
    },
    {
      id: "oral-care",
      name: "口腔清洁",
      description: "完成非医疗性质的日常口腔清洁。",
      applicableSpecies: ["dog", "cat"],
      specifications: [
        { petSize: "small", priceCents: 3_500, durationMinutes: 15 },
        { petSize: "medium", priceCents: 3_500, durationMinutes: 15 },
        { petSize: "large", priceCents: 3_500, durationMinutes: 15 },
      ],
    },
  ],
};

@Injectable()
export class ServiceCatalogService {
  getStorefront(): StorefrontCatalogResponse {
    return storefrontCatalog;
  }
}
