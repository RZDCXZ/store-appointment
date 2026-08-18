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

const customerBooking = {
  id: "booking-bohe-future",
  status: "confirmed",
  pet: {
    id: "pet-bohe",
    name: "薄荷",
    species: "cat",
    weightKg: 4.8,
    petSize: "small",
  },
  primaryService: { id: "cat-care", name: "猫咪洗护", priceCents: 16800, durationMinutes: 90 },
  addons: [],
  staff: { id: "chenjia", displayName: "陈嘉" },
  startsAt: "2026-08-14T03:00:00.000Z",
  endsAt: "2026-08-14T04:30:00.000Z",
  turnoverEndsAt: "2026-08-14T04:45:00.000Z",
  totalPriceCents: 16800,
  serviceDurationMinutes: 90,
  turnoverMinutes: 15,
  originalSchedule: {
    startsAt: "2026-08-14T03:00:00.000Z",
    endsAt: "2026-08-14T04:30:00.000Z",
    occupancyStartsAt: "2026-08-14T03:00:00.000Z",
    occupancyEndsAt: "2026-08-14T04:45:00.000Z",
  },
  completedAt: null,
  createdAt: "2026-08-12T02:50:00.000Z",
} as const;

const managerBooking = {
  id: customerBooking.id,
  status: "confirmed",
  customer: { id: "customer-cheng-mo", displayName: "程墨", phoneMasked: "139****0341" },
  pet: { id: "pet-bohe", name: "薄荷", species: "cat", photoPath: null },
  primaryService: { id: "cat-care", name: "猫咪洗护" },
  addons: [],
  staff: customerBooking.staff,
  startsAt: customerBooking.startsAt,
  endsAt: customerBooking.endsAt,
  turnoverEndsAt: customerBooking.turnoverEndsAt,
  totalPriceCents: customerBooking.totalPriceCents,
  serviceDurationMinutes: customerBooking.serviceDurationMinutes,
  turnoverMinutes: customerBooking.turnoverMinutes,
} as const;

const managerActions = {
  canReschedule: true,
  canCancel: true,
  message: "可依据已经与顾客达成的线下约定改期或取消。",
} as const;

const availability = {
  timeZone: "Asia/Shanghai",
  demoNow: "2026-08-13T02:50:00.000Z",
  window: {
    startsOn: "2026-08-13",
    endsOn: "2026-08-26",
    earliestStartsAt: "2026-08-13T03:00:00.000Z",
  },
  selection: {
    pet: customerBooking.pet,
    primaryService: customerBooking.primaryService,
    addons: [],
    totalPriceCents: 16800,
    serviceDurationMinutes: 90,
    requiredSkillIds: ["cat-care"],
  },
  staffOptions: [
    { id: "chenjia", displayName: "陈嘉", employeeNumber: 2 },
    { id: "zhouning", displayName: "周宁", employeeNumber: 4 },
  ],
  days: [
    {
      date: "2026-08-14",
      weekday: 5,
      businessHours: { status: "open", opensAt: "09:00", closesAt: "19:00" },
      reason: null,
      reasonLabel: null,
      qualifiedStaffIds: ["chenjia", "zhouning"],
      slots: [
        {
          startsAt: "2026-08-14T05:00:00.000Z",
          endsAt: "2026-08-14T06:30:00.000Z",
          turnoverEndsAt: "2026-08-14T06:45:00.000Z",
          staff: { id: "zhouning", displayName: "周宁", employeeNumber: 4 },
        },
        {
          startsAt: "2026-08-14T06:00:00.000Z",
          endsAt: "2026-08-14T07:30:00.000Z",
          turnoverEndsAt: "2026-08-14T07:45:00.000Z",
          staff: { id: "chenjia", displayName: "陈嘉", employeeNumber: 2 },
        },
      ],
    },
  ],
} as const;

