import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  petCareTags,
  type PetCareTag,
  type PetCoatType,
  type PetListResponse,
  type PetProfile,
  type PetProfileInput,
  type PetSex,
  type PetSize,
  type PetSpecies,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";

interface PetRow {
  id: string;
  name: string;
  species: PetProfile["species"];
  weight_kg: string;
  breed: string | null;
  sex: PetProfile["sex"];
  birth_date: string | null;
  coat_type: PetProfile["coatType"];
  photo_id: string | null;
  photo_path: string | null;
  care_notes: string | null;
  archived_at: Date | null;
  care_tags: PetCareTag[];
  future_booking: { id: string; startsAt: string } | null;
}

type FieldErrors = Partial<Record<keyof PetProfileInput, string>>;

const allowedCareTags = new Set<string>(petCareTags);
const allowedCoatTypes = new Set<PetCoatType>([
  "short",
  "long",
  "double",
  "curly",
  "hairless",
  "other",
]);

function nullableString(
  value: unknown,
  field: keyof PetProfileInput,
  maximumLength: number,
  fieldErrors: FieldErrors,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || value.trim().length > maximumLength) {
    fieldErrors[field] = `最多填写 ${maximumLength} 个字符。`;
    return null;
  }

  return value.trim() || null;
}

function demoLocalDate(): string {
  const instant = new Date(getDemoNow());
  return new Date(instant.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseInput(value: unknown): PetProfileInput {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const fieldErrors: FieldErrors = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";

  if (name.length < 1 || name.length > 30) {
    fieldErrors.name = "请输入 1 至 30 个字符的宠物名称。";
  }

  const species = input.species === "dog" || input.species === "cat" ? input.species : null;

  if (!species) {
    fieldErrors.species = "请选择犬或猫。";
  }

  const weightKg = input.weightKg;

  if (
    typeof weightKg !== "number" ||
    !Number.isFinite(weightKg) ||
    weightKg < 0.1 ||
    weightKg > 99.99 ||
    Number(weightKg.toFixed(2)) !== weightKg
  ) {
    fieldErrors.weightKg = "当前体重需为 0.1 至 99.99kg，最多保留两位小数。";
  }

  const breed = nullableString(input.breed, "breed", 50, fieldErrors);
  const careNotes = nullableString(input.careNotes, "careNotes", 500, fieldErrors);
  const sex: PetSex | null =
    input.sex === undefined || input.sex === null || input.sex === ""
      ? null
      : input.sex === "male" || input.sex === "female"
        ? input.sex
        : null;

  if (input.sex !== undefined && input.sex !== null && input.sex !== "" && !sex) {
    fieldErrors.sex = "请选择公或母，或留空。";
  }

  const coatType: PetCoatType | null =
    input.coatType === undefined || input.coatType === null || input.coatType === ""
      ? null
      : allowedCoatTypes.has(input.coatType as PetCoatType)
        ? (input.coatType as PetCoatType)
        : null;

  if (
    input.coatType !== undefined &&
    input.coatType !== null &&
    input.coatType !== "" &&
    !coatType
  ) {
    fieldErrors.coatType = "请选择列表中的毛发类型。";
  }

  const birthDate =
    input.birthDate === undefined || input.birthDate === null || input.birthDate === ""
      ? null
      : typeof input.birthDate === "string"
        ? input.birthDate
        : null;
  const birthDateInstant = birthDate ? new Date(`${birthDate}T00:00:00.000Z`) : null;

  if (
    birthDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
      Number.isNaN(birthDateInstant?.getTime()) ||
      birthDateInstant?.toISOString().slice(0, 10) !== birthDate ||
      birthDate > demoLocalDate())
  ) {
    fieldErrors.birthDate = "出生日期需为有效且不晚于演示日期的日期。";
  }

  const careTags = Array.isArray(input.careTags) ? input.careTags : [];

  if (
    !Array.isArray(input.careTags) ||
    careTags.length > petCareTags.length ||
    new Set(careTags).size !== careTags.length ||
    !careTags.every((tag): tag is PetCareTag => typeof tag === "string" && allowedCareTags.has(tag))
  ) {
    fieldErrors.careTags = "护理标签需从可选列表中选择且不能重复。";
  }

  const photoId =
    input.photoId === undefined || input.photoId === null || input.photoId === ""
      ? null
      : typeof input.photoId === "string" && input.photoId.length <= 80
        ? input.photoId
        : null;

  if (input.photoId !== undefined && input.photoId !== null && input.photoId !== "" && !photoId) {
    fieldErrors.photoId = "宠物照片标识无效，请重新上传。";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message: "请检查宠物资料中的字段。", fieldErrors },
      HttpStatus.BAD_REQUEST,
    );
  }

  return {
    name,
    species: species as PetSpecies,
    weightKg: weightKg as number,
    breed,
    sex,
    birthDate,
    coatType,
    photoId,
    careTags: careTags as PetCareTag[],
    careNotes,
  };
}

