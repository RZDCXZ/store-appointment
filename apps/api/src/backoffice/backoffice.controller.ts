import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
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
  type StaffBookingDetailResponse,
  type StaffBookingListResponse,
  type StaffPhoneRevealResponse,
  type StaffTodayResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";
import type { Observable } from "rxjs";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { RequestOriginGuard } from "../auth/request-origin.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { SessionService } from "../auth/session.service.js";
import { LiveRefreshService } from "../live-refresh/live-refresh.service.js";
import { ManagerLiveBookingService } from "./manager-live-booking.service.js";
import { StaffFulfilmentService } from "./staff-fulfilment.service.js";

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
    @Inject(StaffFulfilmentService)
    private readonly staffFulfilment: StaffFulfilmentService,
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

  @Get("staff/today")
  @ApiOperation({ summary: "读取当前员工本人今日工作与行动队列" })
  staffTodayFacts(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffTodayResponse> {
    reply.header("Cache-Control", "no-store");
    return this.staffFulfilment.today(request.backofficeIdentity);
  }

  @Get("staff/bookings")
  @ApiOperation({ summary: "读取当前员工本人预约" })
  staffBookings(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffBookingListResponse> {
    reply.header("Cache-Control", "no-store");
    return this.staffFulfilment.bookings(request.backofficeIdentity);
  }

  @Get("staff/bookings/:bookingId")
  @ApiOperation({ summary: "读取当前员工获分配预约的履约资料" })
  staffBookingDetail(
    @Param("bookingId") bookingId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffBookingDetailResponse> {
    reply.header("Cache-Control", "no-store");
    return this.staffFulfilment.bookingDetail(request.backofficeIdentity, bookingId);
  }

  @Get("staff/bookings/:bookingId/pet-photo")
  @ApiOperation({ summary: "仅向当前分配员工返回预约宠物的顾客上传照片" })
  async staffBookingPetPhoto(
    @Param("bookingId") bookingId: string,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = await this.staffFulfilment.bookingPetPhoto(request.backofficeIdentity, bookingId);
    reply.header("Cache-Control", "private, no-store");
    reply.type(photo.mimeType).send(photo.bytes);
  }

  @Post("staff/bookings/:bookingId/customer-phone/reveal")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "当前分配员工确认后揭示完整手机号并追加审计事实" })
  revealStaffBookingCustomerPhone(
    @Param("bookingId") bookingId: string,
    @Body() body: { confirmed?: boolean } | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffPhoneRevealResponse> {
    reply.header("Cache-Control", "no-store");
    return this.staffFulfilment.revealCustomerPhone(
      request.backofficeIdentity,
      bookingId,
      body?.confirmed === true,
    );
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
