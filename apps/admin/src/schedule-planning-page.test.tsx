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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function planningFixture() {
  const businessHours = { status: "open", opensAt: "09:30", closesAt: "19:00" } as const;
  return {
    timeZone: "Asia/Shanghai",
    demoNow: "2026-08-13T02:50:00.000Z",
    window: { startsOn: "2026-08-13", endsOn: "2026-08-26" },
    staff: [
      {
        id: "linxia",
        displayName: "林夏",
        employeeNumber: 1,
        templateDays: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          businessHours:
            weekday === 1 ? { status: "closed", opensAt: null, closesAt: null } : businessHours,
          shifts:
            weekday === 1
              ? []
              : [
                  {
                    startsAt: "09:30",
                    endsAt: "18:00",
                    breaks: [{ startsAt: "13:00", endsAt: "14:00" }],
                  },
                ],
        })),
      },
    ],
    draftDays: [],
  };
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function planningWithDrafts() {
  const fixture = planningFixture();
  return {
    ...fixture,
    draftDays: Array.from({ length: 14 }, (_, index) => {
      const date = addDays("2026-08-13", index);
      const weekday = (4 + index) % 7;
      return {
        date,
        weekday,
        businessHours:
          weekday === 1
            ? { status: "closed", opensAt: null, closesAt: null }
            : { status: "open", opensAt: "09:30", closesAt: "19:00" },
        staffDays: [
          {
            staffId: "linxia",
            status: "draft",
            source: "weekly_template",
            exception: null,
            shifts:
              weekday === 1
                ? []
                : [
                    {
                      startsAt: "09:30",
                      endsAt: "18:00",
                      breaks: [{ startsAt: "13:00", endsAt: "14:00" }],
                    },
                  ],
          },
        ],
      };
    }),
  };
}

