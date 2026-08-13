import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@rongguang/contracts";

import { HealthService } from "./health.service.js";

@ApiTags("system")
@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: "检查 API 与数据库是否已就绪" })
  @ApiOkResponse({
    schema: {
      example: {
        database: "ready",
        service: "rongguang-api",
        status: "ok",
        timestamp: "2026-08-13T02:50:00.000Z",
      },
    },
  })
  async getHealth(): Promise<HealthResponse> {
    return this.healthService.check();
  }
}
