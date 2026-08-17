import { createHash, createHmac, randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { quoteBookingSelection } from "@rongguang/contracts";
import type {
  BookingDetailResponse,
  BookingConflictSuggestion,
  BookingSelectionLine,
  BookingSelectionQuote,
  ConfirmedBooking,
  CreateBookingInput,
  CreateBookingResponse,
  PetSize,
  StaffSkillId,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import {
  bookingWindowFor,
  earliestCustomerCandidate,
} from "../booking-availability/availability.js";
import { BookingAvailabilityService } from "../booking-availability/booking-availability.service.js";
import { getBookingCodeSecret, getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { getShanghaiLocalDate } from "../schedule/schedule-date.js";
import { ServiceCatalogService } from "../service-catalog/service-catalog.service.js";

interface PetRow {
  id: string;
  name: string;
  species: "dog" | "cat";
  weight_kg: string;
  archived_at: Date | null;
}

interface StaffRow {
  id: string;
  display_name: string;
  skills: StaffSkillId[];
}

interface BookingRow {
  id: string;
  pet_id: string;
  staff_id: string;
  status: "confirmed";
  starts_at: Date;
  ends_at: Date;
  occupancy_ends_at: Date;
  service_duration_minutes: number;
  pet_name_snapshot: string;
  pet_species_snapshot: "dog" | "cat";
  pet_weight_kg_snapshot: string;
  pet_size_snapshot: PetSize;
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  primary_service_price_cents: number;
  primary_service_duration_minutes: number;
  addon_snapshots: BookingSelectionLine[];
  total_price_cents: number;
  staff_display_name_snapshot: string;
  turnover_minutes: number;
  original_starts_at: Date;
  original_ends_at: Date;
  original_occupancy_starts_at: Date;
  original_occupancy_ends_at: Date;
  created_at: Date;
}

interface IdempotencyRow {
  request_digest: string;
  booking_id: string | null;
  response_status: number | null;
  response_body: unknown | null;
}

interface BookingConflictBody {
  code: "BOOKING_TIME_CONFLICT";
  message: string;
  nextStep: "conflict";
  suggestions: BookingConflictSuggestion[];
}

interface DatabaseError {
  code?: string;
  constraint?: string;
}

const idPattern = /^[a-z0-9][a-z0-9-]{1,79}$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function businessError(code: string, message: string, status: HttpStatus, details = {}): never {
  throw new HttpException({ code, message, ...details }, status);
}

function validationError(fieldErrors: Record<string, string>): never {
  businessError("VALIDATION_ERROR", "预约草稿无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
    fieldErrors,
  });
}

function parseCreateInput(body: unknown): CreateBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};

  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  for (const key of ["petId", "primaryServiceId", "staffId"] as const) {
    if (typeof input[key] !== "string" || !idPattern.test(input[key])) {
      fieldErrors[key] = "请选择有效值。";
    }
  }
  if (
    !Array.isArray(input.addonIds) ||
    input.addonIds.length > 3 ||
    input.addonIds.some((id) => typeof id !== "string" || !idPattern.test(id)) ||
    new Set(input.addonIds).size !== input.addonIds.length
  ) {
    fieldErrors.addonIds = "增项选择无效，请重新选择。";
  }
  if (typeof input.startsAt !== "string" || !Number.isFinite(Date.parse(input.startsAt))) {
    fieldErrors.startsAt = "请选择有效的预约开始时间。";
  }
  const staffPreference = (() => {
    if (input.staffPreference === undefined) {
      return { kind: "specified", staffId: input.staffId } as const;
    }
    if (!input.staffPreference || typeof input.staffPreference !== "object") {
      fieldErrors.staffPreference = "请选择有效的员工偏好。";
      return null;
    }
    const preference = input.staffPreference as Record<string, unknown>;
    if (preference.kind === "fastest") {
      return { kind: "fastest" } as const;
    }
    if (
      preference.kind === "specified" &&
      typeof preference.staffId === "string" &&
      idPattern.test(preference.staffId) &&
      preference.staffId === input.staffId
    ) {
      return { kind: "specified", staffId: preference.staffId } as const;
    }
    fieldErrors.staffPreference = "指定员工偏好必须与本次分配员工一致。";
    return null;
  })();
  if (Object.keys(fieldErrors).length > 0) {
    validationError(fieldErrors);
  }

  return {
    idempotencyKey: input.idempotencyKey as string,
    petId: input.petId as string,
    primaryServiceId: input.primaryServiceId as string,
    addonIds: [...(input.addonIds as string[])].sort(),
    staffId: input.staffId as string,
    staffPreference: staffPreference as CreateBookingInput["staffPreference"],
    startsAt: new Date(input.startsAt as string).toISOString(),
  };
}

