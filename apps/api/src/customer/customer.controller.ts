import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  DemoCustomerChoicesResponse,
  MiniappProfileResponse,
  MiniappSessionResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "./customer-session.guard.js";
import { CustomerSessionService } from "./customer-session.service.js";
import type { AuthenticatedCustomerRequest } from "./customer-session.types.js";

interface DemoSessionBody {
  customerKey?: unknown;
}

@ApiTags("mini-program customer")
@Controller("miniapp")
export class CustomerController {
  constructor(@Inject(CustomerSessionService) private readonly sessions: CustomerSessionService) {}

  @Get("demo-customers")
  @ApiOperation({ summary: "列出三个预置演示顾客及其故事语义" })
  async demoCustomers(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DemoCustomerChoicesResponse> {
    reply.header("Cache-Control", "no-store");
    return { customers: await this.sessions.listChoices() };
  }

  @Post("demo-sessions")
  @ApiOperation({ summary: "选择预置演示顾客并签发短期 Bearer 会话" })
  async createDemoSession(
    @Body() body: DemoSessionBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MiniappSessionResponse> {
    if (typeof body.customerKey !== "string" || !body.customerKey || body.customerKey.length > 80) {
      throw new HttpException(
        { code: "INVALID_DEMO_CUSTOMER", message: "请选择列表中的演示顾客。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const session = await this.sessions.create(body.customerKey);

    if (!session) {
      throw new HttpException(
        { code: "INVALID_DEMO_CUSTOMER", message: "该演示顾客不存在，请重新选择。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    reply.header("Cache-Control", "no-store");
    return session;
  }

  @Get("me")
  @UseGuards(CustomerSessionGuard)
  @ApiOperation({ summary: "通过 Bearer 会话读取当前顾客的基础资料" })
  profile(
    @Req() request: AuthenticatedCustomerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): MiniappProfileResponse {
    const identity = request.customerIdentity;
    const customer = {
      avatarInitial: identity.avatarInitial,
      displayName: identity.displayName,
      phoneMasked: identity.phoneMasked,
      story: identity.story,
    };

    reply.header("Cache-Control", "no-store");
    return { customer };
  }
}
