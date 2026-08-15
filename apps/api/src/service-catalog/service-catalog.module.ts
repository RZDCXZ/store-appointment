import { Module } from "@nestjs/common";

import { ServiceCatalogController } from "./service-catalog.controller.js";
import { ServiceCatalogService } from "./service-catalog.service.js";

@Module({
  controllers: [ServiceCatalogController],
  providers: [ServiceCatalogService],
})
export class ServiceCatalogModule {}
