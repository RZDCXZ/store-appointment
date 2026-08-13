import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import { Pool, type PoolClient } from "pg";

import { getDatabaseUrl, redactDatabaseUrl } from "../config/environment.js";

const migrationsDirectory = new URL("../../database/migrations/", import.meta.url);

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migrate(client: PoolClient): Promise<void> {
  await ensureMigrationTable(client);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsDirectory), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>(
      "SELECT checksum FROM app_migrations WHERE name = $1",
      [file],
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`migration ${file} 已执行但文件内容发生变化，请新增 migration。`);
      }

      console.info(`migration 已存在：${file}`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO app_migrations (name, checksum) VALUES ($1, $2)", [
        file,
        checksum,
      ]);
      await client.query("COMMIT");
      console.info(`migration 已执行：${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function seed(client: PoolClient): Promise<void> {
  const entries = [
    ["brand", { name: "茸光宠物洗护" }],
    ["seed", { version: 1 }],
  ] as const;

  for (const [key, value] of entries) {
    await client.query(
      `
        INSERT INTO app_metadata (key, value)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (key) DO UPDATE
        SET value = excluded.value, updated_at = now()
      `,
      [key, JSON.stringify(value)],
    );
  }

  console.info("种子已写入：茸光本地演示元数据");
}

async function reset(client: PoolClient): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("TRUNCATE TABLE app_metadata");
    await seed(client);
    await client.query("COMMIT");
    console.info("本地演示数据已重置");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function run(): Promise<void> {
  const command = process.argv[2];

  if (command !== "migrate" && command !== "seed" && command !== "reset") {
    throw new Error("数据库命令必须是 migrate、seed 或 reset。请从仓库根目录运行 pnpm db:<命令>。");
  }

  const databaseUrl = getDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    if (command === "migrate") {
      await migrate(client);
    } else if (command === "seed") {
      await seed(client);
    } else {
      await reset(client);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`数据库命令失败：${message}`);
  console.error(
    `请确认 PostgreSQL 已健康，并检查 DATABASE_URL=${redactDatabaseUrl(getDatabaseUrl())}`,
  );
  process.exitCode = 1;
});
