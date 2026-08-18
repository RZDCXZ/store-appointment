import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

const booking = {
  id: "booking-bohe-future",
  status: "confirmed",
  pet: {
    id: "pet-bohe",
    name: "薄荷",
    species: "cat",
    weightKg: 4.8,
    petSize: "small",
  },
  primaryService: {
    id: "cat-care",
    name: "猫咪洗护",
    priceCents: 16800,
    durationMinutes: 90,
  },
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

const currentContent = {
  pet: booking.pet,
  primaryService: booking.primaryService,
  addons: [],
  totalPriceCents: 16800,
  serviceDurationMinutes: 90,
  requiredSkillIds: ["cat-care"],
} as const;

const candidateContent = {
  pet: { ...booking.pet, weightKg: 10.01, petSize: "medium" },
  primaryService: {
    id: "cat-care",
    name: "猫咪洗护",
    priceCents: 21800,
    durationMinutes: 120,
  },
  addons: [{ id: "nail", name: "指甲护理", priceCents: 3000, durationMinutes: 15 }],
  totalPriceCents: 24800,
  serviceDurationMinutes: 135,
  requiredSkillIds: ["cat-care", "nail-care"],
} as const;

const managerActions = {
  canReschedule: true,
  canCancel: true,
  canCorrectContent: true,
  message: "可依据已经与顾客达成的线下约定改期、取消或纠正预约内容。",
} as const;

const optionsResponse = {
  booking,
  bookingRevision: 1,
  contentDigest: "content-digest-v1",
  managerActions,
  currentContent,
  availableAddons: [
    { id: "nail", name: "指甲护理", description: "修剪并打磨指甲" },
    { id: "teeth", name: "口腔护理", description: "基础口腔清洁" },
  ],
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("MG-07 店长预约内容纠正", () => {
  it("直达路由恢复当前快照，自动重算体型并在服务端校验后原子保存", async () => {
    let previewBody: Record<string, unknown> | undefined;
    let submittedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return jsonResponse({
          account: { id: "manager", username: "manager", displayName: "沈青", role: "manager" },
        });
      }
      if (url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-options`)) {
        return jsonResponse(optionsResponse);
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-preview`) &&
        init?.method === "POST"
      ) {
        previewBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          booking,
          currentContent,
          candidateContent,
          interval: {
            startsAt: booking.startsAt,
            endsAt: "2026-08-14T05:15:00.000Z",
            turnoverEndsAt: "2026-08-14T05:30:00.000Z",
          },
          validation: {
            skill: { status: "satisfied", staff: booking.staff },
            capacity: { status: "available" },
          },
          canSave: true,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correct-content`) &&
        init?.method === "POST"
      ) {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          booking: {
            ...booking,
            pet: candidateContent.pet,
            primaryService: candidateContent.primaryService,
            addons: candidateContent.addons,
            endsAt: "2026-08-14T05:15:00.000Z",
            turnoverEndsAt: "2026-08-14T05:30:00.000Z",
            totalPriceCents: 24800,
            serviceDurationMinutes: 135,
          },
          bookingRevision: 1,
          contentDigest: "content-digest-v2",
          managerActions,
          verificationCodeStatus: "unchanged",
          change: {
            id: "event-manager-content-correction",
            kind: "manager_content_corrected",
            actor: { type: "manager", id: "manager", displayName: "沈青" },
            reason: "顾客确认体重和增项录入有误",
            previous: currentContent,
            next: candidateContent,
            occurredAt: "2026-08-13T02:50:00.000Z",
          },
        });
      }
      throw new Error(`未处理请求：${url}`);
    });

    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${booking.id}/correction`],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "纠正预约内容" })).toBeInTheDocument();
    expect((await screen.findAllByText(/4.8 kg.*小型/)).length).toBe(2);
    expect(screen.getAllByText(/主要服务规格：猫咪洗护.*小型.*¥168.*90 分钟/)).toHaveLength(2);
    expect(screen.getAllByText(/增项：无增项/)).toHaveLength(2);
    expect(screen.getAllByText(/预约总计：¥168.*90 分钟/)).toHaveLength(2);
    expect(screen.getAllByText(/所需技能：cat-care/)).toHaveLength(2);
    expect(screen.getByText("主要服务不可替换；如需更换，请取消后重新预约。")).toBeInTheDocument();
    expect(screen.queryByLabelText("纠正后体型")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("纠正后体重（kg）"), {
      target: { value: "10.01" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /指甲护理/ }));

    expect(await screen.findByText(/10.01 kg.*中型/)).toBeInTheDocument();
    expect(screen.getByText(/主要服务规格：猫咪洗护.*中型.*¥218.*120 分钟/)).toBeInTheDocument();
    expect(screen.getByText(/预约总计：¥248.*135 分钟/)).toBeInTheDocument();
    expect(screen.getByText("员工技能满足")).toBeInTheDocument();
    expect(screen.getByText("排班与连续容量可用")).toBeInTheDocument();
    expect(previewBody).toEqual({
      petWeightKg: 10.01,
      primaryServiceId: "cat-care",
      addonIds: ["nail"],
    });

    fireEvent.change(screen.getByLabelText("纠正原因"), {
      target: { value: "顾客确认体重和增项录入有误" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并保存纠正" }));

    expect(await screen.findByRole("heading", { name: "预约内容已纠正" })).toBeInTheDocument();
    expect(screen.getByText("核销码保持不变；原内容与原因已写入变更历史。")).toBeInTheDocument();
    expect(submittedBody).toMatchObject({
      idempotencyKey: expect.stringMatching(/^manager-correction-/),
      reason: "顾客确认体重和增项录入有误",
      expectedStaffId: "chenjia",
      expectedStartsAt: booking.startsAt,
      expectedBookingRevision: 1,
      expectedContentDigest: "content-digest-v1",
      petWeightKg: 10.01,
      primaryServiceId: "cat-care",
      addonIds: ["nail"],
    });
    expect(router.state.location.pathname).toBe(`/manager/appointments/${booking.id}/correction`);
  });

  it("容量不足时保留原快照并给出换员工、改期或取消入口", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return jsonResponse({
          account: { id: "manager", username: "manager", displayName: "沈青", role: "manager" },
        });
      }
      if (url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-options`)) {
        return jsonResponse(optionsResponse);
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-preview`) &&
        init?.method === "POST"
      ) {
        return jsonResponse(
          {
            code: "BOOKING_CORRECTION_CAPACITY_UNAVAILABLE",
            message: "纠正后的连续占用与下一预约冲突，原预约内容保持不变。",
            booking,
            candidate: candidateContent,
            validation: { skill: { status: "satisfied" }, capacity: { status: "unavailable" } },
            nextSteps: ["change_staff", "reschedule", "cancel"],
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });

    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${booking.id}/correction`],
    });
    render(<RouterProvider router={router} />);

    fireEvent.change(await screen.findByLabelText("纠正后体重（kg）"), {
      target: { value: "10.01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "校验纠正后内容" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "纠正后的连续占用与下一预约冲突，原预约内容保持不变。",
    );
    expect(screen.getByText(/原内容仍有效.*4.8 kg.*小型/)).toBeInTheDocument();
    expect(screen.getByText(/10.01 kg.*中型/)).toBeInTheDocument();
    expect(screen.getByText(/预约总计：¥248.*135 分钟/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "换员工" })).toHaveAttribute(
      "href",
      `/manager/appointments/${booking.id}/reschedule`,
    );
    expect(screen.getByRole("link", { name: "改期" })).toHaveAttribute(
      "href",
      `/manager/appointments/${booking.id}/reschedule`,
    );
    expect(screen.getByRole("link", { name: "取消预约" })).toHaveAttribute(
      "href",
      `/manager/appointments/${booking.id}/cancel`,
    );
  });

  it("忽略过期预检响应，只允许保存与当前草稿绑定的校验结果", async () => {
    let resolveOldPreview: ((response: Response) => void) | undefined;
    const submittedBodies: Array<Record<string, unknown>> = [];
    const smallCandidate = {
      ...currentContent,
      pet: { ...booking.pet, weightKg: 4.9 },
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return jsonResponse({
          account: { id: "manager", username: "manager", displayName: "沈青", role: "manager" },
        });
      }
      if (url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-options`)) {
        return jsonResponse(optionsResponse);
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-preview`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as { petWeightKg: number };
        if (body.petWeightKg === 10.01) {
          return new Promise<Response>((resolve) => {
            resolveOldPreview = resolve;
          });
        }
        return jsonResponse({
          booking,
          currentContent,
          candidateContent: smallCandidate,
          interval: {
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            turnoverEndsAt: booking.turnoverEndsAt,
          },
          validation: {
            skill: { status: "satisfied", staff: booking.staff },
            capacity: { status: "available" },
          },
          canSave: true,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correct-content`) &&
        init?.method === "POST"
      ) {
        submittedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return jsonResponse({
          booking: { ...booking, pet: smallCandidate.pet },
          bookingRevision: 1,
          contentDigest: "content-digest-v2",
          managerActions,
          verificationCodeStatus: "unchanged",
          change: {
            id: "event-current-draft",
            kind: "manager_content_corrected",
            actor: { type: "manager", id: "manager", displayName: "沈青" },
            reason: "仅保存当前草稿",
            previous: currentContent,
            next: smallCandidate,
            occurredAt: "2026-08-13T02:50:00.000Z",
          },
        });
      }
      throw new Error(`未处理请求：${url}`);
    });

    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${booking.id}/correction`],
    });
    render(<RouterProvider router={router} />);
    const weightInput = await screen.findByLabelText("纠正后体重（kg）");
    fireEvent.change(weightInput, { target: { value: "10.01" } });
    fireEvent.click(screen.getByRole("button", { name: "校验纠正后内容" }));
    fireEvent.change(weightInput, { target: { value: "4.9" } });

    expect(await screen.findByText(/4.9 kg.*小型/)).toBeInTheDocument();
    resolveOldPreview?.(
      jsonResponse({
        booking,
        currentContent,
        candidateContent,
        interval: {
          startsAt: booking.startsAt,
          endsAt: "2026-08-14T05:15:00.000Z",
          turnoverEndsAt: "2026-08-14T05:30:00.000Z",
        },
        validation: {
          skill: { status: "satisfied", staff: booking.staff },
          capacity: { status: "available" },
        },
        canSave: true,
      }),
    );
    await waitFor(() => expect(screen.queryByText(/10.01 kg.*中型/)).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("纠正原因"), {
      target: { value: "仅保存当前草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并保存纠正" }));
    await screen.findByRole("heading", { name: "预约内容已纠正" });
    expect(submittedBodies).toHaveLength(1);
    expect(submittedBodies[0]).toMatchObject({ petWeightKg: 4.9, addonIds: [] });
  });

  it("确定性失败后重新校验会使用新的幂等键，而非永久重放旧失败", async () => {
    const submittedKeys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return jsonResponse({
          account: { id: "manager", username: "manager", displayName: "沈青", role: "manager" },
        });
      }
      if (url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-options`)) {
        return jsonResponse(optionsResponse);
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-preview`) &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          booking,
          currentContent,
          candidateContent,
          interval: {
            startsAt: booking.startsAt,
            endsAt: "2026-08-14T05:15:00.000Z",
            turnoverEndsAt: "2026-08-14T05:30:00.000Z",
          },
          validation: {
            skill: { status: "satisfied", staff: booking.staff },
            capacity: { status: "available" },
          },
          canSave: true,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correct-content`) &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as { idempotencyKey: string };
        submittedKeys.push(body.idempotencyKey);
        if (submittedKeys.length === 1) {
          return jsonResponse(
            {
              code: "BOOKING_CORRECTION_CAPACITY_UNAVAILABLE",
              message: "保存时容量刚刚发生变化，原内容保持不变。",
              booking,
              candidate: candidateContent,
              validation: {
                skill: { status: "satisfied" },
                capacity: { status: "insufficient", reason: "concurrent_change" },
              },
              nextSteps: ["change_staff", "reschedule", "cancel"],
            },
            409,
          );
        }
        return jsonResponse({
          booking: { ...booking, pet: candidateContent.pet },
          bookingRevision: 1,
          contentDigest: "content-digest-v2",
          managerActions,
          verificationCodeStatus: "unchanged",
          change: {
            id: "event-after-revalidation",
            kind: "manager_content_corrected",
            actor: { type: "manager", id: "manager", displayName: "沈青" },
            reason: "容量恢复后重新确认",
            previous: currentContent,
            next: candidateContent,
            occurredAt: "2026-08-13T02:50:00.000Z",
          },
        });
      }
      throw new Error(`未处理请求：${url}`);
    });

    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${booking.id}/correction`],
    });
    render(<RouterProvider router={router} />);
    fireEvent.change(await screen.findByLabelText("纠正后体重（kg）"), {
      target: { value: "10.01" },
    });
    await screen.findByText(/10.01 kg.*中型/);
    fireEvent.change(screen.getByLabelText("纠正原因"), {
      target: { value: "容量恢复后重新确认" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并保存纠正" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存时容量刚刚发生变化");
    expect(screen.queryByText("排班与连续容量可用")).not.toBeInTheDocument();
    expect(screen.getByText("员工技能满足")).toBeInTheDocument();
    expect(screen.getByText("排班或连续容量不可用，请重新校验")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并保存纠正" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "校验纠正后内容" }));
    await screen.findByText("排班与连续容量可用");
    fireEvent.click(screen.getByRole("button", { name: "确认并保存纠正" }));
    await screen.findByRole("heading", { name: "预约内容已纠正" });

    expect(submittedKeys).toHaveLength(2);
    expect(submittedKeys[1]).not.toBe(submittedKeys[0]);
  });

  it("预约事实冲突后立即作废旧预检，等待服务端当前事实刷新", async () => {
    let optionsRequests = 0;
    let resolveRefresh: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) {
        return jsonResponse({
          account: { id: "manager", username: "manager", displayName: "沈青", role: "manager" },
        });
      }
      if (url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-options`)) {
        optionsRequests += 1;
        if (optionsRequests === 1) return jsonResponse(optionsResponse);
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correction-preview`) &&
        init?.method === "POST"
      ) {
        return jsonResponse({
          booking,
          currentContent,
          candidateContent,
          interval: {
            startsAt: booking.startsAt,
            endsAt: "2026-08-14T05:15:00.000Z",
            turnoverEndsAt: "2026-08-14T05:30:00.000Z",
          },
          validation: {
            skill: { status: "satisfied", staff: booking.staff },
            capacity: { status: "available" },
          },
          canSave: true,
        });
      }
      if (
        url.endsWith(`/backoffice/manager/bookings/${booking.id}/correct-content`) &&
        init?.method === "POST"
      ) {
        return jsonResponse(
          {
            code: "BOOKING_FACT_CHANGED",
            message: "预约已被另一位店长更新。",
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });

    const router = createMemoryRouter(routes, {
      initialEntries: [`/manager/appointments/${booking.id}/correction`],
    });
    render(<RouterProvider router={router} />);
    fireEvent.change(await screen.findByLabelText("纠正后体重（kg）"), {
      target: { value: "10.01" },
    });
    await screen.findByText("排班与连续容量可用");
    fireEvent.change(screen.getByLabelText("纠正原因"), {
      target: { value: "重新确认最新事实" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认并保存纠正" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("预约事实已变化");
    await waitFor(() => expect(optionsRequests).toBe(2));
    expect(screen.queryByText("排班与连续容量可用")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并保存纠正" })).toBeDisabled();

    resolveRefresh?.(jsonResponse(optionsResponse));
    await waitFor(() => expect(screen.getByLabelText("纠正后体重（kg）")).toHaveValue(4.8));
  });
});
