import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { CustomerController } from "./customer.controller.js";
import { CustomerSessionGuard } from "./customer-session.guard.js";
import { CustomerSessionService } from "./customer-session.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [CustomerController],
  providers: [CustomerSessionGuard, CustomerSessionService],
  exports: [CustomerSessionGuard, CustomerSessionService],
})
export class CustomerModule {}
