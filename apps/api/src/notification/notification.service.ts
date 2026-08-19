import { randomUUID } from "node:crypto";

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type {
  ManagerNotificationAttempt,
  ManagerNotificationDetailResponse,
  ManagerNotificationFailureInjectionResponse,
  ManagerNotificationListResponse,
  ManagerNotificationManualRetryResponse,
  ManagerNotificationTask,
  ManagerNotificationTaskStatus,
} from "@rongguang/contracts";

import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getNotificationRetryBackoffMilliseconds } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { NOTIFICATION_CLOCK, type NotificationClock } from "./notification.clock.js";

interface NotificationTaskRow {
  id: string;
  notification_type: ManagerNotificationTask["type"];
  status: "pending" | "processing" | "sent" | "retry" | "failed";
  attempt_count: number;
  available_at: Date;
  created_at: Date;
  customer_id: string;
  customer_display_name: string;
  booking_id: string;
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  starts_at: Date;
}

interface NotificationAttemptRow {
  id: string;
  attempt_number: number;
  mode: ManagerNotificationAttempt["mode"];
  result: ManagerNotificationAttempt["result"];
  detail: string;
  attempted_at: Date;
}

const notificationTypeLabels: Record<ManagerNotificationTask["type"], string> = {
  booking_confirmed: "预约确认通知",
  booking_rescheduled: "预约改期通知",
  booking_cancelled: "预约取消通知",
  booking_content_corrected: "预约内容更新通知",
  booking_reminder: "开始前提醒",
};

function displayStatus(status: NotificationTaskRow["status"]): ManagerNotificationTaskStatus {
  if (status === "sent") return "sent";
  if (status === "failed") return "manual_retry_required";
  if (status === "retry") return "failed";
  return "pending";
}

function taskFromRow(row: NotificationTaskRow): ManagerNotificationTask {
  return {
    id: row.id,
    type: row.notification_type,
    typeLabel: notificationTypeLabels[row.notification_type],
    status: displayStatus(row.status),
    channel: "模拟微信通道",
    customer: { id: row.customer_id, displayName: row.customer_display_name },
    booking: {
      id: row.booking_id,
      petName: row.pet_name_snapshot,
      serviceName: row.primary_service_name_snapshot,
      startsAt: row.starts_at.toISOString(),
    },
    attemptCount: row.attempt_count,
    createdAt: row.created_at.toISOString(),
    availableAt: row.available_at.toISOString(),
  };
}

function failureCount(input: unknown): number {
  if (
    typeof input !== "object" ||
    input === null ||
    !("count" in input) ||
    !Number.isInteger((input as { count?: unknown }).count) ||
    Number((input as { count: number }).count) < 0 ||
    Number((input as { count: number }).count) > 10
  ) {
    throw new HttpException(
      { code: "INVALID_FAILURE_COUNT", message: "模拟失败次数必须是 0 到 10 之间的整数。" },
      HttpStatus.BAD_REQUEST,
    );
  }
  return (input as { count: number }).count;
}

