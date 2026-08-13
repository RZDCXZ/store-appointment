import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("原生小程序项目契约", () => {
  it("registers a compilable TypeScript home page and placeholder project config", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const projectConfig = JSON.parse(
      await readFile(new URL("../project.config.example.json", import.meta.url), "utf8"),
    ) as {
      appid: string;
      miniprogramRoot: string;
      setting: { useCompilerPlugins?: string[] };
    };

    expect(appConfig.pages).toContain("pages/home/index");
    expect(projectConfig).toMatchObject({
      appid: "请填写自己的测试AppID",
      miniprogramRoot: "miniprogram/",
    });
    expect(projectConfig.setting.useCompilerPlugins).toContain("typescript");
  });
});
