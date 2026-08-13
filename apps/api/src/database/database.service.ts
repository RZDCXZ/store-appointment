import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getDatabaseUrl } from "../config/environment.js";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: getDatabaseUrl() });
  readonly client: NodePgDatabase = drizzle(this.pool);

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
