import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class ManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.backofficeIdentity.role !== "manager") {
      throw new HttpException(
        { code: "FORBIDDEN", message: "当前身份没有访问此内容的权限。" },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
