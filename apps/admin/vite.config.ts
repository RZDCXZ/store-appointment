import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

function getDevServerPort(): number {
  const url = new URL(process.env.ADMIN_ORIGIN ?? "http://localhost:5173");
  const port = Number(url.port || (url.protocol === "https:" ? "443" : "80"));

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`ADMIN_ORIGIN 端口无效：${url.href}`);
  }

  return port;
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: getDevServerPort(),
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
