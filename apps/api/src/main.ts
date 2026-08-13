import { createApplication } from "./bootstrap.js";
import { getApiHost, getApiPort } from "./config/environment.js";

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const host = getApiHost();
  const port = getApiPort();

  await app.listen(port, host);
  console.info(`茸光 API 已启动：http://localhost:${port}`);
  console.info(`OpenAPI 文档：http://localhost:${port}/docs`);
}

bootstrap().catch((error: unknown) => {
  console.error("API 启动失败。请先运行 pnpm db:migrate，并检查 DATABASE_URL。", error);
  process.exitCode = 1;
});
