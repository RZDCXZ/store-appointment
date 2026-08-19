import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  ManagerCustomerListFilters,
  ManagerCustomerBookingHistoryItem,
  ManagerCustomerHistoryResponse,
  ManagerCustomerListItem,
  ManagerCustomerListResponse,
  ManagerCustomerPetProfile,
  ManagerCustomerProfileResponse,
  ManagerPetDetailResponse,
  StoreServiceRecord,
} from "@rongguang/contracts";

import { DatabaseService } from "../database/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getDemoNow } from "../config/environment.js";
import { getShanghaiLocalDate } from "../schedule/schedule-date.js";
import { managerBookingListFilters } from "./manager-live-booking.service.js";

const pageSize = 20;

interface CustomerListRow {
  id: string;
  display_name: string;
  phone: string;
  pets: ManagerCustomerListItem["pets"];
  future_booking_count: string;
  completed_service_count: string;
}

interface CustomerProfileRow {
  id: string;
  display_name: string;
  phone: string;
  created_at: Date;
}

interface CustomerPetRow {
  id: string;
  name: string;
  species: ManagerCustomerPetProfile["species"];
  weight_kg: string;
  breed: string | null;
  sex: ManagerCustomerPetProfile["sex"];
  birth_date: string | null;
  coat_type: ManagerCustomerPetProfile["coatType"];
  photo_path: string | null;
  care_tags: string[];
  care_notes: string | null;
  archived_at: Date | null;
}

interface CustomerBookingHistoryRow {
  id: string;
  status: ManagerCustomerBookingHistoryItem["status"];
  pet_id: string;
  pet_name_snapshot: string;
  pet_species_snapshot: ManagerCustomerBookingHistoryItem["pet"]["species"];
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  addon_snapshots: ManagerCustomerBookingHistoryItem["addons"];
  staff_id: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
  ends_at: Date;
  total_price_cents: number;
  service_duration_minutes: number;
}

interface CustomerServiceRecordRow {
  id: string;
  booking_id: string;
  pet_snapshot: StoreServiceRecord["pet"];
  primary_service_snapshot: StoreServiceRecord["primaryService"];
  addon_snapshots: StoreServiceRecord["addons"];
  staff_snapshot: StoreServiceRecord["staff"];
  actual_starts_at: Date;
  actual_ends_at: Date;
  care_tags: StoreServiceRecord["careTags"];
  internal_text: string | null;
  created_at: Date;
}

interface CustomerServiceRecordNoteRow {
  id: string;
  service_record_id: string;
  kind: StoreServiceRecord["notes"][number]["kind"];
  note_text: string;
  author_type: StoreServiceRecord["notes"][number]["author"]["type"];
  author_id: string;
  author_display_name: string;
  created_at: Date;
}

interface BookingCsvRow {
  id: string;
  status: "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show" | "terminated";
  customer_display_name: string;
  customer_phone: string;
  pet_name_snapshot: string;
  pet_species_snapshot: "dog" | "cat";
  primary_service_name_snapshot: string;
  addon_snapshots: Array<{ id: string; name: string }>;
  staff_display_name_snapshot: string;
  starts_at: Date;
  ends_at: Date;
  service_duration_minutes: number;
  turnover_minutes: number;
  total_price_cents: number;
}

interface CustomerPetJsonExportRow {
  display_name: string;
  phone: string;
  created_at: Date;
  privacy_consents: Array<{
    version: string;
    source: "miniapp_booking" | "manager_offline";
    consentedAt: string;
  }>;
  pets: Array<{
    name: string;
    species: ManagerCustomerPetProfile["species"];
    weightKg: number;
    petSize: ManagerCustomerPetProfile["petSize"];
    breed: string | null;
    sex: ManagerCustomerPetProfile["sex"];
    birthDate: string | null;
    coatType: ManagerCustomerPetProfile["coatType"];
    photoPath: string | null;
    careTags: string[];
    careNotes: string | null;
    archivedAt: string | null;
  }>;
}

export interface ManagerExportFile {
  filename: string;
  contentType: string;
  body: string;
}

const bookingStatusLabels: Record<BookingCsvRow["status"], string> = {
  confirmed: "已确认",
  checked_in: "已到店",
  completed: "已完成",
  cancelled: "已取消",
  no_show: "已爽约",
  terminated: "已终止",
};

function bodyString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function shanghaiDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")}`;
}