function petSizeFor(weightKg: number): PetSize {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function hasAllSkills(staff: StaffRow, requiredSkills: StaffSkillId[]): boolean {
  const skills = new Set(staff.skills);
  return requiredSkills.every((skill) => skills.has(skill));
}

function requestDigest(input: CreateBookingInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function verificationCode(customerId: string, idempotencyKey: string, bookingId: string): string {
  const digest = createHmac("sha256", getBookingCodeSecret())
    .update(`${customerId}:${idempotencyKey}:${bookingId}`)
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function verificationCodeDigest(bookingId: string, code: string): string {
  return createHmac("sha256", getBookingCodeSecret())
    .update(`booking-code:${bookingId}:${code}`)
    .digest("hex");
}

function localMinuteOfDay(instant: Date): number {
  const local = new Date(instant.getTime() + 8 * 60 * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function asBooking(row: BookingRow): ConfirmedBooking {
  return {
    id: row.id,
    status: row.status,
    pet: {
      id: row.pet_id,
      name: row.pet_name_snapshot,
      species: row.pet_species_snapshot,
      weightKg: Number(row.pet_weight_kg_snapshot),
      petSize: row.pet_size_snapshot,
    },
    primaryService: {
      id: row.primary_service_id_snapshot,
      name: row.primary_service_name_snapshot,
      priceCents: row.primary_service_price_cents,
      durationMinutes: row.primary_service_duration_minutes,
    },
    addons: row.addon_snapshots,
    staff: { id: row.staff_id, displayName: row.staff_display_name_snapshot },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    turnoverEndsAt: row.occupancy_ends_at.toISOString(),
    totalPriceCents: row.total_price_cents,
    serviceDurationMinutes: row.service_duration_minutes,
    turnoverMinutes: row.turnover_minutes,
    originalSchedule: {
      startsAt: row.original_starts_at.toISOString(),
      endsAt: row.original_ends_at.toISOString(),
      occupancyStartsAt: row.original_occupancy_starts_at.toISOString(),
      occupancyEndsAt: row.original_occupancy_ends_at.toISOString(),
    },
    createdAt: row.created_at.toISOString(),
  };
}

const bookingColumns = `
  id, pet_id, staff_id, status, starts_at, ends_at, occupancy_ends_at,
  service_duration_minutes, pet_name_snapshot, pet_species_snapshot,
  pet_weight_kg_snapshot::text, pet_size_snapshot,
  primary_service_id_snapshot, primary_service_name_snapshot,
  primary_service_price_cents, primary_service_duration_minutes,
  addon_snapshots, total_price_cents, staff_display_name_snapshot,
  turnover_minutes, original_starts_at, original_ends_at,
  original_occupancy_starts_at, original_occupancy_ends_at, created_at
`;

@Injectable()
export class BookingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ServiceCatalogService) private readonly catalog: ServiceCatalogService,
    @Inject(BookingAvailabilityService)
    private readonly availability: BookingAvailabilityService,
  ) {}

  async createConfirmed(customerId: string, body: unknown): Promise<CreateBookingResponse> {
    const input = parseCreateInput(body);
    const digest = requestDigest(input);
    const client = await this.database.pool.connect();
    const idempotencyLockKey = `${customerId}:create_booking:${input.idempotencyKey}`;
    let idempotencyLockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [idempotencyLockKey]);
      idempotencyLockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<IdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM booking_idempotency_keys
          WHERE customer_id = $1
            AND command_type = 'create_booking'
            AND idempotency_key = $2
        `,
        [customerId, input.idempotencyKey],
      );
      const previous = existing.rows[0];

      if (previous) {
        if (previous.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一份预约草稿，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!previous.booking_id) {
          if (
            previous.response_status &&
            previous.response_body &&
            typeof previous.response_body === "object"
          ) {
            await client.query("COMMIT");
            throw new HttpException(previous.response_body, previous.response_status);
          }
          throw new Error("预约幂等结果缺少成功预约或失败响应。");
        }
        const booking = await this.findBooking(client, customerId, previous.booking_id);
        await client.query("COMMIT");
        return {
          booking,
          verificationCode: verificationCode(customerId, input.idempotencyKey, booking.id),
        };
      }

      await this.requirePrivacyConsent(client, customerId);
      const pet = await this.requireActivePet(client, customerId, input.petId);
      const selection = this.quote(pet, input.primaryServiceId, input.addonIds);
      const staff = await this.requireQualifiedStaff(client, input.staffId, selection);
      const interval = await this.requireAvailableInterval(client, input, selection);
      const bookingId = randomUUID();
      const code = verificationCode(customerId, input.idempotencyKey, bookingId);
      const createdAt = getDemoNow();

      await client.query(
        `
          INSERT INTO bookings (
            id, customer_id, pet_id, staff_id, starts_at, ends_at,
            occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
            pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
            primary_service_id_snapshot, primary_service_name_snapshot,
            primary_service_price_cents, primary_service_duration_minutes,
            addon_snapshots, required_skill_ids_snapshot, total_price_cents,
            staff_display_name_snapshot, turnover_minutes,
            original_starts_at, original_ends_at,
            original_occupancy_starts_at, original_occupancy_ends_at,
            verification_code_digest, created_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $5, $7, $8, 'confirmed',
            $9, $10, $11, $12, $13, $14, $15, $16,
            $17::jsonb, $18::jsonb, $19, $20, 15,
            $5, $6, $5, $7, $21, $22
          )
        `,
        [
          bookingId,
          customerId,
          pet.id,
          staff.id,
          interval.startsAt,
          interval.endsAt,
          interval.turnoverEndsAt,
          selection.serviceDurationMinutes,
          pet.name,
          pet.species,
          Number(pet.weight_kg),
          selection.pet.petSize,
          selection.primaryService.id,
          selection.primaryService.name,
          selection.primaryService.priceCents,
          selection.primaryService.durationMinutes,
          JSON.stringify(selection.addons),
          JSON.stringify(selection.requiredSkillIds),
          selection.totalPriceCents,
          staff.display_name,
          verificationCodeDigest(bookingId, code),
          createdAt,
        ],
      );
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest, booking_id, created_at
          )
          VALUES ($1, 'create_booking', $2, $3, $4, $5)
        `,
        [customerId, input.idempotencyKey, digest, bookingId, createdAt],
      );
      const factPayload = JSON.stringify({
        status: "confirmed",
        petId: pet.id,
        staffId: staff.id,
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        turnoverEndsAt: interval.turnoverEndsAt,
        totalPriceCents: selection.totalPriceCents,
      });
      await client.query(
        `
          INSERT INTO booking_events (
            id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
          )
          VALUES ($1, $2, 'booking_confirmed', 'customer', $3, $4::jsonb, $5)
        `,
        [randomUUID(), bookingId, customerId, factPayload, createdAt],
      );
      await client.query(
        `
          INSERT INTO audit_events (
            id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
          )
          VALUES ($1, 'booking_created', 'customer', $2, 'booking', $3, $4::jsonb, $5)
        `,
        [randomUUID(), customerId, bookingId, factPayload, createdAt],
      );
      await client.query(
        `
          INSERT INTO notification_outbox (
            id, booking_id, customer_id, notification_type, payload,
            status, available_at, created_at
          )
          VALUES (
            $1, $2, $3, 'booking_confirmed', $4::jsonb,
            'pending', $5, $5
          )
        `,
        [
          randomUUID(),
          bookingId,
          customerId,
          JSON.stringify({
            bookingId,
            petName: pet.name,
            staffName: staff.display_name,
            startsAt: interval.startsAt,
          }),
          createdAt,
        ],
      );
      const booking = await this.findBooking(client, customerId, bookingId);
      await client.query("COMMIT");
      return { booking, verificationCode: code };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      if (
        this.isBookingTimeConflict(error) ||
        databaseError.code === "23P01" ||
        databaseError.code === "40001" ||
        databaseError.code === "40P01"
      ) {
        await this.throwBookingTimeConflict(customerId, input, digest, client);
      }
      if (error instanceof HttpException) throw error;
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (idempotencyLockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [idempotencyLockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("预约幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError =
            error instanceof Error ? error : new Error("预约幂等锁释放失败，连接不可复用。");
        }
      }
      client.release(releaseError);
    }
  }

  private isBookingTimeConflict(error: unknown): boolean {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    if (!response || typeof response !== "object") return false;
    const code = (response as { code?: unknown }).code;
    return code === "STAFF_TIME_CONFLICT" || code === "PET_TIME_CONFLICT";
  }

  private async throwBookingTimeConflict(
    customerId: string,
    input: CreateBookingInput,
    digest: string,
    client: PoolClient,
  ): Promise<never> {
    const availability = await this.availability.discover(
      {
        customerId,
        petId: input.petId,
        primaryServiceId: input.primaryServiceId,
        addonIds: input.addonIds.join(","),
        staffId:
          input.staffPreference.kind === "specified" ? input.staffPreference.staffId : undefined,
      },
      client,
    );
    const requestedStart = Date.parse(input.startsAt);
    const nearbySuggestions: BookingConflictSuggestion[] = availability.days
      .flatMap((day) =>
        day.slots.map((slot) => ({
          date: day.date,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          staff: {
            id: slot.staff.id,
            displayName: slot.staff.displayName,
          },
        })),
      )
      .filter((suggestion) => suggestion.startsAt !== input.startsAt)
      .sort((left, right) => {
        const distance =
          Math.abs(Date.parse(left.startsAt) - requestedStart) -
          Math.abs(Date.parse(right.startsAt) - requestedStart);
        return distance || left.startsAt.localeCompare(right.startsAt);
      })
      .slice(0, 5);
    const suggestions = nearbySuggestions.length >= 3 ? nearbySuggestions : [];

    const proposed: BookingConflictBody = {
      code: "BOOKING_TIME_CONFLICT",
      message: "刚刚有人选走了这个时段，请选择相近可用安排。",
      nextStep: "conflict",
      suggestions,
    };
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'create_booking', $2, $3, NULL, $4, $5::jsonb, $6)
        `,
        [
          customerId,
          input.idempotencyKey,
          digest,
          HttpStatus.CONFLICT,
          JSON.stringify(proposed),
          getDemoNow(),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    throw new HttpException(proposed, HttpStatus.CONFLICT);
  }

  async detail(customerId: string, bookingId: string): Promise<BookingDetailResponse> {
    if (!idPattern.test(bookingId) && !/^[0-9a-f-]{36}$/.test(bookingId)) {
      businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    }
    const client = await this.database.pool.connect();
    try {
      return { booking: await this.findBooking(client, customerId, bookingId) };
    } finally {
      client.release();
    }
  }

  private async findBooking(
    client: PoolClient,
    customerId: string,
    bookingId: string,
  ): Promise<ConfirmedBooking> {
    const result = await client.query<BookingRow>(
      `SELECT ${bookingColumns} FROM bookings WHERE id = $1 AND customer_id = $2`,
      [bookingId, customerId],
    );
    const row = result.rows[0];
    if (!row) {
      businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    }
    return asBooking(row);
  }

  private async requirePrivacyConsent(client: PoolClient, customerId: string): Promise<void> {
    const result = await client.query<{ accepted: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM privacy_notices AS notice
          JOIN privacy_consents AS consent
            ON consent.notice_version = notice.version
           AND consent.customer_id = $1
          WHERE notice.is_current
        ) AS accepted
      `,
      [customerId],
    );
    if (!result.rows[0]?.accepted) {
      businessError(
        "PRIVACY_CONSENT_REQUIRED",
        "隐私说明尚未同意或已经更新，请确认后再提交预约。",
        HttpStatus.CONFLICT,
        { nextStep: "privacy" },
      );
    }
  }

  private async requireActivePet(
    client: PoolClient,
    customerId: string,
    petId: string,
  ): Promise<PetRow> {
    const result = await client.query<PetRow>(
      `
        SELECT id, name, species, weight_kg::text, archived_at
        FROM pets
        WHERE id = $1 AND customer_id = $2
      `,
      [petId, customerId],
    );
    const pet = result.rows[0];
    if (!pet) {
      businessError(
        "PET_NOT_FOUND",
        "找不到这份宠物档案，或当前顾客无权访问。",
        HttpStatus.NOT_FOUND,
      );
    }
    if (pet.archived_at) {
      businessError(
        "PET_ARCHIVED",
        "已归档宠物不能用于新预约，请先恢复使用。",
        HttpStatus.CONFLICT,
        { nextStep: "pet" },
      );
    }
    return pet;
  }

  private quote(pet: PetRow, primaryServiceId: string, addonIds: string[]): BookingSelectionQuote {
    try {
      return quoteBookingSelection(
        {
          id: pet.id,
          name: pet.name,
          species: pet.species,
          weightKg: Number(pet.weight_kg),
          petSize: petSizeFor(Number(pet.weight_kg)),
        },
        this.catalog.getStorefront(),
        primaryServiceId,
        addonIds,
      );
    } catch (error) {
      businessError(
        "SERVICE_NOT_AVAILABLE",
        error instanceof Error ? error.message : "服务已经停用或不再适用于这只宠物。",
        HttpStatus.CONFLICT,
        { nextStep: "service" },
      );
    }
  }

  private async requireQualifiedStaff(
    client: PoolClient,
    staffId: string,
    selection: BookingSelectionQuote,
  ): Promise<StaffRow> {
    const result = await client.query<StaffRow>(
      `
        SELECT staff.id,
               account.display_name,
               coalesce(array_agg(skill.skill_id ORDER BY skill.skill_id)
                 FILTER (WHERE skill.skill_id IS NOT NULL), '{}') AS skills
        FROM staff_members AS staff
        JOIN backoffice_accounts AS account ON account.id = staff.id
        LEFT JOIN staff_skills AS skill ON skill.staff_id = staff.id
        WHERE staff.id = $1 AND staff.active = true AND account.active = true
        GROUP BY staff.id, account.display_name
      `,
      [staffId],
    );
    const staff = result.rows[0];
    if (!staff || !hasAllSkills(staff, selection.requiredSkillIds)) {
      businessError(
        "STAFF_NOT_QUALIFIED",
        "所选员工当前无法完成全部服务，请重新选择员工或时段。",
        HttpStatus.CONFLICT,
        { nextStep: "staff" },
      );
    }
    return staff;
  }

  private async requireAvailableInterval(
    client: PoolClient,
    input: CreateBookingInput,
    selection: BookingSelectionQuote,
  ): Promise<{ startsAt: string; endsAt: string; turnoverEndsAt: string }> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + selection.serviceDurationMinutes * 60_000);
    const turnoverEndsAt = new Date(endsAt.getTime() + 15 * 60_000);
    const localDate = getShanghaiLocalDate(startsAt);
    const window = bookingWindowFor(getDemoNow());
    const localMinute = localMinuteOfDay(startsAt);

    if (
      startsAt.getUTCSeconds() !== 0 ||
      startsAt.getUTCMilliseconds() !== 0 ||
      localMinute % 30 !== 0 ||
      startsAt.getTime() < Date.parse(earliestCustomerCandidate(getDemoNow())) ||
      localDate < window.startsOn ||
      localDate > window.endsOn ||
      getShanghaiLocalDate(turnoverEndsAt) !== localDate
    ) {
      businessError(
        "SLOT_OUTSIDE_OPEN_WINDOW",
        "所选时间已超出预约开放窗口，请重新选择。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }

    const capacity = await client.query<{
      within_business_hours: boolean;
      within_published_schedule: boolean;
      capacity_blocked: boolean;
      staff_conflict: boolean;
      pet_conflict: boolean;
    }>(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM store_business_hours
            WHERE weekday = extract(dow FROM $1::timestamptz AT TIME ZONE 'Asia/Shanghai')::int
              AND opens_at IS NOT NULL
              AND opens_at <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              AND closes_at >= ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
          ) AS within_business_hours,
          EXISTS (
            SELECT 1
            FROM staff_schedule_days AS day
            JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
            WHERE day.staff_id = $4
              AND day.local_date = $6::date
              AND day.publication_status = 'published'
              AND day.published_at IS NOT NULL
              AND shift.starts_at <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              AND shift.ends_at >= ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              AND NOT EXISTS (
                SELECT 1
                FROM staff_schedule_breaks AS shift_break
                WHERE shift_break.schedule_shift_id = shift.id
                  AND shift_break.starts_at < ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
                  AND shift_break.ends_at > ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              )
          ) AS within_published_schedule,
          (
            EXISTS (
              SELECT 1
              FROM staff_time_off_intervals
              WHERE staff_id = $4
                AND local_date = $6::date
                AND status IN ('pending', 'active')
                AND starts_at < ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
                AND ends_at > ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
            )
            OR EXISTS (
              SELECT 1
              FROM store_closure_intervals
              WHERE local_date = $6::date
                AND status IN ('pending', 'active')
                AND starts_at < ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
                AND ends_at > ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
            )
          ) AS capacity_blocked,
          EXISTS (
            SELECT 1 FROM bookings
            WHERE staff_id = $4
              AND status NOT IN ('cancelled', 'no_show')
              AND tstzrange(occupancy_starts_at, occupancy_ends_at, '[)')
                  && tstzrange($1::timestamptz, $3::timestamptz, '[)')
          ) AS staff_conflict,
          EXISTS (
            SELECT 1 FROM bookings
            WHERE pet_id = $5
              AND status NOT IN ('cancelled', 'no_show')
              AND tstzrange(starts_at, ends_at, '[)')
                  && tstzrange($1::timestamptz, $2::timestamptz, '[)')
          ) AS pet_conflict
      `,
      [
        startsAt.toISOString(),
        endsAt.toISOString(),
        turnoverEndsAt.toISOString(),
        input.staffId,
        input.petId,
        localDate,
      ],
    );
    const result = capacity.rows[0];
    if (result?.pet_conflict) {
      businessError(
        "PET_TIME_CONFLICT",
        "这只宠物在所选时间已有预约，请选择其他时段。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }
    if (result?.staff_conflict) {
      businessError(
        "STAFF_TIME_CONFLICT",
        "这个员工的时段刚被占用，请选择相近时段。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }
    if (
      !result?.within_business_hours ||
      !result.within_published_schedule ||
      result.capacity_blocked
    ) {
      businessError(
        "SLOT_NO_LONGER_AVAILABLE",
        "所选时段已不在当前已发布排班或可用容量内，请重新选择。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      turnoverEndsAt: turnoverEndsAt.toISOString(),
    };
  }
}