function detailResponse(status: "confirmed" | "checked_in" | "cancelled" = "confirmed") {
  const actions =
    status === "confirmed"
      ? managerActions
      : {
          canReschedule: false,
          canCancel: false,
          message:
            status === "checked_in"
              ? "预约已经到店核销，不能改期或取消；请继续完成服务或记录服务终止。"
              : "当前预约状态不支持店长改期或取消。",
        };
  return {
    booking: { ...managerBooking, status },
    bookingRevision: 1,
    managerActions: actions,
    petProfile: {
      weightKg: 4.8,
      petSize: "small",
      breed: "英国短毛猫",
      careTags: [],
      careNotes: null,
    },
    serviceRecord: null,
    changeHistory: [],
    notifications: [],
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("店长改期与店长取消页面", () => {
  it("MG-06 直达路由恢复原安排、真实建议、手动选择和必填原因", async () => {
    let submittedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/reschedule-options`)) {
        return jsonResponse({
          booking: customerBooking,
          bookingRevision: 1,
          managerActions,
          availability,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/reschedule`) &&
        init?.method === "POST"
      ) {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            booking: {
              ...customerBooking,
              staff: { id: "zhouning", displayName: "周宁" },
              startsAt: "2026-08-14T05:00:00.000Z",
              endsAt: "2026-08-14T06:30:00.000Z",
              turnoverEndsAt: "2026-08-14T06:45:00.000Z",
            },
            bookingRevision: 2,
            managerActions,
            verificationCodeStatus: "rotated",
            change: {
              id: "event-manager-reschedule",
              kind: "manager_rescheduled",
              actor: { type: "manager", id: "manager", displayName: "沈青" },
              reason: "顾客电话确认稍晚到店",
              previous: {
                staff: customerBooking.staff,
                startsAt: customerBooking.startsAt,
                endsAt: customerBooking.endsAt,
                turnoverEndsAt: customerBooking.turnoverEndsAt,
              },
              next: {
                staff: { id: "zhouning", displayName: "周宁" },
                startsAt: "2026-08-14T05:00:00.000Z",
                endsAt: "2026-08-14T06:30:00.000Z",
                turnoverEndsAt: "2026-08-14T06:45:00.000Z",
              },
              occurredAt: "2026-08-13T02:50:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${customerBooking.id}/reschedule`],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "店长改期" })).toBeInTheDocument();
    expect(await screen.findByText(/原安排：陈嘉/)).toBeInTheDocument();
    expect(screen.getByText(/8月14日.*11:00/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "可用建议" })).toBeInTheDocument();
    expect(screen.getByLabelText("手动选择新安排")).toBeInTheDocument();
    expect(screen.getByText("价格 ¥168 · 未变化")).toBeInTheDocument();
    expect(screen.getByText("服务时长 90 分钟 · 未变化")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认新安排" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /周宁.*13:00/ }));
    fireEvent.change(screen.getByLabelText("改期原因"), {
      target: { value: "顾客电话确认稍晚到店" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认新安排" }));

    expect(await screen.findByRole("heading", { name: "改期成功" })).toBeInTheDocument();
    expect(screen.getByText("核销码已轮换；原安排已保留在变更历史中。")).toBeInTheDocument();
    expect(submittedBody).toMatchObject({
      idempotencyKey: expect.stringMatching(/^manager-reschedule-/),
      reason: "顾客电话确认稍晚到店",
      expectedStaffId: "chenjia",
      expectedStartsAt: customerBooking.startsAt,
      expectedBookingRevision: 1,
      staffId: "zhouning",
      startsAt: "2026-08-14T05:00:00.000Z",
    });
    expect(router.state.location.pathname).toBe(
      `/manager/appointments/${customerBooking.id}/reschedule`,
    );
  });

  it("改期冲突保留原安排并把服务端最新建议替换为可再次提交的选项", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/reschedule-options`)) {
        return jsonResponse({
          booking: customerBooking,
          bookingRevision: 1,
          managerActions,
          availability,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/reschedule`) &&
        init?.method === "POST"
      ) {
        return jsonResponse(
          {
            code: "BOOKING_TIME_CONFLICT",
            message: "新安排刚刚被占用，原安排和核销码保持不变，请选择相近可用安排。",
            nextStep: "conflict",
            booking: customerBooking,
            requested: {
              staffId: "zhouning",
              startsAt: "2026-08-14T05:00:00.000Z",
            },
            suggestions: [
              {
                date: "2026-08-14",
                startsAt: "2026-08-14T07:00:00.000Z",
                endsAt: "2026-08-14T08:30:00.000Z",
                staff: { id: "yangxue", displayName: "杨雪" },
              },
            ],
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${customerBooking.id}/reschedule`],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("radio", { name: /周宁.*13:00/ }));
    fireEvent.change(screen.getByLabelText("改期原因"), {
      target: { value: "顾客希望调整到新的时间" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认新安排" }));

    expect(await screen.findByText("新安排未能成立，原安排保持不变")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /杨雪.*15:00/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /周宁.*13:00/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /杨雪.*15:00/ }));
    expect(screen.getByText("新员工 杨雪")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认新安排" })).toBeEnabled();
  });

  it("改期请求结果不明后修改原因会轮换幂等键", async () => {
    const submittedBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/reschedule-options`)) {
        return jsonResponse({
          booking: customerBooking,
          bookingRevision: 1,
          managerActions,
          availability,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/reschedule`) &&
        init?.method === "POST"
      ) {
        submittedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({ code: "REQUEST_FAILED", message: "响应暂时无法确认" }, 503);
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${customerBooking.id}/reschedule`],
    });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("radio", { name: /周宁.*13:00/ }));
    fireEvent.change(screen.getByLabelText("改期原因"), {
      target: { value: "第一次电话确认" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认新安排" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("响应暂时无法确认");

    fireEvent.change(screen.getByLabelText("改期原因"), {
      target: { value: "第二次电话确认" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认新安排" }));
    await waitFor(() => expect(submittedBodies).toHaveLength(2));
    expect(submittedBodies[1]?.idempotencyKey).not.toBe(submittedBodies[0]?.idempotencyKey);
    expect(submittedBodies[1]).toMatchObject({ reason: "第二次电话确认" });
  });

  it("取消确认路由恢复当前事实、要求原因，并在成功后显示通知后果", async () => {
    let submittedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}`)) {
        return jsonResponse(detailResponse());
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/cancel`) &&
        init?.method === "POST"
      ) {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            booking: { ...customerBooking, status: "cancelled" },
            managerActions: { canReschedule: false, canCancel: false, message: "已取消" },
            verificationCodeStatus: "invalidated",
            change: {
              id: "event-manager-cancel",
              kind: "manager_cancelled",
              actor: { type: "manager", id: "manager", displayName: "沈青" },
              reason: "门店临时无法提供服务",
              previous: {
                staff: customerBooking.staff,
                startsAt: customerBooking.startsAt,
                endsAt: customerBooking.endsAt,
                turnoverEndsAt: customerBooking.turnoverEndsAt,
              },
              next: null,
              occurredAt: "2026-08-13T02:50:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${customerBooking.id}/cancel`],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "取消预约" })).toBeInTheDocument();
    expect(await screen.findByText(/取消后将立即释放实际占用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认取消预约" })).toBeDisabled();
    fireEvent.change(await screen.findByLabelText("取消原因"), {
      target: { value: "门店临时无法提供服务" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认取消预约" }));

    expect(await screen.findByRole("heading", { name: "预约已取消" })).toBeInTheDocument();
    expect(screen.getByText(/实际占用已释放，核销码已作废/)).toBeInTheDocument();
    expect(submittedBody).toMatchObject({
      idempotencyKey: expect.stringMatching(/^manager-cancel-/),
      reason: "门店临时无法提供服务",
      expectedStaffId: "chenjia",
      expectedStartsAt: customerBooking.startsAt,
      expectedBookingRevision: 1,
    });
  });

  it("并发状态变化时取消页重新读取当前预约并解释已到店事实", async () => {
    let detailReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}`)) {
        detailReads += 1;
        return jsonResponse(detailReads === 1 ? detailResponse() : detailResponse("checked_in"));
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}/cancel`) &&
        init?.method === "POST"
      ) {
        return jsonResponse(
          {
            code: "BOOKING_CHANGE_NOT_ALLOWED",
            message: "预约已经到店核销，不能改期或取消；请继续完成服务或记录服务终止。",
            managerActions: detailResponse("checked_in").managerActions,
            booking: { ...customerBooking, status: "checked_in" },
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${customerBooking.id}/cancel`],
    });
    render(<RouterProvider router={router} />);

    await screen.findByRole("heading", { name: "取消预约" });
    fireEvent.change(await screen.findByLabelText("取消原因"), {
      target: { value: "尝试覆盖并发状态" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认取消预约" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "预约状态已变化，已重新读取当前事实",
    );
    await waitFor(() => expect(detailReads).toBe(2));
    expect(screen.getByRole("heading", { name: "当前预约不能取消" })).toBeInTheDocument();
    expect(screen.getAllByText(/已经到店核销/)).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "确认取消预约" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "服务终止" })).toHaveAttribute(
      "href",
      `/manager/appointments/${customerBooking.id}/terminate`,
    );
  });

  it("预约详情按状态只提供允许的行动，并由独立路由驱动浮层语义", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith(`/backoffice/manager/bookings/${customerBooking.id}`)) {
        return jsonResponse(detailResponse("checked_in"));
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${customerBooking.id}`],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "薄荷的预约" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "店长改期" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "取消预约" })).not.toBeInTheDocument();
    expect(screen.getByText("完成服务由陈嘉操作")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "服务终止" })).toHaveAttribute(
      "href",
      `/manager/appointments/${customerBooking.id}/terminate`,
    );
  });
});
