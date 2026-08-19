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
    | "capacity_change_revoked";
  actor: {
    type: "staff" | "manager";
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
      | "store_closure";
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
}