function petSize(weightKg: number): ManagerCustomerPetProfile["petSize"] {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function phoneMasked(phone: string): string {
  if (phone.length < 7) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function listFilters(input: { query?: string; page?: string }): ManagerCustomerListFilters {
  const query = input.query?.trim() ?? "";
  const rawPage = input.page?.trim() || "1";
  const page = Number(rawPage);
  const fieldErrors: Record<string, string> = {};

  if (query.length > 50) fieldErrors.query = "搜索关键字不能超过 50 个字符。";
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1) {
    fieldErrors.page = "请选择有效页码。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new HttpException(
      { code: "VALIDATION_ERROR", message: "顾客筛选条件无效。", fieldErrors },
      HttpStatus.BAD_REQUEST,
    );
  }

  return { query, page };
}

@Injectable()
export class ManagerCustomerRecordsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  async list(input: { query?: string; page?: string }): Promise<ManagerCustomerListResponse> {
    const filters = listFilters(input);
    const offset = (filters.page - 1) * pageSize;
    const demoNow = getDemoNow();
    const searchWhere = `
      (
        $1::text = ''
        OR customer.display_name ILIKE '%' || $1 || '%'
        OR concat(left(customer.phone, 3), '****', right(customer.phone, 4)) ILIKE '%' || $1 || '%'
        OR EXISTS (
          SELECT 1
          FROM pets AS searched_pet
          WHERE searched_pet.customer_id = customer.id
            AND searched_pet.name ILIKE '%' || $1 || '%'
        )
      )
    `;
    const [countResult, customerResult] = await Promise.all([
      this.database.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM customers AS customer WHERE ${searchWhere}`,
        [filters.query],
      ),
      this.database.pool.query<CustomerListRow>(
        `
          SELECT customer.id,
                 customer.display_name,
                 customer.phone,
                 COALESCE(
                   (
                     SELECT jsonb_agg(
                       jsonb_build_object(
                         'id', pet.id,
                         'name', pet.name,
                         'species', pet.species,
                         'breed', pet.breed,
                         'photoPath', pet.seed_photo_path,
                         'archivedAt', pet.archived_at
                       )
                       ORDER BY pet.archived_at NULLS FIRST, pet.created_at, pet.id
                     )
                     FROM pets AS pet
                     WHERE pet.customer_id = customer.id
                   ),
                   '[]'::jsonb
                 ) AS pets,
                 (
                   SELECT count(*)::text
                   FROM bookings AS booking
                   WHERE booking.customer_id = customer.id
                     AND booking.status = 'confirmed'
                     AND booking.starts_at > $4::timestamptz
                 ) AS future_booking_count,
                 (
                   SELECT count(*)::text
                   FROM store_service_records AS record
                   JOIN bookings AS booking ON booking.id = record.booking_id
                   WHERE booking.customer_id = customer.id
                 ) AS completed_service_count
          FROM customers AS customer
          WHERE ${searchWhere}
          ORDER BY customer.display_name, customer.id
          LIMIT $2 OFFSET $3
        `,
        [filters.query, pageSize, offset, demoNow],
      ),
    ]);
    const totalItems = Number(countResult.rows[0]?.count ?? 0);

    return {
      appliedFilters: filters,
      pagination: {
        page: filters.page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
      customers: customerResult.rows.map((customer) => ({
        id: customer.id,
        displayName: customer.display_name,
        phoneMasked: phoneMasked(customer.phone),
        pets: customer.pets.map((pet) => ({
          ...pet,
          archivedAt: pet.archivedAt ? new Date(pet.archivedAt).toISOString() : null,
        })),
        futureBookingCount: Number(customer.future_booking_count),
        completedServiceCount: Number(customer.completed_service_count),
      })),
    };
  }

  async profile(customerId: string): Promise<ManagerCustomerProfileResponse> {
    const [customerResult, petResult, consentResult] = await Promise.all([
      this.database.pool.query<CustomerProfileRow>(
        "SELECT id, display_name, phone, created_at FROM customers WHERE id = $1",
        [customerId],
      ),
      this.database.pool.query<CustomerPetRow>(
        `
          SELECT pet.id,
                 pet.name,
                 pet.species,
                 pet.weight_kg::text,
                 pet.breed,
                 pet.sex,
                 pet.birth_date::text,
                 pet.coat_type,
                 COALESCE(photo.public_path, pet.seed_photo_path) AS photo_path,
                 COALESCE(
                   (
                     SELECT jsonb_agg(tag.tag ORDER BY tag.tag)
                     FROM pet_care_tags AS tag
                     WHERE tag.pet_id = pet.id
                   ),
                   '[]'::jsonb
                 ) AS care_tags,
                 pet.care_notes,
                 pet.archived_at
          FROM pets AS pet
          LEFT JOIN pet_photos AS photo ON photo.id = pet.photo_id
          WHERE pet.customer_id = $1
          ORDER BY pet.archived_at NULLS FIRST, pet.created_at, pet.id
        `,
        [customerId],
      ),
      this.database.pool.query<{
        notice_version: string;
        source: "miniapp_booking" | "manager_offline";
        consented_at: Date;
      }>(
        `
          SELECT notice_version, source, consented_at
          FROM privacy_consents
          WHERE customer_id = $1
          ORDER BY consented_at, notice_version
        `,
        [customerId],
      ),
    ]);
    const customer = customerResult.rows[0];

    if (!customer) {
      throw new HttpException(
        { code: "CUSTOMER_NOT_FOUND", message: "找不到这位顾客。" },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      customer: {
        id: customer.id,
        displayName: customer.display_name,
        phoneMasked: phoneMasked(customer.phone),
        createdAt: customer.created_at.toISOString(),
        privacyConsents: consentResult.rows.map((consent) => ({
          version: consent.notice_version,
          source: consent.source,
          consentedAt: consent.consented_at.toISOString(),
        })),
      },
      pets: petResult.rows.map((pet) => {
        const weightKg = Number(pet.weight_kg);
        return {
          id: pet.id,
          name: pet.name,
          species: pet.species,
          weightKg,
          petSize: petSize(weightKg),
          breed: pet.breed,
          sex: pet.sex,
          birthDate: pet.birth_date,
          coatType: pet.coat_type,
          photoPath: pet.photo_path,
          careTags: pet.care_tags,
          careNotes: pet.care_notes,
          archivedAt: pet.archived_at?.toISOString() ?? null,
        };
      }),
    };
  }

  async history(customerId: string): Promise<ManagerCustomerHistoryResponse> {
    const [customerResult, bookingResult, serviceRecordResult] = await Promise.all([
      this.database.pool.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1) AS exists",
        [customerId],
      ),
      this.database.pool.query<CustomerBookingHistoryRow>(
        `
          SELECT id, status, pet_id, pet_name_snapshot, pet_species_snapshot,
                 primary_service_id_snapshot, primary_service_name_snapshot,
                 addon_snapshots, staff_id, staff_display_name_snapshot,
                 starts_at, ends_at, total_price_cents, service_duration_minutes
          FROM bookings
          WHERE customer_id = $1
          ORDER BY starts_at DESC, id
        `,
        [customerId],
      ),
      this.database.pool.query<CustomerServiceRecordRow>(
        `
          SELECT record.id, record.booking_id, record.pet_snapshot,
                 record.primary_service_snapshot, record.addon_snapshots,
                 record.staff_snapshot, record.actual_starts_at,
                 record.actual_ends_at, record.care_tags, record.internal_text,
                 record.created_at
          FROM store_service_records AS record
          JOIN bookings AS booking ON booking.id = record.booking_id
          WHERE booking.customer_id = $1
          ORDER BY record.actual_ends_at DESC, record.id
        `,
        [customerId],
      ),
    ]);

    if (!customerResult.rows[0]?.exists) {
      throw new HttpException(
        { code: "CUSTOMER_NOT_FOUND", message: "找不到这位顾客。" },
        HttpStatus.NOT_FOUND,
      );
    }

    const recordIds = serviceRecordResult.rows.map((record) => record.id);
    const noteResult =
      recordIds.length > 0
        ? await this.database.pool.query<CustomerServiceRecordNoteRow>(
            `
              SELECT id, service_record_id, kind, note_text, author_type,
                     author_id, author_display_name, created_at
              FROM store_service_record_notes
              WHERE service_record_id = ANY($1::text[])
              ORDER BY created_at, id
            `,
            [recordIds],
          )
        : { rows: [] as CustomerServiceRecordNoteRow[] };

    return {
      bookings: bookingResult.rows.map((booking) => ({
        id: booking.id,
        status: booking.status,
        pet: {
          id: booking.pet_id,
          name: booking.pet_name_snapshot,
          species: booking.pet_species_snapshot,
        },
        primaryService: {
          id: booking.primary_service_id_snapshot,
          name: booking.primary_service_name_snapshot,
        },
        addons: booking.addon_snapshots,
        staff: { id: booking.staff_id, displayName: booking.staff_display_name_snapshot },
        startsAt: booking.starts_at.toISOString(),
        endsAt: booking.ends_at.toISOString(),
        totalPriceCents: booking.total_price_cents,
        serviceDurationMinutes: booking.service_duration_minutes,
      })),
      serviceRecords: serviceRecordResult.rows.map((record) => ({
        id: record.id,
        bookingId: record.booking_id,
        pet: record.pet_snapshot,
        primaryService: record.primary_service_snapshot,
        addons: record.addon_snapshots,
        staff: record.staff_snapshot,
        actualStartsAt: record.actual_starts_at.toISOString(),
        actualEndsAt: record.actual_ends_at.toISOString(),
        careTags: record.care_tags,
        internalText: record.internal_text,
        createdAt: record.created_at.toISOString(),
        notes: noteResult.rows
          .filter((note) => note.service_record_id === record.id)
          .map((note) => ({
            id: note.id,
            kind: note.kind,
            text: note.note_text,
            author: {
              type: note.author_type,
              id: note.author_id,
              displayName: note.author_display_name,
            },
            createdAt: note.created_at.toISOString(),
          })),
      })),
    };
  }

  async petDetail(customerId: string, petId: string): Promise<ManagerPetDetailResponse> {
    const [profile, history] = await Promise.all([
      this.profile(customerId),
      this.history(customerId),
    ]);
    const pet = profile.pets.find((candidate) => candidate.id === petId);

    if (!pet) {
      throw new HttpException(
        { code: "PET_NOT_FOUND", message: "找不到这只宠物。" },
        HttpStatus.NOT_FOUND,
      );
    }

    const bookings = history.bookings.filter((booking) => booking.pet.id === petId);
    const bookingIds = new Set(bookings.map((booking) => booking.id));

    return {
      customer: {
        id: profile.customer.id,
        displayName: profile.customer.displayName,
        phoneMasked: profile.customer.phoneMasked,
      },
      pet,
      bookings,
      serviceRecords: history.serviceRecords.filter((record) => bookingIds.has(record.bookingId)),
    };
  }

  async exportBookingsCsv(identity: BackofficeIdentity, body: unknown): Promise<ManagerExportFile> {
    const filters = managerBookingListFilters({
      date: bodyString(body, "date"),
      status: bodyString(body, "status"),
      staffId: bodyString(body, "staffId"),
      primaryServiceId: bodyString(body, "primaryServiceId"),
      query: bodyString(body, "query"),
    });
    const client = await this.database.pool.connect();
    const occurredAt = getDemoNow();

    try {
      await client.query("BEGIN");
      const result = await client.query<BookingCsvRow>(
        `
          SELECT booking.id,
                 booking.status,
                 customer.display_name AS customer_display_name,
                 customer.phone AS customer_phone,
                 booking.pet_name_snapshot,
                 booking.pet_species_snapshot,
                 booking.primary_service_name_snapshot,
                 booking.addon_snapshots,
                 booking.staff_display_name_snapshot,
                 booking.starts_at,
                 booking.ends_at,
                 booking.service_duration_minutes,
                 booking.turnover_minutes,
                 booking.total_price_cents
          FROM bookings AS booking
          JOIN customers AS customer ON customer.id = booking.customer_id
          WHERE ($1::date IS NULL OR (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date = $1::date)
            AND ($2::text IS NULL OR booking.status = $2)
            AND ($3::text IS NULL OR booking.staff_id = $3)
            AND ($4::text IS NULL OR booking.primary_service_id_snapshot = $4)
            AND (
              $5::text = ''
              OR customer.display_name ILIKE '%' || $5 || '%'
              OR booking.pet_name_snapshot ILIKE '%' || $5 || '%'
            )
          ORDER BY booking.starts_at DESC, booking.id
        `,
        [filters.date, filters.status, filters.staffId, filters.primaryServiceId, filters.query],
      );
      await this.audits.append(
        {
          eventType: "data_exported",
          actor: { type: "manager", id: identity.id },
          subject: { type: "store", id: "rongguang-store" },
          payload: { exportType: "bookings_csv", filters, recordCount: result.rowCount ?? 0 },
          occurredAt,
        },
        client,
      );
      await client.query("COMMIT");

      const header = [
        "预约编号",
        "预约状态",
        "顾客姓名",
        "顾客手机号（脱敏）",
        "宠物名称",
        "宠物种类",
        "主要服务",
        "增项",
        "员工",
        "计划开始时间",
        "计划结束时间",
        "服务时长（分钟）",
        "周转时间（分钟）",
        "预约标价（元）",
      ];
      const rows = result.rows.map((row) => [
        row.id,
        bookingStatusLabels[row.status],
        row.customer_display_name,
        phoneMasked(row.customer_phone),
        row.pet_name_snapshot,
        row.pet_species_snapshot === "dog" ? "犬" : "猫",
        row.primary_service_name_snapshot,
        row.addon_snapshots.length > 0
          ? row.addon_snapshots.map((addon) => addon.name).join("、")
          : "无增项",
        row.staff_display_name_snapshot,
        shanghaiDateTime(row.starts_at),
        shanghaiDateTime(row.ends_at),
        row.service_duration_minutes,
        row.turnover_minutes,
        (row.total_price_cents / 100).toFixed(2),
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((value) => csvCell(value)).join(","))
        .join("\r\n");
      const localDate = getShanghaiLocalDate(occurredAt).replaceAll("-", "");

      return {
        filename: `rongguang-bookings-${localDate}.csv`,
        contentType: "text/csv; charset=utf-8",
        body: `\uFEFF${csv}\r\n`,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exportCustomersPetsJson(
    identity: BackofficeIdentity,
    body: unknown,
  ): Promise<ManagerExportFile> {
    const filters = listFilters({ query: bodyString(body, "query"), page: "1" });
    const client = await this.database.pool.connect();
    const occurredAt = getDemoNow();

    try {
      await client.query("BEGIN");
      const result = await client.query<CustomerPetJsonExportRow>(
        `
          SELECT customer.display_name,
                 customer.phone,
                 customer.created_at,
                 COALESCE(
                   (
                     SELECT jsonb_agg(
                       jsonb_build_object(
                         'version', consent.notice_version,
                         'source', consent.source,
                         'consentedAt', consent.consented_at
                       )
                       ORDER BY consent.consented_at, consent.notice_version
                     )
                     FROM privacy_consents AS consent
                     WHERE consent.customer_id = customer.id
                   ),
                   '[]'::jsonb
                 ) AS privacy_consents,
                 COALESCE(
                   (
                     SELECT jsonb_agg(
                       jsonb_build_object(
                         'name', pet.name,
                         'species', pet.species,
                         'weightKg', pet.weight_kg,
                         'petSize', CASE
                           WHEN pet.weight_kg <= 10 THEN 'small'
                           WHEN pet.weight_kg <= 25 THEN 'medium'
                           ELSE 'large'
                         END,
                         'breed', pet.breed,
                         'sex', pet.sex,
                         'birthDate', pet.birth_date,
                         'coatType', pet.coat_type,
                         'photoPath', COALESCE(photo.public_path, pet.seed_photo_path),
                         'careTags', COALESCE(
                           (
                             SELECT jsonb_agg(tag.tag ORDER BY tag.tag)
                             FROM pet_care_tags AS tag
                             WHERE tag.pet_id = pet.id
                           ),
                           '[]'::jsonb
                         ),
                         'careNotes', pet.care_notes,
                         'archivedAt', pet.archived_at
                       )
                       ORDER BY pet.archived_at NULLS FIRST, pet.created_at, pet.id
                     )
                     FROM pets AS pet
                     LEFT JOIN pet_photos AS photo ON photo.id = pet.photo_id
                     WHERE pet.customer_id = customer.id
                   ),
                   '[]'::jsonb
                 ) AS pets
          FROM customers AS customer
          WHERE $1::text = ''
             OR customer.display_name ILIKE '%' || $1 || '%'
             OR concat(left(customer.phone, 3), '****', right(customer.phone, 4)) ILIKE '%' || $1 || '%'
             OR EXISTS (
               SELECT 1
               FROM pets AS searched_pet
               WHERE searched_pet.customer_id = customer.id
                 AND searched_pet.name ILIKE '%' || $1 || '%'
             )
          ORDER BY customer.display_name, customer.id
        `,
        [filters.query],
      );
      await this.audits.append(
        {
          eventType: "data_exported",
          actor: { type: "manager", id: identity.id },
          subject: { type: "store", id: "rongguang-store" },
          payload: {
            exportType: "customers_pets_json",
            filters: { query: filters.query },
            recordCount: result.rowCount ?? 0,
          },
          occurredAt,
        },
        client,
      );
      await client.query("COMMIT");

      const exportBody = {
        exportType: "customers_pets_json",
        exportedAt: occurredAt,
        authorizationScope: "single_store_manager",
        appliedFilters: { query: filters.query },
        customers: result.rows.map((customer) => ({
          displayName: customer.display_name,
          phoneMasked: phoneMasked(customer.phone),
          createdAt: customer.created_at.toISOString(),
          privacyConsents: customer.privacy_consents,
          pets: customer.pets,
        })),
      };
      const localDate = getShanghaiLocalDate(occurredAt).replaceAll("-", "");

      return {
        filename: `rongguang-customers-pets-${localDate}.json`,
        contentType: "application/json; charset=utf-8",
        body: `${JSON.stringify(exportBody, null, 2)}\n`,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
