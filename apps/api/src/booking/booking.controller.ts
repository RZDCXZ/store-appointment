import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BookingDetailResponse, CreateBookingResponse } from "@rongguang/contracts";
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
}
