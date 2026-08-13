import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { HealthResponse } from "@rongguang/contracts";

import { DatabaseService } from "../database/database.service.js";

@Injectable()
export class HealthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async check(): Promise<HealthResponse> {
    const metadata = await this.database.client.execute(sql`
      SELECT value
      FROM app_metadata
      WHERE key = 'brand'
    `);

    if (metadata.rows.length !== 1) {
      throw new Error("茸光演示元数据尚未 seed，数据库不应报告 ready。");
    }

    return {
      database: "ready",
      service: "rongguang-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
