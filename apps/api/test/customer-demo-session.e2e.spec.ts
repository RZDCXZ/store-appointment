import { createHash } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { DatabaseService } from "../src/database/database.service.js";

describe("小程序演示顾客会话", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("只列出三位带明确故事的快捷演示顾客", async () => {
    const response = await app.inject({ method: "GET", url: "/miniapp/demo-customers" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      customers: [
        expect.objectContaining({ key: "xu-lan", displayName: "许岚", story: "正常预约" }),
        expect.objectContaining({
          key: "cheng-mo",
          displayName: "程墨",
          story: "已有未来预约",
        }),
        expect.objectContaining({
          key: "lu-yao",
          displayName: "陆遥",
          story: "取消或爽约历史",
        }),
      ],
    });
  });

  it("切换到预置顾客后签发 Bearer 会话并读取本人资料", async () => {
    const switchResponse = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: {
        customerKey: "xu-lan",
        customerId: "customer-lu-yao",
        role: "manager",
      },
    });

    expect(switchResponse.statusCode).toBe(201);
    const body = switchResponse.json<{
      accessToken: string;
      expiresAt: string;
      customer: { displayName: string; phoneMasked: string; story: string };
    }>();
    expect(body).toMatchObject({
      customer: {
        displayName: "许岚",
        phoneMasked: "138****2608",
        story: "正常预约",
      },
    });
    expect(body.accessToken).toEqual(expect.any(String));
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(body.expiresAt)).toBeLessThanOrEqual(Date.now() + 3_600_000);

    const profileResponse = await app.inject({
      method: "GET",
      url: "/miniapp/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json()).toMatchObject({
      customer: {
        displayName: "许岚",
        phoneMasked: "138****2608",
        story: "正常预约",
      },
    });
  });

  it("新签发的会话会切换到另一位顾客且不混用旧身份", async () => {
    const firstResponse = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "xu-lan" },
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "lu-yao" },
    });
    const firstToken = firstResponse.json<{ accessToken: string }>().accessToken;
    const secondToken = secondResponse.json<{ accessToken: string }>().accessToken;

    const [firstProfile, secondProfile] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/miniapp/me",
        headers: { authorization: `Bearer ${firstToken}` },
      }),
      app.inject({
        method: "GET",
        url: "/miniapp/me",
        headers: { authorization: `Bearer ${secondToken}` },
      }),
    ]);

    expect(firstProfile.json()).toMatchObject({ customer: { displayName: "许岚" } });
    expect(secondProfile.json()).toMatchObject({ customer: { displayName: "陆遥" } });
  });

  it("拒绝非法顾客标识且不签发会话", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "customer-not-seeded", role: "manager" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_DEMO_CUSTOMER" });
  });

  it("篡改顾客 ID、角色或请求头仍只能读取会话中的本人资料", async () => {
    const switchResponse = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "xu-lan" },
    });
    const { accessToken } = switchResponse.json<{ accessToken: string }>();

    const response = await app.inject({
      method: "GET",
      url: "/miniapp/me?customerId=customer-lu-yao&role=manager",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-customer-id": "customer-lu-yao",
        "x-customer-role": "manager",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      customer: {
        avatarInitial: "许",
        displayName: "许岚",
        phoneMasked: "138****2608",
        story: "正常预约",
      },
    });
  });

  it("会话过期时返回可恢复的专用错误", async () => {
    const switchResponse = await app.inject({
      method: "POST",
      url: "/miniapp/demo-sessions",
      payload: { customerKey: "cheng-mo" },
    });
    const { accessToken } = switchResponse.json<{ accessToken: string }>();
    const tokenHash = createHash("sha256").update(accessToken).digest("hex");

    await database.pool.query(
      "UPDATE customer_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [tokenHash],
    );

    const response = await app.inject({
      method: "GET",
      url: "/miniapp/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "SESSION_EXPIRED",
      message: expect.stringContaining("重新选择"),
    });
  });
});
