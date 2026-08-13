import { Module } from "@nestjs/common";

import { DatabaseService } from "./database/database.service.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";

@Module({
  controllers: [HealthController],
  providers: [DatabaseService, HealthService],
})
export class AppModule {}
