import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/bootstrap.js";

interface OpenApiDocument {
  components?: { securitySchemes?: Record<string, unknown> };
  paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
}

describe("OpenAPI 产品契约", () => {
  let app: NestFastifyApplication;
  let document: OpenApiDocument;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    const response = await app.inject({ method: "GET", url: "/docs-json" });
    expect(response.statusCode).toBe(200);
    document = response.json<OpenApiDocument>();
  });

  afterAll(async () => {
    await app.close();
  });

  it("登记后台 Cookie 与顾客 Bearer 两种本地会话边界", () => {
    expect(document.components?.securitySchemes).toMatchObject({
      backofficeSession: {
        type: "apiKey",
        in: "cookie",
        name: "rongguang_backoffice_session",
      },
      customerBearer: { type: "http", scheme: "bearer" },
    });
  });

  it("每个运行时 HTTP 操作都有领域标签和中文摘要", () => {
    const operations = Object.values(document.paths).flatMap((path) =>
      Object.values(path).filter(
        (operation): operation is { summary?: string; tags?: string[] } =>
          typeof operation === "object" && operation !== null,
      ),
    );

    expect(operations.length).toBeGreaterThan(70);
    for (const operation of operations) {
      expect(operation.summary).toEqual(expect.any(String));
      expect(operation.summary?.trim()).not.toBe("");
      expect(operation.tags?.length).toBeGreaterThan(0);
    }
  });

  it("覆盖三端主流程、演示控制、经营和审计入口", () => {
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        "/miniapp/storefront",
        "/miniapp/bookings",
        "/backoffice/staff/today",
        "/backoffice/bookings/{bookingId}/check-in",
        "/backoffice/manager/workbench",
        "/backoffice/manager/calendar",
        "/backoffice/manager/notifications/{notificationId}/manual-retry",
        "/backoffice/manager/audits",
        "/backoffice/manager/business/metrics",
        "/backoffice/manager/demo/reset",
      ]),
    );
  });
});
