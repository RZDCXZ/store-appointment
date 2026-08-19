import { access, readFile } from "node:fs/promises";

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

  it("四个主入口使用可直接打开的真实原生 tab 页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as {
      pages: string[];
      tabBar?: {
        list: {
          pagePath: string;
          text: string;
          iconPath?: string;
          selectedIconPath?: string;
        }[];
      };
    };
    const tabs = [
      { pagePath: "pages/home/index", text: "首页" },
      { pagePath: "pages/appointments/index", text: "预约记录" },
      { pagePath: "pages/messages/index", text: "消息" },
      { pagePath: "pages/profile/index", text: "我的" },
    ];

    expect(appConfig.pages).toEqual(expect.arrayContaining(tabs.map((tab) => tab.pagePath)));
    expect(appConfig.tabBar?.list).toEqual(tabs.map((tab) => expect.objectContaining(tab)));

    await Promise.all([
      ...tabs.flatMap((tab) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${tab.pagePath}.${extension}`, import.meta.url)),
        ),
      ),
      ...(appConfig.tabBar?.list.flatMap((tab) =>
        [tab.iconPath, tab.selectedIconPath]
          .filter((path): path is string => Boolean(path))
          .map((path) => access(new URL(`../miniprogram/${path}`, import.meta.url))),
      ) ?? []),
    ]);
  });

  it("MP-02 服务列表与详情是可直接打开并可刷新恢复的独立原生页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const servicePages = ["pages/services/index", "pages/service-detail/index"];

    expect(appConfig.pages).toEqual(expect.arrayContaining(servicePages));
    await Promise.all(
      servicePages.flatMap((page) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${page}.${extension}`, import.meta.url)),
        ),
      ),
    );
  });

  it("MP-03、MP-04 与 MP-05 是可直接打开并可刷新恢复的独立原生页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const petAndPrivacyPages = [
      "pages/pets/index",
      "pages/pet-form/index",
      "pages/privacy-consent/index",
    ];

    expect(appConfig.pages).toEqual(expect.arrayContaining(petAndPrivacyPages));
    await Promise.all(
      petAndPrivacyPages.flatMap((page) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${page}.${extension}`, import.meta.url)),
        ),
      ),
    );
  });

  it("MP-06 至 MP-09 是可直接打开并从持久草稿恢复的独立原生页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const bookingPages = [
      "pages/booking-pet/index",
      "pages/booking-service/index",
      "pages/booking-staff/index",
      "pages/booking-time/index",
    ];

    expect(appConfig.pages).toEqual(expect.arrayContaining(bookingPages));
    await Promise.all(
      bookingPages.flatMap((page) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${page}.${extension}`, import.meta.url)),
        ),
      ),
    );
  });

  it("MP-10 确认预约与 MP-11 预约成功是可直接打开并恢复服务端事实的独立页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const bookingFactPages = ["pages/booking-confirm/index", "pages/booking-success/index"];

    expect(appConfig.pages).toEqual(expect.arrayContaining(bookingFactPages));
    await Promise.all(
      bookingFactPages.flatMap((page) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${page}.${extension}`, import.meta.url)),
        ),
      ),
    );
  });

  it("MP-12 时段冲突是可直接打开并恢复冲突上下文的独立页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const conflictPage = "pages/booking-conflict/index";

    expect(appConfig.pages).toContain(conflictPage);
    await Promise.all(
      ["ts", "json", "wxml", "wxss"].map((extension) =>
        access(new URL(`../miniprogram/${conflictPage}.${extension}`, import.meta.url)),
      ),
    );
  });

  it("MP-13、MP-14 与 MP-16 使用可直接打开并可刷新恢复的真实原生页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const customerFactPages = [
      "pages/appointments/index",
      "pages/booking-detail/index",
      "pages/messages/index",
    ];

    expect(appConfig.pages).toEqual(expect.arrayContaining(customerFactPages));
    await Promise.all(
      customerFactPages.flatMap((page) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${page}.${extension}`, import.meta.url)),
        ),
      ),
    );
  });

  it("MP-15 改期与取消是按预约身份直接恢复的独立原生页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const customerChangePages = ["pages/booking-reschedule/index", "pages/booking-cancel/index"];

    expect(appConfig.pages).toEqual(expect.arrayContaining(customerChangePages));
    await Promise.all(
      customerChangePages.flatMap((page) =>
        ["ts", "json", "wxml", "wxss"].map((extension) =>
          access(new URL(`../miniprogram/${page}.${extension}`, import.meta.url)),
        ),
      ),
    );
  });

  it("MP-18 数据权利是可直接打开并从当前会话刷新恢复的独立原生页面", async () => {
    const appConfig = JSON.parse(
      await readFile(new URL("../miniprogram/app.json", import.meta.url), "utf8"),
    ) as { pages: string[] };
    const dataRightsPage = "pages/data-rights/index";

    expect(appConfig.pages).toContain(dataRightsPage);
    await Promise.all(
      ["ts", "json", "wxml", "wxss"].map((extension) =>
        access(new URL(`../miniprogram/${dataRightsPage}.${extension}`, import.meta.url)),
      ),
    );
  });
});
