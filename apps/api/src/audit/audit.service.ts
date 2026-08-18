import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";

import { DatabaseService } from "../database/database.service.js";

export interface AppendAuditFact {
  eventType: "customer_phone_revealed";
  actor: {
    type: "staff";
    id: string;
  };
  subject: {
    type: "booking";
    id: string;
  };
  payload: {
    customerId: string;
  };
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
