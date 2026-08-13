import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@rongguang/contracts";

import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class HealthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<HealthResponse> {
    await this.database.client.execute(sql`
      SELECT value
      FROM app_metadata
      WHERE key = 'brand'
    `);

    return {
      database: "ready",
      service: "rongguang-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
