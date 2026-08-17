import { Module } from "@nestjs/common";

import { CustomerModule } from "../customer/customer.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ServiceCatalogModule } from "../service-catalog/service-catalog.module.js";
import { BookingAvailabilityController } from "./booking-availability.controller.js";
import { BookingAvailabilityService } from "./booking-availability.service.js";

@Module({
  imports: [CustomerModule, DatabaseModule, ServiceCatalogModule],
  controllers: [BookingAvailabilityController],
  providers: [BookingAvailabilityService],
  exports: [BookingAvailabilityService],
})
export class BookingAvailabilityModule {}
