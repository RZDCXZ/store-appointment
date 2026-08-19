import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BookingModule } from "../booking/booking.module.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { LiveRefreshModule } from "../live-refresh/live-refresh.module.js";
import { NotificationModule } from "../notification/notification.module.js";
import { ScheduleModule } from "../schedule/schedule.module.js";
import { ServiceCatalogModule } from "../service-catalog/service-catalog.module.js";
import { BackofficeController } from "./backoffice.controller.js";
import { BookingFulfilmentService } from "./booking-fulfilment.service.js";
import { ManagerLiveBookingService } from "./manager-live-booking.service.js";
import { StaffFulfilmentService } from "./staff-fulfilment.service.js";

@Module({
  imports: [
    AuditModule,
    AuthModule,
    BookingModule,
    DatabaseModule,
    LiveRefreshModule,
    NotificationModule,
    ScheduleModule,
    ServiceCatalogModule,
  ],
  controllers: [BackofficeController],
  providers: [
    ManagerGuard,
    ManagerLiveBookingService,
    StaffFulfilmentService,
    BookingFulfilmentService,
  ],
})
export class BackofficeModule {}
