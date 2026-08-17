import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ManagerPublishedScheduleResponse } from "@rongguang/contracts";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ScheduleService } from "./schedule.service.js";

@ApiTags("schedule and capacity")
@Controller("backoffice/manager/schedule")
@UseGuards(SessionGuard)
export class ScheduleController {
  constructor(@Inject(ScheduleService) private readonly schedules: ScheduleService) {}

  @Get()
  @ApiOperation({ summary: "读取店长可见的已发布具体日期排班与完整门店容量" })
  async publishedSchedule(
    @Query("date") date: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerPublishedScheduleResponse> {
    if (request.backofficeIdentity.role !== "manager") {
      throw new HttpException(
        { code: "FORBIDDEN", message: "员工不能访问排班管理或完整门店容量。" },
        HttpStatus.FORBIDDEN,
      );
    }

    return this.schedules.getPublishedSchedule(date);
  }
}
