import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  DemoAdvanceResponse,
  DemoResetResponse,
  DemoStatusResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { RequestOriginGuard } from "../auth/request-origin.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { DemoControlService } from "./demo-control.service.js";

@ApiTags("demo")
@Controller()
export class DemoControlController {
  constructor(@Inject(DemoControlService) private readonly demo: DemoControlService) {}

  @Get("demo/status")
  @ApiOperation({ summary: "读取所有端共享的上海演示时间" })
  status(@Res({ passthrough: true }) reply: FastifyReply): DemoStatusResponse {
    reply.header("Cache-Control", "no-store");
    return this.demo.status();
  }

  @Post("backoffice/manager/demo/advance")
  @UseGuards(SessionGuard, ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "店长推进演示时间并触发到期提醒" })
  advance(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<DemoAdvanceResponse> {
    return this.demo.advance(request.backofficeIdentity, body);
  }

  @Post("backoffice/manager/demo/reset")
  @UseGuards(SessionGuard, ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "店长确认后确定性重置全部本地演示数据" })
  reset(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<DemoResetResponse> {
    return this.demo.reset(request.backofficeIdentity, body);
  }
}
