import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BackofficeController } from "./backoffice.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [BackofficeController],
})
export class BackofficeModule {}
