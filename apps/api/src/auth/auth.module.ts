import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DatabaseModule } from "../database/database.module.js";
import { AuthController } from "./auth.controller.js";
import { RequestOriginGuard } from "./request-origin.guard.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [SessionGuard, SessionService, { provide: APP_GUARD, useClass: RequestOriginGuard }],
  exports: [SessionGuard, SessionService],
})
export class AuthModule {}
