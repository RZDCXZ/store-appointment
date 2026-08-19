import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routes } from "./routes";

const managerAccount = {
  id: "manager",
  username: "manager",
  displayName: "沈青",
  role: "manager",
} as const;

const staffAccount = {
  id: "chenjia",
  username: "chenjia",
  displayName: "陈嘉",
  role: "staff",
} as const;

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const pet = {
  id: "pet-bohe",
  name: "薄荷",
  species: "cat",
  weightKg: 4.8,
  petSize: "small",
  breed: "英国短毛猫",
  sex: "female",
  birthDate: "2021-09-06",
  coatType: "short",
  photoPath: "/assets/brand/pet-bohe-british-shorthair.jpg",
  careTags: ["对陌生犬敏感"],
  careNotes: "请与犬只保持距离，使用安静的等候区域。",
  archivedAt: null,
} as const;

const booking = {
  id: "booking-bohe-completed",
  status: "completed",
  pet: { id: pet.id, name: pet.name, species: pet.species },
  primaryService: { id: "cat-care", name: "猫咪洗护" },
  addons: [],
  staff: { id: "chenjia", displayName: "陈嘉" },
  startsAt: "2026-08-06T02:00:00.000Z",
  endsAt: "2026-08-06T03:30:00.000Z",
  totalPriceCents: 16800,
  serviceDurationMinutes: 90,
} as const;

const serviceRecord = {
  id: "service-record-bohe-completed",
  bookingId: booking.id,
  pet: { ...booking.pet, weightKg: 4.8, petSize: "small" },
  primaryService: { id: "cat-care", name: "猫咪洗护", durationMinutes: 90 },
  addons: [],
  staff: booking.staff,
  actualStartsAt: "2026-08-06T02:02:00.000Z",
  actualEndsAt: "2026-08-06T03:31:00.000Z",
  careTags: ["对陌生犬敏感"],
  internalText: "洗护过程配合良好，耳部清洁完成。",
  createdAt: "2026-08-06T03:31:00.000Z",
  notes: [
    {
      id: "service-record-note-bohe-manager",
      kind: "manager_correction",
      text: "更正：耳部清洁仅完成外耳可见区域。",
      author: { type: "manager", id: "manager", displayName: "沈青" },
      createdAt: "2026-08-06T03:35:00.000Z",
    },
  ],
} as const;

