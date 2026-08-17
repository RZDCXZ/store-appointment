import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
            startsAt: "09:30",
            endsAt: "18:00",
            breaks: [{ startsAt: "12:00", endsAt: "12:45" }],
            capacity: [
              { startsAt: "09:30", endsAt: "12:00" },
              { startsAt: "12:45", endsAt: "18:00" },
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

  it("空草稿使用独立路由并说明未发布内容不产生容量", async () => {
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
      initialEntries: ["/manager/schedule/draft"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "14 天排班草稿" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "当前没有待发布草稿" })).toBeVisible();
    expect(screen.getByText(/未发布草稿不产生可预约容量/)).toBeVisible();
    expect(router.state.location.pathname).toBe("/manager/schedule/draft");
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
});
