import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PetPhotoUploadResponse } from "@rongguang/contracts";
import type { FastifyReply } from "fastify";

import { CustomerSessionGuard } from "../customer/customer-session.guard.js";
import type { AuthenticatedCustomerRequest } from "../customer/customer-session.types.js";
import { PetPhotoService } from "./pet-photo.service.js";

@ApiTags("mini-program pet photos")
@Controller("miniapp/pet-photos")
@UseGuards(CustomerSessionGuard)
export class PetPhotoController {
  constructor(@Inject(PetPhotoService) private readonly photos: PetPhotoService) {}

  @Post()
  @ApiOperation({ summary: "校验并保存当前顾客上传的宠物照片" })
  async upload(
    @Req() request: AuthenticatedCustomerRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PetPhotoUploadResponse> {
    const photo = await this.photos.upload(request.customerIdentity.id, body);
    reply.header("Cache-Control", "no-store");
    return { photo };
  }

  @Get(":photoId/content")
  @ApiOperation({ summary: "仅向照片所属顾客返回宠物照片内容" })
  async content(
    @Req() request: AuthenticatedCustomerRequest,
    @Param("photoId") photoId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = await this.photos.read(request.customerIdentity.id, photoId);
    reply.header("Cache-Control", "private, no-store");
    reply.type(photo.mimeType).send(photo.bytes);
  }
}
