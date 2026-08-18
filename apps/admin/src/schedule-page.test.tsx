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

function addDateDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);

  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function scheduleFixture() {
  return {
    timeZone: "Asia/Shanghai",
    demoNow: "2026-08-13T02:50:00.000Z",
    selectedDate: "2026-08-15",
    window: {
      startsOn: "2026-08-13",
      endsOn: "2026-08-26",
      days: Array.from({ length: 14 }, (_, index) => ({
        date: addDateDays("2026-08-13", index),
        weekday: (4 + index) % 7,
        businessHours:
          (4 + index) % 7 === 1
            ? { status: "closed", opensAt: null, closesAt: null }
            : { status: "open", opensAt: "09:30", closesAt: "19:00" },
        publishedStaffCount: (4 + index) % 7 === 1 ? 0 : 4,
      })),
    },
    businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
    draftDayCount: 0,
    staffDays: [
      {
        staff: {
          id: "linxia",
          displayName: "林夏",
          employeeNumber: 1,
          skills: ["dog-basic-care", "dog-styling", "nail-care", "deshedding-care", "oral-care"],
        },
        scheduleStatus: "published",
        source: "date_exception",
        exception: { kind: "adjusted_shift", note: "周六门店活动，调整到岗与休息时间。" },
        shifts: [
          {
            startsAt: "11:00",
            endsAt: "19:00",
            breaks: [{ startsAt: "15:00", endsAt: "15:30" }],
            capacity: [
              { startsAt: "11:00", endsAt: "15:00" },
              { startsAt: "15:30", endsAt: "19:00" },
            ],
          },
        ],
      },
      {
        staff: {
          id: "chenjia",
          displayName: "陈嘉",
          employeeNumber: 2,
          skills: ["dog-basic-care", "cat-care", "nail-care", "deshedding-care"],
        },
        scheduleStatus: "published",
        source: "weekly_template",
        exception: null,
        shifts: [
          {
            startsAt: "10:30",
            endsAt: "19:00",
            breaks: [{ startsAt: "14:00", endsAt: "15:00" }],
            capacity: [
              { startsAt: "10:30", endsAt: "14:00" },
              { startsAt: "15:00", endsAt: "19:00" },
            ],
          },
        ],
      },
      {
        staff: {
          id: "zhouning",
          displayName: "周宁",
          employeeNumber: 3,
          skills: ["cat-care", "nail-care", "oral-care"],
        },
        scheduleStatus: "no_schedule",
        source: null,
        exception: null,
        shifts: [],
      },
      {
        staff: {
          id: "zhaohang",
          displayName: "赵航",
          employeeNumber: 4,
          skills: ["dog-basic-care", "dog-styling", "nail-care", "oral-care"],
        },
        scheduleStatus: "no_schedule",
        source: null,
        exception: null,
        shifts: [],
      },
    ],
  };
}

