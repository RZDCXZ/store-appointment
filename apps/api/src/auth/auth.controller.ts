import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { BackofficeAuthResponse } from "@rongguang/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

import { readSessionToken, clearSessionCookie, createSessionCookie } from "./session-cookie.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { getDemoNow, isDemoModeEnabled } from "../config/environment.js";

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

@ApiTags("backoffice auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Post("login")
  @ApiOperation({ summary: "使用本地预置账号登录后台" })
  async login(
    @Body() body: LoginBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BackofficeAuthResponse> {
    if (
      typeof body.username !== "string" ||
      typeof body.password !== "string" ||
      !body.username.trim() ||
      !body.password ||
      body.username.length > 80 ||
      body.password.length > 200
    ) {
      throw new HttpException(
        { code: "VALIDATION_ERROR", message: "请输入演示账号和密码。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const account = await this.sessions.authenticate(body.username, body.password);

    if (!account) {
      throw new HttpException(
        { code: "INVALID_CREDENTIALS", message: "账号或密码不正确，请检查后重试。" },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = await this.sessions.create(account.id);
    reply.header("Set-Cookie", createSessionCookie(token));
    reply.header("Cache-Control", "no-store");

    return {
      account,
      demoStatus: {
        enabled: isDemoModeEnabled(),
        now: getDemoNow(),
        timeZone: "Asia/Shanghai",
      },
    };
  }

  @Get("session")
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: "读取当前后台会话" })
  session(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): BackofficeAuthResponse {
    reply.header("Cache-Control", "no-store");
    return {
      account: request.backofficeIdentity,
      demoStatus: {
        enabled: isDemoModeEnabled(),
        now: getDemoNow(),
        timeZone: "Asia/Shanghai",
      },
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "退出当前后台会话" })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.revoke(readSessionToken(request.headers.cookie));
    reply.header("Set-Cookie", clearSessionCookie());
    reply.header("Cache-Control", "no-store");
  }
}
