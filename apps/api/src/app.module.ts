import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { BackofficeModule } from "./backoffice/backoffice.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [AuthModule, BackofficeModule, HealthModule],
})
export class AppModule {}
