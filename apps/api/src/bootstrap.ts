import "reflect-metadata";

import { mkdir } from "node:fs/promises";

import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module.js";
import { getAdminOrigin, getPetUploadDirectory } from "./config/environment.js";

export async function createApplication(): Promise<NestFastifyApplication> {
  const petUploadDirectory = getPetUploadDirectory();
  await mkdir(petUploadDirectory, { recursive: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ["error", "warn", "log"],
  });
  app.useStaticAssets({ root: petUploadDirectory, prefix: "/uploads/pets/" });

  app.enableCors({
    credentials: true,
    origin: getAdminOrigin(),
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("茸光宠物洗护 API")
    .setDescription("本地作品集演示 API；真实微信能力不在本服务中实现。")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, openApiConfig));

  return app;
}
