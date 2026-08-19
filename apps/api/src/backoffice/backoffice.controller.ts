import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  type BookingCompletionResponse,
  type BookingFulfilmentResponse,
  type BookingTerminationResponse,
  type ManagerBookingContentCorrectionResponse,
  type ManagerBookingCorrectionOptionsResponse,
  type ManagerBookingCorrectionPreviewResponse,
  type ManagerBookingDetailResponse,
  type ManagerBookingListResponse,
  type ManagerProxyBookingResponse,
  type ManagerProxyBookingOptionsResponse,
  type ManagerBookingChangeResponse,
  type ManagerRescheduleBookingOptionsResponse,
  type ManagerCalendarResponse,
  type ManagerNotificationDetailResponse,
  type ManagerNotificationFailureInjectionResponse,
  type ManagerNotificationListResponse,
  type ManagerNotificationManualRetryResponse,
  type ManagerWorkbenchResponse,
  type StaffBookingDetailResponse,
  type StaffBookingListResponse,
  type StaffPhoneRevealResponse,
  type StaffTodayResponse,
  type StoreServiceRecordNoteResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";
import type { Observable } from "rxjs";

import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ManagerGuard } from "../auth/manager.guard.js";
import { RequestOriginGuard } from "../auth/request-origin.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import { SessionService } from "../auth/session.service.js";
import { LiveRefreshService } from "../live-refresh/live-refresh.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { BookingService } from "../booking/booking.service.js";
import { BookingFulfilmentService } from "./booking-fulfilment.service.js";
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
    @Inject(BookingFulfilmentService)
    private readonly bookingFulfilment: BookingFulfilmentService,
    @Inject(LiveRefreshService) private readonly liveRefresh: LiveRefreshService,
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  @Get("manager/notifications")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "读取模拟微信通知任务列表" })
  managerNotifications(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerNotificationListResponse> {
    reply.header("Cache-Control", "no-store");
    return this.notifications.list();
  }

  @Get("manager/notifications/:notificationId")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "读取模拟微信通知任务与每次发送尝试" })
  managerNotificationDetail(
    @Param("notificationId") notificationId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerNotificationDetailResponse> {
    reply.header("Cache-Control", "no-store");
    return this.notifications.detail(notificationId);
  }

  @Post("manager/notifications/:notificationId/simulated-failures")
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "为指定模拟微信通知注入可预测失败次数" })
  injectNotificationFailures(
    @Param("notificationId") notificationId: string,
    @Body() body: unknown,
  ): Promise<ManagerNotificationFailureInjectionResponse> {
    return this.notifications.injectFailures(notificationId, body);
  }

  @Post("manager/notifications/:notificationId/manual-retry")
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "人工重试最终失败通知并记录审计事实" })
  manualRetryNotification(
    @Param("notificationId") notificationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerNotificationManualRetryResponse> {
    return this.notifications.manualRetry(notificationId, request.backofficeIdentity);
  }

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

  @Get("manager/bookings")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "按店长筛选条件读取预约列表" })
  managerBookingList(
    @Query("date") date: string | undefined,
    @Query("status") status: string | undefined,
    @Query("staffId") staffId: string | undefined,
    @Query("primaryServiceId") primaryServiceId: string | undefined,
    @Query("q") query: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerBookingListResponse> {
    reply.header("Cache-Control", "no-store");
    return this.managerBookings.bookings({ date, status, staffId, primaryServiceId, query });
  }

  @Post("manager/proxy-bookings")
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "店长按同一容量规则幂等创建代客预约" })
  createManagerProxyBooking(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerProxyBookingResponse> {
    return this.bookings.createProxy(request.backofficeIdentity, body);
  }

  @Get("manager/proxy-bookings/options")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "读取代客预约所需的档案、隐私、员工和服务选项" })
  managerProxyBookingOptions(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerProxyBookingOptionsResponse> {
    reply.header("Cache-Control", "no-store");
    return this.managerBookings.proxyBookingOptions();
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

  @Get("manager/bookings/:bookingId/reschedule-options")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "按预约身份恢复店长改期原安排与真实可用建议" })
  managerRescheduleBookingOptions(
    @Param("bookingId") bookingId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerRescheduleBookingOptionsResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.managerRescheduleOptions(bookingId);
  }

  @Get("manager/bookings/:bookingId/correction-options")
  @UseGuards(ManagerGuard)
  @ApiOperation({ summary: "按预约身份恢复 MG-07 当前服务快照与可纠正选项" })
  managerBookingCorrectionOptions(
    @Param("bookingId") bookingId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerBookingCorrectionOptionsResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.managerCorrectionOptions(bookingId);
  }

  @Post("manager/bookings/:bookingId/correction-preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "保存前重算 MG-07 价格、时长、技能和连续容量" })
  managerBookingCorrectionPreview(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerBookingCorrectionPreviewResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.managerCorrectionPreview(bookingId, body);
  }

  @Post("manager/bookings/:bookingId/correct-content")
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "到店核销前原子纠正体重、服务规格和增项" })
  managerCorrectBookingContent(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerBookingContentCorrectionResponse> {
    return this.bookings.managerCorrectContent(request.backofficeIdentity, bookingId, body);
  }

  @Post("manager/bookings/:bookingId/reschedule")
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "店长填写线下约定原因并原子改期" })
  managerRescheduleBooking(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerBookingChangeResponse> {
    return this.bookings.managerReschedule(request.backofficeIdentity, bookingId, body);
  }

  @Post("manager/bookings/:bookingId/cancel")
  @UseGuards(ManagerGuard, RequestOriginGuard)
  @ApiOperation({ summary: "店长在到店核销前填写原因并幂等取消预约" })
  managerCancelBooking(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ManagerBookingChangeResponse> {
    return this.bookings.managerCancel(request.backofficeIdentity, bookingId, body);
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

  @Post("bookings/:bookingId/complete")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "完成已到店服务并生成不可覆盖的门店服务记录" })
  completeBooking(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<BookingCompletionResponse> {
    return this.bookingFulfilment.complete(request.backofficeIdentity, bookingId, body);
  }

  @Post("bookings/:bookingId/terminate")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "填写原因终止已到店服务并释放剩余容量" })
  terminateBooking(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<BookingTerminationResponse> {
    return this.bookingFulfilment.terminate(request.backofficeIdentity, bookingId, body);
  }

  @Post("bookings/:bookingId/service-record/notes")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "在只读门店服务记录后追加员工说明或店长更正说明" })
  appendServiceRecordNote(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<StoreServiceRecordNoteResponse> {
    return this.bookingFulfilment.appendServiceRecordNote(
      request.backofficeIdentity,
      bookingId,
      body,
    );
  }

  @Post("bookings/:bookingId/check-in")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "在正常窗口内使用六位码幂等核销到店" })
  checkInBooking(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<BookingFulfilmentResponse> {
    return this.bookingFulfilment.checkIn(request.backofficeIdentity, bookingId, body);
  }

  @Post("bookings/:bookingId/late-check-in")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "超过迟到宽限后填写原因手动核销到店" })
  lateCheckInBooking(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<BookingFulfilmentResponse> {
    return this.bookingFulfilment.lateCheckIn(request.backofficeIdentity, bookingId, body);
  }

  @Post("bookings/:bookingId/no-show")
  @UseGuards(RequestOriginGuard)
  @ApiOperation({ summary: "超过迟到宽限后填写原因人工标记爽约" })
  markBookingNoShow(
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<BookingFulfilmentResponse> {
    return this.bookingFulfilment.markNoShow(request.backofficeIdentity, bookingId, body);
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
