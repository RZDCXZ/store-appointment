import { beforeAll, describe, expect, it, vi } from "vitest";

interface PetFormPageData {
  form: { name: string; weightKg: string; careNotes: string };
  sizeSummary: string;
  pendingPhotoPath: string;
  uploadingPhoto: boolean;
  photoError: string;
}

interface PetFormPageInstance {
  data: PetFormPageData;
  setData(patch: Record<string, unknown>): void;
}

interface PetFormPageDefinition {
  data: PetFormPageData;
  onWeightInput(this: PetFormPageInstance, event: { detail: { value: string } }): void;
  uploadPendingPhoto(this: PetFormPageInstance): Promise<void>;
}

function pageInstance(definition: PetFormPageDefinition): PetFormPageInstance {
  const data = structuredClone(definition.data);
  return {
    data,
    setData(patch) {
      for (const [path, value] of Object.entries(patch)) {
        if (path.startsWith("form.")) {
          const field = path.slice("form.".length) as keyof PetFormPageData["form"];
          data.form[field] = value as never;
        } else {
          (data as unknown as Record<string, unknown>)[path] = value;
        }
      }
    },
  };
}

describe("宠物编辑页组件行为", () => {
  let definition: PetFormPageDefinition;

  beforeAll(async () => {
    vi.stubGlobal("Page", (value: PetFormPageDefinition) => {
      definition = value;
    });
    vi.stubGlobal("getApp", () => ({
      globalData: {
        apiBaseUrl: "http://api.local",
        customerSession: { accessToken: "signed-token" },
      },
    }));
    vi.stubGlobal("wx", {
      getFileSystemManager: () => ({
        readFile(options: { success(result: { data: string }): void }) {
          options.success({ data: "/9j/" });
        },
      }),
      request(options: { fail(): void }) {
        options.fail();
      },
    });
    await import("../miniprogram/pages/pet-form/index");
  });

  it("输入体重时立即更新体型摘要", () => {
    const instance = pageInstance(definition);

    definition.onWeightInput.call(instance, { detail: { value: "10.01" } });

    expect(instance.data.form.weightKg).toBe("10.01");
    expect(instance.data.sizeSummary).toBe("10.01kg · 中型");
  });

  it("照片上传失败时保留表单和待重试文件", async () => {
    const instance = pageInstance(definition);
    instance.data.form = { name: "小满", weightKg: "4.8", careNotes: "请慢慢吹干" };
    instance.data.pendingPhotoPath = "/tmp/xiaoman.jpg";

    await definition.uploadPendingPhoto.call(instance);

    expect(instance.data.form).toEqual({
      name: "小满",
      weightKg: "4.8",
      careNotes: "请慢慢吹干",
    });
    expect(instance.data.pendingPhotoPath).toBe("/tmp/xiaoman.jpg");
    expect(instance.data.photoError).toContain("暂时无法连接");
  });
});
