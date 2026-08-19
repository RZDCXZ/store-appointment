import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { NotificationModule } from "../notification/notification.module.js";
import { DemoControlController } from "./demo-control.controller.js";
import { DemoControlService } from "./demo-control.service.js";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule, NotificationModule],
  controllers: [DemoControlController],
  providers: [DemoControlService, ManagerGuard],
  exports: [DemoControlService],
})
export class DemoControlModule {}
