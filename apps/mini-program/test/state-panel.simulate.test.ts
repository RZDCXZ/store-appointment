// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as simulate from "miniprogram-simulate";
import { beforeAll, describe, expect, it, vi } from "vitest";

type StatePanelDefinition = WechatMiniprogram.Component.Options<
  Record<string, never>,
  {
    state: { type: StringConstructor; value: string };
    title: { type: StringConstructor; value: string };
    message: { type: StringConstructor; value: string };
    retryLabel: { type: StringConstructor; value: string };
  },
  { retry(): void }
>;

describe("小程序异步状态组件", () => {
  let definition: StatePanelDefinition;
  let componentId: ReturnType<typeof simulate.load>;

  beforeAll(async () => {
    vi.stubGlobal("Component", (value: StatePanelDefinition) => {
      definition = value;
    });
    await import("../miniprogram/components/state-panel/index");

    const template = await readFile(
      resolve(process.cwd(), "miniprogram/components/state-panel/index.wxml"),
      "utf8",
    );
    componentId = simulate.load({ ...definition, template });
  });

  it("渲染错误事实并把重试动作交还页面", () => {
    const component = simulate.render(componentId, {
      state: "error",
      title: "服务更新失败",
      message: "网络连接中断，旧服务仍然保留。",
      retryLabel: "重新读取",
    });
    const retry = vi.fn();
    component.addEventListener("retry", retry);
    component.attach(document.createElement("div"));

    expect(component.dom?.textContent).toContain("服务更新失败");
    expect(component.dom?.textContent).toContain("网络连接中断，旧服务仍然保留。");
    expect(component.querySelector("#state-panel-retry")).toBeDefined();
    component.instance.retry();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("加载态不暴露重试按钮", () => {
    const component = simulate.render(componentId, {
      state: "loading",
      title: "正在读取服务",
      message: "价格与时长来自门店当前目录。",
    });
    component.attach(document.createElement("div"));

    expect(component.dom?.textContent).toContain("正在读取服务");
    expect(component.querySelector("#state-panel-retry")).toBeUndefined();
  });
});
