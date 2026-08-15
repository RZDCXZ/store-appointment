import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { getAdminOrigin } from "../config/environment.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class RequestOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const protectsCookieSession =
      request.url.startsWith("/auth/") || request.url.startsWith("/backoffice/");

    if (safeMethods.has(request.method) || !protectsCookieSession) {
      return true;
    }

    const origin = request.headers.origin;
    const trustedOrigin = new URL(getAdminOrigin()).origin;

    if (typeof origin === "string") {
      try {
        if (new URL(origin).origin === trustedOrigin) {
          return true;
        }
      } catch {
        // Malformed Origin values are handled as untrusted below.
      }
    }

    throw new HttpException(
      { code: "UNTRUSTED_ORIGIN", message: "写请求来源不受信任，请从茸光后台重试。" },
      HttpStatus.FORBIDDEN,
    );
  }
}
