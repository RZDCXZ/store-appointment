import { Module } from "@nestjs/common";

import { CustomerModule } from "../customer/customer.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { PetPhotoController } from "./pet-photo.controller.js";
import { PetPhotoService } from "./pet-photo.service.js";
import { PetProfileController } from "./pet-profile.controller.js";
import { PetProfileService } from "./pet-profile.service.js";

@Module({
  imports: [CustomerModule, DatabaseModule],
  controllers: [PetPhotoController, PetProfileController],
  providers: [PetPhotoService, PetProfileService],
})
export class PetProfileModule {}
