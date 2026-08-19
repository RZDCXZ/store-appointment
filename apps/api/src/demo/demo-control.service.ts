import { HttpException, HttpStatus, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type {
  DemoAdvanceResponse,
  DemoResetResponse,
  DemoStatusResponse,
} from "@rongguang/contracts";

import type { BackofficeIdentity } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import {
  getDemoNow,
  isDemoModeEnabled,
  resetRuntimeDemoNow,
  setRuntimeDemoNow,
} from "../config/environment.js";
import { resetDemoData } from "../database/cli.js";
import { DatabaseService } from "../database/database.service.js";
import { NotificationService } from "../notification/notification.service.js";

interface DemoClockMetadata {
  now?: unknown;
}

function advanceMinutes(input: unknown): number {
  if (
    typeof input !== "object" ||
    input === null ||
    !("minutes" in input) ||
    !Number.isInteger((input as { minutes?: unknown }).minutes)
  ) {
    throw new HttpException(
      { code: "INVALID_DEMO_ADVANCE", message: "推进分钟数必须是整数。" },
      HttpStatus.BAD_REQUEST,
    );
  }
  const minutes = Number((input as { minutes: number }).minutes);
  if (minutes < 1 || minutes > 14 * 24 * 60) {
    throw new HttpException(
      { code: "INVALID_DEMO_ADVANCE", message: "演示时间每次只能推进 1 分钟到 14 天。" },
      HttpStatus.BAD_REQUEST,
    );
  }
  return minutes;
}

function requiresResetConfirmation(input: unknown): void {
  if (
    typeof input !== "object" ||
    input === null ||
    !("confirmation" in input) ||
    (input as { confirmation?: unknown }).confirmation !== "重置茸光演示数据"
  ) {
    throw new HttpException(
      {
        code: "DEMO_RESET_CONFIRMATION_REQUIRED",
        message: "请输入“重置茸光演示数据”完成最终确认。",
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

@Injectable()
export class DemoControlService implements OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    resetRuntimeDemoNow();
    if (!process.env.DEMO_NOW) return;

    const result = await this.database.pool.query<{ value: DemoClockMetadata }>(
      "SELECT value FROM app_metadata WHERE key = 'demo_clock'",
    );
    const storedNow = result.rows[0]?.value.now;
    if (
      typeof storedNow === "string" &&
      !Number.isNaN(Date.parse(storedNow)) &&
      new Date(storedNow).toISOString() !== getDemoNow()
    ) {
      setRuntimeDemoNow(storedNow);
    }
  }

  status(): DemoStatusResponse {
    return { enabled: isDemoModeEnabled(), now: getDemoNow(), timeZone: "Asia/Shanghai" };
  }

  async advance(identity: BackofficeIdentity, input: unknown): Promise<DemoAdvanceResponse> {
    this.ensureDemoMode();
    const minutes = advanceMinutes(input);
    const previousNow = getDemoNow();
    const now = new Date(Date.parse(previousNow) + minutes * 60_000).toISOString();
    const client = await this.database.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO app_metadata (key, value, updated_at)
         VALUES ('demo_clock', $1::jsonb, $2)
         ON CONFLICT (key) DO UPDATE
         SET value = excluded.value, updated_at = excluded.updated_at`,
        [JSON.stringify({ now }), now],
      );
      await this.audits.append(
        {
          eventType: "demo_time_advanced",
          actor: { type: "manager", id: identity.id },
          subject: { type: "store", id: "rongguang-store" },
          payload: { previousNow, now, minutes },
          occurredAt: now,
        },
        client,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const remindersCreated = await this.notifications.createDueRemindersAt(now);
    setRuntimeDemoNow(now);
    return { previousNow, now, timeZone: "Asia/Shanghai", remindersCreated };
  }

  async reset(identity: BackofficeIdentity, input: unknown): Promise<DemoResetResponse> {
    this.ensureDemoMode();
    requiresResetConfirmation(input);
    const previousNow = getDemoNow();
    await this.notifications.pauseWorker();
    const client = await this.database.pool.connect();

    try {
      await resetDemoData(client);
      const now = getDemoNow();
      setRuntimeDemoNow(now);
      await this.audits.append({
        eventType: "demo_data_reset",
        actor: { type: "manager", id: identity.id },
        subject: { type: "store", id: "rongguang-store" },
        payload: {
          previousNow,
          now,
          invalidatedSessions: "all",
          uploadsRestored: true,
        },
        occurredAt: now,
      });
      return {
        now,
        timeZone: "Asia/Shanghai",
        invalidatedSessions: "all",
        uploadsRestored: true,
      };
    } catch (error) {
      setRuntimeDemoNow(previousNow);
      throw error;
    } finally {
      client.release();
      this.notifications.resumeWorker();
    }
  }

  private ensureDemoMode(): void {
    if (!isDemoModeEnabled()) {
      throw new HttpException(
        { code: "DEMO_MODE_REQUIRED", message: "只有启用 DEMO_NOW 的演示环境可以执行此操作。" },
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
