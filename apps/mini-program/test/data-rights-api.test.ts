import { describe, expect, it, vi } from "vitest";

import type { CustomerApiRequestClient } from "../miniprogram/services/customer-api";
import {
  deleteCustomerData,
  fetchCustomerDataExport,
  fetchCustomerDataRights,
} from "../miniprogram/services/data-rights-api";

describe("顾客数据权利小程序 API", () => {
  it("所有读写都绑定当前 Bearer 会话且删除必须发送明确确认", async () => {
    const request = vi.fn((options: Parameters<CustomerApiRequestClient["request"]>[0]) => {
      options.success({ statusCode: 200, data: {} });
    });
    const client = { request };
    const context = { apiBaseUrl: "http://api.test", accessToken: "signed-token" };

    await fetchCustomerDataRights(client, context);
    await fetchCustomerDataExport(client, context);
    await deleteCustomerData(client, context);

    expect(request.mock.calls.map(([options]) => [options.method, options.url])).toEqual([
      ["GET", "http://api.test/miniapp/data-rights"],
      ["GET", "http://api.test/miniapp/data-export"],
      ["POST", "http://api.test/miniapp/data-deletion"],
    ]);
    expect(request.mock.calls[2]?.[0]).toMatchObject({
      data: { confirmAnonymization: true },
      header: { Authorization: "Bearer signed-token" },
    });
  });
});
