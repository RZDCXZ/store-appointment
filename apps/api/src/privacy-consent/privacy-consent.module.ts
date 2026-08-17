import { Module } from "@nestjs/common";

import { CustomerModule } from "../customer/customer.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { PrivacyConsentController } from "./privacy-consent.controller.js";
import { PrivacyConsentService } from "./privacy-consent.service.js";

@Module({
  imports: [CustomerModule, DatabaseModule],
  controllers: [PrivacyConsentController],
  providers: [PrivacyConsentService],
})
export class PrivacyConsentModule {}
