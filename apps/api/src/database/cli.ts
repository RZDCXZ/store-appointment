import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";

import { Pool, type PoolClient } from "pg";

import {
  getDatabaseUrl,
  getDemoNow,
  getPetUploadDirectory,
  redactDatabaseUrl,
} from "../config/environment.js";
import { hashPassword } from "../auth/password.js";
import { addLocalDays, getLocalWeekday, getShanghaiLocalDate } from "../schedule/schedule-date.js";

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

  await client.query("DELETE FROM staff_schedule_days");
  await client.query("DELETE FROM weekly_shift_templates");
  await client.query("DELETE FROM staff_skills");
  await client.query("DELETE FROM staff_members");
  await client.query("DELETE FROM store_business_hours");

  const staff = [
    {
      id: "linxia",
      employeeNumber: 1,
      skills: ["dog-basic-care", "dog-styling", "nail-care", "deshedding-care", "oral-care"],
      weekdays: [2, 3, 4, 5, 6],
      shift: ["09:30", "18:00"],
      shiftBreak: ["13:00", "14:00"],
    },
    {
      id: "chenjia",
      employeeNumber: 2,
      skills: ["dog-basic-care", "cat-care", "nail-care", "deshedding-care"],
      weekdays: [0, 3, 4, 5, 6],
      shift: ["10:30", "19:00"],
      shiftBreak: ["14:00", "15:00"],
    },
    {
      id: "zhouning",
      employeeNumber: 3,
      skills: ["cat-care", "nail-care", "oral-care"],
      weekdays: [0, 2, 4, 5, 6],
      shift: ["09:30", "18:00"],
      shiftBreak: ["12:30", "13:30"],
    },
    {
      id: "zhaohang",
      employeeNumber: 4,
      skills: ["dog-basic-care", "dog-styling", "nail-care", "oral-care"],
      weekdays: [2, 3, 4, 5, 6],
      shift: ["10:30", "19:00"],
      shiftBreak: ["14:30", "15:30"],
    },
  ] as const;

  for (const member of staff) {
    await client.query("INSERT INTO staff_members (id, employee_number) VALUES ($1, $2)", [
      member.id,
      member.employeeNumber,
    ]);

    for (const skill of member.skills) {
      await client.query("INSERT INTO staff_skills (staff_id, skill_id) VALUES ($1, $2)", [
        member.id,
        skill,
      ]);
    }

    for (const weekday of member.weekdays) {
      const templateId = `template-${member.id}-${weekday}`;

      await client.query(
        `
          INSERT INTO weekly_shift_templates (id, staff_id, weekday, starts_at, ends_at)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [templateId, member.id, weekday, member.shift[0], member.shift[1]],
      );
      await client.query(
        `
          INSERT INTO weekly_shift_template_breaks (id, template_id, starts_at, ends_at)
          VALUES ($1, $2, $3, $4)
        `,
        [`template-break-${member.id}-${weekday}`, templateId, ...member.shiftBreak],
      );
    }
  }

  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const open = weekday !== 1;

    await client.query(
      `
        INSERT INTO store_business_hours (weekday, opens_at, closes_at)
        VALUES ($1, $2, $3)
      `,
      [weekday, open ? "09:30" : null, open ? "19:00" : null],
    );
  }

  const demoNow = getDemoNow();
  const scheduleStartsOn = getShanghaiLocalDate(demoNow);
  let seededSaturdayException = false;

  for (let offset = 0; offset < 14; offset += 1) {
    const localDate = addLocalDays(scheduleStartsOn, offset);
    const weekday = getLocalWeekday(localDate);

    if (weekday === 1) {
      continue;
    }

    for (const member of staff) {
      if (!(member.weekdays as readonly number[]).includes(weekday)) {
        continue;
      }

      const adjustedSaturday = weekday === 6 && member.id === "linxia" && !seededSaturdayException;
      const scheduleDayId = `schedule-${localDate}-${member.id}`;
      const shift = adjustedSaturday ? (["11:00", "19:00"] as const) : member.shift;
      const shiftBreak = adjustedSaturday ? (["15:00", "15:30"] as const) : member.shiftBreak;

      await client.query(
        `
          INSERT INTO staff_schedule_days (
            id, staff_id, local_date, publication_status, source,
            exception_kind, exception_note, published_at
          )
          VALUES ($1, $2, $3, 'published', $4, $5, $6, $7)
        `,
        [
          scheduleDayId,
          member.id,
          localDate,
          adjustedSaturday ? "date_exception" : "weekly_template",
          adjustedSaturday ? "adjusted_shift" : null,
          adjustedSaturday ? "周六门店活动，调整到岗与休息时间。" : null,
          demoNow,
        ],
      );
      await client.query(
        `
          INSERT INTO staff_schedule_shifts (id, schedule_day_id, starts_at, ends_at)
          VALUES ($1, $2, $3, $4)
        `,
        [`shift-${localDate}-${member.id}`, scheduleDayId, shift[0], shift[1]],
      );
      await client.query(
        `
          INSERT INTO staff_schedule_breaks (id, schedule_shift_id, starts_at, ends_at)
          VALUES ($1, $2, $3, $4)
        `,
        [`break-${localDate}-${member.id}`, `shift-${localDate}-${member.id}`, ...shiftBreak],
      );

      if (adjustedSaturday) {
        seededSaturdayException = true;
      }
    }
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
      INSERT INTO bookings (
        id, customer_id, pet_id, staff_id, starts_at, ends_at,
        service_duration_minutes, status
      )
      VALUES (
        'booking-bohe-future',
        'customer-cheng-mo',
        'pet-bohe',
        'chenjia',
        '2026-08-14T03:00:00.000Z',
        '2026-08-14T04:30:00.000Z',
        90,
        'confirmed'
      )
      ON CONFLICT (id) DO UPDATE
      SET staff_id = excluded.staff_id,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          service_duration_minutes = excluded.service_duration_minutes,
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

  console.info("种子已写入：茸光本地演示元数据、账号、排班容量、顾客、宠物与隐私同意");
}

async function reset(client: PoolClient): Promise<void> {
  await withTransaction(client, async () => {
    await client.query(
      "TRUNCATE TABLE app_metadata, staff_schedule_breaks, staff_schedule_shifts, staff_schedule_days, weekly_shift_template_breaks, weekly_shift_templates, store_business_hours, staff_skills, staff_members, privacy_consents, privacy_notices, bookings, pet_care_tags, pets, pet_photos, customer_sessions, demo_customer_profiles, customers, backoffice_sessions, backoffice_accounts",
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
