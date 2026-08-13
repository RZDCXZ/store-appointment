import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DEMO_NOW, resolveDemoEnvironment } from "./demo-config.mjs";

describe("demo:up 环境解析", () => {
  it("为空环境提供可见的确定性演示时间和一致的默认 URL", () => {
    const environment = {};
    const config = resolveDemoEnvironment(environment);

    assert.equal(environment.DEMO_NOW, DEFAULT_DEMO_NOW);
    assert.equal(environment.VITE_DEMO_NOW, DEFAULT_DEMO_NOW);
    assert.equal(environment.VITE_API_BASE_URL, "http://localhost:3000");
    assert.deepEqual(config, {
      adminWorkbenchUrl: "http://localhost:5173/manager/workbench",
      apiHealthUrl: "http://localhost:3000/health",
    });
  });

  it("让 API、Vite 客户端和后台健康检查跟随端口覆盖", () => {
    const environment = {
      ADMIN_ORIGIN: "http://localhost:5180",
      API_PORT: "4100",
    };
    const config = resolveDemoEnvironment(environment);

    assert.equal(environment.VITE_API_BASE_URL, "http://localhost:4100");
    assert.deepEqual(config, {
      adminWorkbenchUrl: "http://localhost:5180/manager/workbench",
      apiHealthUrl: "http://localhost:4100/health",
    });
  });

  it("尊重显式 VITE_API_BASE_URL", () => {
    const environment = { VITE_API_BASE_URL: "http://127.0.0.1:4200" };
    const config = resolveDemoEnvironment(environment);

    assert.equal(config.apiHealthUrl, "http://127.0.0.1:4200/health");
  });
});
