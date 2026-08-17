import type { BookingConflictSuggestion } from "@rongguang/contracts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chooseBookingPet,
  chooseBookingService,
  chooseBookingStaff,
  chooseBookingTime,
  readBookingDraft,
} from "../miniprogram/services/booking-draft";
import {
  readBookingConflict,
  writeBookingConflict,
} from "../miniprogram/services/booking-conflict";

interface PageInstance {
  data: Record<string, unknown>;
  setData(next: Record<string, unknown>): void;
}

interface ConflictPageDefinition {
  data: Record<string, unknown>;
  loadConflict(this: PageInstance): Promise<void>;
  selectSuggestion(this: PageInstance, event: WechatMiniprogram.BaseEvent): void;
  chooseOtherDate(this: PageInstance): void;
  recover(this: PageInstance): void;
}

function pageInstance(definition: ConflictPageDefinition): PageInstance {
  return {
    data: structuredClone(definition.data),
    setData(next) {
      Object.assign(this.data, next);
    },
  };
}

const suggestions: BookingConflictSuggestion[] = [
  {
    date: "2026-08-26",
    startsAt: "2026-08-26T07:00:00.000Z",
    endsAt: "2026-08-26T08:15:00.000Z",
    staff: { id: "zhaohang", displayName: "赵航" },
  },
  {
    date: "2026-08-26",
    startsAt: "2026-08-26T08:30:00.000Z",
    endsAt: "2026-08-26T09:45:00.000Z",
    staff: { id: "linxia", displayName: "林夏" },
  },
  {
    date: "2026-08-27",
    startsAt: "2026-08-27T02:00:00.000Z",
    endsAt: "2026-08-27T03:15:00.000Z",
    staff: { id: "zhaohang", displayName: "赵航" },
  },
];

describe("MP-12 时段冲突与相近建议页面", () => {
  let definition: ConflictPageDefinition;
  let storage: Map<string, unknown>;
  const redirectTo = vi.fn();

  beforeAll(async () => {
    vi.stubGlobal("Page", (page: ConflictPageDefinition) => {
      definition = page;
    });
    await import("../miniprogram/pages/booking-conflict/index");
  });

  beforeEach(() => {
    storage = new Map();
    redirectTo.mockReset();
    const customer = {
      displayName: "许岚",
      phoneMasked: "138****1208",
      story: "正常预约" as const,
      avatarInitial: "岚",
    };
    const session = {
      accessToken: "customer-token",
      expiresAt: "2099-08-27T00:00:00.000Z",
      customerKey: "xu-lan",
      customer,
    };
    storage.set("rongguang.customer-session", session);
    vi.stubGlobal("getApp", () => ({
      globalData: {
        apiBaseUrl: "http://api.test",
        customerSession: session,
        customerSessionStatus: "active",
      },
    }));
    vi.stubGlobal("wx", {
      getStorageSync: (key: string) => storage.get(key),
      setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
      removeStorageSync: (key: string) => storage.delete(key),
      redirectTo,
      switchTab: vi.fn(),
      request: vi.fn((options: { success(response: unknown): void }) => {
        options.success({ statusCode: 200, data: { customer } });
      }),
    });
    chooseBookingPet("pet-tuanzi");
    chooseBookingService("dog-basic-care", ["oral-care"]);
    chooseBookingStaff({ kind: "fastest" });
    chooseBookingTime({
      date: "2026-08-26",
      startsAt: "2026-08-26T05:00:00.000Z",
      endsAt: "2026-08-26T06:15:00.000Z",
      assignedStaffId: "zhaohang",
    });
    writeBookingConflict({
      requestedStartsAt: "2026-08-26T05:00:00.000Z",
      petLabel: "团子 · 犬 · 8.4kg · 小型",
      serviceLabel: "犬基础洗护 + 口腔清洁",
      staffPreferenceLabel: "最快可约",
      suggestions,
    });
  });

  it("刷新后从持久上下文恢复提示、原选择摘要和三条具体员工建议", async () => {
    const before = readBookingDraft();
    const instance = pageInstance(definition);

    await definition.loadConflict.call(instance);

    expect(instance.data).toMatchObject({
      pageState: "ready",
      petLabel: "团子 · 犬 · 8.4kg · 小型",
      serviceLabel: "犬基础洗护 + 口腔清洁",
      staffPreferenceLabel: "最快可约",
      requestedTimeLabel: "8月26日 周三 13:00–14:15",
    });
    expect(instance.data.suggestions).toHaveLength(3);
    expect(instance.data.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dateLabel: "8月26日 周三",
          timeLabel: "15:00–16:15",
          staffLabel: "赵航",
        }),
      ]),
    );
    expect(readBookingDraft()).toEqual(before);
  });

  it("只有顾客点击建议后才替换时段，并重新进入确认页", async () => {
    const instance = pageInstance(definition);
    await definition.loadConflict.call(instance);

    definition.selectSuggestion.call(instance, {
      currentTarget: { dataset: { start: suggestions[1]?.startsAt } },
    } as unknown as WechatMiniprogram.BaseEvent);

    expect(readBookingDraft()).toMatchObject({
      petId: "pet-tuanzi",
      primaryServiceId: "dog-basic-care",
      addonIds: ["oral-care"],
      staffPreference: { kind: "fastest" },
      idempotencyKey: null,
      selectedTime: {
        date: "2026-08-26",
        startsAt: "2026-08-26T08:30:00.000Z",
        endsAt: "2026-08-26T09:45:00.000Z",
        assignedStaffId: "linxia",
      },
    });
    expect(readBookingConflict()).toBeNull();
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/booking-confirm/index" });
  });

  it("没有建议时保留上游草稿并提供返回其他日期的恢复路径", async () => {
    writeBookingConflict({
      requestedStartsAt: "2026-08-26T05:00:00.000Z",
      petLabel: "团子 · 犬 · 8.4kg · 小型",
      serviceLabel: "犬基础洗护 + 口腔清洁",
      staffPreferenceLabel: "最快可约",
      suggestions: [],
    });
    const instance = pageInstance(definition);

    await definition.loadConflict.call(instance);
    expect(instance.data).toMatchObject({ pageState: "empty", suggestions: [] });

    definition.chooseOtherDate.call(instance);
    expect(readBookingDraft()).toMatchObject({
      petId: "pet-tuanzi",
      primaryServiceId: "dog-basic-care",
      addonIds: ["oral-care"],
      staffPreference: { kind: "fastest" },
      selectedTime: null,
    });
    expect(readBookingConflict()).toBeNull();
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/booking-time/index" });
  });

  it("直接访问但缺少冲突上下文时明确返回时段选择页", async () => {
    storage.delete("rongguang.booking-conflict.v1");
    const instance = pageInstance(definition);

    await definition.loadConflict.call(instance);
    expect(instance.data).toMatchObject({
      pageState: "recovery",
      recoveryMessage: "冲突建议已经失效，请重新选择日期与时段。",
    });

    definition.recover.call(instance);
    expect(redirectTo).toHaveBeenCalledWith({ url: "/pages/booking-time/index" });
  });
});
