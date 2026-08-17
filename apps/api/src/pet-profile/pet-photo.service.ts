import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { PetPhoto } from "@rongguang/contracts";

import { getDemoNow, getPetUploadDirectory } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";

const maximumPhotoBytes = 512 * 1024;

function hasFileSignature(bytes: Buffer, mimeType: PetPhoto["mimeType"]): boolean {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  }

  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

@Injectable()
export class PetPhotoService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async upload(customerId: string, body: unknown): Promise<PetPhoto> {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png") {
      throw new HttpException(
        { code: "PHOTO_TYPE_INVALID", message: "宠物照片只支持 JPEG 或 PNG。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (typeof input.base64Data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64Data)) {
      throw new HttpException(
        { code: "PHOTO_CONTENT_INVALID", message: "无法读取这张宠物照片，请重新选择。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const bytes = Buffer.from(input.base64Data, "base64");

    if (bytes.length > maximumPhotoBytes) {
      throw new HttpException(
        { code: "PHOTO_TOO_LARGE", message: "宠物照片不能超过 512 KiB，请压缩后重试。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (bytes.length === 0 || !hasFileSignature(bytes, input.mimeType)) {
      throw new HttpException(
        { code: "PHOTO_CONTENT_INVALID", message: "照片内容与文件类型不一致，请重新选择。" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const id = `photo-${randomUUID()}`;
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const storageKey = `${id}.${extension}`;
    const photoPath = `/miniapp/pet-photos/${id}/content`;
    const uploadDirectory = getPetUploadDirectory();
    const filePath = join(uploadDirectory, storageKey);
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(filePath, bytes, { flag: "wx" });

    try {
      await this.database.pool.query(
        `
          INSERT INTO pet_photos (
            id, customer_id, mime_type, size_bytes, storage_key, public_path, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
        `,
        [id, customerId, input.mimeType, bytes.length, storageKey, photoPath, getDemoNow()],
      );
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }

    return { id, photoPath, mimeType: input.mimeType, sizeBytes: bytes.length };
  }

  async read(
    customerId: string,
    photoId: string,
  ): Promise<{ bytes: Buffer; mimeType: PetPhoto["mimeType"] }> {
    const result = await this.database.pool.query<{
      mime_type: PetPhoto["mimeType"];
      storage_key: string;
    }>("SELECT mime_type, storage_key FROM pet_photos WHERE id = $1 AND customer_id = $2", [
      photoId,
      customerId,
    ]);
    const photo = result.rows[0];

    if (!photo) {
      throw new HttpException(
        { code: "PET_PHOTO_NOT_FOUND", message: "找不到这张宠物照片，或当前顾客无权访问。" },
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      bytes: await readFile(join(getPetUploadDirectory(), photo.storage_key)),
      mimeType: photo.mime_type,
    };
  }
}
