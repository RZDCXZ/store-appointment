import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { CustomerSessionService } from "./customer-session.service.js";
import type { AuthenticatedCustomerRequest } from "./customer-session.types.js";

function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

@Injectable()
export class CustomerSessionGuard implements CanActivate {
  constructor(@Inject(CustomerSessionService) private readonly sessions: CustomerSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const resolution = await this.sessions.resolve(readBearerToken(request.headers.authorization));

    if (resolution.kind === "authenticated") {
      (request as AuthenticatedCustomerRequest).customerIdentity = resolution.customer;
      return true;
    }

    const expired = resolution.kind === "expired";
    throw new HttpException(
      {
        code: expired ? "SESSION_EXPIRED" : "UNAUTHENTICATED",
        message: expired ? "演示顾客会话已失效，请重新选择后继续。" : "请先选择一个演示顾客。",
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
