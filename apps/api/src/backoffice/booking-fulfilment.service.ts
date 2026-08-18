import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  BookingCheckInInput,
  BookingCompletionInput,
  BookingCompletionResponse,
  BookingFulfilmentResponse,
  BookingLateActionInput,
  BookingTerminationInput,
  BookingTerminationResponse,
  StoreServiceCareTag,
  StoreServiceRecord,
  StoreServiceRecordNoteInput,
  StoreServiceRecordNoteResponse,
} from "@rongguang/contracts";
import { storeServiceCareTags } from "@rongguang/contracts";
import type { PoolClient } from "pg";

import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getBookingCodeSecret, getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";

interface FulfilmentBookingRow {
  id: string;
  pet_id: string;
  pet_name_snapshot: string;
  pet_species_snapshot: "dog" | "cat";
  pet_weight_kg_snapshot: string;
  pet_size_snapshot: "small" | "medium" | "large";
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  primary_service_price_cents: number;
  primary_service_duration_minutes: number;
  addon_snapshots: Array<{
    id: string;
    name: string;
    priceCents: number;
    durationMinutes: number;
  }>;
  staff_id: string;
  staff_display_name_snapshot: string;
  status: "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show" | "terminated";
  starts_at: Date;
  ends_at: Date;
  occupancy_starts_at: Date | null;
  occupancy_ends_at: Date | null;
  original_starts_at: Date;
  original_ends_at: Date;
  original_occupancy_starts_at: Date;
  original_occupancy_ends_at: Date;
  verification_code_digest: string;
}

type FulfilmentCommandType =
  "check_in" | "late_check_in" | "no_show" | "complete" | "terminate" | "service_record_note";

interface FulfilmentIdempotencyRow<Response extends object> {
  request_digest: string;
  response_status: number;
  response_body: Response;
}

const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function businessError(code: string, message: string, status: HttpStatus, details = {}): never {
  throw new HttpException({ code, message, ...details }, status);
}

function parseCheckInInput(body: unknown): BookingCheckInInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (typeof input.verificationCode !== "string" || !/^\d{6}$/.test(input.verificationCode)) {
    fieldErrors.verificationCode = "请输入六位数字核销码。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    businessError("VALIDATION_ERROR", "核销信息无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
      fieldErrors,
    });
  }
  return {
    idempotencyKey: input.idempotencyKey as string,
    verificationCode: input.verificationCode as string,
  };
}

function parseLateActionInput(body: unknown): BookingLateActionInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length < 2 ||
    input.reason.trim().length > 120
  ) {
    fieldErrors.reason = "请填写 2–120 字的处理原因。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    businessError("VALIDATION_ERROR", "迟到处理信息无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
      fieldErrors,
    });
  }
  return {
    idempotencyKey: input.idempotencyKey as string,
    reason: (input.reason as string).trim(),
  };
}

function parseCompletionInput(body: unknown): BookingCompletionInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  const allowedTags = new Set<string>(storeServiceCareTags);
  if (
    !Array.isArray(input.careTags) ||
    input.careTags.some((tag) => typeof tag !== "string" || !allowedTags.has(tag)) ||
    new Set(input.careTags).size !== input.careTags.length
  ) {
    fieldErrors.careTags = "护理标签包含无效或重复选项。";
  }
  if (
    input.internalText !== null &&
    input.internalText !== undefined &&
    (typeof input.internalText !== "string" || input.internalText.trim().length > 1000)
  ) {
    fieldErrors.internalText = "内部文字不能超过 1000 字。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    businessError("VALIDATION_ERROR", "完成服务信息无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
      fieldErrors,
    });
  }
  const internalText =
    typeof input.internalText === "string" && input.internalText.trim().length > 0
      ? input.internalText.trim()
      : null;
  return {
    idempotencyKey: input.idempotencyKey as string,
    careTags: input.careTags as StoreServiceCareTag[],
    internalText,
  };
}

function parseTerminationInput(body: unknown): BookingTerminationInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length < 2 ||
    input.reason.trim().length > 200
  ) {
    fieldErrors.reason = "请填写 2–200 字的服务终止原因。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    businessError("VALIDATION_ERROR", "服务终止信息无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
      fieldErrors,
    });
  }
  return {
    idempotencyKey: input.idempotencyKey as string,
    reason: (input.reason as string).trim(),
  };
}

