import { Module } from "@nestjs/common";

import { CustomerModule } from "../customer/customer.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ServiceCatalogModule } from "../service-catalog/service-catalog.module.js";
import { BookingController } from "./booking.controller.js";
import { BookingService } from "./booking.service.js";

@Module({
  imports: [CustomerModule, DatabaseModule, ServiceCatalogModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
