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

const booking = {
  id: "booking-bohe-future",
  status: "checked_in",
  action: "complete",
  customer: { displayName: "程默", phoneMasked: "138****0136" },
  pet: {
    id: "pet-bohe",
    name: "薄荷",
    species: "cat",
    photoPath: null,
    careTags: ["怕吹风"],
    weightKg: 4.8,
    petSize: "small",
    breed: "英短",
    sex: "female",
    birthDate: "2022-04-10",
    coatType: "short",
    careNotes: "降低风速",
  },
  service: {
    id: "cat-care",
    name: "猫咪洗护",
    addonNames: [],
    durationMinutes: 90,
  },
  staff: { id: "chenjia", displayName: "陈嘉" },
  startsAt: "2026-08-14T03:00:00.000Z",
  endsAt: "2026-08-14T04:30:00.000Z",
};

const serviceRecord = {
  id: "record-bohe",
  bookingId: booking.id,
  pet: { id: "pet-bohe", name: "薄荷", species: "cat", weightKg: 4.8, petSize: "small" },
  primaryService: {
    id: "cat-care",
    name: "猫咪洗护",
    priceCents: 16800,
    durationMinutes: 90,
  },
  addons: [],
  staff: { id: "chenjia", displayName: "陈嘉" },
  actualStartsAt: "2026-08-14T03:05:00.000Z",
  actualEndsAt: "2026-08-14T03:40:00.000Z",
  careTags: ["情绪稳定"],
  internalText: "洗护过程配合良好。",
  createdAt: "2026-08-14T03:40:00.000Z",
  notes: [],
};

