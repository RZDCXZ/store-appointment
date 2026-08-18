import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const optionsFixture = {
  timeZone: "Asia/Shanghai",
  demoNow: "2026-08-13T02:50:00.000Z",
  window: {
    startsOn: "2026-08-13",
    endsOn: "2026-08-26",
    days: [
      {
        date: "2026-08-13",
        weekday: 4,
        businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
        publishedStaffCount: 4,
      },
      {
        date: "2026-08-14",
        weekday: 5,
        businessHours: { status: "open", opensAt: "09:30", closesAt: "19:00" },
        publishedStaffCount: 4,
      },
    ],
  },
  staff: [
    { id: "linxia", displayName: "林夏", employeeNumber: 1 },
    { id: "chenjia", displayName: "陈嘉", employeeNumber: 2 },
  ],
};

const previewFixture = {
  target: { kind: "store_closure", label: "门店临时闭店", staff: null },
  interval: { localDate: "2026-08-14", startsAt: "11:00", endsAt: "13:00" },
  reason: "临时设备检修",
  targetCapacityMinutes: 450,
  affectedBookingCount: 1,
  affectedBookings: [
    {
      id: "booking-bohe-future",
      revision: 1,
      status: "confirmed",
      customerName: "程墨",
      petName: "薄荷",
      serviceName: "猫咪洗护",
      staff: { id: "chenjia", displayName: "陈嘉" },
      startsAt: "2026-08-14T03:00:00.000Z",
      endsAt: "2026-08-14T04:30:00.000Z",
      turnoverEndsAt: "2026-08-14T04:45:00.000Z",
    },
  ],
  outcome: "pending",
  consequence: "确认后该区间立即停止接受新预约；已有预约保持原员工、时段和状态，等待逐笔处理。",
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MG-10 停班或临时闭店创建", () => {
  it("独立路由可直接恢复，并在预览后显示目标容量、受影响预约和后果再确认", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ url, method, body });

      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/capacity-changes/options")) {
        return jsonResponse(optionsFixture);
      }
      if (url.endsWith("/backoffice/manager/capacity-changes/preview")) {
        return jsonResponse(previewFixture, 201);
      }
      if (url.endsWith("/backoffice/manager/capacity-changes")) {
        return jsonResponse(
          {
            change: {
              id: "store-closure-new",
              kind: "store_closure",
              ...previewFixture,
              status: "pending",
              createdAt: optionsFixture.demoNow,
            },
            nextStep: {
              label: "查看待处理区间",
              href: "/manager/appointments/calendar?date=2026-08-14",
            },
          },
          201,
        );
      }
      throw new Error(`未处理请求：${method} ${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/capacity-changes/new"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "创建停班或临时闭店" })).toBeInTheDocument();
    expect(screen.getByText(/MG-10/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "容量变化" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(await screen.findByRole("radio", { name: /临时闭店/ }));
    expect(screen.queryByLabelText("员工")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-08-14" } });
    fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "13:00" } });
    fireEvent.change(screen.getByLabelText("原因"), {
      target: { value: "临时设备检修" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览影响" }));

    expect(await screen.findByRole("heading", { name: "影响摘要" })).toBeInTheDocument();
    expect(screen.getByText("7.5 员工小时")).toBeInTheDocument();
    expect(screen.getByText("1 笔预约")).toBeInTheDocument();
    expect(screen.getByText(/薄荷 · 程墨/)).toBeInTheDocument();
    expect(screen.getByText(previewFixture.consequence)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并进入待处理" }));

    expect(await screen.findByRole("status")).toHaveTextContent("容量变化已进入待处理");
    expect(screen.getByRole("link", { name: "查看待处理区间" })).toHaveAttribute(
      "href",
      "/manager/appointments/calendar?date=2026-08-14",
    );
    expect(requests.at(-2)).toMatchObject({
      method: "POST",
      body: {
        kind: "store_closure",
        localDate: "2026-08-14",
        startsAt: "11:00",
        endsAt: "13:00",
        reason: "临时设备检修",
      },
    });
    expect(requests.at(-1)).toMatchObject({ method: "POST", body: requests.at(-2)?.body });
  });

  it("初次读取失败可重试，字段错误会回到对应表单项且不显示假成功", async () => {
    let optionsReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/capacity-changes/options")) {
        optionsReads += 1;
        return optionsReads === 1
          ? jsonResponse({ code: "TEMPORARY_FAILURE", message: "容量资料暂时不可用" }, 503)
          : jsonResponse(optionsFixture);
      }
      if (url.endsWith("/backoffice/manager/capacity-changes/preview")) {
        return jsonResponse(
          {
            code: "VALIDATION_ERROR",
            message: "请检查容量变化信息。",
            fieldErrors: { interval: "员工停班区间必须完整落在已发布班次内。" },
          },
          400,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/schedule/capacity-changes/new"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("容量资料暂时不可用");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByRole("heading", { name: "创建停班或临时闭店" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("原因"), { target: { value: "临时停班" } });
    fireEvent.click(screen.getByRole("button", { name: "预览影响" }));

    expect(await screen.findByText("员工停班区间必须完整落在已发布班次内。")).toBeInTheDocument();
    expect(screen.queryByText("容量变化已进入待处理")).not.toBeInTheDocument();
    await waitFor(() => expect(optionsReads).toBe(2));
  });
});
