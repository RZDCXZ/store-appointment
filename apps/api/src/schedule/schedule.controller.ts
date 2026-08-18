import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ManagerPublishedScheduleResponse } from "@rongguang/contracts";
import type {
  ManagerSchedulePlanningResponse,
  ManagerSchedulePublishResponse,
} from "@rongguang/contracts";

import type { AuthenticatedRequest, BackofficeIdentity } from "../auth/auth.types.js";
import { SessionGuard } from "../auth/session.guard.js";
import { ScheduleService } from "./schedule.service.js";
import { SchedulePlanningService } from "./schedule-planning.service.js";

function managerIdentity(request: AuthenticatedRequest): BackofficeIdentity {
  if (request.backofficeIdentity.role !== "manager") {
    throw new HttpException(
      { code: "FORBIDDEN", message: "员工不能访问排班管理或完整门店容量。" },
      HttpStatus.FORBIDDEN,
    );
  }

  return request.backofficeIdentity;
}

@ApiTags("schedule and capacity")
@Controller("backoffice/manager/schedule")
@UseGuards(SessionGuard)
export class ScheduleController {
  constructor(
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
    @Inject(SchedulePlanningService) private readonly planning: SchedulePlanningService,
  ) {}

  @Get("planning")
  @ApiOperation({ summary: "读取每周排班模板与上海未来十四日草稿工作区" })
  async schedulePlanning(
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerSchedulePlanningResponse> {
    managerIdentity(request);

    return this.planning.read();
  }

  @Put("templates/:staffId/:weekday")
  @ApiOperation({ summary: "维护一名员工某星期的模板班次与休息" })
  updateTemplate(
    @Req() request: AuthenticatedRequest,
    @Param("staffId") staffId: string,
    @Param("weekday") weekday: string,
    @Body() body: unknown,
  ): Promise<ManagerSchedulePlanningResponse> {
    return this.planning.updateTemplate(managerIdentity(request), staffId, weekday, body);
  }

  @Post("drafts/generate")
  @ApiOperation({ summary: "从当前每周模板生成上海未来十四日排班草稿" })
  generateDrafts(@Req() request: AuthenticatedRequest): Promise<ManagerSchedulePlanningResponse> {
    return this.planning.generateDrafts(managerIdentity(request));
  }

  @Post("drafts/publish")
  @ApiOperation({ summary: "确认并发布所选员工与日期的排班草稿" })
  publishDrafts(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ManagerSchedulePublishResponse> {
    return this.planning.publishDrafts(managerIdentity(request), body);
  }

  @Put("drafts/:staffId/:date")
  @ApiOperation({ summary: "修改一名员工一个具体日期的未发布草稿" })
  updateDraft(
    @Req() request: AuthenticatedRequest,
    @Param("staffId") staffId: string,
    @Param("date") date: string,
    @Body() body: unknown,
  ): Promise<ManagerSchedulePlanningResponse> {
    return this.planning.updateDraft(managerIdentity(request), staffId, date, body);
  }

  @Put("published/:staffId/:date/exception")
  @ApiOperation({ summary: "保存已发布排班的具体日期调班、加班或休息例外" })
  updatePublishedException(
    @Req() request: AuthenticatedRequest,
    @Param("staffId") staffId: string,
    @Param("date") date: string,
    @Body() body: unknown,
  ): Promise<{ updated: true }> {
    return this.planning.updatePublishedException(managerIdentity(request), staffId, date, body);
  }

  @Get()
  @ApiOperation({ summary: "读取店长可见的已发布具体日期排班与完整门店容量" })
  async publishedSchedule(
    @Query("date") date: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerPublishedScheduleResponse> {
    managerIdentity(request);

    return this.schedules.getPublishedSchedule(date);
  }
}
