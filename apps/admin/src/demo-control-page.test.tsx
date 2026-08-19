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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MG-18 演示时间与数据重置", () => {
  it("独立路由恢复当前上海演示时间，并推进时间后立即更新横条", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body ? String(init.body) : null });
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/demo/status")) {
        return jsonResponse({
          enabled: true,
          now: "2026-08-13T02:50:00.000Z",
          timeZone: "Asia/Shanghai",
        });
      }
      if (url.endsWith("/backoffice/manager/demo/advance")) {
        return jsonResponse(
          {
            previousNow: "2026-08-13T02:50:00.000Z",
            now: "2026-08-13T03:05:00.000Z",
            timeZone: "Asia/Shanghai",
            remindersCreated: 1,
          },
          201,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/system/demo"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "演示时间与数据重置" })).toBeVisible();
    expect((await screen.findAllByText(/2026年8月13日.*10:50/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "+15 分钟" }));
    expect(await screen.findByText("演示时间已推进，并生成 1 个到期提醒。")).toBeVisible();
    expect(screen.getAllByText(/2026年8月13日.*11:05/).length).toBeGreaterThan(0);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ minutes: 15 }),
        }),
      ]),
    );
    expect(router.state.location.pathname).toBe("/manager/system/demo");
  });

  it("重置明确文件、业务数据和旧会话后果，并要求两步确认", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/demo/status")) {
        return jsonResponse({
          enabled: true,
          now: "2026-08-13T02:50:00.000Z",
          timeZone: "Asia/Shanghai",
        });
      }
      if (url.endsWith("/backoffice/manager/demo/reset") && init?.method === "POST") {
        expect(init.body).toBe(JSON.stringify({ confirmation: "重置茸光演示数据" }));
        return jsonResponse(
          {
            now: "2026-08-13T02:50:00.000Z",
            timeZone: "Asia/Shanghai",
            invalidatedSessions: "all",
            uploadsRestored: true,
          },
          201,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/system/demo"] });
    render(<RouterProvider router={router} />);

    const resetButton = await screen.findByRole("button", { name: "重置演示数据" });
    await waitFor(() => expect(resetButton).toBeEnabled());
    fireEvent.click(resetButton);
    expect(screen.getByText("上传文件会被清理，种子素材会恢复")).toBeVisible();
    expect(screen.getByText("预约、排班、通知、审计与经营样例会重建")).toBeVisible();
    expect(screen.getByText("全部后台与小程序旧会话会失效")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "继续确认" }));

    const confirmation = screen.getByLabelText("请输入：重置茸光演示数据");
    expect(screen.getByRole("button", { name: "确认重置演示数据" })).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: "重置茸光演示数据" } });
    fireEvent.click(screen.getByRole("button", { name: "确认重置演示数据" }));
    await waitFor(() =>
      expect(screen.getByText("演示数据已恢复；全部旧会话现在均已失效。")).toBeVisible(),
    );
  });
});
