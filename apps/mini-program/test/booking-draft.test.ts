import type { PetProfile, StorefrontCatalogResponse } from "@rongguang/contracts";
import { describe, expect, it } from "vitest";

import {
  bookingFlowPaths,
  clearBookingTime,
  chooseBookingPet,
  chooseBookingService,
  chooseBookingStaff,
  chooseBookingTime,
  emptyBookingDraft,
  ensureBookingIdempotencyKey,
  readBookingDraft,
  recoveryForBookingStep,
  type BookingDraftStorage,
} from "../miniprogram/services/booking-draft";
import { quoteBookingSelection } from "../miniprogram/services/booking-selection";
import { findRestorableBookingSlot } from "../miniprogram/services/booking-presentation";

function memoryStorage(initial: unknown = undefined): BookingDraftStorage {
  let value = initial;
  return {
    get() {
      return value;
    },
    set(next) {
      value = structuredClone(next);
    },
    remove() {
      value = undefined;
    },
  };
}

const pet = {
  id: "pet-tuanzi",
  name: "团子",
  species: "dog",
  weightKg: 8.4,
  petSize: "small",
} as PetProfile;

const catalog = {
  primaryServices: [
    {
      id: "dog-basic-care",
      name: "犬基础洗护",
      applicableSpecies: ["dog"],
      availableAddonIds: ["nail-care", "oral-care"],
      specifications: [{ petSize: "small", priceCents: 12800, durationMinutes: 60 }],
    },
  ],
  addons: [
    {
      id: "nail-care",
      name: "修甲护理",
      applicableSpecies: ["dog", "cat"],
      specifications: [{ petSize: "small", priceCents: 3000, durationMinutes: 15 }],
    },
    {
      id: "oral-care",
      name: "口腔清洁",
      applicableSpecies: ["dog", "cat"],
      specifications: [{ petSize: "small", priceCents: 3500, durationMinutes: 15 }],
    },
  ],
} as StorefrontCatalogResponse;

