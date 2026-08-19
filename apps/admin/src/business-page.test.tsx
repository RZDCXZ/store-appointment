import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ManagerBusinessMetricsResponse,
  ManagerBusinessSeriesResponse,
} from "@rongguang/contracts";

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

const metrics: ManagerBusinessMetricsResponse = {
  timeZone: "Asia/Shanghai",
  demoNow: "2026-08-13T02:50:00.000Z",
  periodDays: 30,
  currentPeriodRevision: "business-revision-30",
  currentWindow: { startsOn: "2026-07-15", endsOn: "2026-08-13" },
  previousWindow: { startsOn: "2026-06-15", endsOn: "2026-07-14" },
  current: {
    bookingCount: 6,
    completedBookingCount: 3,
    completedServiceMinutes: 210,
    availableStaffMinutes: 420,
    utilizationRate: 0.5,
    completedListPriceCents: 42_400,
    cancellationCount: 1,
    cancellationDenominator: 6,
    cancellationRate: 1 / 6,
    noShowCount: 1,
    noShowDenominator: 5,
    noShowRate: 0.2,
    terminationCount: 1,
    terminationDenominator: 6,
    terminationRate: 1 / 6,
  },
  previous: {
    bookingCount: 8,
    completedBookingCount: 2,
    completedServiceMinutes: 120,
    availableStaffMinutes: 300,
    utilizationRate: 0.4,
    completedListPriceCents: 30_000,
    cancellationCount: 1,
    cancellationDenominator: 8,
    cancellationRate: 0.125,
    noShowCount: 0,
    noShowDenominator: 7,
    noShowRate: 0,
    terminationCount: 0,
    terminationDenominator: 8,
    terminationRate: 0,
  },
  revisit90Days: {
    periodDays: 90,
    currentWindow: { startsOn: "2026-05-16", endsOn: "2026-08-13" },
    previousWindow: { startsOn: "2026-02-15", endsOn: "2026-05-15" },
    current: { completedCustomerCount: 2, revisitCustomerCount: 1, revisitRate: 0.5 },
    previous: { completedCustomerCount: 4, revisitCustomerCount: 1, revisitRate: 0.25 },
  },
};

