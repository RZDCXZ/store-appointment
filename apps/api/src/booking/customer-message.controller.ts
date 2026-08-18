import { Controller, Get, Inject, Param, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { CustomerMessageDetailResponse, CustomerMessagesResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "../customer/customer-session.guard.js";
import type { AuthenticatedCustomerRequest } from "../customer/customer-session.types.js";
import { BookingService } from "./booking.service.js";

@ApiTags("mini-program messages")
@Controller("miniapp/messages")
@UseGuards(CustomerSessionGuard)
export class CustomerMessageController {
  constructor(@Inject(BookingService) private readonly bookings: BookingService) {}

  @Get()
  @ApiOperation({ summary: "读取由当前顾客预约事实产生的模拟消息" })
  list(
    @Req() request: AuthenticatedCustomerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CustomerMessagesResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.messages(request.customerIdentity.id);
  }

  @Get(":messageId")
  @ApiOperation({ summary: "按消息身份读取当前顾客自己的模拟消息" })
  detail(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("messageId") messageId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CustomerMessageDetailResponse> {
    reply.header("Cache-Control", "no-store");
    return this.bookings.message(request.customerIdentity.id, messageId);
  }
}