describe("预约草稿与服务组合", () => {
  it("草稿写入本地存储后可在刷新时恢复完整选择", () => {
    const storage = memoryStorage();
    chooseBookingPet("pet-tuanzi", storage);
    chooseBookingService("dog-basic-care", ["oral-care"], storage);
    chooseBookingStaff({ kind: "specified", staffId: "zhaohang" }, storage);
    chooseBookingTime(
      {
        date: "2026-08-13",
        startsAt: "2026-08-13T05:00:00.000Z",
        endsAt: "2026-08-13T06:15:00.000Z",
        assignedStaffId: "zhaohang",
      },
      storage,
    );

    expect(readBookingDraft(storage)).toEqual({
      version: 1,
      idempotencyKey: null,
      petId: "pet-tuanzi",
      primaryServiceId: "dog-basic-care",
      addonIds: ["oral-care"],
      staffPreference: { kind: "specified", staffId: "zhaohang" },
      selectedTime: {
        date: "2026-08-13",
        startsAt: "2026-08-13T05:00:00.000Z",
        endsAt: "2026-08-13T06:15:00.000Z",
        assignedStaffId: "zhaohang",
      },
    });
  });

  it("改变上游选择会清除已经失效的下游选择，损坏存储回退为空草稿", () => {
    const storage = memoryStorage({ version: 99, petId: 42 });

    expect(readBookingDraft(storage)).toEqual(emptyBookingDraft());

    chooseBookingPet("pet-tuanzi", storage);
    chooseBookingService("dog-basic-care", ["nail-care"], storage);
    chooseBookingStaff({ kind: "fastest" }, storage);
    chooseBookingTime(
      {
        date: "2026-08-14",
        startsAt: "2026-08-14T01:30:00.000Z",
        endsAt: "2026-08-14T02:45:00.000Z",
        assignedStaffId: "linxia",
      },
      storage,
    );

    chooseBookingService("dog-basic-care", ["oral-care"], storage);
    expect(readBookingDraft(storage)).toMatchObject({
      petId: "pet-tuanzi",
      primaryServiceId: "dog-basic-care",
      addonIds: ["oral-care"],
      staffPreference: null,
      selectedTime: null,
    });

    chooseBookingPet("pet-other", storage);
    expect(readBookingDraft(storage)).toEqual({
      ...emptyBookingDraft(),
      petId: "pet-other",
    });
  });

  it("同一草稿重试复用幂等键，改变时段后生成新的命令键", () => {
    const storage = memoryStorage();
    chooseBookingPet("pet-tuanzi", storage);
    chooseBookingService("dog-basic-care", [], storage);
    chooseBookingStaff({ kind: "fastest" }, storage);
    chooseBookingTime(
      {
        date: "2026-08-14",
        startsAt: "2026-08-14T01:30:00.000Z",
        endsAt: "2026-08-14T02:30:00.000Z",
        assignedStaffId: "linxia",
      },
      storage,
    );

    expect(ensureBookingIdempotencyKey(storage, () => "booking-first-key")).toBe(
      "booking-first-key",
    );
    expect(ensureBookingIdempotencyKey(storage, () => "unused-key")).toBe("booking-first-key");

    chooseBookingTime(
      {
        date: "2026-08-14",
        startsAt: "2026-08-14T02:00:00.000Z",
        endsAt: "2026-08-14T03:00:00.000Z",
        assignedStaffId: "zhaohang",
      },
      storage,
    );
    expect(ensureBookingIdempotencyKey(storage, () => "booking-second-key")).toBe(
      "booking-second-key",
    );
  });

  it("刷新时只恢复当前响应中仍真实存在的员工时段，并清除已经失效的时间", () => {
    const storage = memoryStorage();
    chooseBookingPet("pet-tuanzi", storage);
    chooseBookingService("dog-basic-care", [], storage);
    chooseBookingStaff({ kind: "fastest" }, storage);
    const saved = {
      date: "2026-08-14",
      startsAt: "2026-08-14T01:30:00.000Z",
      endsAt: "2026-08-14T02:30:00.000Z",
      assignedStaffId: "linxia",
    };
    chooseBookingTime(saved, storage);
    const days = [
      {
        date: "2026-08-14",
        weekday: 5,
        reason: null,
        reasonLabel: "可预约",
        slots: [
          {
            startsAt: saved.startsAt,
            endsAt: saved.endsAt,
            turnoverEndsAt: "2026-08-14T02:45:00.000Z",
            staff: { id: "zhaohang", displayName: "赵航", employeeNumber: 4 },
          },
        ],
      },
    ];

    expect(findRestorableBookingSlot(days, saved)).toBeNull();
    clearBookingTime(storage);
    expect(readBookingDraft(storage).selectedTime).toBeNull();
  });

  it("后续页面直接访问时给出最早缺失步骤的明确恢复路径", () => {
    const empty = emptyBookingDraft();
    const petOnly = { ...empty, petId: "pet-tuanzi" };
    const serviceReady = {
      ...petOnly,
      primaryServiceId: "dog-basic-care",
      addonIds: [],
    };

    expect(recoveryForBookingStep("service", empty)).toEqual({
      path: bookingFlowPaths.pet,
      message: "请先选择这次要服务的宠物。",
    });
    expect(recoveryForBookingStep("staff", petOnly)).toEqual({
      path: bookingFlowPaths.service,
      message: "请先选择主要服务与增项。",
    });
    expect(recoveryForBookingStep("time", serviceReady)).toEqual({
      path: bookingFlowPaths.staff,
      message: "请先选择员工偏好。",
    });
    expect(
      recoveryForBookingStep("time", {
        ...serviceReady,
        staffPreference: { kind: "fastest" },
      }),
    ).toBeNull();
    expect(
      recoveryForBookingStep("confirm", {
        ...serviceReady,
        staffPreference: { kind: "fastest" },
      }),
    ).toEqual({
      path: bookingFlowPaths.time,
      message: "请先选择仍然可约的日期与时段。",
    });
  });

  it("按宠物体型实时合计价格、服务时长和同一员工所需的全部技能", () => {
    expect(
      quoteBookingSelection(pet, catalog, "dog-basic-care", ["nail-care", "oral-care"]),
    ).toMatchObject({
      totalPriceCents: 19300,
      serviceDurationMinutes: 90,
      requiredSkillIds: ["dog-basic-care", "nail-care", "oral-care"],
      primaryService: { name: "犬基础洗护", priceCents: 12800, durationMinutes: 60 },
      addons: [
        { name: "修甲护理", priceCents: 3000, durationMinutes: 15 },
        { name: "口腔清洁", priceCents: 3500, durationMinutes: 15 },
      ],
    });
  });
});
