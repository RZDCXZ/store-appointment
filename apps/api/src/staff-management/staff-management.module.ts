import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { StaffManagementController } from "./staff-management.controller.js";
import { StaffManagementService } from "./staff-management.service.js";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule],
  controllers: [StaffManagementController],
  providers: [ManagerGuard, StaffManagementService],
})
export class StaffManagementModule {}
