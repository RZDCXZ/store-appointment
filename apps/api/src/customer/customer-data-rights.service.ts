import { unlink } from "node:fs/promises";
import { join } from "node:path";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  CustomerBooking,
  CustomerDataExport,
  CustomerDataExportPet,
  CustomerDataRightsStatusResponse,
  CustomerDataDeletionResponse,
  CustomerMessage,
  PetSize,
  PrivacyConsent,
} from "@rongguang/contracts";

import { AuditService } from "../audit/audit.service.js";
import { getDemoNow, getPetUploadDirectory } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { getShanghaiLocalDate } from "../schedule/schedule-date.js";

interface CustomerRow {
  display_name: string;
  phone: string;
  created_at: Date;
}

interface PetRow {
  id: string;
  name: string;
  species: CustomerDataExportPet["species"];
  weight_kg: string;
  breed: string | null;
  sex: CustomerDataExportPet["sex"];
  birth_date: string | null;
  coat_type: CustomerDataExportPet["coatType"];
  photo_path: string | null;
  care_tags: string[];
  care_notes: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface BookingRow {
  id: string;
  status: CustomerBooking["status"];
  pet_id: string;
  pet_name_snapshot: string;
  pet_species_snapshot: CustomerBooking["pet"]["species"];
  pet_weight_kg_snapshot: string;
  pet_size_snapshot: PetSize;
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  primary_service_price_cents: number;
  primary_service_duration_minutes: number;
  addon_snapshots: CustomerBooking["addons"];
  staff_id: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
  ends_at: Date;
  occupancy_ends_at: Date | null;
  total_price_cents: number;
  service_duration_minutes: number;
  turnover_minutes: number;
  original_starts_at: Date;
  original_ends_at: Date;
  original_occupancy_starts_at: Date;
  original_occupancy_ends_at: Date;
  completed_at: Date | null;
  created_at: Date;
}

interface MessageRow {
  id: string;
  notification_type: CustomerMessage["kind"];
  booking_id: string;
  created_at: Date;
  payload: {
    petName?: string;
    serviceName?: string;
    staffName?: string;
    startsAt?: string;
  };
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
}

interface StatusRow {
  display_name: string;
  phone: string;
  pet_count: string;
  privacy_consent_count: string;
  booking_count: string;
  message_count: string;
}

interface FutureBookingRow {
  id: string;
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  starts_at: Date;
  ends_at: Date;
}

export interface CustomerExportFile {
  filename: string;
  body: string;
  value: CustomerDataExport;
}

function petSize(weightKg: number): PetSize {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function bookingValue(row: BookingRow): CustomerBooking {
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
    turnoverEndsAt: (
      row.occupancy_ends_at ?? new Date(row.ends_at.getTime() + row.turnover_minutes * 60_000)
    ).toISOString(),
    totalPriceCents: row.total_price_cents,
    serviceDurationMinutes: row.service_duration_minutes,
    turnoverMinutes: row.turnover_minutes,
    originalSchedule: {
      startsAt: row.original_starts_at.toISOString(),
      endsAt: row.original_ends_at.toISOString(),
      occupancyStartsAt: row.original_occupancy_starts_at.toISOString(),
      occupancyEndsAt: row.original_occupancy_ends_at.toISOString(),
    },
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function messageValue(row: MessageRow): CustomerMessage {
  const petName = row.payload.petName ?? row.pet_name_snapshot;
  const serviceName = row.payload.serviceName ?? row.primary_service_name_snapshot;
  const staffName = row.payload.staffName ?? row.staff_display_name_snapshot;
  const startsAt = row.payload.startsAt ?? row.starts_at.toISOString();
  const values: Record<
    CustomerMessage["kind"],
    Pick<CustomerMessage, "title" | "body" | "actionLabel">
  > = {
    booking_confirmed: {
      title: "预约已确认",
      body: `${petName}的${serviceName}已确认，员工为${staffName}，开始时间为${startsAt}。`,
      actionLabel: "查看核销码",
    },
    booking_rescheduled: {
      title: "预约已改期",
      body: `${petName}的${serviceName}已更新，员工为${staffName}，开始时间为${startsAt}。`,
      actionLabel: "查看核销码",
    },
    booking_cancelled: {
      title: "预约已取消",
      body: `${petName}的${serviceName}预约已取消。`,
      actionLabel: "查看预约",
    },
    booking_content_corrected: {
      title: "预约内容已更新",
      body: `${petName}的预约内容已由门店更新，请查看当前服务、时长与价格。`,
      actionLabel: "查看核销码",
    },
    booking_reminder: {
      title: "预约即将开始",
      body: `${petName}的${serviceName}将在${startsAt}开始，员工为${staffName}。`,
      actionLabel: "查看核销码",
    },
  };
  return {
    id: row.id,
    kind: row.notification_type,
    ...values[row.notification_type],
    occurredAt: row.created_at.toISOString(),
    bookingId: row.booking_id,
  };
}

@Injectable()
export class CustomerDataRightsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  async status(customerId: string): Promise<CustomerDataRightsStatusResponse> {
    const [summaryResult, futureResult] = await Promise.all([
      this.database.pool.query<StatusRow>(
        `SELECT customer.display_name,
                customer.phone,
                (SELECT count(*)::text FROM pets WHERE customer_id = customer.id) AS pet_count,
                (SELECT count(*)::text FROM privacy_consents WHERE customer_id = customer.id)
                  AS privacy_consent_count,
                (SELECT count(*)::text FROM bookings WHERE customer_id = customer.id)
                  AS booking_count,
                (SELECT count(*)::text FROM notification_outbox WHERE customer_id = customer.id)
                  AS message_count
         FROM customers AS customer
         WHERE customer.id = $1 AND customer.anonymized_at IS NULL`,
        [customerId],
      ),
      this.database.pool.query<FutureBookingRow>(
        `SELECT id, pet_name_snapshot, primary_service_name_snapshot, starts_at, ends_at
         FROM bookings
         WHERE customer_id = $1
           AND status IN ('confirmed', 'checked_in')
           AND ends_at > $2::timestamptz
         ORDER BY starts_at, id`,
        [customerId, getDemoNow()],
      ),
    ]);
    const summary = summaryResult.rows[0];
    if (!summary) {
      throw new Error("当前顾客资料不存在或已经匿名化。");
    }
    const futureBookings = futureResult.rows.map((booking) => ({
      id: booking.id,
      petName: booking.pet_name_snapshot,
      primaryServiceName: booking.primary_service_name_snapshot,
      startsAt: booking.starts_at.toISOString(),
      endsAt: booking.ends_at.toISOString(),
    }));
    return {
      customer: {
        displayName: summary.display_name,
        phoneMasked: `${summary.phone.slice(0, 3)}****${summary.phone.slice(-4)}`,
      },
      dataSummary: {
        petCount: Number(summary.pet_count),
        privacyConsentCount: Number(summary.privacy_consent_count),
        bookingCount: Number(summary.booking_count),
        messageCount: Number(summary.message_count),
      },
      futureBookings,
      canDelete: futureBookings.length === 0,
      retentionPolicy: {
        anonymized: ["顾客姓名与手机号", "宠物档案、照片与护理资料", "顾客会话与身份关联"],
        retained: ["不含身份的预约历史", "经营统计与删除审计事实"],
        disclaimer: "这是本地作品集的演示保留规则，不构成任何司法辖区的法律意见。",
      },
    };
  }

  async delete(customerId: string, body: unknown): Promise<CustomerDataDeletionResponse> {
    if (
      !body ||
      typeof body !== "object" ||
      (body as Record<string, unknown>).confirmAnonymization !== true
    ) {
      throw new HttpException(
        {
          code: "ANONYMIZATION_CONFIRMATION_REQUIRED",
          message: "请完成两步确认后再删除顾客资料。",
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = await this.database.pool.connect();
    const anonymizedAt = getDemoNow();
    try {
      await client.query("BEGIN");
      const customer = await client.query<{ anonymized_at: Date | null }>(
        "SELECT anonymized_at FROM customers WHERE id = $1 FOR UPDATE",
        [customerId],
      );
      if (!customer.rows[0] || customer.rows[0].anonymized_at) {
        throw new HttpException(
          { code: "CUSTOMER_ALREADY_ANONYMIZED", message: "这份顾客资料已经匿名化。" },
          HttpStatus.CONFLICT,
        );
      }
      const futureResult = await client.query<FutureBookingRow>(
        `SELECT id, pet_name_snapshot, primary_service_name_snapshot, starts_at, ends_at
         FROM bookings
         WHERE customer_id = $1
           AND status IN ('confirmed', 'checked_in')
           AND ends_at > $2::timestamptz
         ORDER BY starts_at, id
         FOR UPDATE`,
        [customerId, anonymizedAt],
      );
      if (futureResult.rows.length > 0) {
        throw new HttpException(
          {
            code: "FUTURE_BOOKINGS_REQUIRE_ACTION",
            message: "请先处理仍未结束的预约，再删除顾客资料。",
            futureBookings: futureResult.rows.map((booking) => ({
              id: booking.id,
              petName: booking.pet_name_snapshot,
              primaryServiceName: booking.primary_service_name_snapshot,
              startsAt: booking.starts_at.toISOString(),
              endsAt: booking.ends_at.toISOString(),
            })),
          },
          HttpStatus.CONFLICT,
        );
      }

      const statistics = await client.query<{
        booking_count: string;
        completed_booking_count: string;
        total_price_cents: string;
      }>(
        `SELECT count(*)::text AS booking_count,
                count(*) FILTER (WHERE status = 'completed')::text AS completed_booking_count,
                COALESCE(sum(total_price_cents), 0)::text AS total_price_cents
         FROM bookings
         WHERE customer_id = $1`,
        [customerId],
      );
      const retained = statistics.rows[0];
      if (!retained) throw new Error("匿名化前无法读取预约经营事实。");

      const photoResult = await client.query<{ storage_key: string }>(
        "SELECT storage_key FROM pet_photos WHERE customer_id = $1 FOR UPDATE",
        [customerId],
      );
      const deletedPhotoStorageKeys = photoResult.rows.map((photo) => photo.storage_key);

      await client.query("SELECT anonymize_store_service_records_for_customer($1)", [customerId]);
      await client.query(
        `UPDATE booking_events AS event
         SET actor_id = CASE
               WHEN event.actor_type = 'customer' THEN 'anonymized-customer'
               ELSE event.actor_id
             END,
             payload = '{"anonymized":true}'::jsonb
         FROM bookings AS booking
         WHERE event.booking_id = booking.id AND booking.customer_id = $1`,
        [customerId],
      );
      await client.query(
        `UPDATE notification_outbox AS notification
         SET payload = jsonb_build_object(
           'bookingId', booking.id,
           'petName', '已匿名宠物',
           'serviceName', booking.primary_service_name_snapshot,
           'staffName', booking.staff_display_name_snapshot,
           'startsAt', booking.starts_at
         )
         FROM bookings AS booking
         WHERE notification.booking_id = booking.id AND booking.customer_id = $1`,
        [customerId],
      );
      await client.query(
        `UPDATE capacity_change_booking_resolutions AS resolution
         SET reason = '[原原因已匿名化]',
             original_snapshot = '{"anonymized":true}'::jsonb,
             result_summary = CASE
               WHEN result_summary IS NULL THEN NULL
               ELSE '{"anonymized":true}'::jsonb
             END,
             response_body = CASE
               WHEN response_body IS NULL THEN NULL
               ELSE '{"anonymized":true}'::jsonb
             END
         FROM bookings AS booking
         WHERE resolution.booking_id = booking.id AND booking.customer_id = $1`,
        [customerId],
      );
      await client.query("DELETE FROM booking_idempotency_keys WHERE customer_id = $1", [
        customerId,
      ]);
      await client.query(
        `DELETE FROM manager_booking_change_idempotency_keys AS idempotency
         USING bookings AS booking
         WHERE idempotency.booking_id = booking.id AND booking.customer_id = $1`,
        [customerId],
      );
      await client.query(
        `DELETE FROM manager_proxy_booking_idempotency_keys AS idempotency
         USING bookings AS booking
         WHERE idempotency.booking_id = booking.id AND booking.customer_id = $1`,
        [customerId],
      );
      await client.query(
        `DELETE FROM pet_care_tags AS tag
         USING pets AS pet
         WHERE tag.pet_id = pet.id AND pet.customer_id = $1`,
        [customerId],
      );
      await client.query(
        `UPDATE pets
         SET name = '已匿名宠物',
             breed = NULL,
             sex = NULL,
             birth_date = NULL,
             coat_type = NULL,
             seed_photo_path = NULL,
             photo_id = NULL,
             care_notes = NULL,
             archived_at = $2::timestamptz,
             updated_at = $2::timestamptz
         WHERE customer_id = $1`,
        [customerId, anonymizedAt],
      );
      await client.query(
        "UPDATE bookings SET pet_name_snapshot = '已匿名宠物' WHERE customer_id = $1",
        [customerId],
      );
      await Promise.all(
        deletedPhotoStorageKeys.map((storageKey) =>
          unlink(join(getPetUploadDirectory(), storageKey)).catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            },
          ),
        ),
      );
      await client.query("DELETE FROM pet_photos WHERE customer_id = $1", [customerId]);
      await client.query("DELETE FROM privacy_consents WHERE customer_id = $1", [customerId]);
      await client.query("DELETE FROM customer_sessions WHERE customer_id = $1", [customerId]);
      await client.query("DELETE FROM demo_customer_profiles WHERE customer_id = $1", [customerId]);
      await client.query(
        `UPDATE customers
         SET display_name = '已匿名顾客', phone = '13000000000', anonymized_at = $2::timestamptz
         WHERE id = $1`,
        [customerId, anonymizedAt],
      );

      const retainedFacts = {
        bookingCount: Number(retained.booking_count),
        completedBookingCount: Number(retained.completed_booking_count),
        totalPriceCents: Number(retained.total_price_cents),
      };
      await this.audits.append(
        {
          eventType: "customer_data_anonymized",
          actor: { type: "customer", id: customerId },
          subject: { type: "customer", id: customerId },
          payload: { ...retainedFacts, retentionPolicy: "portfolio_demo" },
          occurredAt: anonymizedAt,
        },
        client,
      );
      await client.query("COMMIT");

      return { anonymizedAt, retained: retainedFacts, sessionsRevoked: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async export(customerId: string): Promise<CustomerExportFile> {
    const client = await this.database.pool.connect();
    const exportedAt = getDemoNow();

    try {
      await client.query("BEGIN");
      const customerResult = await client.query<CustomerRow>(
        `SELECT display_name, phone, created_at
             FROM customers
             WHERE id = $1 AND anonymized_at IS NULL
             FOR SHARE`,
        [customerId],
      );
      const petResult = await client.query<PetRow>(
        `SELECT pet.id, pet.name, pet.species, pet.weight_kg::text, pet.breed,
                    pet.sex, pet.birth_date::text, pet.coat_type,
                    COALESCE(photo.public_path, pet.seed_photo_path) AS photo_path,
                    COALESCE(
                      (SELECT jsonb_agg(tag.tag ORDER BY tag.created_at, tag.tag)
                       FROM pet_care_tags AS tag WHERE tag.pet_id = pet.id),
                      '[]'::jsonb
                    ) AS care_tags,
                    pet.care_notes, pet.archived_at, pet.created_at, pet.updated_at
             FROM pets AS pet
             LEFT JOIN pet_photos AS photo ON photo.id = pet.photo_id
             WHERE pet.customer_id = $1
             ORDER BY pet.created_at, pet.id`,
        [customerId],
      );
      const consentResult = await client.query<{
        notice_version: string;
        source: PrivacyConsent["source"];
        consented_at: Date;
      }>(
        `SELECT notice_version, source, consented_at
             FROM privacy_consents
             WHERE customer_id = $1
             ORDER BY consented_at, notice_version`,
        [customerId],
      );
      const bookingResult = await client.query<BookingRow>(
        `SELECT id, status, pet_id, pet_name_snapshot, pet_species_snapshot,
                    pet_weight_kg_snapshot::text, pet_size_snapshot,
                    primary_service_id_snapshot, primary_service_name_snapshot,
                    primary_service_price_cents, primary_service_duration_minutes,
                    addon_snapshots, staff_id, staff_display_name_snapshot,
                    starts_at, ends_at, occupancy_ends_at, total_price_cents,
                    service_duration_minutes, turnover_minutes,
                    original_starts_at, original_ends_at,
                    original_occupancy_starts_at, original_occupancy_ends_at,
                    completed_at, created_at
             FROM bookings
             WHERE customer_id = $1
             ORDER BY starts_at, id`,
        [customerId],
      );
      const messageResult = await client.query<MessageRow>(
        `SELECT notification.id, notification.notification_type,
                    notification.booking_id, notification.created_at, notification.payload,
                    booking.pet_name_snapshot, booking.primary_service_name_snapshot,
                    booking.staff_display_name_snapshot, booking.starts_at
             FROM notification_outbox AS notification
             JOIN bookings AS booking ON booking.id = notification.booking_id
             WHERE notification.customer_id = $1 AND booking.customer_id = $1
             ORDER BY notification.created_at, notification.sequence`,
        [customerId],
      );
      const customer = customerResult.rows[0];
      if (!customer) {
        throw new Error("当前顾客资料不存在或已经匿名化。");
      }
      const value: CustomerDataExport = {
        exportType: "customer_personal_data_json",
        exportedAt,
        subjectScope: "authenticated_customer",
        customer: {
          displayName: customer.display_name,
          phone: customer.phone,
          createdAt: customer.created_at.toISOString(),
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
            createdAt: pet.created_at.toISOString(),
            updatedAt: pet.updated_at.toISOString(),
          };
        }),
        privacyConsents: consentResult.rows.map((consent) => ({
          version: consent.notice_version,
          source: consent.source,
          consentedAt: consent.consented_at.toISOString(),
        })),
        bookings: bookingResult.rows.map(bookingValue),
        messages: messageResult.rows.map(messageValue),
      };
      await this.audits.append(
        {
          eventType: "data_exported",
          actor: { type: "customer", id: customerId },
          subject: { type: "customer", id: customerId },
          payload: {
            exportType: value.exportType,
            petCount: value.pets.length,
            bookingCount: value.bookings.length,
            messageCount: value.messages.length,
          },
          occurredAt: exportedAt,
        },
        client,
      );
      await client.query("COMMIT");
      const localDate = getShanghaiLocalDate(exportedAt).replaceAll("-", "");
      return {
        filename: `rongguang-my-data-${localDate}.json`,
        body: `${JSON.stringify(value, null, 2)}\n`,
        value,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
