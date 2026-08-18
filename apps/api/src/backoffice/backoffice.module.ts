import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { LiveRefreshModule } from "../live-refresh/live-refresh.module.js";
import { ScheduleModule } from "../schedule/schedule.module.js";
import { BackofficeController } from "./backoffice.controller.js";
import { ManagerLiveBookingService } from "./manager-live-booking.service.js";
import { StaffFulfilmentService } from "./staff-fulfilment.service.js";

@Module({
  imports: [AuditModule, AuthModule, DatabaseModule, LiveRefreshModule, ScheduleModule],
  controllers: [BackofficeController],
  providers: [ManagerGuard, ManagerLiveBookingService, StaffFulfilmentService],
})
export class BackofficeModule {}
