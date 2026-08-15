import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { backofficeNavigation, type BackofficeLandingResponse } from "@rongguang/contracts";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { SessionGuard } from "../auth/session.guard.js";
import { SessionService } from "../auth/session.service.js";

function forbidden(): never {
  throw new HttpException(
    { code: "FORBIDDEN", message: "当前身份没有访问此内容的权限。" },
    HttpStatus.FORBIDDEN,
  );
}

@ApiTags("backoffice")
@Controller("backoffice")
@UseGuards(SessionGuard)
export class BackofficeController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Get("manager/workbench")
  @ApiOperation({ summary: "读取店长工作台身份与导航" })
  managerWorkbench(@Req() request: AuthenticatedRequest): BackofficeLandingResponse {
    if (request.backofficeIdentity.role !== "manager") {
      forbidden();
    }

    return {
      account: request.backofficeIdentity,
      navigation: backofficeNavigation.manager.map((item) => item.label),
    };
  }

  @Get("staff/:staffId/today")
  @ApiOperation({ summary: "读取指定员工的今日工作身份与导航" })
  async staffToday(
    @Param("staffId") staffId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackofficeLandingResponse> {
    const identity = request.backofficeIdentity;

    if (identity.role !== "manager" && identity.id !== staffId) {
      forbidden();
    }

    const account = await this.sessions.findActiveAccount(staffId);

    if (!account || account.role !== "staff") {
      throw new HttpException(
        { code: "NOT_FOUND", message: "没有找到该员工账号。" },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      account,
      navigation: backofficeNavigation.staff.map((item) => item.label),
    };
  }
}
