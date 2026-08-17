import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { LiveRefreshService } from "./live-refresh.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [LiveRefreshService],
  exports: [LiveRefreshService],
})
export class LiveRefreshModule {}
