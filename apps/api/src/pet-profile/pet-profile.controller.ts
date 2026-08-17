import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PetListResponse, PetProfileResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "../customer/customer-session.guard.js";
import type { AuthenticatedCustomerRequest } from "../customer/customer-session.types.js";
import { PetProfileService } from "./pet-profile.service.js";

@ApiTags("mini-program pet profiles")
@Controller("miniapp/pets")
@UseGuards(CustomerSessionGuard)
export class PetProfileController {
  constructor(@Inject(PetProfileService) private readonly pets: PetProfileService) {}

  @Get()
  @ApiOperation({ summary: "列出当前顾客自己的在用与归档宠物" })
  async list(
    @Req() request: AuthenticatedCustomerRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetListResponse> {
    reply.header("Cache-Control", "no-store");
    return this.pets.list(request.customerIdentity.id);
  }

  @Get(":petId")
  @ApiOperation({ summary: "读取当前顾客自己的单只宠物档案" })
  async get(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("petId") petId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetProfileResponse> {
    const pet = await this.pets.get(request.customerIdentity.id, petId);

    if (!pet) {
      throw new HttpException(
        { code: "PET_NOT_FOUND", message: "找不到这份宠物档案，或当前顾客无权访问。" },
        HttpStatus.NOT_FOUND,
      );
    }

    reply.header("Cache-Control", "no-store");
    return { pet };
  }

  @Post()
  @ApiOperation({ summary: "创建当前顾客自己的宠物档案" })
  async create(
    @Req() request: AuthenticatedCustomerRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetProfileResponse> {
    const pet = await this.pets.create(request.customerIdentity.id, body);
    reply.header("Cache-Control", "no-store");
    return { pet };
  }

  @Put(":petId")
  @ApiOperation({ summary: "修改当前顾客自己的宠物档案" })
  async update(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("petId") petId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetProfileResponse> {
    const pet = await this.pets.update(request.customerIdentity.id, petId, body);
    reply.header("Cache-Control", "no-store");
    return { pet };
  }

  @Post(":petId/archive")
  @ApiOperation({ summary: "归档没有未来预约的宠物" })
  async archive(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("petId") petId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetProfileResponse> {
    const pet = await this.pets.archive(request.customerIdentity.id, petId);
    reply.header("Cache-Control", "no-store");
    return { pet };
  }

  @Post(":petId/restore")
  @ApiOperation({ summary: "恢复当前顾客自己的归档宠物" })
  async restore(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("petId") petId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetProfileResponse> {
    const pet = await this.pets.restore(request.customerIdentity.id, petId);
    reply.header("Cache-Control", "no-store");
    return { pet };
  }
}
