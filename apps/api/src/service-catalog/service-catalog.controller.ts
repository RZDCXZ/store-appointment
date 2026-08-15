import { Controller, Get, Inject, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { StorefrontCatalogResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { ServiceCatalogService } from "./service-catalog.service.js";

@ApiTags("mini-program storefront")
@Controller("miniapp/storefront")
export class ServiceCatalogController {
  constructor(
    @Inject(ServiceCatalogService) private readonly serviceCatalog: ServiceCatalogService,
  ) {}

  @Get()
  @ApiOperation({ summary: "读取门店信息、主要服务、增项与确定服务规格" })
  storefront(@Res({ passthrough: true }) reply: FastifyReply): StorefrontCatalogResponse {
    reply.header("Cache-Control", "public, max-age=300");
    return this.serviceCatalog.getStorefront();
  }
}
