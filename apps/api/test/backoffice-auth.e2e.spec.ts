import { createHash } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

const adminOrigin = "http://localhost:5173";
const demoPassword = "Rongguang2026!";

function sessionCookie(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const setCookie = Array.isArray(value) ? value[0] : value;

  if (typeof setCookie !== "string") {
    throw new Error("登录响应没有设置会话 Cookie");
  }

  return setCookie.split(";", 1)[0] ?? "";
}

async function login(app: NestFastifyApplication, username: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { origin: adminOrigin },
    payload: { username, password: demoPassword },
  });

  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

describe("后台演示账号与角色 API 边界", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
    await database.pool.query("DELETE FROM backoffice_sessions");
  });

  afterAll(async () => {
    await app.close();
  });

  it("数据库只保存一个店长和四个员工账号的 scrypt 哈希", async () => {
    const result = await database.pool.query<{ password_hash: string; role: string }>(
      "SELECT password_hash, role FROM backoffice_accounts ORDER BY id",
    );

    expect(result.rows).toHaveLength(5);
    expect(result.rows.filter((account) => account.role === "manager")).toHaveLength(1);
    expect(result.rows.filter((account) => account.role === "staff")).toHaveLength(4);
    expect(result.rows.every((account) => account.password_hash.startsWith("scrypt$"))).toBe(true);
    expect(result.rows.every((account) => !account.password_hash.includes(demoPassword))).toBe(
      true,
    );
  });

  it("未登录身份不能访问店长接口", async () => {
    const response = await app.inject({ method: "GET", url: "/backoffice/manager/workbench" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("密码错误与服务器错误分开反馈，且不会建立会话", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin: adminOrigin },
      payload: { username: "manager", password: "wrong-password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("拒绝来源不可信的写请求", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "manager", password: demoPassword },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "UNTRUSTED_ORIGIN" });
  });

  it("店长登录后得到安全 Cookie，并可访问店长和员工范围", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { origin: adminOrigin },
      payload: { username: "manager", password: demoPassword },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      account: { displayName: "沈青", role: "manager", username: "manager" },
    });
    expect(response.headers["set-cookie"]).toEqual(expect.stringMatching(/HttpOnly; SameSite=Lax/));

    const cookie = sessionCookie(response);
    const managerResponse = await app.inject({
      method: "GET",
      url: "/backoffice/manager/workbench",
      headers: { cookie },
    });
    const staffResponse = await app.inject({
      method: "GET",
      url: "/backoffice/staff/linxia/today",
      headers: { cookie },
    });

    expect(managerResponse.statusCode).toBe(200);
    expect(staffResponse.statusCode).toBe(200);
  });

  it("员工只能访问自己的范围，且调用店长接口得到明确无权限", async () => {
    const cookie = await login(app, "linxia");
    const ownResponse = await app.inject({
      method: "GET",
      url: "/backoffice/staff/linxia/today",
      headers: { cookie },
    });
    const managerResponse = await app.inject({
      method: "GET",
      url: "/backoffice/manager/workbench",
      headers: { cookie },
    });

    expect(ownResponse.statusCode).toBe(200);
    expect(managerResponse.statusCode).toBe(403);
    expect(managerResponse.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("其他员工不能读取不属于自己的员工范围", async () => {
    const cookie = await login(app, "chenjia");
    const response = await app.inject({
      method: "GET",
      url: "/backoffice/staff/linxia/today",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("会话过期时返回专用错误，允许客户端恢复目标位置", async () => {
    const cookie = await login(app, "zhaohang");
    const token = cookie.slice(cookie.indexOf("=") + 1);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await database.pool.query(
      "UPDATE backoffice_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [tokenHash],
    );

    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });
});
