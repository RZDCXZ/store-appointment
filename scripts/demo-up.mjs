import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { resolveDemoEnvironment } from "./demo-config.mjs";

function loadLocalEnvironment() {
  try {
    loadEnvFile(".env");
    console.info("已读取 .env");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      console.info("未找到 .env，使用仓库安全的本地默认值；可从 .env.example 复制覆盖。");
    } else {
      throw error;
    }
  }

  return resolveDemoEnvironment(process.env);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} 被信号 ${signal} 终止。`
            : `${command} ${args.join(" ")} 返回退出码 ${code ?? "unknown"}。`,
        ),
      );
    });
  });
}

async function postgresIsReady() {
  const database = process.env.POSTGRES_DB ?? "rongguang";
  const user = process.env.POSTGRES_USER ?? "rongguang";

  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", user, "-d", database],
      { env: process.env, stdio: "ignore" },
    );

    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function waitForPostgres() {
  const attempts = 30;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await postgresIsReady()) {
      console.info("PostgreSQL 健康检查通过。");
      return;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      console.info(`等待 PostgreSQL 健康（${attempt}/${attempts}）…`);
    }

    await delay(1_000);
  }

  throw new Error(
    "PostgreSQL 在 30 秒内未通过健康检查。请运行“docker compose logs postgres”查看初始化或端口冲突。",
  );
}

async function serviceIsReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForDevServers(child, config) {
  const attempts = 30;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`开发服务在健康检查完成前退出，退出码 ${child.exitCode}。`);
    }

    const [apiReady, adminReady] = await Promise.all([
      serviceIsReady(config.apiHealthUrl),
      serviceIsReady(config.adminWorkbenchUrl),
    ]);

    if (apiReady && adminReady) {
      console.info("API 与后台健康检查通过，可开始本地演示。");
      return;
    }

    if (attempt === 1 || attempt % 5 === 0) {
      console.info(`等待 API 与后台健康（${attempt}/${attempts}）…`);
    }

    await delay(1_000);
  }

  throw new Error(
    `API 或后台在 30 秒内未就绪。探测目标：${config.apiHealthUrl}、${config.adminWorkbenchUrl}。请检查对应端口并查看上方服务日志。`,
  );
}

async function startDevServers(config) {
  console.info(`正在启动 API（${config.apiHealthUrl}）与后台（${config.adminWorkbenchUrl}）…`);
  const child = spawn(
    "corepack",
    ["pnpm", "exec", "turbo", "dev", "--filter=@rongguang/api", "--filter=@rongguang/admin"],
    { env: process.env, stdio: "inherit" },
  );

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }

  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal === "SIGINT" || signal === "SIGTERM" || code === 0) {
        resolve();
      } else {
        reject(new Error(`开发服务意外退出，退出码 ${code ?? "unknown"}。`));
      }
    });
  });

  try {
    await Promise.race([
      waitForDevServers(child, config),
      completion.then(() => {
        throw new Error("开发服务在健康检查完成前退出。");
      }),
    ]);
    await completion;
  } catch (error) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }

    throw error;
  }
}

async function main() {
  const config = loadLocalEnvironment();
  console.info("正在启动锁定小版本的 PostgreSQL 18.4…");
  await run("docker", ["compose", "up", "-d", "postgres"]);
  await waitForPostgres();
  await run("corepack", ["pnpm", "db:migrate"]);
  await run("corepack", ["pnpm", "db:reset"]);
  await startDevServers(config);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\n茸光本地环境启动失败：${message}`);
  console.error("排查顺序：确认 Docker 正在运行 → 确认上方探测目标对应端口未占用 → 检查 .env。\n");
  process.exitCode = 1;
});
