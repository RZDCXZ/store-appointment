import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

import { DatabaseService } from "../database/database.service.js";

export interface AppendAuditFact {
  eventType:
    | "customer_phone_revealed"
    | "service_catalog_created"
    | "service_catalog_updated"
    | "service_catalog_deactivated"
    | "staff_account_created"
    | "staff_skills_updated"
    | "staff_account_deactivated"
    | "schedule_template_updated"
    | "schedule_drafts_generated"
    | "schedule_draft_updated"
    | "schedule_published"
    | "schedule_exception_updated"
    | "capacity_change_created"
    | "capacity_change_status_changed"
    | "capacity_change_booking_resolved"
    | "capacity_change_revoked"
    | "data_exported"
    | "customer_data_anonymized";
  actor: {
    type: "customer" | "staff" | "manager";
    id: string;
  };
  subject: {
    type:
      | "booking"
      | "primary_service"
      | "addon"
      | "staff"
      | "schedule_template"
      | "schedule_draft"
      | "published_schedule"
      | "staff_time_off"
      | "store_closure"
      | "store"
      | "customer";
    id: string;
  };
  payload: Record<string, unknown>;
  occurredAt: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async append(
    fact: AppendAuditFact,
    connection: Pool | PoolClient = this.database.pool,
  ): Promise<void> {
    await connection.query(
      `
        INSERT INTO audit_events (
          id, event_type, actor_type, actor_id,
          subject_type, subject_id, payload, occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `,
      [
        `audit-${randomUUID()}`,
        fact.eventType,
        fact.actor.type,
        fact.actor.id,
        fact.subject.type,
        fact.subject.id,
        JSON.stringify(fact.payload),
        fact.occurredAt,
      ],
    );
  }

  async redactCustomer(
    customerId: string,
    redactedAt: string,
    connection: Pool | PoolClient = this.database.pool,
  ): Promise<void> {
    await connection.query(
      `INSERT INTO audit_event_redactions (
         audit_event_id, actor_id, payload, redacted_at, reason
       )
       SELECT audit.id,
              CASE
                WHEN audit.actor_type = 'customer' THEN 'anonymized-customer'
                ELSE audit.actor_id
              END,
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      CASE
                        WHEN audit.payload ? 'reason' THEN jsonb_set(
                          audit.payload,
                          '{reason}',
                          to_jsonb('[原原因已匿名化]'::text),
                          false
                        )
                        ELSE audit.payload
                      END - 'customerPhone' - 'phone' - 'customer' - 'serviceRecord',
                      '{customerName}',
                      to_jsonb('已匿名顾客'::text),
                      false
                    ),
                    '{petName}',
                    to_jsonb('已匿名宠物'::text),
                    false
                  ),
                  '{previous,pet,name}',
                  to_jsonb('已匿名宠物'::text),
                  false
                ),
                '{next,pet,name}',
                to_jsonb('已匿名宠物'::text),
                false
              ),
              $2::timestamptz,
              'customer_data_anonymized'
       FROM audit_events AS audit
       WHERE (
         audit.actor_id = $1
         OR (audit.subject_type = 'customer' AND audit.subject_id = $1)
         OR EXISTS (
           SELECT 1
           FROM bookings AS booking
           WHERE booking.customer_id = $1
             AND (
               (audit.subject_type = 'booking' AND audit.subject_id = booking.id)
               OR audit.payload ->> 'bookingId' = booking.id
             )
         )
       )
       ON CONFLICT (audit_event_id) DO NOTHING`,
      [customerId, redactedAt],
    );
  }
}
