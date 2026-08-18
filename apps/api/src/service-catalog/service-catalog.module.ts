import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { ManagerServiceCatalogController } from "./manager-service-catalog.controller.js";
import { ServiceCatalogController } from "./service-catalog.controller.js";
import { ServiceCatalogService } from "./service-catalog.service.js";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule],
  controllers: [ServiceCatalogController, ManagerServiceCatalogController],
  providers: [ManagerGuard, ServiceCatalogService],
  exports: [ServiceCatalogService],
})
export class ServiceCatalogModule {}
