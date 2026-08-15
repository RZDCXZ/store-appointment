import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AuthController } from "./auth/auth.controller.js";
import { RequestOriginGuard } from "./auth/request-origin.guard.js";
import { SessionGuard } from "./auth/session.guard.js";
import { SessionService } from "./auth/session.service.js";
import { BackofficeController } from "./backoffice/backoffice.controller.js";
import { DatabaseService } from "./database/database.service.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";

@Module({
  controllers: [AuthController, BackofficeController, HealthController],
  providers: [
    DatabaseService,
    HealthService,
    SessionGuard,
    SessionService,
    { provide: APP_GUARD, useClass: RequestOriginGuard },
  ],
})
export class AppModule {}
