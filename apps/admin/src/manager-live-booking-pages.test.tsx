import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const booking = {
  id: "booking-live",
  status: "confirmed",
  customer: { id: "customer-cheng-mo", displayName: "程墨", phoneMasked: "139****0341" },
  pet: {
    id: "pet-bohe",
    name: "薄荷",
    species: "cat",
    photoPath: "/assets/brand/pet-bohe-british-shorthair.jpg",
  },
  primaryService: { id: "cat-care", name: "猫咪洗护" },
  addons: [],
  staff: { id: "chenjia", displayName: "陈嘉" },
  startsAt: "2026-08-13T07:00:00.000Z",
  endsAt: "2026-08-13T08:30:00.000Z",
  turnoverEndsAt: "2026-08-13T08:45:00.000Z",
  totalPriceCents: 16800,
  serviceDurationMinutes: 90,
  turnoverMinutes: 15,
} as const;

function staffDay(
  id: "linxia" | "chenjia" | "zhouning" | "zhaohang",
  displayName: string,
  employeeNumber: number,
  startsAt: string,
  endsAt: string,
  breakStartsAt: string,
  breakEndsAt: string,
) {
  return {
    staff: {
      id,
      displayName,
      employeeNumber,
      skills: [],
      avatarPath: `/assets/brand/staff-${id}.png`,
    },
    scheduleStatus: "published",
    source: "weekly_template",
    exception: null,
    shifts: [
      {
        startsAt,
        endsAt,
        breaks: [{ startsAt: breakStartsAt, endsAt: breakEndsAt }],
        capacity: [
          { startsAt, endsAt: breakStartsAt },
          { startsAt: breakEndsAt, endsAt },
        ],
      },
    ],
    bookings: id === "chenjia" ? [booking] : [],
    blocks:
      id === "chenjia"
        ? [
            {
              id: "pending-time-off",
              kind: "time_off",
              status: "pending",
              startsAt: "15:30",
              endsAt: "16:00",
              reason: "待处理停班",
              affectedBookingCount: 1,
            },
          ]
        : [],
    capacity: {
      publishedMinutes: 450,
      occupiedMinutes: id === "chenjia" ? 105 : 0,
      remainingMinutes: id === "chenjia" ? 345 : 450,
    },
  };
}

const staffDays = [
  staffDay("linxia", "林夏", 1, "09:30", "18:00", "13:00", "14:00"),
  staffDay("chenjia", "陈嘉", 2, "10:30", "19:00", "14:00", "15:00"),
  staffDay("zhouning", "周宁", 3, "09:30", "18:00", "12:30", "13:30"),
  staffDay("zhaohang", "赵航", 4, "10:30", "19:00", "14:30", "15:30"),
];