function classifyPetSize(weightKg: number): PetSize {
  if (weightKg <= 10) {
    return "small";
  }

  if (weightKg <= 25) {
    return "medium";
  }

  return "large";
}

function toPet(row: PetRow): PetProfile {
  const weightKg = Number(row.weight_kg);

  return {
    id: row.id,
    name: row.name,
    species: row.species,
    weightKg,
    petSize: classifyPetSize(weightKg),
    breed: row.breed,
    sex: row.sex,
    birthDate: row.birth_date,
    coatType: row.coat_type,
    photoId: row.photo_id,
    photoPath: row.photo_path,
    careTags: row.care_tags,
    careNotes: row.care_notes,
    archivedAt: row.archived_at?.toISOString() ?? null,
    futureBooking: row.future_booking,
  };
}

const petSelect = `
  SELECT pet.id,
         pet.name,
         pet.species,
         pet.weight_kg,
         pet.breed,
         pet.sex,
         pet.birth_date::text,
         pet.coat_type,
         pet.photo_id,
         COALESCE(photo.public_path, pet.seed_photo_path) AS photo_path,
         pet.care_notes,
         pet.archived_at,
         COALESCE(tags.values, '[]'::jsonb) AS care_tags,
         future_booking.value AS future_booking
  FROM pets AS pet
  LEFT JOIN pet_photos AS photo ON photo.id = pet.photo_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(tag.tag ORDER BY tag.created_at, tag.tag) AS values
    FROM pet_care_tags AS tag
    WHERE tag.pet_id = pet.id
  ) AS tags ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
             'id', booking.id,
             'startsAt', to_char(booking.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) AS value
    FROM bookings AS booking
    WHERE booking.pet_id = pet.id
      AND booking.status IN ('confirmed', 'checked_in')
      AND booking.starts_at > $2::timestamptz
    ORDER BY booking.starts_at
    LIMIT 1
  ) AS future_booking ON true
`;

@Injectable()
export class PetProfileService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async list(customerId: string): Promise<PetListResponse> {
    const result = await this.database.pool.query<PetRow>(
      `${petSelect}
       WHERE pet.customer_id = $1
       ORDER BY pet.archived_at NULLS FIRST, pet.created_at, pet.id`,
      [customerId, getDemoNow()],
    );
    const pets = result.rows.map(toPet);

