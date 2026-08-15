import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { AuthenticatedRequest } from "./auth.types.js";
import { readSessionToken } from "./session-cookie.js";
import { SessionService } from "./session.service.js";

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const resolution = await this.sessions.resolve(readSessionToken(request.headers.cookie));

    if (resolution.kind === "authenticated") {
      (request as AuthenticatedRequest).backofficeIdentity = resolution.account;
      return true;
    }

    const expired = resolution.kind === "expired";
    throw new HttpException(
      {
        code: expired ? "SESSION_EXPIRED" : "UNAUTHENTICATED",
        message: expired ? "登录已过期，请重新登录后继续。" : "请先登录茸光后台。",
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