const notificationSelect = `
  SELECT notification.id,
         notification.notification_type,
         notification.status,
         notification.attempt_count,
         notification.available_at,
         notification.created_at,
         notification.customer_id,
         customer.display_name AS customer_display_name,
         notification.booking_id,
         booking.pet_name_snapshot,
         booking.primary_service_name_snapshot,
         booking.starts_at
  FROM notification_outbox AS notification
  JOIN customers AS customer ON customer.id = notification.customer_id
  JOIN bookings AS booking ON booking.id = notification.booking_id
`;

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeWorkerCycle: Promise<void> | null = null;
  private stopping = false;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NOTIFICATION_CLOCK) private readonly clock: NotificationClock,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.database.pool.query(
      `UPDATE notification_outbox
       SET status = CASE WHEN attempt_count >= 3 THEN 'failed' ELSE 'retry' END,
           available_at = $1
       WHERE status = 'processing'`,
      [this.clock.now()],
    );
    this.stopping = false;
    this.timer = setInterval(() => void this.runWorkerCycle(), 100);
    void this.runWorkerCycle();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeWorkerCycle;
  }

  async list(): Promise<ManagerNotificationListResponse> {
    const result = await this.database.pool.query<NotificationTaskRow>(
      `${notificationSelect} ORDER BY notification.created_at DESC, notification.sequence DESC`,
    );
    return { channel: "模拟微信通道", tasks: result.rows.map(taskFromRow) };
  }

  async detail(notificationId: string): Promise<ManagerNotificationDetailResponse> {
    const result = await this.database.pool.query<NotificationTaskRow>(
      `${notificationSelect} WHERE notification.id = $1`,
      [notificationId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new HttpException(
        { code: "NOTIFICATION_NOT_FOUND", message: "找不到这项通知任务。" },
        HttpStatus.NOT_FOUND,
      );
    }
    const attemptResult = await this.database.pool.query<NotificationAttemptRow>(
      `SELECT id, attempt_number, mode, result, detail, attempted_at
       FROM notification_delivery_attempts
       WHERE notification_id = $1
       ORDER BY attempt_number`,
      [notificationId],
    );
    const attempts: ManagerNotificationAttempt[] = attemptResult.rows.map((attempt) => ({
      id: attempt.id,
      number: attempt.attempt_number,
      mode: attempt.mode,
      attemptedAt: attempt.attempted_at.toISOString(),
      result: attempt.result,
      detail: attempt.detail,
    }));
    return {
      task: { ...taskFromRow(row), attempts },
      businessFactNotice: "通知失败不会撤销已经成立的预约事实。",
    };
  }

  async injectFailures(
    notificationId: string,
    input: unknown,
  ): Promise<ManagerNotificationFailureInjectionResponse> {
    const count = failureCount(input);
    const result = await this.database.pool.query(
      `UPDATE notification_outbox
       SET simulated_failures_remaining = $2
       WHERE id = $1
       RETURNING id`,
      [notificationId, count],
    );
    if (result.rowCount === 0) this.notFound();
    return { notificationId, simulatedFailuresRemaining: count };
  }

  async manualRetry(
    notificationId: string,
    manager: BackofficeIdentity,
  ): Promise<ManagerNotificationManualRetryResponse> {
    const client = await this.database.pool.connect();
    const acceptedAt = this.clock.now().toISOString();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ attempt_count: number }>(
        `SELECT attempt_count
         FROM notification_outbox
         WHERE id = $1
         FOR UPDATE`,
        [notificationId],
      );
      const task = result.rows[0];
      if (!task) this.notFound();
      const updated = await client.query(
        `UPDATE notification_outbox
         SET status = 'pending', available_at = $2
         WHERE id = $1 AND status = 'failed'
         RETURNING id`,
        [notificationId, acceptedAt],
      );
      if (updated.rowCount === 0) {
        throw new HttpException(
          {
            code: "NOTIFICATION_RETRY_NOT_ALLOWED",
            message: "只有需人工重试的通知才能执行此操作。",
          },
          HttpStatus.CONFLICT,
        );
      }
      await client.query(
        `INSERT INTO audit_events (
           id, event_type, actor_type, actor_id,
           subject_type, subject_id, payload, occurred_at
         )
         VALUES (
           $1, 'notification_manual_retry_requested', 'manager', $2,
           'notification', $3, $4::jsonb, $5
         )`,
        [
          randomUUID(),
          manager.id,
          notificationId,
          JSON.stringify({
            attemptCount: task.attempt_count,
            managerDisplayName: manager.displayName,
          }),
          acceptedAt,
        ],
      );
      await client.query("COMMIT");
      return { notificationId, status: "pending", acceptedAt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private notFound(): never {
    throw new HttpException(
      { code: "NOTIFICATION_NOT_FOUND", message: "找不到这项通知任务。" },
      HttpStatus.NOT_FOUND,
    );
  }

  private runWorkerCycle(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.activeWorkerCycle) return this.activeWorkerCycle;

    const cycle = this.processWorkerCycle();
    this.activeWorkerCycle = cycle;
    void cycle.finally(() => {
      if (this.activeWorkerCycle === cycle) this.activeWorkerCycle = null;
    });
    return cycle;
  }

  private async processWorkerCycle(): Promise<void> {
    try {
      await this.createDueReminders();
      const task = await this.claimNextTask();
      if (task) await this.deliver(task);
    } catch (error) {
      this.logger.error(
        "模拟微信通知工作器处理失败",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async createDueReminders(): Promise<void> {
    const demoNow = this.clock.now().toISOString();
    await this.database.pool.query(
      `INSERT INTO notification_outbox (
         id, booking_id, customer_id, notification_type, payload,
         status, available_at, created_at
       )
       SELECT 'reminder-' || booking.id,
              booking.id,
              booking.customer_id,
              'booking_reminder',
              jsonb_build_object(
                'bookingId', booking.id,
                'petName', booking.pet_name_snapshot,
                'serviceName', booking.primary_service_name_snapshot,
                'staffName', booking.staff_display_name_snapshot,
                'startsAt', booking.starts_at
              ),
              'pending',
              $1::timestamptz,
              $1::timestamptz
       FROM bookings AS booking
       WHERE booking.status = 'confirmed'
         AND booking.starts_at > $1::timestamptz
         AND booking.starts_at - interval '24 hours' <= $1::timestamptz
         AND booking.created_at <= booking.starts_at - interval '24 hours'
       ON CONFLICT (booking_id) WHERE notification_type = 'booking_reminder'
       DO NOTHING`,
      [demoNow],
    );
  }

  private async claimNextTask(): Promise<{ id: string } | null> {
    const result = await this.database.pool.query<{ id: string }>(
      `WITH next_task AS (
         SELECT id
         FROM notification_outbox
         WHERE status IN ('pending', 'retry')
           AND available_at <= $1
         ORDER BY available_at, sequence
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE notification_outbox AS notification
       SET status = 'processing'
       FROM next_task
       WHERE notification.id = next_task.id
       RETURNING notification.id`,
      [this.clock.now()],
    );
    return result.rows[0] ?? null;
  }

  private async deliver(task: { id: string }): Promise<void> {
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{
        attempt_count: number;
        simulated_failures_remaining: number;
      }>(
        `SELECT attempt_count, simulated_failures_remaining
         FROM notification_outbox
         WHERE id = $1 AND status = 'processing'
         FOR UPDATE`,
        [task.id],
      );
      const row = locked.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return;
      }

      const attemptNumber = row.attempt_count + 1;
      const mode: ManagerNotificationAttempt["mode"] =
        row.attempt_count < 3 ? "automatic" : "manual";
      const failed = row.simulated_failures_remaining > 0;
      const attemptedAt = this.clock.now();
      const result: ManagerNotificationAttempt["result"] = failed ? "failed" : "sent";
      const detail = failed ? "已注入的模拟微信通道失败" : "模拟微信通道发送成功";
      await client.query(
        `INSERT INTO notification_delivery_attempts (
           id, notification_id, attempt_number, mode, result, detail, attempted_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), task.id, attemptNumber, mode, result, detail, attemptedAt],
      );

      if (!failed) {
        await client.query(
          `UPDATE notification_outbox
           SET status = 'sent', attempt_count = $2, available_at = $3
           WHERE id = $1`,
          [task.id, attemptNumber, attemptedAt],
        );
      } else {
        const automaticRetry = mode === "automatic" && attemptNumber < 3;
        const availableAt = new Date(
          attemptedAt.getTime() + getNotificationRetryBackoffMilliseconds(),
        );
        await client.query(
          `UPDATE notification_outbox
           SET status = $2,
               attempt_count = $3,
               available_at = $4,
               simulated_failures_remaining = simulated_failures_remaining - 1
           WHERE id = $1`,
          [task.id, automaticRetry ? "retry" : "failed", attemptNumber, availableAt],
        );
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
