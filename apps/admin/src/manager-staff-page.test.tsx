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

function staffFixture() {
  return {
    staff: [
      {
        id: "linxia",
        username: "linxia",
        displayName: "林夏",
        employeeNumber: 1,
        status: "active",
        skillIds: ["dog-basic-care", "dog-styling", "nail-care"],
        shiftSummary: {
          publishedShiftCount: 10,
          scheduledMinutes: 4500,
          nextShiftStartsAt: "2026-08-13T01:30:00.000Z",
        },
      },
      {
        id: "zhaohang",
        username: "zhaohang",
        displayName: "赵航",
        employeeNumber: 4,
        status: "inactive",
        skillIds: ["dog-basic-care", "oral-care"],
        shiftSummary: {
          publishedShiftCount: 8,
          scheduledMinutes: 3600,
          nextShiftStartsAt: null,
        },
      },
    ],
    skillColumns: [
      {
        id: "dog-basic-care",
        name: "犬基础洗护",
        kind: "primary_service",
        status: "active",
        requiredSkillIds: ["dog-basic-care"],
      },
      {
        id: "cat-care",
        name: "猫咪洗护",
        kind: "primary_service",
        status: "active",
        requiredSkillIds: ["cat-care"],
      },
      {
        id: "oral-care",
        name: "口腔清洁",
        kind: "addon",
        status: "active",
        requiredSkillIds: ["oral-care"],
      },
    ],
  } as const;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MG-13 员工账号与员工技能页面", () => {
  it("可直接刷新独立路由并查看账号状态、班次摘要和清晰技能矩阵", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/staff")) return jsonResponse(staffFixture());
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services/staff"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "员工与技能" })).toBeVisible();
    expect(screen.getByRole("link", { name: "服务目录" })).toHaveAttribute(
      "href",
      "/manager/services",
    );
    const linxia = await screen.findByRole("row", { name: /林夏/ });
    expect(within(linxia).getByText("在用")).toBeVisible();
    expect(within(linxia).getByText("未来 14 天 10 个班次 · 75 小时")).toBeVisible();
    expect(within(linxia).getByLabelText("林夏具备犬基础洗护所需全部技能")).toBeVisible();
    expect(within(linxia).getByLabelText("林夏尚未覆盖猫咪洗护所需全部技能")).toBeVisible();
    const zhaohang = screen.getByRole("row", { name: /赵航/ });
    expect(within(zhaohang).getByText("已停用")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: /口腔清洁.*增项/ })).toBeVisible();
    expect(router.state.location.pathname).toBe("/manager/services/staff");
  });

  it("可用键盘聚焦员工技能选项并保存对主要服务和增项的技能覆盖", async () => {
    let patchBody: { skillIds?: string[] } | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/staff") && !init?.method) {
        return jsonResponse(staffFixture());
      }
      if (url.endsWith("/staff/linxia/skills") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as { skillIds: string[] };
        const fixture = staffFixture();
        return jsonResponse({
          ...fixture,
          staff: fixture.staff.map((member) =>
            member.id === "linxia"
              ? { ...member, skillIds: ["cat-care", "dog-basic-care", "nail-care"] }
              : member,
          ),
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services/staff"] });
    render(<RouterProvider router={router} />);

    const linxia = await screen.findByRole("row", { name: /林夏/ });
    fireEvent.click(within(linxia).getByRole("button", { name: "编辑林夏技能" }));
    expect(screen.getByRole("heading", { name: "编辑林夏的技能" })).toBeVisible();
    const catCare = screen.getByRole("checkbox", { name: /猫咪洗护/ });
    catCare.focus();
    expect(catCare).toHaveFocus();
    fireEvent.click(catCare);
    fireEvent.click(screen.getByRole("checkbox", { name: /犬造型美容/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存林夏技能" }));

    await waitFor(() =>
      expect(patchBody).toEqual({
        skillIds: ["cat-care", "dog-basic-care", "nail-care"],
      }),
    );
    expect(
      await screen.findByText("林夏的技能已保存，新的可约时段会立即使用当前覆盖。"),
    ).toBeVisible();
    const updated = screen.getByRole("row", { name: /林夏/ });
    expect(within(updated).getByLabelText("林夏具备猫咪洗护所需全部技能")).toBeVisible();
  });

  it("可创建员工账号并把服务端字段错误关联到表单", async () => {
    let createAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/staff") && !init?.method) {
        return jsonResponse(staffFixture());
      }
      if (url.endsWith("/backoffice/manager/staff") && init?.method === "POST") {
        createAttempts += 1;
        return jsonResponse(
          {
            code: "VALIDATION_ERROR",
            message: "请检查员工账号信息后重试。",
            fieldErrors: {
              username: "演示账号已存在。",
              demoPassword: "演示密码须为 10–200 个字符。",
            },
          },
          400,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services/staff"] });
    render(<RouterProvider router={router} />);

    await screen.findByRole("row", { name: /林夏/ });
    fireEvent.click(screen.getByRole("button", { name: "新增员工" }));
    fireEvent.change(screen.getByLabelText("演示账号"), { target: { value: "linxia" } });
    fireEvent.change(screen.getByLabelText("员工姓名"), { target: { value: "新员工" } });
    fireEvent.change(screen.getByLabelText("演示密码"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "创建员工账号" }));

    expect(await screen.findByText("演示账号已存在。")).toBeVisible();
    expect(screen.getByLabelText("演示账号")).toHaveAttribute(
      "aria-describedby",
      "staff-username-error",
    );
    expect(screen.getByText("演示密码须为 10–200 个字符。")).toBeVisible();
    expect(screen.getByLabelText("演示密码")).toHaveAttribute(
      "aria-describedby",
      "staff-password-error",
    );
    expect(createAttempts).toBe(1);
  });

  it("停用被未来预约阻断时列出准确错误与逐笔处理入口", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/staff") && !init?.method) {
        return jsonResponse(staffFixture());
      }
      if (url.endsWith("/staff/linxia/deactivate")) {
        return jsonResponse(
          {
            code: "STAFF_HAS_FUTURE_BOOKINGS",
            message: "该员工仍有未来预约，请逐笔换员工、改期或取消后再停用。",
            affectedBookings: [
              {
                id: "booking-future",
                petName: "团子",
                serviceName: "犬基础洗护",
                staffName: "林夏",
                startsAt: "2026-08-14T03:00:00.000Z",
                resolutionPath: "/manager/appointments/booking-future",
              },
            ],
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url} ${init?.method ?? "GET"}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/services/staff"] });
    render(<RouterProvider router={router} />);

    const linxia = await screen.findByRole("row", { name: /林夏/ });
    fireEvent.click(within(linxia).getByRole("button", { name: "停用林夏账号" }));
    const dialog = screen.getByRole("alertdialog", { name: "停用林夏账号" });
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认停用林夏账号" }));

    expect(await screen.findByRole("heading", { name: "林夏仍有 1 笔未来预约" })).toBeVisible();
    expect(screen.getByText("团子 · 犬基础洗护")).toBeVisible();
    expect(screen.getByRole("link", { name: "处理团子的预约" })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-future",
    );
  });
});
