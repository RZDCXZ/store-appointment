import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  CapacityChangeCreateResponse,
  CapacityChangePreviewResponse,
  ManagerCapacityChangeOptionsResponse,
} from "@rongguang/contracts";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { CapacityChangeService } from "./capacity-change.service.js";

@ApiTags("schedule and capacity")
@Controller("backoffice/manager/capacity-changes")
@UseGuards(SessionGuard, ManagerGuard)
export class CapacityChangeController {
  constructor(
    @Inject(CapacityChangeService) private readonly capacityChanges: CapacityChangeService,
  ) {}

  @Get("options")
  @ApiOperation({ summary: "读取停班或临时闭店创建页所需员工与十四日窗口" })
  options(): Promise<ManagerCapacityChangeOptionsResponse> {
    return this.capacityChanges.options();
  }

  @Post("preview")
  @ApiOperation({ summary: "预览停班或临时闭店的目标容量与受影响预约" })
  preview(@Body() body: unknown): Promise<CapacityChangePreviewResponse> {
    return this.capacityChanges.preview(body);
  }

  @Post()
  @ApiOperation({ summary: "创建员工停班或门店临时闭店并冻结目标容量" })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<CapacityChangeCreateResponse> {
    return this.capacityChanges.create(request.backofficeIdentity, body);
  }
}
