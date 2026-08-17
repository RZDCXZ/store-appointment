import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";

import { Pool, type PoolClient } from "pg";

import { getDatabaseUrl, getPetUploadDirectory, redactDatabaseUrl } from "../config/environment.js";
import { hashPassword } from "../auth/password.js";

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

async function withTransaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");

  try {
    const result = await work();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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

    await withTransaction(client, async () => {
      await client.query(sql);
      await client.query("INSERT INTO app_migrations (name, checksum) VALUES ($1, $2)", [
        file,
        checksum,
      ]);
    });
    console.info(`migration 已执行：${file}`);
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

  const demoAccounts = [
    { id: "manager", username: "manager", displayName: "沈青", role: "manager" },
    { id: "linxia", username: "linxia", displayName: "林夏", role: "staff" },
    { id: "chenjia", username: "chenjia", displayName: "陈嘉", role: "staff" },
    { id: "zhouning", username: "zhouning", displayName: "周宁", role: "staff" },
    { id: "zhaohang", username: "zhaohang", displayName: "赵航", role: "staff" },
  ] as const;

  for (const account of demoAccounts) {
    const passwordHash = await hashPassword("Rongguang2026!");

    await client.query(
      `
        INSERT INTO backoffice_accounts (id, username, display_name, role, password_hash)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
        SET username = excluded.username,
            display_name = excluded.display_name,
            role = excluded.role,
            password_hash = excluded.password_hash,
            active = true
      `,
      [account.id, account.username, account.displayName, account.role, passwordHash],
    );
  }

  const demoCustomers = [
    {
      id: "customer-xu-lan",
      key: "xu-lan",
      displayName: "许岚",
      phone: "13874212608",
      story: "正常预约",
      sortOrder: 1,
    },
    {
      id: "customer-cheng-mo",
      key: "cheng-mo",
      displayName: "程墨",
      phone: "13951870341",
      story: "已有未来预约",
      sortOrder: 2,
    },
    {
      id: "customer-lu-yao",
      key: "lu-yao",
      displayName: "陆遥",
      phone: "13690247519",
      story: "取消或爽约历史",
      sortOrder: 3,
    },
  ] as const;

  for (const customer of demoCustomers) {
    await client.query(
      `
        INSERT INTO customers (id, display_name, phone)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET display_name = excluded.display_name,
            phone = excluded.phone
      `,
      [customer.id, customer.displayName, customer.phone],
    );
    await client.query(
      `
        INSERT INTO demo_customer_profiles (customer_id, demo_key, story, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (customer_id) DO UPDATE
        SET demo_key = excluded.demo_key,
            story = excluded.story,
            sort_order = excluded.sort_order
      `,
      [customer.id, customer.key, customer.story, customer.sortOrder],
    );
  }

  await client.query("UPDATE privacy_notices SET is_current = false WHERE is_current");
  await client.query(
    `
      INSERT INTO privacy_notices (version, title, summary, published_at, is_current)
      VALUES
        ('2026.05', '茸光隐私说明', '说明预约与宠物洗护所需资料的使用范围。', '2026-05-01T00:00:00.000Z', false),
        ('2026.08', '茸光隐私说明', '说明顾客资料、宠物档案与预约记录的使用和保留方式。', '2026-08-01T00:00:00.000Z', true)
      ON CONFLICT (version) DO UPDATE
      SET title = excluded.title,
          summary = excluded.summary,
          published_at = excluded.published_at,
          is_current = excluded.is_current
    `,
  );

  const demoPets = [
    {
      id: "pet-tuanzi",
      customerId: "customer-xu-lan",
      name: "团子",
      species: "dog",
      weightKg: 8.4,
      breed: "柴犬",
      sex: "male",
      birthDate: "2022-03-18",
      coatType: "double",
      seedPhotoPath: "/assets/brand/pet-tuanzi-shiba.jpg",
      careNotes: "吹风时从低档开始，适应后再逐步调高。",
      archivedAt: null,
      careTags: ["怕吹风"],
    },
    {
      id: "pet-bohe",
      customerId: "customer-cheng-mo",
      name: "薄荷",
      species: "cat",
      weightKg: 4.8,
      breed: "英国短毛猫",
      sex: "female",
      birthDate: "2021-09-06",
      coatType: "short",
      seedPhotoPath: "/assets/brand/pet-bohe-british-shorthair.jpg",
      careNotes: "请与犬只保持距离，使用安静的等候区域。",
      archivedAt: null,
      careTags: ["对陌生犬敏感"],
    },
    {
      id: "pet-lizi",
      customerId: "customer-lu-yao",
      name: "栗子",
      species: "dog",
      weightKg: 28.6,
      breed: "金毛寻回犬",
      sex: "male",
      birthDate: "2020-11-22",
      coatType: "long",
      seedPhotoPath: "/assets/brand/pet-lizi-golden.jpg",
      careNotes: "耳部清洁动作放缓。",
      archivedAt: "2026-08-02T04:00:00.000Z",
      careTags: ["耳部需轻柔"],
    },
  ] as const;

  for (const pet of demoPets) {
    await client.query(
      `
        INSERT INTO pets (
          id, customer_id, name, species, weight_kg, breed, sex, birth_date,
          coat_type, seed_photo_path, care_notes, archived_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE
        SET customer_id = excluded.customer_id,
            name = excluded.name,
            species = excluded.species,
            weight_kg = excluded.weight_kg,
            breed = excluded.breed,
            sex = excluded.sex,
            birth_date = excluded.birth_date,
            coat_type = excluded.coat_type,
            seed_photo_path = excluded.seed_photo_path,
            care_notes = excluded.care_notes,
            archived_at = excluded.archived_at,
            updated_at = now()
      `,
      [
        pet.id,
        pet.customerId,
        pet.name,
        pet.species,
        pet.weightKg,
        pet.breed,
        pet.sex,
        pet.birthDate,
        pet.coatType,
        pet.seedPhotoPath,
        pet.careNotes,
        pet.archivedAt,
      ],
    );
    await client.query("DELETE FROM pet_care_tags WHERE pet_id = $1", [pet.id]);

    for (const tag of pet.careTags) {
      await client.query("INSERT INTO pet_care_tags (pet_id, tag) VALUES ($1, $2)", [pet.id, tag]);
    }
  }

  await client.query(
    `
      INSERT INTO bookings (id, customer_id, pet_id, starts_at, ends_at, status)
      VALUES (
        'booking-bohe-future',
        'customer-cheng-mo',
        'pet-bohe',
        '2026-08-14T03:00:00.000Z',
        '2026-08-14T04:30:00.000Z',
        'confirmed'
      )
      ON CONFLICT (id) DO UPDATE
      SET starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          status = excluded.status
    `,
  );

  await client.query(
    `
      INSERT INTO privacy_consents (customer_id, notice_version, source, consented_at)
      VALUES
        ('customer-cheng-mo', '2026.08', 'miniapp_booking', '2026-08-02T03:20:00.000Z'),
        ('customer-lu-yao', '2026.05', 'miniapp_booking', '2026-05-06T01:10:00.000Z')
      ON CONFLICT (customer_id, notice_version) DO UPDATE
      SET source = excluded.source,
          consented_at = excluded.consented_at
    `,
  );

  console.info("种子已写入：茸光本地演示元数据、账号、顾客、宠物与隐私同意");
}

async function reset(client: PoolClient): Promise<void> {
  await withTransaction(client, async () => {
    await client.query(
      "TRUNCATE TABLE app_metadata, privacy_consents, privacy_notices, bookings, pet_care_tags, pets, pet_photos, customer_sessions, demo_customer_profiles, customers, backoffice_sessions, backoffice_accounts",
    );
    await seed(client);
  });
  const petUploadDirectory = getPetUploadDirectory();
  await rm(petUploadDirectory, { force: true, recursive: true });
  await mkdir(petUploadDirectory, { recursive: true });
  console.info("本地演示数据已重置");
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
