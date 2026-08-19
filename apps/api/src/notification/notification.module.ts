import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { NotificationService } from "./notification.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