    return {
      active: pets.filter((pet) => pet.archivedAt === null),
      archived: pets.filter((pet) => pet.archivedAt !== null),
    };
  }

  async get(customerId: string, petId: string): Promise<PetProfile | null> {
    const result = await this.database.pool.query<PetRow>(
      `${petSelect}
       WHERE pet.customer_id = $1 AND pet.id = $3`,
      [customerId, getDemoNow(), petId],
    );

    return result.rows[0] ? toPet(result.rows[0]) : null;
  }

  async create(customerId: string, body: unknown): Promise<PetProfile> {
    const input = parseInput(body);
    const petId = `pet-${randomUUID()}`;
    await this.write(customerId, petId, input, true);
    const pet = await this.get(customerId, petId);

    if (!pet) {
      throw new Error("宠物档案创建后无法读取");
    }

    return pet;
  }

  async update(customerId: string, petId: string, body: unknown): Promise<PetProfile> {
    const input = parseInput(body);
    await this.write(customerId, petId, input, false);
    const pet = await this.get(customerId, petId);

    if (!pet) {
      throw new Error("宠物档案更新后无法读取");
    }

    return pet;
  }

  async archive(customerId: string, petId: string): Promise<PetProfile> {
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      const petResult = await client.query<{ archived_at: Date | null }>(
        "SELECT archived_at FROM pets WHERE id = $1 AND customer_id = $2 FOR UPDATE",
        [petId, customerId],
      );

      if (!petResult.rows[0]) {
        throw new HttpException(
          { code: "PET_NOT_FOUND", message: "找不到这份宠物档案，或当前顾客无权归档。" },
          HttpStatus.NOT_FOUND,
        );
      }

      if (!petResult.rows[0].archived_at) {
        const bookingResult = await client.query<{ id: string; starts_at: Date }>(
          `
            SELECT id, starts_at
            FROM bookings
            WHERE pet_id = $1
              AND customer_id = $2
              AND status IN ('confirmed', 'checked_in')
              AND starts_at > $3::timestamptz
            ORDER BY starts_at
            LIMIT 1
          `,
          [petId, customerId, getDemoNow()],
        );
        const booking = bookingResult.rows[0];

        if (booking) {
          throw new HttpException(
            {
              code: "PET_HAS_FUTURE_BOOKING",
              message: "这只宠物仍有关联的未来预约，请先处理预约后再归档。",
              booking: { id: booking.id, startsAt: booking.starts_at.toISOString() },
            },
            HttpStatus.CONFLICT,
          );
        }

        await client.query(
          "UPDATE pets SET archived_at = $3::timestamptz, updated_at = now() WHERE id = $1 AND customer_id = $2",
          [petId, customerId, getDemoNow()],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.requirePet(customerId, petId);
  }

  async restore(customerId: string, petId: string): Promise<PetProfile> {
    const result = await this.database.pool.query(
      `
        UPDATE pets
        SET archived_at = null, updated_at = now()
        WHERE id = $1 AND customer_id = $2
        RETURNING id
      `,
      [petId, customerId],
    );

    if (!result.rows[0]) {
      throw new HttpException(
        { code: "PET_NOT_FOUND", message: "找不到这份宠物档案，或当前顾客无权恢复。" },
        HttpStatus.NOT_FOUND,
      );
    }

    return this.requirePet(customerId, petId);
  }

  private async requirePet(customerId: string, petId: string): Promise<PetProfile> {
    const pet = await this.get(customerId, petId);

    if (!pet) {
      throw new Error("宠物档案状态更新后无法读取");
    }

    return pet;
  }

  private async assertPhotoOwnership(
    client: PoolClient,
    customerId: string,
    photoId: string | null,
  ): Promise<void> {
    if (!photoId) {
      return;
    }

    const result = await client.query(
      "SELECT 1 FROM pet_photos WHERE id = $1 AND customer_id = $2",
      [photoId, customerId],
    );

    if (!result.rows[0]) {
      throw new HttpException(
        {
          code: "VALIDATION_ERROR",
          message: "请检查宠物资料中的字段。",
          fieldErrors: { photoId: "找不到这张照片，或当前顾客无权使用。" },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async write(
    customerId: string,
    petId: string,
    input: PetProfileInput,
    create: boolean,
  ): Promise<void> {
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      await this.assertPhotoOwnership(client, customerId, input.photoId);

      if (create) {
        await client.query(
          `
            INSERT INTO pets (
              id, customer_id, name, species, weight_kg, breed, sex, birth_date,
              coat_type, photo_id, care_notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [
            petId,
            customerId,
            input.name,
            input.species,
            input.weightKg,
            input.breed,
            input.sex,
            input.birthDate,
            input.coatType,
            input.photoId,
            input.careNotes,
          ],
        );
      } else {
        const result = await client.query(
          `
            UPDATE pets
            SET name = $3,
                species = $4,
                weight_kg = $5,
                breed = $6,
                sex = $7,
                birth_date = $8,
                coat_type = $9,
                photo_id = $10,
                care_notes = $11,
                updated_at = now()
            WHERE id = $1 AND customer_id = $2
            RETURNING id
          `,
          [
            petId,
            customerId,
            input.name,
            input.species,
            input.weightKg,
            input.breed,
            input.sex,
            input.birthDate,
            input.coatType,
            input.photoId,
            input.careNotes,
          ],
        );

        if (!result.rows[0]) {
          throw new HttpException(
            { code: "PET_NOT_FOUND", message: "找不到这份宠物档案，或当前顾客无权修改。" },
            HttpStatus.NOT_FOUND,
          );
        }
      }

      await client.query("DELETE FROM pet_care_tags WHERE pet_id = $1", [petId]);

      for (const tag of input.careTags) {
        await client.query("INSERT INTO pet_care_tags (pet_id, tag) VALUES ($1, $2)", [petId, tag]);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