const windowDays = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-08-${String(13 + index).padStart(2, "0")}`,
  weekday: (4 + index) % 7,
  businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
  publishedStaffCount: 4,
}));

const workbenchFixture = {
  timeZone: "Asia/Shanghai",
  demoNow: "2026-08-13T02:50:00.000Z",
  localDate: "2026-08-13",
  risks: [
    {
      id: "late:booking-live",
      kind: "late_booking",
      title: "迟到待处理",
      detail: "薄荷，原定 10:30，负责人陈嘉",
      href: "/manager/appointments/booking-live",
    },
  ],
  statusSummary: {
    confirmed: 1,
    checked_in: 0,
    completed: 0,
    cancelled: 0,
    no_show: 0,
    terminated: 0,
  },
  staffDays,
  capacity: { publishedMinutes: 1800, occupiedMinutes: 105, remainingMinutes: 1695 },
};

const calendarFixture = {
  timeZone: "Asia/Shanghai",
  demoNow: "2026-08-13T02:50:00.000Z",
  selectedDate: "2026-08-13",
  window: { startsOn: "2026-08-13", endsOn: "2026-08-26", days: windowDays },
  businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
  staffDays,
  capacity: workbenchFixture.capacity,
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== listener),
    );
  }

  close(): void {}

  emit(type: string, data: unknown): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  reopen(): void {
    this.onopen?.();
  }
}

describe("店长即时预约页面", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("工作台按风险、状态、容量和员工时间线展示，并在 SSE 提示后回源刷新", async () => {
    let workbenchReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/workbench")) {
        workbenchReads += 1;
        if (workbenchReads === 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return jsonResponse(
          workbenchReads === 1
            ? workbenchFixture
            : {
                ...workbenchFixture,
                statusSummary: { ...workbenchFixture.statusSummary, confirmed: 2 },
              },
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/workbench"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByLabelText("正在读取今日工作台")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "风险队列" })).toBeInTheDocument();
    expect(screen.getByText("迟到待处理")).toBeInTheDocument();
    expect(screen.getByText("当前剩余容量")).toBeInTheDocument();
    expect(screen.getByText("薄荷")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看按员工日历/ })).toHaveAttribute(
      "href",
      "/manager/appointments/calendar?date=2026-08-13",
    );

    const events = FakeEventSource.instances[0];
    expect(events?.url).toContain("/backoffice/manager/events");
    act(() => {
      events?.emit("refresh", {
        scope: "manager-live-bookings",
        reason: "booking-changed",
      });
    });

    await waitFor(() => expect(workbenchReads).toBe(2));
    expect(screen.getByLabelText("已确认 2 笔")).toBeInTheDocument();
  });

  it("SSE 重连后重新拉取事实，失败时保留旧数据并允许重试", async () => {
    let workbenchReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/workbench")) {
        workbenchReads += 1;
        return workbenchReads === 1
          ? jsonResponse(workbenchFixture)
          : jsonResponse({ code: "REQUEST_FAILED", message: "暂时无法更新工作台" }, 503);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/workbench"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("薄荷")).toBeInTheDocument();
    expect(await screen.findByText("实时更新已连接")).toBeInTheDocument();
    act(() => FakeEventSource.instances[0]?.reopen());

    expect(await screen.findByText("暂时无法更新工作台")).toBeInTheDocument();
    expect(screen.getByText("薄荷")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试刷新" })).toBeInTheDocument();
  });

  it("MG-02 日历为独立可恢复路由，并明确非班次、休息、预约、周转和状态", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/calendar?date=2026-08-13")) {
        return jsonResponse(calendarFixture);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/appointments/calendar?date=2026-08-13"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "按员工日历" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("manager-calendar-staff")).toHaveLength(4);
    expect(screen.getAllByText("非班次").length).toBeGreaterThan(0);
    expect(screen.getAllByText("休息").length).toBeGreaterThan(0);
    expect(screen.getByText("周转 15 分钟")).toBeInTheDocument();
    expect(screen.getByText("已确认")).toBeInTheDocument();
    expect(screen.getByText(/影响 1 笔预约/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /薄荷.*猫咪洗护/ })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-live",
    );
    expect(router.state.location.pathname).toBe("/manager/appointments/calendar");
    expect(router.state.location.search).toBe("?date=2026-08-13");
  });

  it("预约详情拥有独立直达入口，刷新时从 API 恢复事实", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/bookings/booking-live")) {
        return jsonResponse({
          booking,
          petProfile: {
            weightKg: 4.2,
            petSize: "small",
            breed: "英国短毛猫",
            careTags: [],
            careNotes: null,
          },
          serviceRecord: null,
          changeHistory: [],
          notifications: [],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/appointments/booking-live"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "薄荷的预约" })).toBeInTheDocument();
    expect(screen.getByText("程墨")).toBeInTheDocument();
    expect(screen.getByText("猫咪洗护")).toBeInTheDocument();
    expect(screen.getByText(/陈嘉 · 周转 15 分钟/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/manager/appointments/booking-live");
  });
});
