import { describe, expect, it } from "vitest";

import {
  petFormPath,
  readPetFormRoute,
  sizeSummaryForWeightInput,
} from "../miniprogram/services/pet-profile-presentation";

describe("宠物档案页面逻辑", () => {
  it("编辑页路径携带宠物 ID，页面重新加载后可从查询参数恢复", () => {
    expect(petFormPath()).toBe("/pages/pet-form/index");
    expect(petFormPath("pet-tuanzi")).toBe("/pages/pet-form/index?id=pet-tuanzi");
    expect(petFormPath("pet / 有空格")).toBe(
      "/pages/pet-form/index?id=pet%20%2F%20%E6%9C%89%E7%A9%BA%E6%A0%BC",
    );
    expect(readPetFormRoute({ id: "pet-tuanzi" })).toEqual({ petId: "pet-tuanzi" });
    expect(readPetFormRoute({})).toEqual({ petId: null });
  });

  it("体重输入在 10kg 与 25kg 边界即时显示正确体型", () => {
    expect(["9.99", "10", "10.01", "25", "25.01"].map(sizeSummaryForWeightInput)).toEqual([
      "9.99kg · 小型",
      "10kg · 小型",
      "10.01kg · 中型",
      "25kg · 中型",
      "25.01kg · 大型",
    ]);
    expect(sizeSummaryForWeightInput("not-a-number")).toBeNull();
  });
});
