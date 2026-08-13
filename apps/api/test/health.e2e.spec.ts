import type { HealthResponse } from "@rongguang/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/bootstrap.js";

describe("API 健康检查", () => {
  let app: Awaited<ReturnType<typeof createApplication>>;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports that the API and migrated database are ready", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json<HealthResponse>();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      database: "ready",
      service: "rongguang-api",
      status: "ok",
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
