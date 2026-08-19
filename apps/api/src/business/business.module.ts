import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { BusinessController } from "./business.controller.js";
import { BusinessService } from "./business.service.js";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule],
  controllers: [BusinessController],
  providers: [BusinessService, ManagerGuard],
})
export class BusinessModule {}
