import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { BookingEntryResponse, PrivacyConsentStatusResponse } from "@rongguang/contracts";

import { DatabaseService } from "../database/database.service.js";

interface PrivacyStatusRow {
  version: string;
  title: string;
  summary: string;
  published_at: Date;
  consent_version: string | null;
  consent_source: "miniapp_booking" | "manager_offline" | null;
  consented_at: Date | null;
}

@Injectable()
export class PrivacyConsentService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async status(customerId: string): Promise<PrivacyConsentStatusResponse> {
    const result = await this.database.pool.query<PrivacyStatusRow>(
      `
        SELECT notice.version,
               notice.title,
               notice.summary,
               notice.published_at,
               consent.notice_version AS consent_version,
               consent.source AS consent_source,
               consent.consented_at
        FROM privacy_notices AS notice
        LEFT JOIN privacy_consents AS consent
          ON consent.notice_version = notice.version
         AND consent.customer_id = $1
        WHERE notice.is_current
      `,
      [customerId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("当前隐私说明尚未配置");
    }

    const consent =
      row.consent_version && row.consent_source && row.consented_at
        ? {
            version: row.consent_version,
            source: row.consent_source,
            consentedAt: row.consented_at.toISOString(),
          }
        : null;

    return {
      notice: {
        version: row.version,
        title: row.title,
        summary: row.summary,
        publishedAt: row.published_at.toISOString(),
      },
      consent,
      requiresConsent: consent === null,
    };
  }

  async accept(customerId: string, body: unknown): Promise<PrivacyConsentStatusResponse> {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if (input.accepted !== true) {
      throw new HttpException(
        { code: "EXPLICIT_CONSENT_REQUIRED", message: "请先明确勾选已阅读并同意当前隐私说明。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (typeof input.version !== "string" || input.version.length > 20) {
      throw new HttpException(
        { code: "PRIVACY_NOTICE_OUTDATED", message: "隐私说明版本无效，请重新打开页面。" },
        HttpStatus.CONFLICT,
      );
    }

    const current = await this.status(customerId);

    if (input.version !== current.notice.version) {
      throw new HttpException(
        {
          code: "PRIVACY_NOTICE_OUTDATED",
          message: "隐私说明已更新，请阅读当前版本后重新确认。",
          currentVersion: current.notice.version,
        },
        HttpStatus.CONFLICT,
      );
    }

    await this.database.pool.query(
      `
        INSERT INTO privacy_consents (customer_id, notice_version, source)
        VALUES ($1, $2, 'miniapp_booking')
        ON CONFLICT (customer_id, notice_version) DO NOTHING
      `,
      [customerId, input.version],
    );

    return this.status(customerId);
  }

  async bookingEntry(customerId: string): Promise<BookingEntryResponse> {
    const status = await this.status(customerId);

    return {
      canContinue: !status.requiresConsent,
      requiredPrivacyNoticeVersion: status.notice.version,
    };
  }
}
