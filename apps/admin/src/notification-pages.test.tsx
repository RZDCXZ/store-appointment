import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

const managerAccount = {
  id: "manager",
  username: "manager",
  displayName: "沈青",
  role: "manager",
} as const;

const failedTask = {
  id: "notification-seed-final-failed",
  type: "rescheduled",
  typeLabel: "预约改期通知",
  status: "manual_retry_required",
  channel: "模拟微信通道",
  customer: { id: "customer-cheng-mo", displayName: "程墨" },
  booking: {
    id: "booking-bohe-future-rescheduled",
    petName: "薄荷",
    serviceName: "猫咪洗护",
    startsAt: "2026-08-15T07:00:00.000Z",
  },
  attemptCount: 3,
  createdAt: "2026-08-13T02:50:00.000Z",
  availableAt: "2026-08-13T02:50:00.000Z",
} as const;

const attempts = [1, 2, 3].map((number) => ({
  id: `notification-seed-final-failed-attempt-${number}`,
  number,
  mode: "automatic" as const,
  attemptedAt: `2026-08-13T02:50:0${number}.000Z`,
  result: "failed" as const,
  detail: "模拟微信通道发送失败",
}));

const failedDetail = {
  task: { ...failedTask, attempts },
  businessFactNotice: "通知失败不会撤销已经成立的预约事实。",
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class FakeEventSource {
  static instance: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private refreshListener: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instance = this;
    queueMicrotask(() => this.onopen?.());
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "refresh") this.refreshListener = listener;
  }

  removeEventListener(): void {}

  close(): void {}

  emitRefresh(data: object): void {
    this.refreshListener?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MG-15 通知任务页面", () => {
  it("列表作为独立路由展示通道、状态、预约事实和详情入口", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/notifications")) {
        return jsonResponse({
          channel: "模拟微信通道",
          tasks: [
            failedTask,
            {
              ...failedTask,
              id: "notification-seed-sent",
              status: "sent",
              type: "booking_confirmed",
              typeLabel: "预约确认通知",
              attemptCount: 1,
            },
          ],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/notifications"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "通知任务" })).toBeVisible();
    expect(screen.getByText("模拟微信通道")).toBeVisible();
    expect(await screen.findByText("需人工重试")).toBeVisible();
    expect(screen.getByText("已发送")).toBeVisible();
    expect(screen.getByText("通知失败不会撤销已经成立的预约事实。")).toBeVisible();
    expect(screen.getByRole("link", { name: /查看预约改期通知/ })).toHaveAttribute(
      "href",
      "/manager/system/notifications/notification-seed-final-failed",
    );
    expect(router.state.location.pathname).toBe("/manager/system/notifications");
  });

  it("通知状态变化提示只触发回源刷新，页面不把 SSE 当作事实", async () => {
    FakeEventSource.instance = null;
    vi.stubGlobal("EventSource", FakeEventSource);
    let reads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/notifications")) {
        reads += 1;
        return jsonResponse({
          channel: "模拟微信通道",
          tasks: [{ ...failedTask, status: reads === 1 ? "manual_retry_required" : "sent" }],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/notifications"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("需人工重试")).toBeVisible();
    act(() => {
      FakeEventSource.instance?.emitRefresh({
        scope: "manager-notifications",
        reason: "notification-changed",
      });
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(await screen.findByText("已发送")).toBeVisible();
  });

  it("列表加载后可展示空状态", async () => {
    let resolveList!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/notifications")) {
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/notifications"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "正在读取通知事实…" })).toBeVisible();
    await waitFor(() => expect(resolveList).toBeTypeOf("function"));
    await act(async () => {
      resolveList(jsonResponse({ channel: "模拟微信通道", tasks: [] }));
    });
    expect(await screen.findByText("当前没有通知任务")).toBeVisible();
  });

  it("列表读取失败可以重试，无权限不会伪装成普通空状态", async () => {
    let reads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/notifications")) {
        reads += 1;
        return reads === 1
          ? jsonResponse({ code: "TEMPORARY_FAILURE", message: "通知任务暂时无法读取" }, 503)
          : jsonResponse({ code: "FORBIDDEN", message: "没有权限读取通知任务" }, 403);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/notifications"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("通知任务暂时无法读取")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByRole("heading", { name: "没有权限读取通知任务" })).toBeVisible();
    expect(screen.queryByText("当前没有通知任务")).not.toBeInTheDocument();
  });

  it("详情直达后恢复尝试记录，并支持失败注入与人工重试", async () => {
    let detailReads = 0;
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body ? String(init.body) : null });
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/notifications/notification-seed-final-failed")) {
        detailReads += 1;
        return jsonResponse(failedDetail);
      }
      if (
        url.endsWith(
          "/backoffice/manager/notifications/notification-seed-final-failed/simulated-failures",
        )
      ) {
        return jsonResponse({
          notificationId: failedTask.id,
          simulatedFailuresRemaining: 1,
        });
      }
      if (
        url.endsWith(
          "/backoffice/manager/notifications/notification-seed-final-failed/manual-retry",
        )
      ) {
        return jsonResponse({
          notificationId: failedTask.id,
          status: "pending",
          acceptedAt: "2026-08-13T02:50:00.000Z",
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/notifications/notification-seed-final-failed"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "预约改期通知" })).toBeVisible();
    expect(screen.getAllByText("模拟微信通道发送失败")).toHaveLength(3);
    expect(screen.getByText("通知失败不会撤销已经成立的预约事实。")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "注入下一次模拟失败" }));
    expect(await screen.findByText("已注入 1 次模拟失败。")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "人工重试" }));
    expect(await screen.findByText("人工重试已受理，正在读取最新结果。")).toBeVisible();
    await waitFor(() => expect(detailReads).toBeGreaterThan(1));

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringMatching(/\/simulated-failures$/),
          method: "POST",
          body: JSON.stringify({ count: 1 }),
        }),
        expect.objectContaining({
          url: expect.stringMatching(/\/manual-retry$/),
          method: "POST",
        }),
      ]),
    );
    expect(router.state.location.pathname).toBe(
      "/manager/system/notifications/notification-seed-final-failed",
    );
  });

  it("详情读取可重试，写失败保留已有尝试且不显示假成功", async () => {
    let detailReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/notifications/notification-seed-final-failed")) {
        detailReads += 1;
        return detailReads === 1
          ? jsonResponse({ code: "TEMPORARY_FAILURE", message: "通知详情暂时无法读取" }, 503)
          : jsonResponse(failedDetail);
      }
      if (
        url.endsWith(
          "/backoffice/manager/notifications/notification-seed-final-failed/manual-retry",
        ) &&
        init?.method === "POST"
      ) {
        return jsonResponse({ code: "CHANNEL_UNAVAILABLE", message: "模拟通道暂时不可用" }, 503);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/system/notifications/notification-seed-final-failed"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("通知详情暂时无法读取")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("累计尝试 3 次")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "人工重试" }));
    expect(await screen.findByText("模拟通道暂时不可用")).toBeVisible();
    expect(screen.getByText("累计尝试 3 次")).toBeVisible();
    expect(screen.queryByText("人工重试已受理，正在读取最新结果。")).not.toBeInTheDocument();
  });
});
