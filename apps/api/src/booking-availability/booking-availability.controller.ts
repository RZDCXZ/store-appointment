import { Controller, Get, Inject, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BookingAvailabilityResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "../customer/customer-session.guard.js";
import type { AuthenticatedCustomerRequest } from "../customer/customer-session.types.js";
import { BookingAvailabilityService } from "./booking-availability.service.js";

@ApiTags("mini-program booking availability")
@Controller("miniapp/available-slots")
@UseGuards(CustomerSessionGuard)
export class BookingAvailabilityController {
  constructor(
    @Inject(BookingAvailabilityService)
    private readonly availability: BookingAvailabilityService,
  ) {}

  @Get()
  @ApiOperation({ summary: "按当前顾客的宠物、服务组合与员工偏好查询十四日真实可约时段" })
  async availableSlots(
    @Req() request: AuthenticatedCustomerRequest,
    @Query("petId") petId: string | undefined,
    @Query("primaryServiceId") primaryServiceId: string | undefined,
    @Query("addonIds") addonIds: string | undefined,
    @Query("staffId") staffId: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BookingAvailabilityResponse> {
    reply.header("Cache-Control", "no-store");
    return this.availability.discover({
      customerId: request.customerIdentity.id,
      petId,
      primaryServiceId,
      addonIds,
      staffId,
    });
  }
}
