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

const booking = {
  id: "booking-bohe-future",
  status: "confirmed",
  customer: { id: "customer-cheng-mo", displayName: "程墨", phoneMasked: "139****0341" },
  pet: { id: "pet-bohe", name: "薄荷", species: "cat", photoPath: null },
  primaryService: { id: "cat-care", name: "猫咪洗护" },
  addons: [],
  staff: { id: "chenjia", displayName: "陈嘉" },
  startsAt: "2026-08-14T03:00:00.000Z",
  endsAt: "2026-08-14T04:30:00.000Z",
  turnoverEndsAt: "2026-08-14T04:45:00.000Z",
  totalPriceCents: 16800,
  serviceDurationMinutes: 90,
  turnoverMinutes: 15,
} as const;

const proxyOptions = {
  demoNow: "2026-08-13T02:50:00.000Z",
  privacyNotice: {
    version: "2026.08",
    title: "茸光隐私说明",
    summary: "用于预约履约与必要通知。",
  },
  window: {
    startsOn: "2026-08-13",
    endsOn: "2026-08-26",
    earliestStartsAt: "2026-08-13T03:00:00.000Z",
  },
  customers: [
    {
      id: "customer-xu-lan",
      displayName: "许岚",
      phoneMasked: "138****2608",
      pets: [
        {
          id: "pet-tuanzi",
          name: "团子",
          species: "dog",
          weightKg: 8.6,
          petSize: "small",
        },
      ],
    },
  ],
  staff: [
    { id: "zhaohang", displayName: "赵航", skills: ["dog_basic"] },
    { id: "chenjia", displayName: "陈嘉", skills: ["cat_care"] },
  ],
  primaryServices: [
    {
      id: "dog-basic-care",
      name: "犬基础洗护",
      applicableSpecies: ["dog"],
      availableAddonIds: ["paw-care"],
    },
    {
      id: "cat-care",
      name: "猫咪洗护",
      applicableSpecies: ["cat"],
      availableAddonIds: [],
    },
  ],
  addons: [{ id: "paw-care", name: "足部护理" }],
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("店长预约列表与代客预约页面", () => {
  it("MG-03 从可寻址查询参数恢复筛选并进入当前预约详情", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (
        url.endsWith(
          "/backoffice/manager/bookings?date=2026-08-14&status=confirmed&staffId=chenjia&primaryServiceId=cat-care&q=%E8%96%84%E8%8D%B7",
        )
      ) {
        return jsonResponse({
          appliedFilters: {
            date: "2026-08-14",
            status: "confirmed",
            staffId: "chenjia",
            primaryServiceId: "cat-care",
            query: "薄荷",
          },
          bookings: [booking],
          filterOptions: {
            staff: [{ id: "chenjia", displayName: "陈嘉" }],
            primaryServices: [{ id: "cat-care", name: "猫咪洗护" }],
          },
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [
        "/manager/appointments/list?date=2026-08-14&status=confirmed&staffId=chenjia&primaryServiceId=cat-care&q=%E8%96%84%E8%8D%B7",
      ],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "预约列表" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "陈嘉" });
    expect(screen.getByLabelText("预约日期")).toHaveValue("2026-08-14");
    expect(screen.getByLabelText("预约状态")).toHaveValue("confirmed");
    expect(screen.getByLabelText("员工")).toHaveValue("chenjia");
    expect(screen.getByLabelText("主要服务")).toHaveValue("cat-care");
    expect(screen.getByLabelText("搜索顾客或宠物")).toHaveValue("薄荷");
    expect(screen.getByRole("link", { name: /查看薄荷预约详情/ })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-bohe-future",
    );
    expect(screen.getByRole("link", { name: "代客预约" })).toHaveAttribute(
      "href",
      "/manager/appointments/proxy",
    );
    expect(router.state.location.pathname).toBe("/manager/appointments/list");
  });

  it("MG-04 直接访问详情可查看宠物档案、门店记录、变更和通知事实", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/bookings/booking-bohe-future")) {
        return jsonResponse({
          booking,
          bookingRevision: 1,
          managerActions: {
            canReschedule: true,
            canCancel: true,
            canCorrectContent: true,
            message: "可依据已经与顾客达成的线下约定改期、取消或纠正预约内容。",
          },
          petProfile: {
            weightKg: 4.2,
            petSize: "small",
            breed: "英国短毛猫",
            careTags: ["需要慢速吹风"],
            careNotes: "容易紧张",
          },
          serviceRecord: {
            id: "record-1",
            bookingId: booking.id,
            pet: {
              id: booking.pet.id,
              name: booking.pet.name,
              species: booking.pet.species,
              weightKg: 4.2,
              petSize: "small",
            },
            primaryService: { id: "cat-care", name: "猫咪洗护", durationMinutes: 90 },
            addons: [],
            staff: booking.staff,
            actualStartsAt: "2026-08-14T03:02:00.000Z",
            actualEndsAt: "2026-08-14T04:31:00.000Z",
            careTags: ["需要慢速吹风"],
            internalText: "吹风时已降低风速",
            createdAt: "2026-08-14T04:31:00.000Z",
            notes: [
              {
                id: "note-1",
                kind: "manager_correction",
                text: "已与顾客电话确认",
                author: { type: "manager", id: "manager", displayName: "沈青" },
                createdAt: "2026-08-14T04:40:00.000Z",
              },
            ],
          },
          changeHistory: [
            {
              id: "event-1",
              type: "created",
              actorType: "manager",
              actorId: "manager",
              reason: null,
              previous: {
                staff: { id: "chenjia", displayName: "陈嘉" },
                startsAt: "2026-08-13T03:00:00.000Z",
                endsAt: "2026-08-13T04:30:00.000Z",
                turnoverEndsAt: "2026-08-13T04:45:00.000Z",
              },
              next: {
                staff: { id: "zhouning", displayName: "周宁" },
                startsAt: "2026-08-13T05:00:00.000Z",
                endsAt: "2026-08-13T06:30:00.000Z",
                turnoverEndsAt: "2026-08-13T06:45:00.000Z",
              },
              occurredAt: "2026-08-13T10:00:00.000Z",
            },
            {
              id: "event-content-correction",
              type: "booking_content_corrected",
              actorType: "manager",
              actorId: "manager",
              reason: "顾客确认复秤并增加修甲",
              previous: {
                pet: { ...booking.pet, weightKg: 4.8, petSize: "small" },
                primaryService: {
                  ...booking.primaryService,
                  priceCents: 16800,
                  durationMinutes: 90,
                },
                addons: [],
                totalPriceCents: 16800,
                serviceDurationMinutes: 90,
                requiredSkillIds: ["cat-care"],
              },
              next: {
                pet: { ...booking.pet, weightKg: 10.01, petSize: "medium" },
                primaryService: {
                  ...booking.primaryService,
                  priceCents: 21800,
                  durationMinutes: 120,
                },
                addons: [
                  {
                    id: "nail-care",
                    name: "修甲护理",
                    priceCents: 3000,
                    durationMinutes: 15,
                  },
                ],
                totalPriceCents: 24800,
                serviceDurationMinutes: 135,
                requiredSkillIds: ["cat-care", "nail-care"],
              },
              occurredAt: "2026-08-13T10:05:00.000Z",
            },
          ],
          notifications: [
            {
              id: "notification-1",
              type: "booking_created",
              status: "sent",
              attemptCount: 1,
              createdAt: "2026-08-13T10:00:00.000Z",
            },
          ],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/appointments/booking-bohe-future"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "薄荷的预约" })).toBeInTheDocument();
    expect(screen.getByText("英国短毛猫 · 4.2 kg")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "门店服务记录" })).toBeInTheDocument();
    expect(screen.getByText("吹风时已降低风速")).toBeInTheDocument();
    expect(screen.getByText("已与顾客电话确认")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "预约变更历史" })).toBeInTheDocument();
    expect(screen.getByText("店长 · created")).toBeInTheDocument();
    expect(screen.getByText(/原安排：陈嘉/)).toBeInTheDocument();
    expect(screen.getByText(/新安排：周宁/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "纠正预约内容" })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-bohe-future/correction",
    );
    expect(screen.getByText("顾客确认复秤并增加修甲")).toBeInTheDocument();
    expect(screen.getByText(/原内容：4.8 kg.*小型.*¥168.*90 分钟/)).toBeInTheDocument();
    expect(
      screen.getByText(/新内容：10.01 kg.*中型.*修甲护理.*¥248.*135 分钟/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "通知记录" })).toBeInTheDocument();
    expect(screen.getByText("已发送 · 尝试 1 次")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/manager/appointments/booking-bohe-future");
  });

  it("MG-05 用已有顾客与宠物代录预约，并显示核销码与详情入口", async () => {
    let submittedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/proxy-bookings/options")) {
        return jsonResponse(proxyOptions);
      }
      if (url.endsWith("/backoffice/manager/proxy-bookings") && init?.method === "POST") {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            booking: { ...booking, id: "booking-proxy-existing" },
            verificationCode: "314159",
            verificationWindow: {
              opensAt: "2026-08-13T02:30:00.000Z",
              closesAt: "2026-08-13T03:15:00.000Z",
              description: "可在开始前 30 分钟至开始后 15 分钟内出示",
            },
            proxyRecord: {
              privacyNoticeVersion: "2026.08",
              offlineConsentSource: "phone",
              manager: { id: "manager", displayName: "沈青" },
              createdAt: "2026-08-13T02:50:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/appointments/proxy"],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "代客预约" })).toBeInTheDocument();
    await screen.findByRole("option", { name: /许岚/ });
    fireEvent.change(screen.getByLabelText("已有顾客"), {
      target: { value: "customer-xu-lan" },
    });
    fireEvent.change(screen.getByLabelText("已有宠物"), { target: { value: "pet-tuanzi" } });
    fireEvent.change(screen.getByLabelText("主要服务"), {
      target: { value: "dog-basic-care" },
    });
    fireEvent.change(screen.getByLabelText("执行员工"), { target: { value: "zhaohang" } });
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-08-13T11:00" },
    });
    fireEvent.change(screen.getByLabelText("线下同意来源"), { target: { value: "phone" } });
    fireEvent.click(screen.getByLabelText(/已向顾客说明《茸光隐私说明》/));
    fireEvent.click(screen.getByRole("button", { name: "建立代客预约" }));

    expect(await screen.findByRole("heading", { name: "代客预约已建立" })).toBeInTheDocument();
    expect(screen.getByText("314159")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看预约详情" })).toHaveAttribute(
      "href",
      "/manager/appointments/booking-proxy-existing",
    );
    expect(submittedBody).toMatchObject({
      idempotencyKey: expect.stringMatching(/^manager-proxy-/),
      profile: {
        kind: "existing",
        customerId: "customer-xu-lan",
        petId: "pet-tuanzi",
      },
      primaryServiceId: "dog-basic-care",
      addonIds: [],
      staffId: "zhaohang",
      startsAt: "2026-08-13T03:00:00.000Z",
      offlineConsentSource: "phone",
    });
  });

  it("MG-05 代录新顾客与宠物的最小档案", async () => {
    let submittedBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/proxy-bookings/options")) {
        return jsonResponse(proxyOptions);
      }
      if (url.endsWith("/backoffice/manager/proxy-bookings") && init?.method === "POST") {
        submittedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            booking: { ...booking, id: "booking-proxy-new", pet: { ...booking.pet, name: "雪球" } },
            verificationCode: "271828",
            verificationWindow: {
              opensAt: "2026-08-13T03:30:00.000Z",
              closesAt: "2026-08-13T04:15:00.000Z",
              description: "到店时出示",
            },
            proxyRecord: {
              privacyNoticeVersion: "2026.08",
              offlineConsentSource: "chat",
              manager: { id: "manager", displayName: "沈青" },
              createdAt: "2026-08-13T02:50:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/appointments/proxy"],
    });
    render(<RouterProvider router={router} />);

    await screen.findByRole("heading", { name: "代客预约" });
    fireEvent.click(await screen.findByRole("radio", { name: "新建顾客与宠物" }));
    fireEvent.change(screen.getByLabelText("顾客姓名"), { target: { value: "乔安" } });
    fireEvent.change(screen.getByLabelText("顾客手机号"), { target: { value: "13566081234" } });
    fireEvent.change(screen.getByLabelText("宠物名称"), { target: { value: "雪球" } });
    fireEvent.change(screen.getByLabelText("宠物种类"), { target: { value: "cat" } });
    fireEvent.change(screen.getByLabelText("宠物体重（kg）"), { target: { value: "5.2" } });
    fireEvent.change(screen.getByLabelText("主要服务"), { target: { value: "cat-care" } });
    fireEvent.change(screen.getByLabelText("执行员工"), { target: { value: "chenjia" } });
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-08-13T12:00" },
    });
    fireEvent.change(screen.getByLabelText("线下同意来源"), { target: { value: "chat" } });
    fireEvent.click(screen.getByLabelText(/已向顾客说明/));
    fireEvent.click(screen.getByRole("button", { name: "建立代客预约" }));

    await waitFor(() =>
      expect(submittedBody).toMatchObject({
        profile: {
          kind: "new",
          customer: { displayName: "乔安", phone: "13566081234" },
          pet: { name: "雪球", species: "cat", weightKg: 5.2 },
        },
        primaryServiceId: "cat-care",
        staffId: "chenjia",
        startsAt: "2026-08-13T04:00:00.000Z",
        offlineConsentSource: "chat",
      }),
    );
    expect(await screen.findByText("271828")).toBeInTheDocument();
  });

  it("MG-05 时间冲突时保留原选择，并用新幂等键提交建议时段", async () => {
    const submittedBodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/proxy-bookings/options")) {
        return jsonResponse(proxyOptions);
      }
      if (url.endsWith("/backoffice/manager/proxy-bookings") && init?.method === "POST") {
        submittedBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (submittedBodies.length > 1) {
          return jsonResponse(
            {
              booking: { ...booking, id: "booking-proxy-suggestion" },
              verificationCode: "161803",
              verificationWindow: {
                opensAt: "2026-08-13T04:30:00.000Z",
                closesAt: "2026-08-13T05:15:00.000Z",
                description: "到店时出示",
              },
              proxyRecord: {
                privacyNoticeVersion: "2026.08",
                offlineConsentSource: "phone",
                manager: { id: "manager", displayName: "沈青" },
                createdAt: "2026-08-13T02:50:00.000Z",
              },
            },
            201,
          );
        }
        return jsonResponse(
          {
            code: "BOOKING_TIME_CONFLICT",
            message: "该员工在所选时段已有占用。",
            nextStep: "conflict",
            suggestions: [
              {
                date: "2026-08-13",
                startsAt: "2026-08-13T05:00:00.000Z",
                endsAt: "2026-08-13T06:00:00.000Z",
                staff: { id: "zhaohang", displayName: "赵航" },
              },
            ],
          },
          409,
        );
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/appointments/proxy"],
    });
    render(<RouterProvider router={router} />);

    await screen.findByRole("heading", { name: "代客预约" });
    await screen.findByRole("option", { name: /许岚/ });
    fireEvent.change(screen.getByLabelText("已有顾客"), {
      target: { value: "customer-xu-lan" },
    });
    fireEvent.change(screen.getByLabelText("已有宠物"), { target: { value: "pet-tuanzi" } });
    fireEvent.change(screen.getByLabelText("主要服务"), {
      target: { value: "dog-basic-care" },
    });
    fireEvent.change(screen.getByLabelText("执行员工"), { target: { value: "zhaohang" } });
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-08-13T11:00" },
    });
    fireEvent.change(screen.getByLabelText("线下同意来源"), { target: { value: "phone" } });
    fireEvent.click(screen.getByLabelText(/已向顾客说明/));
    fireEvent.click(screen.getByRole("button", { name: "建立代客预约" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前选择已保留，请更换时间或员工");
    expect(screen.getByLabelText("已有宠物")).toHaveValue("pet-tuanzi");
    expect(screen.getByLabelText("执行员工")).toHaveValue("zhaohang");
    expect(screen.getByLabelText("开始时间")).toHaveValue("2026-08-13T11:00");
    fireEvent.click(screen.getByRole("button", { name: "赵航 · 2026-08-13 13:00" }));
    expect(screen.getByLabelText("开始时间")).toHaveValue("2026-08-13T13:00");
    fireEvent.click(screen.getByRole("button", { name: "建立代客预约" }));

    expect(await screen.findByRole("heading", { name: "代客预约已建立" })).toBeInTheDocument();
    expect(submittedBodies).toHaveLength(2);
    expect(submittedBodies[1]).toMatchObject({ startsAt: "2026-08-13T05:00:00.000Z" });
    expect(submittedBodies[1]?.idempotencyKey).not.toBe(submittedBodies[0]?.idempotencyKey);
  });
});
