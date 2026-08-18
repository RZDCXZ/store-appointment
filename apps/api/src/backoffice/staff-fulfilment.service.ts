import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  StaffBookingAction,
  StaffBookingDetailResponse,
  StaffBookingListResponse,
  StaffBookingStatus,
  StaffBookingSummary,
  StaffPhoneRevealResponse,
  StaffTodayResponse,
} from "@rongguang/contracts";

import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getDemoNow, getPetUploadDirectory } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { getShanghaiLocalDate } from "../schedule/schedule-date.js";

interface BookingRow {
  id: string;
  customer_display_name: string;
  customer_phone: string;
  pet_id: string;
  pet_name: string;
  pet_species: "dog" | "cat";
  pet_weight_kg: string;
  pet_breed: string | null;
  pet_sex: "male" | "female" | null;
  pet_birth_date: string | null;
  pet_coat_type: "short" | "long" | "double" | "curly" | "hairless" | "other" | null;
  pet_photo_id: string | null;
  pet_seed_photo_path: string | null;
  pet_care_notes: string | null;
  care_tags: string[];
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  addon_snapshots: Array<{ id: string; name: string }>;
  service_duration_minutes: number;
  staff_id: string;
  staff_display_name_snapshot: string;
  status: StaffBookingStatus;
  starts_at: Date;
  ends_at: Date;
}

interface ShiftRow {
  shift_id: string;
  starts_at: string;
  ends_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
}

interface BookingEventRow {
  id: string;
  event_type: string;
  actor_type: "customer" | "staff" | "manager" | "system";
  occurred_at: Date;
}

interface ServiceHistoryRow {
  booking_id: string;
  service_name: string;
  addon_snapshots: Array<{ id: string; name: string }>;
  staff_name: string;
  completed_at: Date;
}

interface StaffPetPhotoRow {
  staff_id: string;
  mime_type: "image/jpeg" | "image/png" | null;
  storage_key: string | null;
}

const bookingSelect = `
  booking.id,
  customer.display_name AS customer_display_name,
  customer.phone AS customer_phone,
  booking.pet_id,
  pet.name AS pet_name,
  pet.species AS pet_species,
  pet.weight_kg AS pet_weight_kg,
  pet.breed AS pet_breed,
  pet.sex AS pet_sex,
  pet.birth_date::text AS pet_birth_date,
  pet.coat_type AS pet_coat_type,
  pet.photo_id AS pet_photo_id,
  pet.seed_photo_path AS pet_seed_photo_path,
  pet.care_notes AS pet_care_notes,
  COALESCE(
    (SELECT jsonb_agg(tag.tag ORDER BY tag.tag) FROM pet_care_tags AS tag WHERE tag.pet_id = pet.id),
    '[]'::jsonb
  ) AS care_tags,
  booking.primary_service_id_snapshot,
  booking.primary_service_name_snapshot,
  booking.addon_snapshots,
  booking.service_duration_minutes,
  booking.staff_id,
  booking.staff_display_name_snapshot,
  booking.status,
  booking.starts_at,
  booking.ends_at
`;

function forbidden(): never {
  throw new HttpException(
    { code: "FORBIDDEN", message: "当前员工没有访问这笔预约的权限。" },
    HttpStatus.FORBIDDEN,
  );
}

function requireStaff(identity: BackofficeIdentity): void {
  if (identity.role !== "staff") forbidden();
}

