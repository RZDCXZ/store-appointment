import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  ManagerBusinessMetricsResponse,
  ManagerBusinessSeriesResponse,
} from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { ManagerGuard } from "../auth/manager.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { SessionGuard } from "../auth/session.guard.js";
import { BusinessService, parseBusinessPeriod } from "./business.service.js";

@ApiTags("business")
@Controller("backoffice/manager/business")
@UseGuards(SessionGuard, ManagerGuard)
export class BusinessController {
  constructor(@Inject(BusinessService) private readonly business: BusinessService) {}

  @Get("metrics")
  @ApiOperation({ summary: "读取经营指标、公式分子分母与前一等长周期比较" })
  metrics(
    @Query("period") period: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerBusinessMetricsResponse> {
    reply.header("Cache-Control", "no-store");
    return this.business.metrics(parseBusinessPeriod(period));
  }

  @Get("series")
  @ApiOperation({ summary: "读取当前经营周期逐日精确指标序列" })
  series(
    @Query("period") period: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ManagerBusinessSeriesResponse> {
    reply.header("Cache-Control", "no-store");
    return this.business.series(parseBusinessPeriod(period));
  }

  @Post("export.csv")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "按当前经营周期导出逐日 CSV 并记录审计事实" })
  async exportCsv(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const rawPeriod =
      typeof input.period === "string" || typeof input.period === "number"
        ? String(input.period)
        : undefined;
    const file = await this.business.exportCsv(
      request.backofficeIdentity,
      parseBusinessPeriod(rawPeriod),
    );
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Type", file.contentType);
    reply.header("Content-Disposition", `attachment; filename="${file.filename}"`);
    reply.send(file.body);
  }
}
