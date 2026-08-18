import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

const staffAccount = {
  id: "chenjia",
  username: "chenjia",
  displayName: "陈嘉",
  role: "staff",
};

const bookingDetail = {
  booking: {
    id: "booking-bohe-future",
    status: "confirmed",
    action: "check_in",
    customer: { displayName: "程默", phoneMasked: "138****0136" },
    pet: {
      id: "pet-bohe",
      name: "薄荷",
      species: "cat",
      photoPath: null,
      careTags: ["怕吹风"],
      weightKg: 5.2,
      petSize: "small",
      breed: "英短",
      sex: "female",
      birthDate: "2022-04-10",
      coatType: "short",
      careNotes: "降低风速",
    },
    service: {
      id: "svc-cat",
      name: "猫咪精洗",
      addonNames: ["指甲护理"],
      durationMinutes: 90,
    },
    staff: { id: "chenjia", displayName: "陈嘉" },
    startsAt: "2026-08-14T03:00:00.000Z",
    endsAt: "2026-08-14T04:30:00.000Z",
  },
  statusHistory: [
    {
      id: "event-confirmed",
      type: "booking_confirmed",
      actorType: "customer",
      actorId: "customer-cheng-mo",
      actorDisplayName: "程默",
      reason: null,
      occurredAt: "2026-08-10T02:00:00.000Z",
    },
  ],
  petServiceHistory: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fulfilmentResponse(outcome: "checked_in" | "no_show", reason: string | null) {
  return {
    bookingId: bookingDetail.booking.id,
    status: outcome,
    outcome,
    occurredAt: "2026-08-14T03:20:00.000Z",
    actor: { type: "staff", id: "chenjia", displayName: "陈嘉" },
    reason,
    actualOccupancy: {
      startsAt: "2026-08-14T03:00:00.000Z",
      endsAt: outcome === "no_show" ? "2026-08-14T03:20:00.000Z" : "2026-08-14T04:45:00.000Z",
    },
    originalSchedule: {
      startsAt: "2026-08-14T03:00:00.000Z",
      endsAt: "2026-08-14T04:30:00.000Z",
      occupancyStartsAt: "2026-08-14T03:00:00.000Z",
      occupancyEndsAt: "2026-08-14T04:45:00.000Z",
    },
  };
}

describe("ST-04 / ST-05 员工履约命令页", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("可直达正常核销路由并提交六位码，结果明确保留首次核销时间", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        return jsonResponse(bookingDetail);
      }
      if (url.endsWith(`/backoffice/bookings/${bookingDetail.booking.id}/check-in`)) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({ verificationCode: "314159" });
        return jsonResponse(fulfilmentResponse("checked_in", null), 201);
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}/check-in`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "到店核销" })).toBeVisible();
    expect(screen.getByText("开始前 30 分钟至开始后 15 分钟")).toBeVisible();
    fireEvent.change(screen.getByLabelText("六位核销码"), { target: { value: "314159" } });
    fireEvent.click(screen.getByRole("button", { name: "确认到店核销" }));

    expect(await screen.findByText("已完成到店核销")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("8月14日周五 11:20");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(router.state.location.pathname).toBe(
      `/staff/appointments/${bookingDetail.booking.id}/check-in`,
    );
  });

  it("预约详情按当前行动进入独立核销或迟到处理路由", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        return jsonResponse(bookingDetail);
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}`],
    });
    const rendered = render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("link", { name: "输入核销码" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/staff/appointments/${bookingDetail.booking.id}/check-in`,
      ),
    );

    rendered.unmount();
    const lateRouter = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}`],
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        return jsonResponse({
          ...bookingDetail,
          booking: { ...bookingDetail.booking, action: "late" },
        });
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    render(<RouterProvider router={lateRouter} />);

    fireEvent.click(await screen.findByRole("link", { name: "处理迟到" }));
    await waitFor(() =>
      expect(lateRouter.state.location.pathname).toBe(
        `/staff/appointments/${bookingDetail.booking.id}/late`,
      ),
    );
  });

  it("迟到页区分手动核销和危险爽约，并在确认后释放后续实际占用", async () => {
    const lateDetail = {
      ...bookingDetail,
      booking: { ...bookingDetail.booking, action: "late" },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        return jsonResponse(lateDetail);
      }
      if (url.endsWith(`/backoffice/bookings/${bookingDetail.booking.id}/no-show`)) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          reason: "电话无人接听，顾客未到店",
        });
        return jsonResponse(fulfilmentResponse("no_show", "电话无人接听，顾客未到店"), 201);
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}/late`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "迟到处理" })).toBeVisible();
    expect(screen.getByRole("radio", { name: /手动迟到核销/ })).toBeChecked();
    expect(screen.getByText(/不改变原计划容量占用/)).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /标记爽约/ }));
    expect(screen.getByText(/释放处理时刻之后的实际占用/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("处理原因"), {
      target: { value: "电话无人接听，顾客未到店" },
    });
    const submit = screen.getByRole("button", { name: "确认标记爽约" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText("我确认顾客未到店，并理解此操作会结束预约"));
    fireEvent.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent("已人工标记爽约");
    expect(screen.getByRole("status")).toHaveTextContent("不会自动处罚顾客");
  });

  it("刷新独立路由后从状态历史恢复首次履约结果，不重复提交命令", async () => {
    const completedDetail = {
      ...bookingDetail,
      booking: { ...bookingDetail.booking, status: "checked_in", action: "complete" },
      statusHistory: [
        ...bookingDetail.statusHistory,
        {
          id: "event-check-in",
          type: "booking_checked_in",
          actorType: "staff",
          actorId: "chenjia",
          actorDisplayName: "陈嘉",
          reason: null,
          occurredAt: "2026-08-14T03:05:00.000Z",
        },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        return jsonResponse(completedDetail);
      }
      throw new Error(`刷新不应再次提交命令：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}/check-in`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByText("已完成到店核销")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("8月14日周五 11:05 · 陈嘉");
    expect(screen.queryByLabelText("六位核销码")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("提交遇到状态冲突后刷新预约事实并引导到当前可用动作", async () => {
    let detailReads = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        detailReads += 1;
        return jsonResponse(
          detailReads === 1
            ? bookingDetail
            : {
                ...bookingDetail,
                booking: { ...bookingDetail.booking, action: "late" },
              },
        );
      }
      if (url.endsWith(`/backoffice/bookings/${bookingDetail.booking.id}/check-in`)) {
        return jsonResponse(
          { code: "CHECK_IN_WINDOW_CLOSED", message: "正常核销窗口已结束，请改为处理迟到。" },
          409,
        );
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}/check-in`],
    });

    render(<RouterProvider router={router} />);

    fireEvent.change(await screen.findByLabelText("六位核销码"), {
      target: { value: "314159" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认到店核销" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("已重新读取预约当前状态");
    expect(await screen.findByRole("link", { name: "前往迟到处理" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("服务端拒绝请求后更换幂等键，允许员工修正核销码重新提交", async () => {
    const submittedKeys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${bookingDetail.booking.id}`)) {
        return jsonResponse(bookingDetail);
      }
      if (url.endsWith(`/backoffice/bookings/${bookingDetail.booking.id}/check-in`)) {
        const payload = JSON.parse(String(init?.body)) as {
          idempotencyKey: string;
          verificationCode: string;
        };
        submittedKeys.push(payload.idempotencyKey);
        return payload.verificationCode === "314159"
          ? jsonResponse(fulfilmentResponse("checked_in", null), 201)
          : jsonResponse(
              { code: "INVALID_VERIFICATION_CODE", message: "核销码不正确，请重新输入。" },
              400,
            );
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${bookingDetail.booking.id}/check-in`],
    });

    render(<RouterProvider router={router} />);

    const input = await screen.findByLabelText("六位核销码");
    fireEvent.change(input, { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "确认到店核销" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("核销码不正确");

    fireEvent.change(input, { target: { value: "314159" } });
    fireEvent.click(screen.getByRole("button", { name: "确认到店核销" }));
    expect(await screen.findByText("已完成到店核销")).toBeVisible();
    expect(submittedKeys).toHaveLength(2);
    expect(submittedKeys[1]).not.toBe(submittedKeys[0]);
  });
});
