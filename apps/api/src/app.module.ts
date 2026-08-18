import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { BackofficeModule } from "./backoffice/backoffice.module.js";
import { BookingAvailabilityModule } from "./booking-availability/booking-availability.module.js";
import { BookingModule } from "./booking/booking.module.js";
import { CustomerModule } from "./customer/customer.module.js";
import { HealthModule } from "./health/health.module.js";
import { PetProfileModule } from "./pet-profile/pet-profile.module.js";
import { PrivacyConsentModule } from "./privacy-consent/privacy-consent.module.js";
import { ServiceCatalogModule } from "./service-catalog/service-catalog.module.js";
import { ScheduleModule } from "./schedule/schedule.module.js";
import { StaffManagementModule } from "./staff-management/staff-management.module.js";

@Module({
  imports: [
    AuthModule,
    BackofficeModule,
    BookingAvailabilityModule,
    BookingModule,
    CustomerModule,
    HealthModule,
    PetProfileModule,
    PrivacyConsentModule,
    ScheduleModule,
    ServiceCatalogModule,
    StaffManagementModule,
  ],
})
export class AppModule {}
