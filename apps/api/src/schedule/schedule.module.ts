import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ScheduleController } from "./schedule.controller.js";
import { ScheduleService } from "./schedule.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