function parseServiceRecordNoteInput(body: unknown): StoreServiceRecordNoteInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (
    typeof input.text !== "string" ||
    input.text.trim().length < 2 ||
    input.text.trim().length > 500
  ) {
    fieldErrors.text = "请填写 2–500 字的追加说明。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    businessError("VALIDATION_ERROR", "追加说明无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
      fieldErrors,
    });
  }
  return {
    idempotencyKey: input.idempotencyKey as string,
    text: (input.text as string).trim(),
  };
}

function verificationCodeDigest(bookingId: string, code: string): string {
  return createHmac("sha256", getBookingCodeSecret())
    .update(`booking-code:${bookingId}:${code}`)
    .digest("hex");
}

function matchesVerificationCode(row: FulfilmentBookingRow, code: string): boolean {
  const expected = Buffer.from(verificationCodeDigest(row.id, code), "hex");
  const actual = Buffer.from(row.verification_code_digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function fulfilmentRequestDigest(
  commandType: FulfilmentCommandType,
  bookingId: string,
  input: { idempotencyKey: string },
): string {
  return createHmac("sha256", getBookingCodeSecret())
    .update("booking-fulfilment-request:v1\0")
    .update(commandType)
    .update("\0")
    .update(JSON.stringify({ bookingId, ...input }))
    .digest("hex");
}

function fulfilmentResponse(
  row: FulfilmentBookingRow,
  identity: BackofficeIdentity,
  occurredAt: string,
  reason: string | null,
  outcome: "checked_in" | "no_show" = "checked_in",
): BookingFulfilmentResponse {
  return {
    bookingId: row.id,
    status: outcome,
    outcome,
    occurredAt,
    actor: {
      type: identity.role,
      id: identity.id,
      displayName: identity.displayName,
    },
    reason,
    actualOccupancy:
      row.occupancy_starts_at && row.occupancy_ends_at
        ? {
            startsAt: row.occupancy_starts_at.toISOString(),
            endsAt: row.occupancy_ends_at.toISOString(),
          }
        : null,
    originalSchedule: {
      startsAt: row.original_starts_at.toISOString(),
      endsAt: row.original_ends_at.toISOString(),
      occupancyStartsAt: row.original_occupancy_starts_at.toISOString(),
      occupancyEndsAt: row.original_occupancy_ends_at.toISOString(),
    },
  };
}

@Injectable()
export class BookingFulfilmentService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async complete(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingCompletionResponse> {
    const input = parseCompletionInput(body);
    return this.executeIdempotentCommand(
      identity,
      bookingId,
      "complete",
      input,
      "这个幂等键已经用于另一条完成服务命令，请重新提交。",
      async (client) => {
        const row = await this.bookingForUpdate(client, bookingId);
        if (identity.role !== "staff" || row.staff_id !== identity.id) {
          businessError("FORBIDDEN", "只有这笔预约的分配员工可以完成服务。", HttpStatus.FORBIDDEN);
        }
        if (row.status !== "checked_in") {
          businessError(
            "BOOKING_COMPLETION_NOT_ALLOWED",
            "只有已到店预约可以完成服务。",
            HttpStatus.CONFLICT,
          );
        }

        const occurredAt = getDemoNow();
        const now = Date.parse(occurredAt);
        if (now < row.starts_at.getTime()) {
          businessError(
            "BOOKING_COMPLETION_TOO_EARLY",
            "尚未到计划开始时间，不能提前完成服务。",
            HttpStatus.CONFLICT,
            { startsAt: row.starts_at.toISOString() },
          );
        }
        if (!row.occupancy_starts_at || !row.occupancy_ends_at) {
          throw new Error("已到店预约缺少实际占用区间。");
        }

        const checkIn = await client.query<{ occurred_at: Date }>(
          `
            SELECT occurred_at
            FROM booking_events
            WHERE booking_id = $1
              AND event_type IN ('booking_checked_in', 'booking_late_checked_in')
            ORDER BY occurred_at, sequence
            LIMIT 1
          `,
          [row.id],
        );
        const actualStartsAt = checkIn.rows[0]?.occurred_at;
        if (!actualStartsAt) throw new Error("已到店预约缺少首次核销事实。");

        const releasedAt = new Date(
          Math.min(now + 15 * 60_000, row.original_occupancy_ends_at.getTime()),
        );
        const serviceRecord: StoreServiceRecord = {
          id: randomUUID(),
          bookingId: row.id,
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
          actualStartsAt: actualStartsAt.toISOString(),
          actualEndsAt: occurredAt,
          careTags: input.careTags,
          internalText: input.internalText,
          createdAt: occurredAt,
          notes: [],
        };

        await client.query(
          `
            UPDATE bookings
            SET status = 'completed', completed_at = $2, occupancy_ends_at = $3
            WHERE id = $1
          `,
          [row.id, occurredAt, releasedAt.toISOString()],
        );
        await client.query(
          `
            INSERT INTO store_service_records (
              id, booking_id, pet_snapshot, primary_service_snapshot, addon_snapshots,
              staff_snapshot, actual_starts_at, actual_ends_at, care_tags,
              internal_text, created_at
            )
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9::jsonb, $10, $11)
          `,
          [
            serviceRecord.id,
            row.id,
            JSON.stringify(serviceRecord.pet),
            JSON.stringify(serviceRecord.primaryService),
            JSON.stringify(serviceRecord.addons),
            JSON.stringify(serviceRecord.staff),
            serviceRecord.actualStartsAt,
            serviceRecord.actualEndsAt,
            JSON.stringify(serviceRecord.careTags),
            serviceRecord.internalText,
            serviceRecord.createdAt,
          ],
        );
        const response: BookingCompletionResponse = {
          bookingId: row.id,
          status: "completed",
          outcome: "completed",
          occurredAt,
          actor: {
            type: identity.role,
            id: identity.id,
            displayName: identity.displayName,
          },
          actualOccupancy: {
            startsAt: row.occupancy_starts_at.toISOString(),
            endsAt: releasedAt.toISOString(),
          },
          originalSchedule: {
            startsAt: row.original_starts_at.toISOString(),
            endsAt: row.original_ends_at.toISOString(),
            occupancyStartsAt: row.original_occupancy_starts_at.toISOString(),
            occupancyEndsAt: row.original_occupancy_ends_at.toISOString(),
          },
          serviceRecord,
        };
        await this.appendBookingEvent(client, row.id, "booking_completed", identity, response);
        return response;
      },
    );
  }

  async terminate(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingTerminationResponse> {
    const input = parseTerminationInput(body);
    return this.executeIdempotentCommand(
      identity,
      bookingId,
      "terminate",
      input,
      "这个幂等键已经用于另一条服务终止命令，请重新提交。",
      async (client) => {
        const row = await this.bookingForUpdate(client, bookingId);
        if (identity.role === "staff" && row.staff_id !== identity.id) {
          businessError("FORBIDDEN", "当前员工不能终止未分配给自己的预约。", HttpStatus.FORBIDDEN);
        }
        if (row.status !== "checked_in") {
          businessError(
            "BOOKING_TERMINATION_NOT_ALLOWED",
            "只有已到店预约可以终止服务。",
            HttpStatus.CONFLICT,
          );
        }
        if (!row.occupancy_starts_at || !row.occupancy_ends_at) {
          throw new Error("已到店预约缺少实际占用区间。");
        }

        const occurredAt = getDemoNow();
        const releasedAt = new Date(
          Math.min(Date.parse(occurredAt) + 15 * 60_000, row.original_occupancy_ends_at.getTime()),
        );
        const hasRemainingOccupancy = releasedAt.getTime() > row.occupancy_starts_at.getTime();
        await client.query(
          `
            UPDATE bookings
            SET status = 'terminated',
                occupancy_starts_at = CASE WHEN $2 THEN occupancy_starts_at ELSE NULL END,
                occupancy_ends_at = CASE WHEN $2 THEN $3::timestamptz ELSE NULL END
            WHERE id = $1
          `,
          [row.id, hasRemainingOccupancy, releasedAt.toISOString()],
        );
        const response: BookingTerminationResponse = {
          bookingId: row.id,
          status: "terminated",
          outcome: "terminated",
          occurredAt,
          actor: {
            type: identity.role,
            id: identity.id,
            displayName: identity.displayName,
          },
          reason: input.reason,
          actualOccupancy: hasRemainingOccupancy
            ? {
                startsAt: row.occupancy_starts_at.toISOString(),
                endsAt: releasedAt.toISOString(),
              }
            : null,
          originalSchedule: {
            startsAt: row.original_starts_at.toISOString(),
            endsAt: row.original_ends_at.toISOString(),
            occupancyStartsAt: row.original_occupancy_starts_at.toISOString(),
            occupancyEndsAt: row.original_occupancy_ends_at.toISOString(),
          },
        };
        await this.appendBookingEvent(client, row.id, "booking_terminated", identity, response);
        return response;
      },
    );
  }

  async appendServiceRecordNote(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<StoreServiceRecordNoteResponse> {
    const input = parseServiceRecordNoteInput(body);
    return this.executeIdempotentCommand(
      identity,
      bookingId,
      "service_record_note",
      input,
      "这个幂等键已经用于另一条追加说明，请重新提交。",
      async (client) => {
        const row = await this.bookingForUpdate(client, bookingId);
        if (identity.role === "staff" && row.staff_id !== identity.id) {
          businessError(
            "FORBIDDEN",
            "当前员工不能为未分配给自己的预约追加说明。",
            HttpStatus.FORBIDDEN,
          );
        }
        const record = await client.query<{ id: string }>(
          `
            SELECT id
            FROM store_service_records
            WHERE booking_id = $1
            FOR SHARE
          `,
          [row.id],
        );
        const serviceRecordId = record.rows[0]?.id;
        if (!serviceRecordId) {
          businessError(
            "SERVICE_RECORD_NOT_FOUND",
            "这笔预约还没有可追加说明的门店服务记录。",
            HttpStatus.CONFLICT,
          );
        }

        const occurredAt = getDemoNow();
        const note = {
          id: randomUUID(),
          kind: identity.role === "manager" ? "manager_correction" : "staff_note",
          text: input.text,
          author: {
            type: identity.role,
            id: identity.id,
            displayName: identity.displayName,
          },
          createdAt: occurredAt,
        } as const;
        await client.query(
          `
            INSERT INTO store_service_record_notes (
              id, service_record_id, kind, note_text,
              author_type, author_id, author_display_name, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            note.id,
            serviceRecordId,
            note.kind,
            note.text,
            note.author.type,
            note.author.id,
            note.author.displayName,
            note.createdAt,
          ],
        );
        return { bookingId: row.id, serviceRecordId, occurredAt, note };
      },
    );
  }

  async checkIn(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingFulfilmentResponse> {
    const input = parseCheckInInput(body);
    return this.executeIdempotentCommand(
      identity,
      bookingId,
      "check_in",
      input,
      "这个幂等键已经用于另一条核销命令，请重新提交。",
      async (client) => {
        const row = await this.bookingForUpdate(client, bookingId);
        if (identity.role !== "staff" || row.staff_id !== identity.id) {
          businessError(
            "FORBIDDEN",
            "只有这笔预约的分配员工可以使用核销码。",
            HttpStatus.FORBIDDEN,
          );
        }
        if (row.status === "checked_in") return this.firstCheckInResult(client, row.id);
        if (row.status !== "confirmed") {
          businessError(
            "BOOKING_CHECK_IN_NOT_ALLOWED",
            "当前预约状态不允许到店核销。",
            HttpStatus.CONFLICT,
          );
        }

        const occurredAt = getDemoNow();
        const now = Date.parse(occurredAt);
        const opensAt = row.starts_at.getTime() - 30 * 60_000;
        const closesAt = row.starts_at.getTime() + 15 * 60_000;
        if (now < opensAt) {
          businessError(
            "CHECK_IN_TOO_EARLY",
            "核销窗口尚未开始，不能提前核销。",
            HttpStatus.CONFLICT,
            { opensAt: new Date(opensAt).toISOString() },
          );
        }
        if (now > closesAt) {
          businessError(
            "CHECK_IN_WINDOW_CLOSED",
            "正常核销窗口已结束，请改为处理迟到。",
            HttpStatus.CONFLICT,
            { closesAt: new Date(closesAt).toISOString() },
          );
        }
        if (!matchesVerificationCode(row, input.verificationCode)) {
          businessError(
            "INVALID_VERIFICATION_CODE",
            "核销码不正确，请与顾客确认六位数字。",
            HttpStatus.BAD_REQUEST,
          );
        }

        await client.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [row.id]);
        const response = fulfilmentResponse(row, identity, occurredAt, null);
        await this.appendFulfilmentEvent(client, row.id, "booking_checked_in", identity, response);
        return response;
      },
    );
  }

  async lateCheckIn(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingFulfilmentResponse> {
    const input = parseLateActionInput(body);
    return this.executeIdempotentCommand(
      identity,
      bookingId,
      "late_check_in",
      input,
      "这个幂等键已经用于另一条迟到核销命令，请重新提交。",
      async (client) => {
        const row = await this.bookingForUpdate(client, bookingId);
        this.requireLateActionAccess(identity, row);
        if (row.status === "checked_in") return this.firstCheckInResult(client, row.id);
        if (row.status !== "confirmed") {
          businessError(
            "BOOKING_CHECK_IN_NOT_ALLOWED",
            "当前预约状态不允许手动迟到核销。",
            HttpStatus.CONFLICT,
          );
        }

        const occurredAt = getDemoNow();
        if (Date.parse(occurredAt) <= row.starts_at.getTime() + 15 * 60_000) {
          businessError(
            "LATE_CHECK_IN_TOO_EARLY",
            "尚未超过迟到宽限，当前只能在正常窗口使用六位码核销。",
            HttpStatus.CONFLICT,
            { lateAfter: new Date(row.starts_at.getTime() + 15 * 60_000).toISOString() },
          );
        }

        await client.query("UPDATE bookings SET status = 'checked_in' WHERE id = $1", [row.id]);
        const response = fulfilmentResponse(row, identity, occurredAt, input.reason);
        await this.appendFulfilmentEvent(
          client,
          row.id,
          "booking_late_checked_in",
          identity,
          response,
        );
        return response;
      },
    );
  }

  async markNoShow(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingFulfilmentResponse> {
    const input = parseLateActionInput(body);
    return this.executeIdempotentCommand(
      identity,
      bookingId,
      "no_show",
      input,
      "这个幂等键已经用于另一条爽约命令，请重新提交。",
      async (client) => {
        const row = await this.bookingForUpdate(client, bookingId);
        this.requireLateActionAccess(identity, row);
        if (row.status !== "confirmed") {
          businessError(
            "BOOKING_NO_SHOW_NOT_ALLOWED",
            "当前预约状态不允许标记爽约。",
            HttpStatus.CONFLICT,
          );
        }

        const occurredAt = getDemoNow();
        const now = Date.parse(occurredAt);
        if (now <= row.starts_at.getTime() + 15 * 60_000) {
          businessError(
            "NO_SHOW_TOO_EARLY",
            "尚未超过迟到宽限，不能提前标记爽约。",
            HttpStatus.CONFLICT,
            { noShowAfter: new Date(row.starts_at.getTime() + 15 * 60_000).toISOString() },
          );
        }
        if (!row.occupancy_starts_at || !row.occupancy_ends_at) {
          throw new Error("已确认预约缺少实际占用区间。");
        }

        const releasedAt = new Date(Math.min(now, row.occupancy_ends_at.getTime()));
        const updated = { ...row, occupancy_ends_at: releasedAt };
        await client.query(
          `
            UPDATE bookings
            SET status = 'no_show', occupancy_ends_at = $2
            WHERE id = $1
          `,
          [row.id, releasedAt.toISOString()],
        );
        const response = fulfilmentResponse(updated, identity, occurredAt, input.reason, "no_show");
        await this.appendFulfilmentEvent(client, row.id, "booking_no_show", identity, response);
        return response;
      },
    );
  }

  private async executeIdempotentCommand<
    Input extends { idempotencyKey: string },
    Response extends { occurredAt: string },
  >(
    identity: BackofficeIdentity,
    bookingId: string,
    commandType: FulfilmentCommandType,
    input: Input,
    reusedKeyMessage: string,
    execute: (client: PoolClient) => Promise<Response>,
  ): Promise<Response> {
    const client = await this.database.pool.connect();
    const requestDigest = fulfilmentRequestDigest(commandType, bookingId, input);
    const lockKey = `${identity.id}:${commandType}:${input.idempotencyKey}`;
    let lockHeld = false;
    let transactionOpen = false;
    let shouldPersistError = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN");
      transactionOpen = true;
      const idempotency = await client.query<FulfilmentIdempotencyRow<Response>>(
        `
          SELECT request_digest, response_status, response_body
          FROM booking_fulfilment_idempotency_keys
          WHERE actor_id = $1
            AND command_type = $2
            AND idempotency_key = $3
        `,
        [identity.id, commandType, input.idempotencyKey],
      );
      const previous = idempotency.rows[0];
      if (previous) {
        if (previous.request_digest !== requestDigest) {
          businessError("IDEMPOTENCY_KEY_REUSED", reusedKeyMessage, HttpStatus.CONFLICT);
        }
        await client.query("COMMIT");
        transactionOpen = false;
        if (previous.response_status < 200 || previous.response_status >= 300) {
          throw new HttpException(previous.response_body, previous.response_status);
        }
        return previous.response_body;
      }

      shouldPersistError = true;
      const response = await execute(client);
      await this.storeIdempotencyResult(
        client,
        identity.id,
        commandType,
        input.idempotencyKey,
        bookingId,
        requestDigest,
        HttpStatus.CREATED,
        response,
        response.occurredAt,
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return response;
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK").catch(() => undefined);
        transactionOpen = false;
      }
      if (shouldPersistError && error instanceof HttpException) {
        const response = error.getResponse();
        if (response && typeof response === "object") {
          try {
            await client.query("BEGIN");
            transactionOpen = true;
            await this.storeIdempotencyResult(
              client,
              identity.id,
              commandType,
              input.idempotencyKey,
              bookingId,
              requestDigest,
              error.getStatus(),
              response as Record<string, unknown>,
              getDemoNow(),
              true,
            );
            await client.query("COMMIT");
            transactionOpen = false;
          } catch (persistError) {
            if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
            throw persistError;
          }
        }
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("履约命令幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("履约命令幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  private requireLateActionAccess(identity: BackofficeIdentity, row: FulfilmentBookingRow): void {
    if (identity.role === "staff" && row.staff_id !== identity.id) {
      businessError("FORBIDDEN", "当前员工不能处理未分配给自己的预约。", HttpStatus.FORBIDDEN);
    }
  }

  private async appendFulfilmentEvent(
    client: PoolClient,
    bookingId: string,
    eventType: "booking_checked_in" | "booking_late_checked_in" | "booking_no_show",
    identity: BackofficeIdentity,
    response: BookingFulfilmentResponse,
  ): Promise<void> {
    await this.appendBookingEvent(client, bookingId, eventType, identity, response);
  }

  private async appendBookingEvent(
    client: PoolClient,
    bookingId: string,
    eventType:
      | "booking_checked_in"
      | "booking_late_checked_in"
      | "booking_no_show"
      | "booking_completed"
      | "booking_terminated",
    identity: BackofficeIdentity,
    response: { occurredAt: string },
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        randomUUID(),
        bookingId,
        eventType,
        identity.role,
        identity.id,
        JSON.stringify(response),
        response.occurredAt,
      ],
    );
  }

  private async firstCheckInResult(
    client: PoolClient,
    bookingId: string,
  ): Promise<BookingFulfilmentResponse> {
    const existing = await client.query<{ payload: BookingFulfilmentResponse }>(
      `
        SELECT payload
        FROM booking_events
        WHERE booking_id = $1
          AND event_type IN ('booking_checked_in', 'booking_late_checked_in')
        ORDER BY occurred_at, sequence
        LIMIT 1
      `,
      [bookingId],
    );
    const firstResult = existing.rows[0]?.payload;
    if (!firstResult) throw new Error("已到店预约缺少首次核销事实。");
    return firstResult;
  }

  private async storeIdempotencyResult(
    client: PoolClient,
    actorId: string,
    commandType: FulfilmentCommandType,
    idempotencyKey: string,
    bookingId: string,
    requestDigest: string,
    responseStatus: number,
    responseBody: object,
    createdAt: string,
    ignoreConflict = false,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO booking_fulfilment_idempotency_keys (
          actor_id, command_type, idempotency_key, booking_id,
          request_digest, response_status, response_body, created_at
        )
        VALUES (
          $1, $2, $3, (SELECT id FROM bookings WHERE id = $4),
          $5, $6, $7::jsonb, $8
        )
        ${ignoreConflict ? "ON CONFLICT (actor_id, command_type, idempotency_key) DO NOTHING" : ""}
      `,
      [
        actorId,
        commandType,
        idempotencyKey,
        bookingId,
        requestDigest,
        responseStatus,
        JSON.stringify(responseBody),
        createdAt,
      ],
    );
  }

  private async bookingForUpdate(
    client: PoolClient,
    bookingId: string,
  ): Promise<FulfilmentBookingRow> {
    const result = await client.query<FulfilmentBookingRow>(
      `
        SELECT id, pet_id, pet_name_snapshot, pet_species_snapshot,
               pet_weight_kg_snapshot, pet_size_snapshot,
               primary_service_id_snapshot, primary_service_name_snapshot,
               primary_service_price_cents, primary_service_duration_minutes,
               addon_snapshots, staff_id, staff_display_name_snapshot,
               status, starts_at, ends_at,
               occupancy_starts_at, occupancy_ends_at,
               original_starts_at, original_ends_at,
               original_occupancy_starts_at, original_occupancy_ends_at,
               verification_code_digest
        FROM bookings
        WHERE id = $1
        FOR UPDATE
      `,
      [bookingId],
    );
    const row = result.rows[0];
    if (!row) businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    return row;
  }
}
