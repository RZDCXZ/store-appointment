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
import type { ManagerStaffResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { StaffManagementService } from "./staff-management.service.js";

@ApiTags("manager staff management")
@Controller("backoffice/manager/staff")
@UseGuards(SessionGuard, ManagerGuard)
export class StaffManagementController {
  constructor(@Inject(StaffManagementService) private readonly staff: StaffManagementService) {}

  @Get()
  @ApiOperation({ summary: "读取员工账号、未来班次摘要与员工技能矩阵" })
  async read(@Res({ passthrough: true }) reply: FastifyReply): Promise<ManagerStaffResponse> {
    reply.header("Cache-Control", "no-store");
    return this.staff.read();
  }

  @Post()
  @ApiOperation({ summary: "创建只具有员工角色的演示账号" })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ManagerStaffResponse> {
    return this.staff.create(request.backofficeIdentity, body);
  }

  @Patch(":staffId/skills")
  @ApiOperation({ summary: "更新员工对主要服务与增项的当前技能覆盖" })
  updateSkills(
    @Req() request: AuthenticatedRequest,
    @Param("staffId") staffId: string,
    @Body() body: unknown,
  ): Promise<ManagerStaffResponse> {
    return this.staff.updateSkills(request.backofficeIdentity, staffId, body);
  }

  @Post(":staffId/deactivate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "在没有未来预约时停用员工账号并撤销会话" })
  deactivate(
    @Req() request: AuthenticatedRequest,
    @Param("staffId") staffId: string,
  ): Promise<ManagerStaffResponse> {
    return this.staff.deactivate(request.backofficeIdentity, staffId);
  }
}
