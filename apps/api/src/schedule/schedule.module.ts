import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ScheduleController } from "./schedule.controller.js";
import { SchedulePlanningService } from "./schedule-planning.service.js";
import { ScheduleService } from "./schedule.service.js";
import { CapacityChangeController } from "./capacity-change.controller.js";
import { CapacityChangeService } from "./capacity-change.service.js";

@Module({
  imports: [AuthModule, AuditModule, DatabaseModule],
  controllers: [ScheduleController, CapacityChangeController],
  providers: [ScheduleService, SchedulePlanningService, CapacityChangeService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
