import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BookingEntryResponse, PrivacyConsentStatusResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "../customer/customer-session.guard.js";
import type { AuthenticatedCustomerRequest } from "../customer/customer-session.types.js";
import { PrivacyConsentService } from "./privacy-consent.service.js";

@ApiTags("mini-program privacy consent")
@Controller("miniapp")
@UseGuards(CustomerSessionGuard)
export class PrivacyConsentController {
  constructor(@Inject(PrivacyConsentService) private readonly privacy: PrivacyConsentService) {}

  @Get("privacy-consent")
  @ApiOperation({ summary: "读取当前隐私说明及当前顾客的版本化同意状态" })
  async status(
    @Req() request: AuthenticatedCustomerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PrivacyConsentStatusResponse> {
    reply.header("Cache-Control", "no-store");
    return this.privacy.status(request.customerIdentity.id);
  }

  @Post("privacy-consent")
  @ApiOperation({ summary: "记录当前顾客对当前隐私说明版本的明确同意" })
  async accept(
    @Req() request: AuthenticatedCustomerRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PrivacyConsentStatusResponse> {
    reply.header("Cache-Control", "no-store");
    return this.privacy.accept(request.customerIdentity.id, body);
  }

  @Get("booking-entry")
  @ApiOperation({ summary: "在进入预约流程前执行当前隐私同意版本门禁" })
  async bookingEntry(
    @Req() request: AuthenticatedCustomerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BookingEntryResponse> {
    reply.header("Cache-Control", "no-store");
    return this.privacy.bookingEntry(request.customerIdentity.id);
  }
}
