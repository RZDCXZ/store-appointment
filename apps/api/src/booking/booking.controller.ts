import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  BookingDetailResponse,
  CancelBookingResponse,
  CreateBookingResponse,
  CustomerBookingHistoryResponse,
  RescheduleBookingOptionsResponse,
  RescheduleBookingResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "../customer/customer-session.guard.js";
import type { AuthenticatedCustomerRequest } from "../customer/customer-session.types.js";
import { BookingService } from "./booking.service.js";

@ApiTags("mini-program bookings")
@Controller("miniapp/bookings")
@UseGuards(CustomerSessionGuard)
export class BookingController {
  constructor(@Inject(BookingService) private readonly bookings: BookingService) {}

  @Post()
  @ApiOperation({ summary: "重新校验顾客草稿并原子创建已确认预约" })
  create(
    @Req() request: AuthenticatedCustomerRequest,
    @Body() body: unknown,
  ): Promise<CreateBookingResponse> {
    return this.bookings.createConfirmed(request.customerIdentity.id, body);
  }

  @Get()
  @ApiOperation({ summary: "读取当前顾客自己的未来与历史预约" })
  history(
    @Req() request: AuthenticatedCustomerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CustomerBookingHistoryResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.history(request.customerIdentity.id);
  }

  @Get(":bookingId")
  @ApiOperation({ summary: "按预约身份恢复当前顾客自己的已确认预约事实" })
  detail(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("bookingId") bookingId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BookingDetailResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.detail(request.customerIdentity.id, bookingId);
  }

  @Get(":bookingId/reschedule-options")
  @ApiOperation({ summary: "按预约身份恢复原安排与顾客可用改期时段" })
  rescheduleOptions(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("bookingId") bookingId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RescheduleBookingOptionsResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.rescheduleOptions(request.customerIdentity.id, bookingId);
  }

  @Post(":bookingId/reschedule")
  @ApiOperation({ summary: "顾客在十二小时截止前原子改期并轮换核销码" })
  reschedule(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
  ): Promise<RescheduleBookingResponse> {
    return this.bookings.reschedule(request.customerIdentity.id, bookingId, body);
  }

  @Post(":bookingId/cancel")
  @ApiOperation({ summary: "顾客在十二小时截止前幂等取消自己的已确认预约" })
  cancel(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("bookingId") bookingId: string,
    @Body() body: unknown,
  ): Promise<CancelBookingResponse> {
    return this.bookings.cancel(request.customerIdentity.id, bookingId, body);
  }
}