describe("MG-09 已发布排班页面", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
    vi.stubEnv("VITE_DEMO_NOW", "2026-08-13T02:50:00.000Z");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("可直接打开指定日期并区分营业时间、班次、休息、例外和无排班", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/session")) {
        return jsonResponse({ account: managerAccount });
      }

      if (url.endsWith("/backoffice/manager/schedule?date=2026-08-15")) {
        return jsonResponse(scheduleFixture());
      }

      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-15"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "已发布排班" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "8月15日 周六" })).toBeVisible();
    expect(screen.getByText("营业时间 09:30–19:00")).toBeVisible();
    expect(screen.getByText("日期例外")).toBeVisible();
    expect(screen.getByText("班次 11:00–19:00")).toBeVisible();
    expect(screen.getByText("休息 15:00–15:30")).toBeVisible();
    expect(screen.getAllByText("无排班")).toHaveLength(2);
    expect(screen.getByText("8月13日 周四 至 8月26日 周三")).toBeVisible();
    expect(screen.queryByText("2026-08-13 至 2026-08-26")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/manager/schedule/published");
    expect(new URLSearchParams(router.state.location.search).get("date")).toBe("2026-08-15");

    const dateNavigation = screen.getByRole("navigation", { name: "十四日排班日期" });
    expect(within(dateNavigation).getAllByRole("link")).toHaveLength(14);
    expect(within(dateNavigation).getByRole("link", { current: "date" })).toHaveTextContent(
      "8月15日",
    );
  });

  it("首次读取时显示与最终结构一致的排班骨架", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/auth/session")) {
        return Promise.resolve(jsonResponse({ account: managerAccount }));
      }

      return new Promise(() => undefined);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-15"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByLabelText("正在读取已发布排班")).toBeVisible();
    expect(screen.getAllByTestId("schedule-staff-skeleton")).toHaveLength(4);
  });

  it("空草稿在已发布页面说明未发布内容不产生容量", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/session")) {
        return jsonResponse({ account: managerAccount });
      }

      if (url.endsWith("/backoffice/manager/schedule?date=2026-08-13")) {
        const fixture = scheduleFixture();
        return jsonResponse({ ...fixture, selectedDate: "2026-08-13" });
      }

      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-13"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "已发布排班" })).toBeVisible();
    expect(
      await screen.findByText(
        (_, element) =>
          element?.classList.contains("schedule-draft-boundary") === true &&
          element.textContent?.replace(/\s/g, "") === "14天草稿：当前为空·未发布不形成容量",
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/manager/schedule/published");
  });

  it("局部刷新失败时保留最近成功读取的数据并允许重试", async () => {
    let scheduleAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/session")) {
        return jsonResponse({ account: managerAccount });
      }

      if (url.includes("/backoffice/manager/schedule?date=2026-08-15")) {
        scheduleAttempts += 1;
        return scheduleAttempts === 1
          ? jsonResponse(scheduleFixture())
          : jsonResponse({ code: "SCHEDULE_UNAVAILABLE", message: "排班服务暂时不可用。" }, 503);
      }

      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-15"],
    });

    render(<RouterProvider router={router} />);
    expect(await screen.findByText("林夏")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "刷新排班" }));

    expect(await screen.findByText("排班服务暂时不可用。")).toBeVisible();
    expect(screen.getByText(/仍显示最近成功读取的 8月15日数据/)).toBeVisible();
    expect(screen.getByText("林夏")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试刷新" })).toBeVisible();
    expect(scheduleAttempts).toBe(2);
  });

  it("员工直接打开 MG-09 会停留在该 URL 并看到无权限状态", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ account: staffAccount }));
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-15"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "没有权限" })).toBeVisible();
    expect(screen.getByText("员工身份不能访问店长页面。")).toBeVisible();
    expect(router.state.location.pathname).toBe("/manager/schedule/published");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("可在已发布排班上保存调班、加班或休息日期例外并刷新容量", async () => {
    let savedBody: unknown;
    let scheduleReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule?date=2026-08-15")) {
        scheduleReads += 1;
        return jsonResponse(scheduleFixture());
      }
      if (url.endsWith("/backoffice/manager/schedule/published/linxia/2026-08-15/exception")) {
        savedBody = JSON.parse(String(init?.body));
        return jsonResponse({ updated: true });
      }
      throw new Error(`未处理的测试请求：${url} ${init?.method ?? "GET"}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-15"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置林夏8月15日日期例外" }));
    const dialog = screen.getByRole("dialog", { name: "设置林夏8月15日日期例外" });
    fireEvent.change(within(dialog).getByLabelText("例外类型"), {
      target: { value: "special_break" },
    });
    fireEvent.change(within(dialog).getByLabelText("例外说明"), {
      target: { value: "活动日延长休息" },
    });
    fireEvent.change(within(dialog).getByLabelText("休息结束"), {
      target: { value: "16:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存日期例外" }));

    await waitFor(() =>
      expect(savedBody).toEqual({
        kind: "special_break",
        note: "活动日延长休息",
        shifts: [
          {
            startsAt: "11:00",
            endsAt: "19:00",
            breaks: [{ startsAt: "15:00", endsAt: "16:00" }],
          },
        ],
      }),
    );
    expect(await screen.findByText("林夏8月15日的日期例外已保存，容量已刷新。")).toBeVisible();
    expect(scheduleReads).toBe(2);
  });

  it("已发布日期例外影响预约时不覆盖排班并引导处理", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/schedule?date=2026-08-15")) {
        return jsonResponse(scheduleFixture());
      }
      if (url.endsWith("/backoffice/manager/schedule/published/linxia/2026-08-15/exception")) {
        return jsonResponse(
          {
            code: "SCHEDULE_CHANGE_AFFECTS_BOOKINGS",
            message: "日期例外会影响已有预约，请先逐笔处理。",
            impactSummary: { affectedBookingCount: 1 },
            affectedBookings: [
              {
                id: "booking-impact",
                petName: "团子",
                serviceName: "犬基础洗护",
                staffName: "林夏",
                startsAt: "2026-08-15T03:00:00.000Z",
                endsAt: "2026-08-15T04:15:00.000Z",
                resolutionPath: "/manager/appointments/booking-impact",
              },
            ],
          },
          409,
        );
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/published?date=2026-08-15"],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置林夏8月15日日期例外" }));
    const dialog = screen.getByRole("dialog", { name: "设置林夏8月15日日期例外" });
    fireEvent.change(within(dialog).getByLabelText("例外类型"), {
      target: { value: "day_off" },
    });
    fireEvent.change(within(dialog).getByLabelText("例外说明"), {
      target: { value: "临时请假" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存日期例外" }));

    expect(
      await screen.findByRole("heading", { name: "调整已阻断：1 笔预约受影响" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "处理团子的预约" })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-impact",
    );
    expect(screen.getByText("班次 11:00–19:00")).toBeVisible();
  });
});
