import "reflect-metadata";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { backofficeSessionCookieName } from "./auth/session-cookie.js";
import { getAdminOrigin } from "./config/environment.js";

export async function createApplication(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ["error", "warn", "log"],
  });

  app.enableCors({
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    origin: getAdminOrigin(),
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("茸光宠物洗护 API")
    .setDescription("本地作品集演示 API；真实微信能力不在本服务中实现。")
    .setVersion("0.1.0")
    .addCookieAuth(
      backofficeSessionCookieName,
      {
        description: "后台登录签发的 HttpOnly、SameSite=Lax 本地演示会话 Cookie。",
        type: "apiKey",
        in: "cookie",
      },
      "backofficeSession",
    )
    .addBearerAuth(
      {
        description: "选择演示顾客后签发的短期不透明 Bearer token。",
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque",
      },
      "customerBearer",
    )
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, openApiConfig));

  return app;
}
