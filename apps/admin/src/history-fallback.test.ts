// @vitest-environment node

import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

describe("管理端浏览器路由 history fallback", () => {
  let server: ViteDevServer;
  let origin: string;

  beforeAll(async () => {
    server = await createServer({
      appType: "spa",
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
      root: fileURLToPath(new URL("..", import.meta.url)),
      server: { hmr: false, host: "127.0.0.1", port: 0 },
    });
    await server.listen();

    const address = server.httpServer?.address();

    if (!address || typeof address === "string") {
      throw new Error("无法确定 Vite 测试服务端口");
    }

    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it.each([
    "/login",
    "/manager/workbench",
    "/manager/appointments",
    "/manager/schedule",
    "/manager/services",
    "/manager/customers",
    "/manager/business",
    "/manager/system",
    "/staff/today",
    "/staff/appointments",
  ])("%s 可直接访问并在刷新后恢复应用入口", async (path) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${origin}${path}`, { headers: { connection: "close" } });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('<div id="root"></div>');
    }
  });
});
