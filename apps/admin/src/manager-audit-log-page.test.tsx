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

const filterOptions = {
  actors: [
    { value: "manager:manager", label: "沈青 · 店长" },
    { value: "staff:chenjia", label: "陈嘉 · 员工" },
  ],
  actions: [
    { value: "booking_checked_in", label: "到店核销" },
    { value: "customer_phone_revealed", label: "揭示完整手机号" },
  ],
  subjectTypes: [
    { value: "booking", label: "预约" },
    { value: "staff", label: "员工" },
  ],
} as const;

function auditResponse(
  records: Array<Record<string, unknown>> = [],
  pagination = { page: 1, pageSize: 20, totalItems: records.length, totalPages: 1 },
): Response {
  return jsonResponse({
    appliedFilters: { page: pagination.page },
    filterOptions,
    pagination,
    records,
  });
}

const checkInRecord = {
  id: "audit-check-in",
  occurredAt: "2026-08-14T03:15:00.000Z",
  actor: { type: "staff", id: "chenjia", label: "陈嘉 · 员工" },
  action: { type: "booking_checked_in", label: "到店核销" },
  subject: {
    type: "booking",
    id: "booking-bohe-future",
    label: "预约 booking-bohe-future",
  },
  changes: ["已确认 → 已到店"],
};

describe("店长审计记录页面", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("独立路由直达后按 URL 恢复筛选，并只展示安全的只读事实", async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/backoffice/manager/audits?")) {
        return jsonResponse({
          appliedFilters: {
            actor: "staff:chenjia",
            action: "booking_checked_in",
            subjectType: "booking",
            subjectId: "booking-bohe-future",
            from: "2026-08-13",
            to: "2026-08-14",
            page: 1,
          },
          filterOptions,
          pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          records: [checkInRecord],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const search =
      "?actor=staff%3Achenjia&action=booking_checked_in&subjectType=booking" +
      "&subjectId=booking-bohe-future&from=2026-08-13&to=2026-08-14&page=1";
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/system/audit${search}`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "审计记录" })).toBeVisible();
    expect(screen.getByText("不可修改事实")).toBeVisible();
    expect(screen.getByRole("link", { name: "审计记录" })).toHaveAttribute(
      "href",
      "/manager/system/audit",
    );
    const records = await screen.findByRole("list", { name: "审计事实" });
    expect(within(records).getByText("陈嘉 · 员工")).toBeVisible();
    expect(within(records).getByText("到店核销")).toBeVisible();
    expect(within(records).getByText("预约 booking-bohe-future")).toBeVisible();
    expect(within(records).getByText("已确认 → 已到店")).toBeVisible();
    expect(screen.getByLabelText("操作者")).toHaveValue("staff:chenjia");
    expect(screen.getByLabelText("动作类型")).toHaveValue("booking_checked_in");
    expect(screen.getByLabelText("对象编号")).toHaveValue("booking-bohe-future");
    expect(screen.queryByRole("button", { name: /编辑|删除|保存/ })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/manager/system/audit");
    expect(router.state.location.search).toBe(search);
    expect(requests).toContain(`http://localhost:3000/backoffice/manager/audits${search}`);
  });

  it("筛选与分页都写回 URL，并可刷新恢复", async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/backoffice/manager/audits")) {
        const page = url.includes("page=2") ? 2 : 1;
        return auditResponse([checkInRecord], {
          page,
          pageSize: 20,
          totalItems: 41,
          totalPages: 3,
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/audit"],
    });
    render(<RouterProvider router={router} />);

    await screen.findByRole("list", { name: "审计事实" });
    fireEvent.change(screen.getByLabelText("动作类型"), {
      target: { value: "booking_checked_in" },
    });
    fireEvent.change(screen.getByLabelText("对象编号"), {
      target: { value: "booking-bohe-future" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await waitFor(() => {
      expect(router.state.location.search).toBe(
        "?action=booking_checked_in&subjectId=booking-bohe-future&page=1",
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "下一页" }));
    await waitFor(() => expect(router.state.location.search).toContain("page=2"));
    expect(router.state.location.search).toContain("action=booking_checked_in");
    expect(requests.some((url) => url.includes("page=2"))).toBe(true);
  });

  it("区分无记录、筛选无结果与无权限，不把它们混成同一种空态", async () => {
    let reads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/backoffice/manager/audits")) {
        reads += 1;
        if (reads === 1) return auditResponse();
        if (reads === 2) return auditResponse();
        return jsonResponse({ code: "FORBIDDEN", message: "没有权限读取审计记录" }, 403);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/audit"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("当前没有审计记录")).toBeVisible();
    fireEvent.change(screen.getByLabelText("对象编号"), { target: { value: "missing" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(await screen.findByText("筛选条件下没有记录")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "刷新记录" }));
    expect(await screen.findByRole("heading", { name: "没有权限读取审计记录" })).toBeVisible();
    expect(screen.queryByText("当前没有审计记录")).not.toBeInTheDocument();
  });

  it("局部刷新失败时保留已读取事实并给出可重试提示", async () => {
    let reads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/backoffice/manager/audits")) {
        reads += 1;
        return reads === 1
          ? auditResponse([checkInRecord])
          : jsonResponse({ code: "TEMPORARY_FAILURE", message: "审计事实暂时无法读取" }, 503);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/audit"],
    });
    render(<RouterProvider router={router} />);

    const records = await screen.findByRole("list", { name: "审计事实" });
    fireEvent.click(screen.getByRole("button", { name: "刷新记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("审计事实暂时无法读取");
    expect(within(records).getByText("已确认 → 已到店")).toBeVisible();
  });
});
