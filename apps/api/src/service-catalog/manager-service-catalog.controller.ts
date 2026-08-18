import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ManagerServiceCatalogResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ServiceCatalogService } from "./service-catalog.service.js";

@ApiTags("manager service catalog")
@Controller("backoffice/manager/service-catalog")
@UseGuards(SessionGuard, ManagerGuard)
export class ManagerServiceCatalogController {
  constructor(@Inject(ServiceCatalogService) private readonly catalog: ServiceCatalogService) {}

  @Get()
  @ApiOperation({ summary: "读取主要服务、服务规格、增项关联与历史引用状态" })
  async read(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerServiceCatalogResponse> {
    reply.header("Cache-Control", "no-store");
    return this.catalog.getManagerCatalog();
  }

  @Post("primary-services")
  @ApiOperation({ summary: "按目录版本创建主要服务及其规格" })
  createPrimaryService(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.catalog.createPrimaryService(request.backofficeIdentity, body);
  }

  @Patch("primary-services/:itemId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "按目录版本修改主要服务、规格与兼容增项" })
  updatePrimaryService(
    @Req() request: AuthenticatedRequest,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.catalog.updatePrimaryService(request.backofficeIdentity, itemId, body);
  }

  @Post("primary-services/:itemId/deactivate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "停用主要服务并保留历史预约快照" })
  deactivatePrimaryService(
    @Req() request: AuthenticatedRequest,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.catalog.deactivatePrimaryService(request.backofficeIdentity, itemId, body);
  }

  @Post("addons")
  @ApiOperation({ summary: "按目录版本创建增项及其规格" })
  createAddon(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.catalog.createAddon(request.backofficeIdentity, body);
  }

  @Patch("addons/:itemId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "按目录版本修改增项与规格" })
  updateAddon(
    @Req() request: AuthenticatedRequest,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.catalog.updateAddon(request.backofficeIdentity, itemId, body);
  }

  @Post("addons/:itemId/deactivate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "停用增项并保留历史预约快照" })
  deactivateAddon(
    @Req() request: AuthenticatedRequest,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.catalog.deactivateAddon(request.backofficeIdentity, itemId, body);
  }
}