function bookingDetail(overrides: Record<string, unknown> = {}) {
  return {
    demoNow: "2026-08-14T03:40:00.000Z",
    booking: { ...booking, ...overrides },
    statusHistory: [
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
    petServiceHistory: [],
    serviceRecord: overrides.status === "completed" ? serviceRecord : null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ST-06 / ST-07 / ST-09 门店服务记录路由", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4100");
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("可直达完成服务页，保存选填内容后重新读取并展示只读结构化记录", async () => {
    let detailReads = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${booking.id}`)) {
        detailReads += 1;
        return jsonResponse(
          detailReads === 1
            ? bookingDetail()
            : bookingDetail({ status: "completed", action: "ended" }),
        );
      }
      if (url.endsWith(`/backoffice/bookings/${booking.id}/complete`)) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          careTags: ["情绪稳定"],
          internalText: "洗护过程配合良好。",
        });
        return jsonResponse(
          {
            bookingId: booking.id,
            status: "completed",
            outcome: "completed",
            occurredAt: "2026-08-14T03:40:00.000Z",
            actor: { type: "staff", id: "chenjia", displayName: "陈嘉" },
            actualOccupancy: {
              startsAt: "2026-08-14T03:00:00.000Z",
              endsAt: "2026-08-14T03:55:00.000Z",
            },
            originalSchedule: {
              startsAt: booking.startsAt,
              endsAt: booking.endsAt,
              occupancyStartsAt: booking.startsAt,
              occupancyEndsAt: "2026-08-14T04:45:00.000Z",
            },
            serviceRecord,
          },
          201,
        );
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${booking.id}/complete`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "完成服务" })).toBeVisible();
    expect(screen.getByText("结构化服务摘要已生成")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "情绪稳定" }));
    fireEvent.change(screen.getByLabelText("内部文字记录（选填）"), {
      target: { value: "洗护过程配合良好。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成服务并保存记录" }));

    expect(await screen.findByRole("status")).toHaveTextContent("门店服务记录已保存");
    expect(screen.getByText("洗护过程配合良好。")).toBeVisible();
    await waitFor(() => expect(detailReads).toBe(2));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(router.state.location.pathname).toBe(`/staff/appointments/${booking.id}/complete`);
  });

  it("可直达服务终止页，原因必填且提交后重新读取独立终态", async () => {
    let detailReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${booking.id}`)) {
        detailReads += 1;
        return jsonResponse(
          detailReads === 1
            ? bookingDetail()
            : bookingDetail({ status: "terminated", action: "ended" }),
        );
      }
      if (url.endsWith(`/backoffice/bookings/${booking.id}/terminate`)) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          reason: "宠物持续应激，无法安全继续服务",
        });
        return jsonResponse(
          {
            bookingId: booking.id,
            status: "terminated",
            outcome: "terminated",
            occurredAt: "2026-08-14T03:25:00.000Z",
            actor: { type: "staff", id: "chenjia", displayName: "陈嘉" },
            reason: "宠物持续应激，无法安全继续服务",
            actualOccupancy: {
              startsAt: "2026-08-14T03:00:00.000Z",
              endsAt: "2026-08-14T03:40:00.000Z",
            },
            originalSchedule: {
              startsAt: booking.startsAt,
              endsAt: booking.endsAt,
              occupancyStartsAt: booking.startsAt,
              occupancyEndsAt: "2026-08-14T04:45:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${booking.id}/terminate`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "服务终止" })).toBeVisible();
    expect(screen.getByText(/与“已完成”和“已取消”不同/)).toBeVisible();
    const submit = screen.getByRole("button", { name: "确认服务终止" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("终止原因"), {
      target: { value: "宠物持续应激，无法安全继续服务" },
    });
    fireEvent.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent("服务已终止");
    expect(screen.getByRole("status")).toHaveTextContent("15 分钟周转");
    await waitFor(() => expect(detailReads).toBe(2));
    expect(router.state.location.pathname).toBe(`/staff/appointments/${booking.id}/terminate`);
  });

  it("可直达只读门店服务记录页并追加带作者时间的员工说明", async () => {
    let detailReads = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${booking.id}`)) {
        detailReads += 1;
        return jsonResponse({
          ...bookingDetail({ status: "completed", action: "ended" }),
          serviceRecord: {
            ...serviceRecord,
            notes:
              detailReads === 1
                ? []
                : [
                    {
                      id: "note-bohe",
                      kind: "staff_note",
                      text: "补充：左前爪修剪时略有躲闪。",
                      author: { type: "staff", id: "chenjia", displayName: "陈嘉" },
                      createdAt: "2026-08-14T03:45:00.000Z",
                    },
                  ],
          },
        });
      }
      if (url.endsWith(`/backoffice/bookings/${booking.id}/service-record/notes`)) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          text: "补充：左前爪修剪时略有躲闪。",
        });
        return jsonResponse(
          {
            bookingId: booking.id,
            serviceRecordId: serviceRecord.id,
            occurredAt: "2026-08-14T03:45:00.000Z",
            note: {
              id: "note-bohe",
              kind: "staff_note",
              text: "补充：左前爪修剪时略有躲闪。",
              author: { type: "staff", id: "chenjia", displayName: "陈嘉" },
              createdAt: "2026-08-14T03:45:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${booking.id}/service-record`],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "门店服务记录与追加说明" })).toBeVisible();
    expect(screen.getByText("洗护过程配合良好。")).toBeVisible();
    expect(screen.getByText(/原记录不能覆盖或删除/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("追加说明"), {
      target: { value: "补充：左前爪修剪时略有躲闪。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存追加说明" }));

    expect(await screen.findByRole("status")).toHaveTextContent("说明已追加");
    expect(await screen.findByText("补充：左前爪修剪时略有躲闪。")).toBeVisible();
    expect(screen.getByText(/陈嘉.*8月14日周五 11:45/)).toBeVisible();
    await waitFor(() => expect(detailReads).toBe(2));
    expect(router.state.location.pathname).toBe(`/staff/appointments/${booking.id}/service-record`);
  });

  it("已到店预约详情提供完成服务主行动与独立服务终止入口", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      if (url.endsWith(`/backoffice/staff/bookings/${booking.id}`)) {
        return jsonResponse(bookingDetail());
      }
      throw new Error(`未处理的测试请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/staff/appointments/${booking.id}`],
    });

    render(<RouterProvider router={router} />);

    const complete = await screen.findByRole("link", { name: "完成服务并保存记录" });
    const terminate = screen.getByRole("link", { name: "服务终止" });
    expect(complete).toHaveAttribute("href", `/staff/appointments/${booking.id}/complete`);
    expect(terminate).toHaveAttribute("href", `/staff/appointments/${booking.id}/terminate`);
    fireEvent.click(complete);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/staff/appointments/${booking.id}/complete`),
    );
  });
});
