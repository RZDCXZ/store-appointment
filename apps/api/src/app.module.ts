import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { BackofficeModule } from "./backoffice/backoffice.module.js";
import { CustomerModule } from "./customer/customer.module.js";
import { HealthModule } from "./health/health.module.js";
import { ServiceCatalogModule } from "./service-catalog/service-catalog.module.js";

@Module({
  imports: [AuthModule, BackofficeModule, CustomerModule, HealthModule, ServiceCatalogModule],
})
export class AppModule {}
