import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  CapacityChangeCreateResponse,
  CapacityChangeDetailResponse,
  CapacityChangePreviewResponse,
  ManagerCapacityChangeOptionsResponse,
  RevokeCapacityChangeResponse,
  ResolveCapacityChangeBookingResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

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

  @Get(":kind/:changeId")
  @ApiOperation({ summary: "读取可刷新恢复的受影响预约处理进度与可用方案" })
  detail(
    @Param("kind") kind: string,
    @Param("changeId") changeId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CapacityChangeDetailResponse> {
    reply.header("Cache-Control", "no-store");
    return this.capacityChanges.detail(kind, changeId);
  }

  @Post(":kind/:changeId/bookings/:bookingId/resolve")
  @ApiOperation({ summary: "逐笔原子换员工、改期或取消受影响预约" })
  resolve(
    @Param("kind") kind: string,
    @Param("changeId") changeId: string,
    @Param("bookingId") bookingId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ResolveCapacityChangeBookingResponse> {
    return this.capacityChanges.resolve(
      request.backofficeIdentity,
      kind,
      changeId,
      bookingId,
      body,
    );
  }

  @Post(":kind/:changeId/revoke")
  @ApiOperation({ summary: "撤销尚未处理完成的员工停班并保留已成立处理结果" })
  revoke(
    @Param("kind") kind: string,
    @Param("changeId") changeId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<RevokeCapacityChangeResponse> {
    return this.capacityChanges.revoke(request.backofficeIdentity, kind, changeId, body);
  }
}
