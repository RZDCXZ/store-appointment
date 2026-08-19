import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { CustomerDataRightsService } from "./customer-data-rights.service.js";
import { CustomerController } from "./customer.controller.js";
import { CustomerSessionGuard } from "./customer-session.guard.js";
import { CustomerSessionService } from "./customer-session.service.js";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [CustomerController],
  providers: [CustomerDataRightsService, CustomerSessionGuard, CustomerSessionService],
  exports: [CustomerSessionGuard, CustomerSessionService],
})
export class CustomerModule {}