describe("MG-08 排班模板与十四天草稿页面", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
    vi.stubEnv("VITE_DEMO_NOW", "2026-08-13T02:50:00.000Z");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("可直接打开独立路由，并持续区分模板、草稿与已发布排班", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningFixture());
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "排班模板与 14 天草稿" })).toBeVisible();
    expect(screen.getByRole("link", { name: "排班模板与草稿" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "已发布排班与日期例外" })).toHaveAttribute(
      "href",
      "/manager/schedule/published",
    );
    expect(await screen.findByText("模板不会直接产生顾客可约容量")).toBeVisible();
    expect(screen.getByRole("heading", { name: "还没有 14 天草稿" })).toBeVisible();
    expect(screen.getByRole("button", { name: "从模板生成未来 14 天草稿" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/manager/schedule/planning");
  });

  it("可从模板生成十四天草稿并预览每个具体日期后再发布", async () => {
    let generated = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningFixture());
      }
      if (url.endsWith("/backoffice/manager/schedule/drafts/generate")) {
        generated = init?.method === "POST";
        return jsonResponse(planningWithDrafts(), 201);
      }
      throw new Error(`未处理请求：${url} ${init?.method ?? "GET"}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "从模板生成未来 14 天草稿" }));

    expect(await screen.findByRole("heading", { name: "14 天排班草稿" })).toBeVisible();
    expect(generated).toBe(true);
    const dateNavigation = screen.getByRole("navigation", { name: "十四天草稿日期" });
    expect(within(dateNavigation).getAllByRole("button")).toHaveLength(14);
    expect(within(dateNavigation).getByRole("button", { pressed: true })).toHaveTextContent(
      "8月13日",
    );
    expect(screen.getByText("草稿 · 未发布不产生容量")).toBeVisible();
    const draftCard = screen.getByRole("article", { name: "林夏的8月13日排班草稿" });
    expect(within(draftCard).getByText("班次 09:30–18:00")).toBeVisible();
    expect(within(draftCard).getByText("休息 13:00–14:00")).toBeVisible();
    expect(screen.getByRole("button", { name: "发布 14 天草稿" })).toBeVisible();
  });

  it("可维护员工每周工作日的班次与休息区间", async () => {
    let savedBody: unknown;
    const fixture = planningFixture();
    fixture.staff[0]!.templateDays[4]!.shifts.push({
      startsAt: "18:30",
      endsAt: "19:00",
      breaks: [],
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(fixture);
      }
      if (url.endsWith("/backoffice/manager/schedule/templates/linxia/4")) {
        savedBody = JSON.parse(String(init?.body));
        return jsonResponse(fixture);
      }
      throw new Error(`未处理请求：${url} ${init?.method ?? "GET"}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    const editButton = await screen.findByRole("button", { name: "编辑林夏周四模板" });
    editButton.focus();
    fireEvent.click(editButton);
    const dialog = screen.getByRole("dialog", { name: "编辑林夏周四模板" });
    expect(within(dialog).getByRole("checkbox", { name: "该员工当天工作" })).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText("班次开始"), {
      target: { value: "10:00" },
    });
    fireEvent.change(within(dialog).getByLabelText("班次结束"), {
      target: { value: "18:30" },
    });
    fireEvent.change(within(dialog).getByLabelText("休息开始"), {
      target: { value: "13:30" },
    });
    fireEvent.change(within(dialog).getByLabelText("休息结束"), {
      target: { value: "14:15" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存模板" }));

    await waitFor(() =>
      expect(savedBody).toEqual({
        shifts: [
          {
            startsAt: "10:00",
            endsAt: "18:30",
            breaks: [{ startsAt: "13:30", endsAt: "14:15" }],
          },
          { startsAt: "18:30", endsAt: "19:00", breaks: [] },
        ],
      }),
    );
    expect(await screen.findByText("林夏周四的排班模板已保存。")).toBeVisible();
    expect(editButton).toHaveFocus();
  });

  it("可为单个员工修改具体日期草稿并记录日期例外", async () => {
    let savedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningWithDrafts());
      }
      if (url.endsWith("/backoffice/manager/schedule/drafts/linxia/2026-08-13")) {
        savedBody = JSON.parse(String(init?.body));
        return jsonResponse(planningWithDrafts());
      }
      throw new Error(`未处理请求：${url} ${init?.method ?? "GET"}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑林夏8月13日草稿" }));
    const dialog = screen.getByRole("dialog", { name: "编辑林夏8月13日草稿" });
    fireEvent.change(within(dialog).getByLabelText("例外类型"), {
      target: { value: "special_break" },
    });
    fireEvent.change(within(dialog).getByLabelText("例外说明"), {
      target: { value: "午间培训，延长休息" },
    });
    fireEvent.change(within(dialog).getByLabelText("休息结束"), {
      target: { value: "14:30" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存草稿" }));

    await waitFor(() =>
      expect(savedBody).toEqual({
        kind: "special_break",
        note: "午间培训，延长休息",
        shifts: [
          {
            startsAt: "09:30",
            endsAt: "18:00",
            breaks: [{ startsAt: "13:00", endsAt: "14:30" }],
          },
        ],
      }),
    );
    expect(await screen.findByText("林夏8月13日的排班草稿已保存。")).toBeVisible();
  });

  it("确认后一次发布十四天草稿，并明确指向已发布排班", async () => {
    let publishedBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningWithDrafts());
      }
      if (url.endsWith("/backoffice/manager/schedule/drafts/publish")) {
        publishedBody = JSON.parse(String(init?.body));
        return jsonResponse({ publishedCount: 14 }, 201);
      }
      throw new Error(`未处理请求：${url} ${init?.method ?? "GET"}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "发布 14 天草稿" }));
    const dialog = screen.getByRole("alertdialog", { name: "确认发布 14 天草稿" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认发布" }));

    await waitFor(() =>
      expect(publishedBody).toEqual({
        dates: Array.from({ length: 14 }, (_, index) => addDays("2026-08-13", index)),
        staffIds: ["linxia"],
      }),
    );
    expect(
      await screen.findByText("已发布 14 个员工日，顾客可约容量已按新排班更新。"),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "查看已发布排班与日期例外" })).toHaveAttribute(
      "href",
      "/manager/schedule/published?date=2026-08-13",
    );
  });

  it("发布影响已有预约时保留草稿并引导逐笔处理", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningWithDrafts());
      }
      if (url.endsWith("/backoffice/manager/schedule/drafts/publish")) {
        return jsonResponse(
          {
            code: "SCHEDULE_CHANGE_AFFECTS_BOOKINGS",
            message: "这次发布会影响已有预约，请先进入容量变更流程逐笔处理。",
            impactSummary: { affectedBookingCount: 1 },
            affectedBookings: [
              {
                id: "booking-impact",
                petName: "团子",
                serviceName: "犬基础洗护",
                staffName: "林夏",
                startsAt: "2026-08-13T02:00:00.000Z",
                endsAt: "2026-08-13T03:15:00.000Z",
                resolutionPath: "/manager/appointments/booking-impact",
              },
            ],
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "发布 14 天草稿" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "确认发布 14 天草稿" })).getByRole("button", {
        name: "确认发布",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "发布已阻断：1 笔预约受影响" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "处理团子的预约" })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-impact",
    );
    expect(screen.getByRole("article", { name: "林夏的8月13日排班草稿" })).toBeVisible();
  });

  it("模板校验失败时保留编辑内容与明确错误", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningFixture());
      }
      if (url.endsWith("/backoffice/manager/schedule/templates/linxia/4")) {
        return jsonResponse(
          { code: "VALIDATION_ERROR", message: "班次不能超出门店营业时间。" },
          400,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑林夏周四模板" }));
    const dialog = screen.getByRole("dialog", { name: "编辑林夏周四模板" });
    fireEvent.change(within(dialog).getByLabelText("班次结束"), {
      target: { value: "20:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存模板" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "班次不能超出门店营业时间。",
    );
    expect(within(dialog).getByLabelText("班次结束")).toHaveValue("20:00");
  });

  it("局部生成失败时保留最近成功读取的模板", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        return jsonResponse(planningFixture());
      }
      if (url.endsWith("/backoffice/manager/schedule/drafts/generate")) {
        return jsonResponse({ code: "SCHEDULE_UNAVAILABLE", message: "草稿服务暂时不可用。" }, 503);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "从模板生成未来 14 天草稿" }));

    expect(await screen.findByText("草稿服务暂时不可用。")).toBeVisible();
    expect(screen.getByRole("heading", { name: "排班模板" })).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑林夏周四模板" })).toBeVisible();
    expect(screen.getByText("最近成功读取的模板与草稿仍保留在页面中。")).toBeVisible();
  });

  it("首次查询失败时提供原位重试并恢复工作区", async () => {
    let planningReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule/planning")) {
        planningReads += 1;
        return planningReads === 1
          ? jsonResponse({ code: "SCHEDULE_UNAVAILABLE", message: "排班工作区暂时不可用。" }, 503)
          : jsonResponse(planningFixture());
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/planning"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "暂时无法读取排班工作区" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));

    expect(await screen.findByRole("heading", { name: "排班模板" })).toBeVisible();
    expect(planningReads).toBe(2);
  });
});