const series: ManagerBusinessSeriesResponse = {
  timeZone: "Asia/Shanghai",
  periodDays: 30,
  currentPeriodRevision: "business-revision-30",
  window: metrics.currentWindow,
  points: [
    {
      localDate: "2026-08-12",
      ...metrics.current,
      completedListPriceCents: 12_800,
      utilizationRate: 0.4,
    },
    {
      localDate: "2026-08-13",
      ...metrics.current,
      completedListPriceCents: 29_600,
      utilizationRate: 0.6,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyMetrics(): ManagerBusinessMetricsResponse {
  const empty = {
    bookingCount: 0,
    completedBookingCount: 0,
    completedServiceMinutes: 0,
    availableStaffMinutes: 0,
    utilizationRate: null,
    completedListPriceCents: 0,
    cancellationCount: 0,
    cancellationDenominator: 0,
    cancellationRate: null,
    noShowCount: 0,
    noShowDenominator: 0,
    noShowRate: null,
    terminationCount: 0,
    terminationDenominator: 0,
    terminationRate: null,
  };
  return {
    ...metrics,
    current: empty,
    previous: empty,
    revisit90Days: {
      ...metrics.revisit90Days,
      current: { completedCustomerCount: 0, revisitCustomerCount: 0, revisitRate: null },
      previous: { completedCustomerCount: 0, revisitCustomerCount: 0, revisitRate: null },
    },
  };
}

describe("MG-17 经营看板页面", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
    vi.stubEnv("VITE_DEMO_NOW", "2026-08-13T02:50:00.000Z");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("直接路由恢复所选周期，并让精确数值、公式、趋势和非实收说明同时可读", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/backoffice/manager/business/metrics?period=90")) {
        return jsonResponse({ ...metrics, periodDays: 90 });
      }
      if (url.includes("/backoffice/manager/business/series?period=90")) {
        return jsonResponse({ ...series, periodDays: 90 });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/business?period=90"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "经营看板" })).toBeVisible();
    expect(screen.getByRole("button", { name: "近 90 天" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByText("50.00%")).toBeVisible();
    expect(screen.getByText("¥424.00")).toBeVisible();
    expect(screen.getByText("非实收金额")).toBeVisible();
    expect(screen.getByText("210 分钟 ÷ 420 分钟")).toBeVisible();
    expect(
      screen.getByText("已完成预约计划服务分钟数 ÷（已发布排班分钟数 − 休息 − 生效停班）"),
    ).toBeVisible();
    expect(screen.getByText("较前期增加 10.00 个百分点")).toBeVisible();
    expect(screen.getByText("1 笔 · 16.67%")).toBeVisible();
    expect(screen.getByText("至少完成 2 次：1 位 ÷ 至少完成 1 次：2 位")).toBeVisible();
    expect(screen.getByRole("heading", { name: "已完成服务标价" })).toBeVisible();
    expect(screen.getByText("已完成预约价格快照之和")).toBeVisible();
    expect(screen.getByRole("heading", { name: "服务终止" })).toBeVisible();
    expect(screen.getByRole("listitem", { name: "2026-08-12：40.00%" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(router.state.location.search).toBe("?period=90");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4100/backoffice/manager/business/metrics?period=90",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("周期切换写入 URL，刷新入口可恢复同一选择", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/business/metrics")) {
        return jsonResponse(
          url.includes("period=7")
            ? {
                ...metrics,
                periodDays: 7,
                currentPeriodRevision: "business-revision-7",
                current: { ...metrics.current, completedListPriceCents: 700 },
              }
            : metrics,
        );
      }
      if (url.includes("/business/series")) {
        return jsonResponse(
          url.includes("period=7")
            ? { ...series, periodDays: 7, currentPeriodRevision: "business-revision-7" }
            : series,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/business"] });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "近 7 天" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=7"));
    expect(screen.getByRole("button", { name: "近 7 天" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("¥7.00")).toBeVisible();
  });

  it("切换周期失败时明确保留旧周期事实，不冒充为新周期", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("period=7")) {
        return jsonResponse(
          { code: "PERIOD_UNAVAILABLE", message: "近 7 天事实暂时不可用。" },
          500,
        );
      }
      if (url.includes("/business/metrics")) return jsonResponse(metrics);
      if (url.includes("/business/series")) return jsonResponse(series);
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/business"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("¥424.00")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "近 7 天" }));

    expect(
      await screen.findAllByText(
        "近 7 天事实暂时不可用。以下保留近 30 天上次结果，未作为近 7 天数据。",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("¥424.00")).toBeVisible();
    expect(screen.getByText("保留近 30 天上次结果")).toBeVisible();
    expect(screen.getByRole("button", { name: "近 7 天" })).toHaveAttribute("aria-pressed", "true");
  });

  it("指标与趋势事实版本不一致时停止绘图并提供共同重试", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/business/metrics")) return jsonResponse(metrics);
      if (url.includes("/business/series")) {
        return jsonResponse({ ...series, currentPeriodRevision: "newer-revision" });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/business"] });
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByText("经营指标与每日趋势来自不同事实版本，请重新同步。"),
    ).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "服务工时利用率每日趋势" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新同步经营事实" })).toBeVisible();
  });

  it("每日趋势局部失败时保留已加载指标，并可独立重试", async () => {
    let seriesAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/business/metrics")) return jsonResponse(metrics);
      if (url.includes("/business/series")) {
        seriesAttempts += 1;
        return seriesAttempts === 1
          ? jsonResponse({ code: "SERIES_UNAVAILABLE", message: "每日趋势暂时不可用。" }, 500)
          : jsonResponse(series);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/business"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("¥424.00")).toBeVisible();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("每日趋势暂时不可用。")).toBeVisible();
    fireEvent.click(within(alert).getByRole("button", { name: "重试每日趋势" }));
    expect(await screen.findByRole("region", { name: "服务工时利用率每日趋势" })).toBeVisible();
    expect(seriesAttempts).toBe(2);
  });

  it("空周期不伪造比例，仍可按当前周期导出 CSV", async () => {
    const downloadClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:business-export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    let exportInit: RequestInit | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/business/metrics")) return jsonResponse(emptyMetrics());
      if (url.includes("/business/series")) {
        return jsonResponse({ ...series, points: [] });
      }
      if (url.endsWith("/backoffice/manager/business/export.csv")) {
        exportInit = init;
        return new Response("上海业务日期\r\n", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="business.csv"',
          },
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/business"] });
    render(<RouterProvider router={router} />);

    expect((await screen.findAllByText("暂无比例（分母为 0）")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "导出当前周期 CSV" }));
    await waitFor(() => expect(downloadClick).toHaveBeenCalledOnce());
    expect(exportInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: "30" }),
    });
  });

  it("员工直达经营路由只看到页面级无权限，且不请求经营数据", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      throw new Error(`员工页面不应请求经营数据：${String(input)}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/business?period=90"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "没有权限" })).toBeVisible();
    expect(screen.getByText("员工身份不能访问店长页面。")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
