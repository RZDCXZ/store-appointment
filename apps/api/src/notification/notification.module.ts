import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { DemoNotificationClock, NOTIFICATION_CLOCK } from "./notification.clock.js";
import { NotificationService } from "./notification.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    DemoNotificationClock,
    { provide: NOTIFICATION_CLOCK, useExisting: DemoNotificationClock },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