function phoneMasked(phone: string): string {
  if (phone.length < 7) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function petSize(weightKg: number): "small" | "medium" | "large" {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function actionFor(row: BookingRow, now: number): StaffBookingAction {
  const startsAt = row.starts_at.getTime();

  if (row.status === "confirmed" && now > startsAt + 15 * 60_000) return "late";
  if (
    row.status === "confirmed" &&
    now >= startsAt - 30 * 60_000 &&
    now <= startsAt + 15 * 60_000
  ) {
    return "check_in";
  }
  if (row.status === "checked_in") return "complete";
  if (row.status === "confirmed") return "upcoming";
  return "ended";
}

function summary(row: BookingRow, now: number): StaffBookingSummary {
  return {
    id: row.id,
    status: row.status,
    action: actionFor(row, now),
    customer: {
      displayName: row.customer_display_name,
      phoneMasked: phoneMasked(row.customer_phone),
    },
    pet: {
      id: row.pet_id,
      name: row.pet_name,
      species: row.pet_species,
      photoPath: row.pet_photo_id
        ? `/backoffice/staff/bookings/${encodeURIComponent(row.id)}/pet-photo`
        : row.pet_seed_photo_path,
      careTags: row.care_tags,
    },
    service: {
      id: row.primary_service_id_snapshot,
      name: row.primary_service_name_snapshot,
      addonNames: row.addon_snapshots.map((addon) => addon.name),
      durationMinutes: row.service_duration_minutes,
    },
    staff: {
      id: row.staff_id,
      displayName: row.staff_display_name_snapshot,
    },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
  };
}

const actionPriority: Record<"late" | "check_in" | "complete", number> = {
  late: 0,
  check_in: 1,
  complete: 2,
};

@Injectable()
export class StaffFulfilmentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  async today(identity: BackofficeIdentity): Promise<StaffTodayResponse> {
    requireStaff(identity);
    const demoNow = getDemoNow();
    const now = Date.parse(demoNow);
    const localDate = getShanghaiLocalDate(demoNow);
    const [bookingResult, shiftResult] = await Promise.all([
      this.database.pool.query<BookingRow>(
        `
          SELECT ${bookingSelect}
          FROM bookings AS booking
          JOIN customers AS customer ON customer.id = booking.customer_id
          JOIN pets AS pet ON pet.id = booking.pet_id
          WHERE booking.staff_id = $1
            AND (booking.starts_at AT TIME ZONE 'Asia/Shanghai')::date = $2::date
          ORDER BY booking.starts_at, booking.id
        `,
        [identity.id, localDate],
      ),
      this.database.pool.query<ShiftRow>(
        `
          SELECT shift.id AS shift_id,
                 to_char(shift.starts_at, 'HH24:MI') AS starts_at,
                 to_char(shift.ends_at, 'HH24:MI') AS ends_at,
                 to_char(shift_break.starts_at, 'HH24:MI') AS break_starts_at,
                 to_char(shift_break.ends_at, 'HH24:MI') AS break_ends_at
          FROM staff_schedule_days AS day
          JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
          LEFT JOIN staff_schedule_breaks AS shift_break ON shift_break.schedule_shift_id = shift.id
          WHERE day.staff_id = $1
            AND day.local_date = $2::date
            AND day.publication_status = 'published'
            AND day.published_at IS NOT NULL
          ORDER BY shift.starts_at, shift_break.starts_at
        `,
        [identity.id, localDate],
      ),
    ]);
    const bookings = bookingResult.rows.map((row) => summary(row, now));
    const shiftMap = new Map<string, StaffTodayResponse["shifts"][number]>();

    for (const row of shiftResult.rows) {
      const shift = shiftMap.get(row.shift_id) ?? {
        startsAt: row.starts_at.slice(0, 5),
        endsAt: row.ends_at.slice(0, 5),
        breaks: [],
      };
      if (row.break_starts_at && row.break_ends_at) {
        shift.breaks.push({
          startsAt: row.break_starts_at.slice(0, 5),
          endsAt: row.break_ends_at.slice(0, 5),
        });
      }
      shiftMap.set(row.shift_id, shift);
    }

    const actionQueue = bookings
      .filter(
        (
          booking,
        ): booking is StaffBookingSummary & {
          action: "late" | "check_in" | "complete";
        } =>
          booking.action === "late" ||
          booking.action === "check_in" ||
          booking.action === "complete",
      )
      .sort(
        (left, right) =>
          actionPriority[left.action] - actionPriority[right.action] ||
          Date.parse(left.startsAt) - Date.parse(right.startsAt),
      );
    const nextBooking =
      bookings.find(
        (booking) => booking.status === "confirmed" && Date.parse(booking.startsAt) >= now,
      ) ??
      bookings.find((booking) => booking.status === "checked_in") ??
      null;

    return {
      timeZone: "Asia/Shanghai",
      demoNow,
      localDate,
      identity: { id: identity.id, displayName: identity.displayName },
      shifts: [...shiftMap.values()],
      nextBooking,
      actionQueue,
      bookings,
    };
  }

  async bookings(identity: BackofficeIdentity): Promise<StaffBookingListResponse> {
    requireStaff(identity);
    const demoNow = getDemoNow();
    const result = await this.database.pool.query<BookingRow>(
      `
        SELECT ${bookingSelect}
        FROM bookings AS booking
        JOIN customers AS customer ON customer.id = booking.customer_id
        JOIN pets AS pet ON pet.id = booking.pet_id
        WHERE booking.staff_id = $1
        ORDER BY booking.starts_at DESC, booking.id
      `,
      [identity.id],
    );

    return { demoNow, bookings: result.rows.map((row) => summary(row, Date.parse(demoNow))) };
  }

  async bookingDetail(
    identity: BackofficeIdentity,
    bookingId: string,
  ): Promise<StaffBookingDetailResponse> {
    requireStaff(identity);
    const result = await this.database.pool.query<BookingRow>(
      `
        SELECT ${bookingSelect}
        FROM bookings AS booking
        JOIN customers AS customer ON customer.id = booking.customer_id
        JOIN pets AS pet ON pet.id = booking.pet_id
        WHERE booking.id = $1
      `,
      [bookingId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new HttpException(
        { code: "BOOKING_NOT_FOUND", message: "找不到这笔预约。" },
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.staff_id !== identity.id) forbidden();

    const [eventResult, historyResult] = await Promise.all([
      this.database.pool.query<BookingEventRow>(
        `
          SELECT id, event_type, actor_type, occurred_at
          FROM booking_events
          WHERE booking_id = $1
          ORDER BY occurred_at, id
        `,
        [bookingId],
      ),
      this.database.pool.query<ServiceHistoryRow>(
        `
          SELECT id AS booking_id,
                 primary_service_name_snapshot AS service_name,
                 addon_snapshots,
                 staff_display_name_snapshot AS staff_name,
                 completed_at
          FROM bookings
          WHERE pet_id = $1
            AND status = 'completed'
            AND completed_at IS NOT NULL
          ORDER BY completed_at DESC, id
          LIMIT 10
        `,
        [row.pet_id],
      ),
    ]);
    const booking = summary(row, Date.parse(getDemoNow()));

    return {
      booking: {
        ...booking,
        pet: {
          ...booking.pet,
          weightKg: Number(row.pet_weight_kg),
          petSize: petSize(Number(row.pet_weight_kg)),
          breed: row.pet_breed,
          sex: row.pet_sex,
          birthDate: row.pet_birth_date,
          coatType: row.pet_coat_type,
          careNotes: row.pet_care_notes,
        },
      },
      statusHistory: eventResult.rows.map((event) => ({
        id: event.id,
        type: event.event_type,
        actorType: event.actor_type,
        occurredAt: event.occurred_at.toISOString(),
      })),
      petServiceHistory: historyResult.rows.map((history) => ({
        bookingId: history.booking_id,
        serviceName: history.service_name,
        addonNames: history.addon_snapshots.map((addon) => addon.name),
        staffName: history.staff_name,
        completedAt: history.completed_at.toISOString(),
      })),
    };
  }

  async revealCustomerPhone(
    identity: BackofficeIdentity,
    bookingId: string,
    confirmed: boolean,
  ): Promise<StaffPhoneRevealResponse> {
    requireStaff(identity);
    if (!confirmed) {
      throw new HttpException(
        { code: "PHONE_REVEAL_CONFIRMATION_REQUIRED", message: "请先明确确认此次敏感资料访问。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const connection = await this.database.pool.connect();

    try {
      await connection.query("BEGIN");
      const result = await connection.query<{
        id: string;
        staff_id: string;
        customer_id: string;
        customer_phone: string;
        status: StaffBookingStatus;
      }>(
        `
          SELECT booking.id,
                 booking.staff_id,
                 booking.customer_id,
                 customer.phone AS customer_phone,
                 booking.status
          FROM bookings AS booking
          JOIN customers AS customer ON customer.id = booking.customer_id
          WHERE booking.id = $1
          FOR SHARE OF booking, customer
        `,
        [bookingId],
      );
      const row = result.rows[0];

      if (!row) {
        throw new HttpException(
          { code: "BOOKING_NOT_FOUND", message: "找不到这笔预约。" },
          HttpStatus.NOT_FOUND,
        );
      }
      if (row.staff_id !== identity.id) forbidden();
      if (row.status !== "confirmed" && row.status !== "checked_in") {
        throw new HttpException(
          { code: "PHONE_REVEAL_NOT_AVAILABLE", message: "只有当前待履约预约可以揭示完整手机号。" },
          HttpStatus.CONFLICT,
        );
      }

      const revealedAt = getDemoNow();
      await this.audits.append(
        {
          eventType: "customer_phone_revealed",
          actor: { type: "staff", id: identity.id },
          subject: { type: "booking", id: row.id },
          payload: { customerId: row.customer_id },
          occurredAt: revealedAt,
        },
        connection,
      );
      await connection.query("COMMIT");

      return {
        bookingId: row.id,
        phone: row.customer_phone,
        revealedAt,
      };
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  async bookingPetPhoto(
    identity: BackofficeIdentity,
    bookingId: string,
  ): Promise<{ bytes: Buffer; mimeType: "image/jpeg" | "image/png" }> {
    requireStaff(identity);
    const result = await this.database.pool.query<StaffPetPhotoRow>(
      `
        SELECT booking.staff_id, photo.mime_type, photo.storage_key
        FROM bookings AS booking
        JOIN pets AS pet ON pet.id = booking.pet_id
        LEFT JOIN pet_photos AS photo ON photo.id = pet.photo_id
        WHERE booking.id = $1
      `,
      [bookingId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new HttpException(
        { code: "BOOKING_NOT_FOUND", message: "找不到这笔预约。" },
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.staff_id !== identity.id) forbidden();
    if (!row.mime_type || !row.storage_key) {
      throw new HttpException(
        { code: "PET_PHOTO_NOT_FOUND", message: "这笔预约没有顾客上传的宠物照片。" },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      bytes: await readFile(join(getPetUploadDirectory(), row.storage_key)),
      mimeType: row.mime_type,
    };
  }
}
