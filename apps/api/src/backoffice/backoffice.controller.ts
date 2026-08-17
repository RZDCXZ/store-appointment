import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  backofficeNavigation,
  type BackofficeLandingResponse,
  type ManagerBookingDetailResponse,
  type ManagerCalendarResponse,
  type ManagerWorkbenchResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";
import type { Observable } from "rxjs";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { SessionService } from "../auth/session.service.js";
import { LiveRefreshService } from "../live-refresh/live-refresh.service.js";
import { ManagerLiveBookingService } from "./manager-live-booking.service.js";

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
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ManagerLiveBookingService)
    private readonly managerBookings: ManagerLiveBookingService,
    @Inject(LiveRefreshService) private readonly liveRefresh: LiveRefreshService,
  ) {}

  @Get("manager/workbench")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "读取风险优先的店长今日工作台事实与容量" })
  managerWorkbench(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerWorkbenchResponse> {
    reply.header("Cache-Control", "no-store");
    return this.managerBookings.workbench();
  }

  @Get("manager/calendar")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "按四名员工读取日历、预约与当前门店容量" })
  managerCalendar(
    @Query("date") date: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerCalendarResponse> {
    reply.header("Cache-Control", "no-store");
    return this.managerBookings.calendar(date);
  }

  @Get("manager/bookings/:bookingId")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "按可恢复详情入口读取店长可见预约事实" })
  managerBookingDetail(
    @Param("bookingId") bookingId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerBookingDetailResponse> {
    reply.header("Cache-Control", "no-store");
    return this.managerBookings.bookingDetail(bookingId);
  }

  @Sse("manager/events")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "发送仅用于回源刷新的店长 SSE 提示" })
  managerEvents(): Observable<MessageEvent> {
    return this.liveRefresh.managerEvents();
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
