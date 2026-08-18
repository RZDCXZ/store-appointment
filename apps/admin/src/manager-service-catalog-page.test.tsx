import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

const managerAccount = {
  id: "manager",
  username: "manager",
  displayName: "沈青",
  role: "manager",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function catalogFixture() {
  return {
    revision: 7,
    primaryServices: [
      {
        id: "dog-basic-care",
        name: "犬基础洗护",
        description: "洗护、基础梳理、耳部与眼周清洁。",
        applicableSpecies: ["dog"],
        requiredSkillIds: ["dog-basic-care"],
        availableAddonIds: ["nail-care"],
        specifications: [
          {
            id: "spec-dog-small",
            petSize: "small",
            priceCents: 12800,
            durationMinutes: 60,
            status: "active",
            referencedByBookings: true,
          },
          {
            id: "spec-dog-medium",
            petSize: "medium",
            priceCents: 16800,
            durationMinutes: 90,
            status: "active",
            referencedByBookings: false,
          },
          {
            id: "spec-dog-large",
            petSize: "large",
            priceCents: 22800,
            durationMinutes: 120,
            status: "inactive",
            referencedByBookings: true,
          },
        ],
        status: "active",
        referencedByBookings: true,
        updatedAt: "2026-08-13T02:40:00.000Z",
      },
    ],
    addons: [
      {
        id: "nail-care",
        name: "修甲护理",
        description: "修整趾甲并检查足部状态。",
        applicableSpecies: ["dog", "cat"],
        requiredSkillIds: ["nail-care"],
        specifications: [
          {
            id: "spec-nail-small",
            petSize: "small",
            priceCents: 3000,
            durationMinutes: 15,
            status: "active",
            referencedByBookings: true,
          },
        ],
        status: "active",
        referencedByBookings: true,
        updatedAt: "2026-08-13T02:40:00.000Z",
      },
    ],
  } as const;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MG-12 服务目录管理页面", () => {
  it("可直接刷新独立路由并查看主要服务、规格、技能与兼容增项关联", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/service-catalog")) {
        return jsonResponse(catalogFixture());
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "服务目录" })).toBeVisible();
    expect(await screen.findByText("保存后仅影响新预约，已有预约保留快照")).toBeVisible();
    const primary = screen.getByRole("article", { name: "主要服务 犬基础洗护" });
    expect(within(primary).getByText("小型 · ¥128 · 60 分钟")).toBeVisible();
    expect(within(primary).getByText("大型 · ¥228 · 120 分钟")).toBeVisible();
    expect(within(primary).getByText("已停用 · 历史引用")).toBeVisible();
    expect(within(primary).getByText("修甲护理")).toBeVisible();
    expect(
      within(primary).getByText("犬基础洗护", { selector: ".service-skill-chip" }),
    ).toBeVisible();
    expect(screen.getByRole("article", { name: "增项 修甲护理" })).toBeVisible();
    expect(screen.getAllByText("历史预约引用").length).toBeGreaterThan(0);
    expect(router.state.location.pathname).toBe("/manager/services");

    const deactivateButton = screen.getByRole("button", { name: "停用犬基础洗护" });
    fireEvent.click(deactivateButton);
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(deactivateButton).toHaveFocus());
  });

  it("首次加载、空目录和无权限分别显示可恢复状态", async () => {
    let resolveCatalog: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return Promise.resolve(jsonResponse({ account: managerAccount }));
      }
      return new Promise<Response>((resolve) => {
        resolveCatalog = resolve;
      });
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services"] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByLabelText("正在读取服务目录")).toBeVisible();
    resolveCatalog?.(jsonResponse({ revision: 1, primaryServices: [], addons: [] }));
    expect(await screen.findByRole("heading", { name: "服务目录还是空的" })).toBeVisible();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      return jsonResponse({ code: "FORBIDDEN", message: "当前身份没有访问此内容的权限。" }, 403);
    });
    const forbiddenRouter = createMemoryRouter(routes, {
      initialEntries: ["/manager/services"],
    });
    render(<RouterProvider router={forbiddenRouter} />);
    expect(await screen.findByRole("heading", { name: "没有权限管理服务目录" })).toBeVisible();
  });

  it("编辑时提交人民币、分钟、犬猫、体型、技能和关联增项，并显示字段错误", async () => {
    const fixture = catalogFixture();
    let patchBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/service-catalog") && !init?.method) {
        return jsonResponse(fixture);
      }
      if (url.endsWith("/primary-services/dog-basic-care") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            code: "VALIDATION_ERROR",
            message: "请检查服务配置后重试。",
            fieldErrors: {
              description: "说明不能超过 500 个字符",
              specifications: "金额不能为负数；时长须按 5 分钟递增",
            },
          },
          400,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services"] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("article", { name: "主要服务 犬基础洗护" });
    fireEvent.click(screen.getByRole("button", { name: "编辑犬基础洗护" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "犬舒缓洗护" } });
    fireEvent.change(screen.getByLabelText("小型价格（元）"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText("小型服务分钟数"), { target: { value: "17" } });
    expect(screen.getByText("变更后摘要")).toBeVisible();
    expect(screen.getByText(/小型 ¥-1 · 17 分钟/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存服务配置" }));

    expect(await screen.findByText("金额不能为负数；时长须按 5 分钟递增")).toBeVisible();
    expect(screen.getByLabelText("小型价格（元）")).toHaveAttribute(
      "aria-describedby",
      "service-specifications-error",
    );
    expect(screen.getByText("说明不能超过 500 个字符")).toBeVisible();
    expect(screen.getByLabelText("说明")).toHaveAttribute(
      "aria-describedby",
      "service-description-error",
    );
    expect(patchBody).toMatchObject({
      expectedRevision: 7,
      name: "犬舒缓洗护",
      applicableSpecies: ["dog"],
      requiredSkillIds: ["dog-basic-care"],
      availableAddonIds: ["nail-care"],
      specifications: expect.arrayContaining([
        expect.objectContaining({ petSize: "small", priceCents: -100, durationMinutes: 17 }),
      ]),
    });
  });

  it("并发目录变化不会覆盖配置，而是保留页面并要求刷新", async () => {
    let catalogReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/service-catalog") && !init?.method) {
        catalogReads += 1;
        return catalogReads === 1
          ? jsonResponse(catalogFixture())
          : jsonResponse({ code: "CATALOG_UNAVAILABLE", message: "服务目录暂时不可用。" }, 503);
      }
      if (url.endsWith("/primary-services/dog-basic-care/deactivate")) {
        return jsonResponse(
          {
            code: "CATALOG_REVISION_CONFLICT",
            message: "服务目录刚刚被其他店长更新，请重新读取后再保存。",
            revision: 8,
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services"] });
    render(<RouterProvider router={router} />);
    await screen.findByRole("article", { name: "主要服务 犬基础洗护" });
    fireEvent.click(screen.getByRole("button", { name: "停用犬基础洗护" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用犬基础洗护" }));

    expect(
      await screen.findByText("服务目录刚刚被其他店长更新，请重新读取后再保存。"),
    ).toBeVisible();
    expect(screen.getByRole("article", { name: "主要服务 犬基础洗护" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "读取最新目录" }));
    await waitFor(() => expect(catalogReads).toBe(2));
    expect(await screen.findByText("最新目录读取失败")).toBeVisible();
    expect(screen.getByText("服务目录暂时不可用。 已保留当前显示内容。")).toBeVisible();
    expect(screen.getByRole("article", { name: "主要服务 犬基础洗护" })).toBeVisible();
  });
});
