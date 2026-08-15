import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

const managerAccount = {
  id: "manager",
  username: "manager",
  displayName: "沈青",
  role: "manager",
};

const staffAccount = {
  id: "linxia",
  username: "linxia",
  displayName: "林夏",
  role: "staff",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("后台登录与角色路由", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("可直接打开独立登录路由并使用五个预置账号", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: "UNAUTHENTICATED" }, 401));
    const router = createMemoryRouter(routes, { initialEntries: ["/login"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "演示账号" })).toHaveTextContent("沈青");
    expect(screen.getByRole("combobox", { name: "演示账号" })).toHaveTextContent("赵航");
    expect(screen.getByLabelText("演示密码")).toHaveAttribute("autocomplete", "current-password");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("未登录访问受保护路由会保留登录后的目标位置", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ code: "UNAUTHENTICATED" }, 401));
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system?tab=audit"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "欢迎回来" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/login");
    expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe(
      "/manager/system?tab=audit",
    );
  });

  it("店长登录后恢复目标路由且只看到店长导航", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: "UNAUTHENTICATED" }, 401))
      .mockResolvedValueOnce(jsonResponse({ account: managerAccount }, 201));
    const router = createMemoryRouter(routes, {
      initialEntries: ["/login?returnTo=%2Fmanager%2Fsystem%3Ftab%3Daudit"],
    });

    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "欢迎回来" });
    fireEvent.change(screen.getByLabelText("演示密码"), {
      target: { value: "Rongguang2026!" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "进入管理端" }).closest("form")!);

    expect(await screen.findByRole("heading", { name: "系统" })).toBeVisible();
    expect(
      within(screen.getByRole("navigation", { name: "店长导航" }))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim().replace(/^./, "")),
    ).toEqual(["工作台", "预约", "排班", "服务", "顾客", "经营", "系统"]);
    expect(screen.queryByText("今日工作")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/manager/system");
    expect(router.state.location.search).toBe("?tab=audit");
  });

  it("员工登录后进入本人落地页且只看到员工导航", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: "UNAUTHENTICATED" }, 401))
      .mockResolvedValueOnce(jsonResponse({ account: staffAccount }, 201))
      .mockResolvedValueOnce(
        jsonResponse({ account: staffAccount, navigation: ["今日工作", "我的预约"] }),
      );
    const router = createMemoryRouter(routes, { initialEntries: ["/login"] });

    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "欢迎回来" });
    fireEvent.change(screen.getByRole("combobox", { name: "演示账号" }), {
      target: { value: "linxia" },
    });
    fireEvent.change(screen.getByLabelText("演示密码"), {
      target: { value: "Rongguang2026!" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "进入管理端" }).closest("form")!);

    expect(await screen.findByRole("heading", { name: "我的今日工作" })).toBeVisible();
    expect(
      within(screen.getByRole("navigation", { name: "员工导航" }))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim().replace(/^./, "")),
    ).toEqual(["今日工作", "我的预约"]);
    expect(screen.queryByText("经营")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/staff/today");
  });

  it("员工直接打开店长路由会看到明确无权限结果", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ account: staffAccount }));
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/system"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "没有权限" })).toBeVisible();
    expect(screen.getByText("员工身份不能访问店长页面。")).toBeVisible();
    expect(router.state.location.pathname).toBe("/manager/system");
  });

  it("密码错误与认证过期显示不同的可恢复提示", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ code: "UNAUTHENTICATED" }, 401))
      .mockResolvedValueOnce(
        jsonResponse(
          { code: "INVALID_CREDENTIALS", message: "账号或密码不正确，请检查后重试。" },
          401,
        ),
      );
    const router = createMemoryRouter(routes, { initialEntries: ["/login"] });

    render(<RouterProvider router={router} />);
    await screen.findByRole("heading", { name: "欢迎回来" });
    const password = screen.getByLabelText("演示密码");
    fireEvent.change(password, { target: { value: "still-wrong" } });
    fireEvent.submit(screen.getByRole("button", { name: "进入管理端" }).closest("form")!);

    expect(await screen.findByText("账号或密码不正确，请检查后重试。")).toBeVisible();
    expect(password).toHaveValue("still-wrong");
    expect(password).toHaveAttribute("aria-describedby", "password-error");
    expect(password).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "SESSION_EXPIRED", message: "登录已过期，请重新登录后继续。" }, 401),
    );
    const expiredRouter = createMemoryRouter(routes, { initialEntries: ["/staff/appointments"] });

    cleanup();
    render(<RouterProvider router={expiredRouter} />);

    expect(await screen.findByText("登录已过期，请重新登录后继续。")).toBeVisible();
    await waitFor(() => expect(expiredRouter.state.location.pathname).toBe("/login"));
    expect(new URLSearchParams(expiredRouter.state.location.search).get("returnTo")).toBe(
      "/staff/appointments",
    );
  });
});
