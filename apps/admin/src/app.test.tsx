import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

describe("后台路由与健康状态", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_DEMO_NOW", "2026-08-13T02:50:00.000Z");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("directly renders the workbench route and shows the API status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          database: "ready",
          service: "rongguang-api",
          status: "ok",
          timestamp: "2026-08-13T02:50:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const router = createMemoryRouter(routes, { initialEntries: ["/manager/workbench"] });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "茸光宠物洗护" })).toBeVisible();
    expect(screen.getByText("上海演示时间：2026年8月13日 周四 10:50")).toBeVisible();
    expect(screen.getByText("API 与数据库已就绪")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看 OpenAPI" })).toHaveAttribute(
      "href",
      "http://localhost:4100/docs",
    );
    expect(router.state.location.pathname).toBe("/manager/workbench");
  });
});
