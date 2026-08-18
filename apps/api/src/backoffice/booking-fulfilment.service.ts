import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  BookingCheckInInput,
  BookingFulfilmentResponse,
  BookingLateActionInput,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getBookingCodeSecret, getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";

interface FulfilmentBookingRow {
  id: string;
  staff_id: string;
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

interface FulfilmentIdempotencyRow {
  booking_id: string;
  request_digest: string;
  response_body: BookingFulfilmentResponse;
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
  return input as unknown as BookingCheckInInput;
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

  async checkIn(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingFulfilmentResponse> {
    const input = parseCheckInInput(body);
    const client = await this.database.pool.connect();
    const requestDigest = createHash("sha256")
      .update(JSON.stringify({ bookingId, ...input }))
      .digest("hex");
    const lockKey = `${identity.id}:check_in:${input.idempotencyKey}`;
    let lockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN");
      const idempotency = await client.query<FulfilmentIdempotencyRow>(
        `
          SELECT booking_id, request_digest, response_body
          FROM booking_fulfilment_idempotency_keys
          WHERE actor_id = $1
            AND command_type = 'check_in'
            AND idempotency_key = $2
        `,
        [identity.id, input.idempotencyKey],
      );
      const previous = idempotency.rows[0];
      if (previous) {
        if (previous.request_digest !== requestDigest || previous.booking_id !== bookingId) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条核销命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        await client.query("COMMIT");
        return previous.response_body;
      }

      const row = await this.bookingForUpdate(client, bookingId);
      if (identity.role === "staff" && row.staff_id !== identity.id) {
        businessError("FORBIDDEN", "当前员工不能处理未分配给自己的预约。", HttpStatus.FORBIDDEN);
      }
      if (row.status === "checked_in") {
        const firstResult = await this.firstCheckInResult(client, row.id);
        await this.storeIdempotencyResult(
          client,
          identity.id,
          "check_in",
          input.idempotencyKey,
          bookingId,
          requestDigest,
          firstResult,
        );
        await client.query("COMMIT");
        return firstResult;
      }
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
          {
            opensAt: new Date(opensAt).toISOString(),
          },
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
      await client.query(
        `
          INSERT INTO booking_events (
            id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
          )
          VALUES ($1, $2, 'booking_checked_in', $3, $4, $5::jsonb, $6)
        `,
        [randomUUID(), row.id, identity.role, identity.id, JSON.stringify(response), occurredAt],
      );
      await this.storeIdempotencyResult(
        client,
        identity.id,
        "check_in",
        input.idempotencyKey,
        bookingId,
        requestDigest,
        response,
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
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
            releaseError = new Error("核销幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("核销幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async lateCheckIn(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingFulfilmentResponse> {
    const input = parseLateActionInput(body);
    const client = await this.database.pool.connect();
    const requestDigest = createHash("sha256")
      .update(JSON.stringify({ bookingId, ...input }))
      .digest("hex");
    const lockKey = `${identity.id}:late_check_in:${input.idempotencyKey}`;
    let lockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN");
      const idempotency = await client.query<FulfilmentIdempotencyRow>(
        `
          SELECT booking_id, request_digest, response_body
          FROM booking_fulfilment_idempotency_keys
          WHERE actor_id = $1
            AND command_type = 'late_check_in'
            AND idempotency_key = $2
        `,
        [identity.id, input.idempotencyKey],
      );
      const previous = idempotency.rows[0];
      if (previous) {
        if (previous.request_digest !== requestDigest || previous.booking_id !== bookingId) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条迟到核销命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        await client.query("COMMIT");
        return previous.response_body;
      }

      const row = await this.bookingForUpdate(client, bookingId);
      if (identity.role === "staff" && row.staff_id !== identity.id) {
        businessError("FORBIDDEN", "当前员工不能处理未分配给自己的预约。", HttpStatus.FORBIDDEN);
      }
      if (row.status === "checked_in") {
        const firstResult = await this.firstCheckInResult(client, row.id);
        await this.storeIdempotencyResult(
          client,
          identity.id,
          "late_check_in",
          input.idempotencyKey,
          bookingId,
          requestDigest,
          firstResult,
        );
        await client.query("COMMIT");
        return firstResult;
      }
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
      await client.query(
        `
          INSERT INTO booking_events (
            id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
          )
          VALUES ($1, $2, 'booking_late_checked_in', $3, $4, $5::jsonb, $6)
        `,
        [randomUUID(), row.id, identity.role, identity.id, JSON.stringify(response), occurredAt],
      );
      await this.storeIdempotencyResult(
        client,
        identity.id,
        "late_check_in",
        input.idempotencyKey,
        bookingId,
        requestDigest,
        response,
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
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
            releaseError = new Error("迟到核销幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("迟到核销幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async markNoShow(
    identity: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<BookingFulfilmentResponse> {
    const input = parseLateActionInput(body);
    const client = await this.database.pool.connect();
    const requestDigest = createHash("sha256")
      .update(JSON.stringify({ bookingId, ...input }))
      .digest("hex");
    const lockKey = `${identity.id}:no_show:${input.idempotencyKey}`;
    let lockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN");
      const idempotency = await client.query<FulfilmentIdempotencyRow>(
        `
          SELECT booking_id, request_digest, response_body
          FROM booking_fulfilment_idempotency_keys
          WHERE actor_id = $1
            AND command_type = 'no_show'
            AND idempotency_key = $2
        `,
        [identity.id, input.idempotencyKey],
      );
      const previous = idempotency.rows[0];
      if (previous) {
        if (previous.request_digest !== requestDigest || previous.booking_id !== bookingId) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条爽约命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        await client.query("COMMIT");
        return previous.response_body;
      }

      const row = await this.bookingForUpdate(client, bookingId);
      if (identity.role === "staff" && row.staff_id !== identity.id) {
        businessError("FORBIDDEN", "当前员工不能处理未分配给自己的预约。", HttpStatus.FORBIDDEN);
      }
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
      const updated = {
        ...row,
        occupancy_ends_at: releasedAt,
      };
      await client.query(
        `
          UPDATE bookings
          SET status = 'no_show', occupancy_ends_at = $2
          WHERE id = $1
        `,
        [row.id, releasedAt.toISOString()],
      );
      const response = fulfilmentResponse(updated, identity, occurredAt, input.reason, "no_show");
      await client.query(
        `
          INSERT INTO booking_events (
            id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
          )
          VALUES ($1, $2, 'booking_no_show', $3, $4, $5::jsonb, $6)
        `,
        [randomUUID(), row.id, identity.role, identity.id, JSON.stringify(response), occurredAt],
      );
      await this.storeIdempotencyResult(
        client,
        identity.id,
        "no_show",
        input.idempotencyKey,
        bookingId,
        requestDigest,
        response,
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
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
            releaseError = new Error("爽约幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("爽约幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
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
    commandType: "check_in" | "late_check_in" | "no_show",
    idempotencyKey: string,
    bookingId: string,
    requestDigest: string,
    response: BookingFulfilmentResponse,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO booking_fulfilment_idempotency_keys (
          actor_id, command_type, idempotency_key, booking_id,
          request_digest, response_body, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      `,
      [
        actorId,
        commandType,
        idempotencyKey,
        bookingId,
        requestDigest,
        JSON.stringify(response),
        response.occurredAt,
      ],
    );
  }

  private async bookingForUpdate(
    client: PoolClient,
    bookingId: string,
  ): Promise<FulfilmentBookingRow> {
    const result = await client.query<FulfilmentBookingRow>(
      `
        SELECT id, staff_id, status, starts_at, ends_at,
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
    if (!row) {
      businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    }
    return row;
  }
}