const profile = {
  customer: {
    id: "customer-cheng-mo",
    displayName: "程墨",
    phoneMasked: "139****0341",
    createdAt: "2026-07-02T01:00:00.000Z",
    privacyConsents: [
      {
        version: "2026.08",
        source: "miniapp_booking",
        consentedAt: "2026-08-01T01:00:00.000Z",
      },
    ],
  },
  pets: [pet],
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MG-14 顾客与宠物档案和数据导出页面", () => {
  it("从查询参数恢复顾客搜索与分页，并按当前搜索导出层级 JSON", async () => {
    const downloadClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createObjectUrl = vi.fn(() => "blob:customer-export");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    let exportInit: RequestInit | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/customers?q=%E8%96%84%E8%8D%B7&page=2")) {
        return jsonResponse({
          appliedFilters: { query: "薄荷", page: 2 },
          pagination: { page: 2, pageSize: 20, totalItems: 43, totalPages: 3 },
          customers: [
            {
              id: "customer-cheng-mo",
              displayName: "程墨",
              phoneMasked: "139****0341",
              pets: [
                {
                  id: pet.id,
                  name: pet.name,
                  species: pet.species,
                  breed: pet.breed,
                  photoPath: pet.photoPath,
                  archivedAt: null,
                },
              ],
              futureBookingCount: 1,
              completedServiceCount: 1,
            },
          ],
        });
      }
      if (url.endsWith("/backoffice/manager/exports/customers-pets.json")) {
        exportInit = init;
        return jsonResponse({ exportType: "customers_pets_json", customers: [] }, 200, {
          "Content-Disposition": 'attachment; filename="customers.json"',
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/customers?q=%E8%96%84%E8%8D%B7&page=2"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "顾客档案" })).toBeVisible();
    expect(screen.getByLabelText("搜索顾客或宠物")).toHaveValue("薄荷");
    expect(await screen.findByText("139****0341")).toBeVisible();
    expect(screen.queryByText("13951870341")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看程墨档案" })).toHaveAttribute(
      "href",
      "/manager/customers/customer-cheng-mo",
    );
    expect(screen.getByRole("link", { name: "查看薄荷档案" })).toHaveAttribute(
      "href",
      "/manager/customers/customer-cheng-mo/pets/pet-bohe",
    );
    expect(screen.getByText("第 2 / 3 页")).toBeVisible();
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute(
      "href",
      "/manager/customers?q=%E8%96%84%E8%8D%B7&page=1",
    );

    fireEvent.click(screen.getByRole("button", { name: "导出当前筛选 JSON" }));
    await waitFor(() => expect(downloadClick).toHaveBeenCalledOnce());
    expect(exportInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "薄荷" }),
    });
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:customer-export");
  });

  it("顾客详情独立恢复本人和宠物档案，服务历史失败时保留已加载内容并可重试", async () => {
    let historyAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/customers/customer-cheng-mo")) {
        return jsonResponse(profile);
      }
      if (url.endsWith("/backoffice/manager/customers/customer-cheng-mo/history")) {
        historyAttempts += 1;
        return historyAttempts === 1
          ? jsonResponse({ code: "UPSTREAM_ERROR", message: "服务历史暂时不可用。" }, 500)
          : jsonResponse({ bookings: [booking], serviceRecords: [serviceRecord] });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/customers/customer-cheng-mo"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "程墨" })).toBeVisible();
    expect(screen.getByText("139****0341")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看薄荷档案" })).toHaveAttribute(
      "href",
      "/manager/customers/customer-cheng-mo/pets/pet-bohe",
    );
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("服务历史暂时不可用。")).toBeVisible();

    fireEvent.click(within(alert).getByRole("button", { name: "重试服务历史" }));
    expect((await screen.findAllByText("猫咪洗护 · 陈嘉")).length).toBe(2);
    expect(historyAttempts).toBe(2);
  });

  it("宠物详情直接路由严格分开顾客护理注意与门店内部记录，并显示追加更正作者和时间", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.endsWith("/backoffice/manager/customers/customer-cheng-mo/pets/pet-bohe")) {
        return jsonResponse({
          customer: profile.customer,
          pet,
          bookings: [booking],
          serviceRecords: [serviceRecord],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const router = createMemoryRouter(routes, {
      initialEntries: ["/manager/customers/customer-cheng-mo/pets/pet-bohe"],
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "薄荷" })).toBeVisible();
    const careSection = screen.getByRole("region", { name: "护理注意事项（顾客填写）" });
    const internalSection = screen.getByRole("region", { name: "门店服务记录（内部）" });
    expect(within(careSection).getByText("请与犬只保持距离，使用安静的等候区域。")).toBeVisible();
    expect(
      within(careSection).queryByText("洗护过程配合良好，耳部清洁完成。"),
    ).not.toBeInTheDocument();
    expect(within(internalSection).getByText("洗护过程配合良好，耳部清洁完成。")).toBeVisible();
    expect(within(internalSection).getByText("更正：耳部清洁仅完成外耳可见区域。")).toBeVisible();
    expect(within(internalSection).getByText(/沈青 · 2026\/08\/06 11:35/)).toBeVisible();
  });

  it("空筛选结果和错误提供可恢复状态，员工直接访问店长档案路由返回页面级 403", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session")) return jsonResponse({ account: managerAccount });
      if (url.includes("/backoffice/manager/customers")) {
        return jsonResponse({
          appliedFilters: { query: "无人", page: 1 },
          pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          customers: [],
        });
      }
      throw new Error(`未处理请求：${url}`);
    });
    const emptyRouter = createMemoryRouter(routes, {
      initialEntries: ["/manager/customers?q=%E6%97%A0%E4%BA%BA"],
    });
    const view = render(<RouterProvider router={emptyRouter} />);
    expect(await screen.findByText("没有符合条件的顾客")).toBeVisible();
    view.unmount();

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/auth/session")) return jsonResponse({ account: staffAccount });
      throw new Error(`员工页面不应请求顾客数据：${String(input)}`);
    });
    const forbiddenRouter = createMemoryRouter(routes, {
      initialEntries: ["/manager/customers/customer-cheng-mo"],
    });
    render(<RouterProvider router={forbiddenRouter} />);
    expect(await screen.findByRole("heading", { name: "没有权限" })).toBeVisible();
    expect(screen.getByText("员工身份不能访问店长页面。")).toBeVisible();
  });

  it("预约列表按 URL 中已应用的当前筛选导出 CSV", async () => {
    const downloadClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:booking-export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    let exportInit: RequestInit | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
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
          bookings: [],
          filterOptions: {
            staff: [{ id: "chenjia", displayName: "陈嘉" }],
            primaryServices: [{ id: "cat-care", name: "猫咪洗护" }],
          },
        });
      }
      if (url.endsWith("/backoffice/manager/exports/bookings.csv")) {
        exportInit = init;
        return new Response("预约编号\r\nbooking-1\r\n", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="bookings.csv"',
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

    fireEvent.click(await screen.findByRole("button", { name: "导出当前筛选 CSV" }));
    await waitFor(() => expect(downloadClick).toHaveBeenCalledOnce());
    expect(exportInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-08-14",
        status: "confirmed",
        staffId: "chenjia",
        primaryServiceId: "cat-care",
        query: "薄荷",
      }),
    });
  });
});
