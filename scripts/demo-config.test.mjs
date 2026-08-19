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

  it("连续三次启动都由 DEMO_NOW 单向同步同一业务时间到管理端", () => {
    const snapshots = Array.from({ length: 3 }, () => {
      const environment = {
        DEMO_NOW: "2026-09-01T01:02:03.000Z",
        VITE_DEMO_NOW: "2099-01-01T00:00:00.000Z",
      };
      const config = resolveDemoEnvironment(environment);
      return { environment, config };
    });

    for (const snapshot of snapshots) {
      assert.equal(snapshot.environment.DEMO_NOW, "2026-09-01T01:02:03.000Z");
      assert.equal(snapshot.environment.VITE_DEMO_NOW, snapshot.environment.DEMO_NOW);
    }
    assert.deepEqual(snapshots[1], snapshots[0]);
    assert.deepEqual(snapshots[2], snapshots[0]);
  });
});
