import { unlink } from "node:fs/promises";
import { join } from "node:path";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApplication } from "../src/bootstrap.js";
import { getDemoNow, getPetUploadDirectory } from "../src/config/environment.js";
import { DatabaseService } from "../src/database/database.service.js";

async function customerAuthorization(
  app: NestFastifyApplication,
  customerKey: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/miniapp/demo-sessions",
    payload: { customerKey },
  });

  expect(response.statusCode).toBe(201);
  const { accessToken } = response.json<{ accessToken: string }>();
  return `Bearer ${accessToken}`;
}

describe("宠物档案与隐私同意", () => {
  let app: NestFastifyApplication;
  let database: DatabaseService;
  const createdPetIds = new Set<string>();
  const uploadedPhotoIds = new Set<string>();

  beforeAll(async () => {
    app = await createApplication();
    await app.init();
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    if (createdPetIds.size > 0) {
      await database.pool.query("DELETE FROM pets WHERE id = ANY($1::text[])", [
        [...createdPetIds],
      ]);
    }
    if (uploadedPhotoIds.size > 0) {
      const photos = await database.pool.query<{ storage_key: string }>(
        "DELETE FROM pet_photos WHERE id = ANY($1::text[]) RETURNING storage_key",
        [[...uploadedPhotoIds]],
      );

      await Promise.all(
        photos.rows.map((photo) =>
          unlink(join(getPetUploadDirectory(), photo.storage_key)).catch(() => undefined),
        ),
      );
    }
    await database.pool.query("DELETE FROM privacy_consents WHERE customer_id = 'customer-xu-lan'");
    await database.pool.query("DELETE FROM privacy_notices WHERE version = '2026.09'");
    await database.pool.query("UPDATE privacy_notices SET is_current = (version = '2026.08')");
    await app.close();
  });

  it("只列出当前顾客的在用与归档宠物，并拒绝通过替换 ID 读取他人档案", async () => {
    const xuLanAuthorization = await customerAuthorization(app, "xu-lan");
    const listResponse = await app.inject({
      method: "GET",
      url: "/miniapp/pets",
      headers: { authorization: xuLanAuthorization },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      active: [
        {
          id: "pet-tuanzi",
          name: "团子",
          species: "dog",
          weightKg: 8.4,
          petSize: "small",
          careTags: ["怕吹风"],
          archivedAt: null,
        },
      ],
      archived: [],
    });

    const replacedIdResponse = await app.inject({
      method: "GET",
      url: "/miniapp/pets/pet-bohe",
      headers: { authorization: xuLanAuthorization },
    });

    expect(replacedIdResponse.statusCode).toBe(404);
    expect(replacedIdResponse.json()).toMatchObject({ code: "PET_NOT_FOUND" });
  });

  it("创建和编辑完整宠物资料，并始终按当前体重返回正确体型", async () => {
    const xuLanAuthorization = await customerAuthorization(app, "xu-lan");
    const createResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pets",
      headers: { authorization: xuLanAuthorization },
      payload: {
        name: "  小满  ",
        species: "cat",
        weightKg: 10.01,
        breed: "布偶猫",
        sex: "female",
        birthDate: "2023-06-12",
        coatType: "long",
        photoId: null,
        careTags: ["易紧张", "不喜欢碰脚"],
        careNotes: "  初次到店，请先让它熟悉环境。  ",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{ pet: { id: string } & Record<string, unknown> }>().pet;
    createdPetIds.add(created.id);
    expect(created).toMatchObject({
      name: "小满",
      species: "cat",
      weightKg: 10.01,
      petSize: "medium",
      breed: "布偶猫",
      sex: "female",
      birthDate: "2023-06-12",
      coatType: "long",
      careTags: expect.arrayContaining(["易紧张", "不喜欢碰脚"]),
      careNotes: "初次到店，请先让它熟悉环境。",
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/miniapp/pets/${created.id}`,
      headers: { authorization: xuLanAuthorization },
      payload: {
        name: "小满",
        species: "cat",
        weightKg: 25.01,
        breed: null,
        sex: null,
        birthDate: null,
        coatType: null,
        photoId: null,
        careTags: ["需要慢速吹干"],
        careNotes: null,
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      pet: {
        id: created.id,
        weightKg: 25.01,
        petSize: "large",
        breed: null,
        careTags: ["需要慢速吹干"],
      },
    });
  });

  it("返回字段级输入错误，且另一位顾客不能修改宠物", async () => {
    const [xuLanAuthorization, chengMoAuthorization] = await Promise.all([
      customerAuthorization(app, "xu-lan"),
      customerAuthorization(app, "cheng-mo"),
    ]);
    const invalidResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pets",
      headers: { authorization: xuLanAuthorization },
      payload: {
        name: "   ",
        species: "rabbit",
        weightKg: 0,
        birthDate: "2099-01-01",
        careTags: ["疾病诊断"],
        careNotes: "x".repeat(501),
      },
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: {
        name: expect.any(String),
        species: expect.any(String),
        weightKg: expect.any(String),
        birthDate: expect.any(String),
        careTags: expect.any(String),
        careNotes: expect.any(String),
      },
    });

    const excessivePrecisionResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pets",
      headers: { authorization: xuLanAuthorization },
      payload: {
        name: "小数",
        species: "cat",
        weightKg: 8.444,
        careTags: [],
      },
    });

    expect(excessivePrecisionResponse.statusCode).toBe(400);
    expect(excessivePrecisionResponse.json()).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: { weightKg: expect.any(String) },
    });

    const replacedIdResponse = await app.inject({
      method: "PUT",
      url: "/miniapp/pets/pet-tuanzi",
      headers: { authorization: chengMoAuthorization },
      payload: {
        name: "被篡改",
        species: "dog",
        weightKg: 9,
        careTags: [],
      },
    });

    expect(replacedIdResponse.statusCode).toBe(404);
    expect(replacedIdResponse.json()).toMatchObject({ code: "PET_NOT_FOUND" });
  });

  it("无未来预约的宠物可归档和恢复，有未来预约时返回关联预约并阻止归档", async () => {
    const [xuLanAuthorization, chengMoAuthorization] = await Promise.all([
      customerAuthorization(app, "xu-lan"),
      customerAuthorization(app, "cheng-mo"),
    ]);
    const createResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pets",
      headers: { authorization: xuLanAuthorization },
      payload: {
        name: "可可",
        species: "dog",
        weightKg: 10,
        careTags: [],
      },
    });
    const createdPetId = createResponse.json<{ pet: { id: string } }>().pet.id;
    createdPetIds.add(createdPetId);

    const archiveResponse = await app.inject({
      method: "POST",
      url: `/miniapp/pets/${createdPetId}/archive`,
      headers: { authorization: xuLanAuthorization },
    });

    expect(archiveResponse.statusCode).toBe(201);
    expect(archiveResponse.json()).toMatchObject({
      pet: { id: createdPetId, archivedAt: expect.any(String) },
    });

    const restoreResponse = await app.inject({
      method: "POST",
      url: `/miniapp/pets/${createdPetId}/restore`,
      headers: { authorization: xuLanAuthorization },
    });

    expect(restoreResponse.statusCode).toBe(201);
    expect(restoreResponse.json()).toMatchObject({ pet: { id: createdPetId, archivedAt: null } });

    const blockedResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pets/pet-bohe/archive",
      headers: { authorization: chengMoAuthorization },
    });

    expect(blockedResponse.statusCode).toBe(409);
    expect(blockedResponse.json()).toMatchObject({
      code: "PET_HAS_FUTURE_BOOKING",
      booking: {
        id: "booking-bohe-future",
        startsAt: "2026-08-14T03:00:00.000Z",
      },
    });
  });

  it("按当前隐私说明版本记录明确同意，并在版本更新后重新拦截预约入口", async () => {
    await database.pool.query("DELETE FROM privacy_consents WHERE customer_id = 'customer-xu-lan'");
    const authorization = await customerAuthorization(app, "xu-lan");
    const initialStatus = await app.inject({
      method: "GET",
      url: "/miniapp/privacy-consent",
      headers: { authorization },
    });

    expect(initialStatus.statusCode).toBe(200);
    expect(initialStatus.json()).toMatchObject({
      notice: { version: "2026.08", title: "茸光隐私说明" },
      consent: null,
      requiresConsent: true,
    });

    const rejectedImplicitConsent = await app.inject({
      method: "POST",
      url: "/miniapp/privacy-consent",
      headers: { authorization },
      payload: { version: "2026.08", accepted: false, customerId: "customer-cheng-mo" },
    });

    expect(rejectedImplicitConsent.statusCode).toBe(400);
    expect(rejectedImplicitConsent.json()).toMatchObject({ code: "EXPLICIT_CONSENT_REQUIRED" });

    const consentResponse = await app.inject({
      method: "POST",
      url: "/miniapp/privacy-consent",
      headers: { authorization },
      payload: { version: "2026.08", accepted: true, customerId: "customer-cheng-mo" },
    });

    expect(consentResponse.statusCode).toBe(201);
    expect(consentResponse.json()).toMatchObject({
      notice: { version: "2026.08" },
      consent: {
        version: "2026.08",
        source: "miniapp_booking",
        consentedAt: expect.any(String),
      },
      requiresConsent: false,
    });
    expect(consentResponse.json().consent.consentedAt).toBe(getDemoNow());

    const allowedEntry = await app.inject({
      method: "GET",
      url: "/miniapp/booking-entry",
      headers: { authorization },
    });

    expect(allowedEntry.statusCode).toBe(200);
    expect(allowedEntry.json()).toEqual({
      canContinue: true,
      requiredPrivacyNoticeVersion: "2026.08",
    });

    await database.pool.query("UPDATE privacy_notices SET is_current = false");
    await database.pool.query(
      `
        INSERT INTO privacy_notices (version, title, summary, published_at, is_current)
        VALUES ('2026.09', '茸光隐私说明', '更新后的说明。', '2026-09-01T00:00:00.000Z', true)
      `,
    );

    const versionUpdatedEntry = await app.inject({
      method: "GET",
      url: "/miniapp/booking-entry",
      headers: { authorization },
    });

    expect(versionUpdatedEntry.statusCode).toBe(200);
    expect(versionUpdatedEntry.json()).toEqual({
      canContinue: false,
      requiredPrivacyNoticeVersion: "2026.09",
    });
  });

  it("校验照片类型、签名和大小，并把合法照片保存到本地数据存储", async () => {
    const authorization = await customerAuthorization(app, "xu-lan");
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const uploadResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pet-photos",
      headers: { authorization },
      payload: {
        fileName: "xiaoman.png",
        mimeType: "image/png",
        base64Data: pngBytes.toString("base64"),
      },
    });

    expect(uploadResponse.statusCode).toBe(201);
    const photo = uploadResponse.json<{
      photo: { id: string; photoPath: string; mimeType: string; sizeBytes: number };
    }>().photo;
    uploadedPhotoIds.add(photo.id);
    expect(photo).toEqual({
      id: expect.any(String),
      photoPath: expect.stringMatching(/^\/miniapp\/pet-photos\/.+\/content$/),
      mimeType: "image/png",
      sizeBytes: pngBytes.length,
    });

    const anonymousFileResponse = await app.inject({ method: "GET", url: photo.photoPath });
    expect(anonymousFileResponse.statusCode).toBe(401);

    const otherCustomerAuthorization = await customerAuthorization(app, "cheng-mo");
    const otherCustomerFileResponse = await app.inject({
      method: "GET",
      url: photo.photoPath,
      headers: { authorization: otherCustomerAuthorization },
    });
    expect(otherCustomerFileResponse.statusCode).toBe(404);

    const savedFileResponse = await app.inject({
      method: "GET",
      url: photo.photoPath,
      headers: { authorization },
    });
    expect(savedFileResponse.statusCode).toBe(200);
    expect(savedFileResponse.rawPayload).toEqual(pngBytes);

    const invalidTypeResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pet-photos",
      headers: { authorization },
      payload: {
        fileName: "pet.gif",
        mimeType: "image/gif",
        base64Data: Buffer.from("GIF89a").toString("base64"),
      },
    });
    expect(invalidTypeResponse.statusCode).toBe(400);
    expect(invalidTypeResponse.json()).toMatchObject({ code: "PHOTO_TYPE_INVALID" });

    const mismatchedContentResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pet-photos",
      headers: { authorization },
      payload: {
        fileName: "pet.jpg",
        mimeType: "image/jpeg",
        base64Data: Buffer.from("not-a-jpeg").toString("base64"),
      },
    });
    expect(mismatchedContentResponse.statusCode).toBe(400);
    expect(mismatchedContentResponse.json()).toMatchObject({ code: "PHOTO_CONTENT_INVALID" });

    const oversizedResponse = await app.inject({
      method: "POST",
      url: "/miniapp/pet-photos",
      headers: { authorization },
      payload: {
        fileName: "large.png",
        mimeType: "image/png",
        base64Data: Buffer.concat([pngBytes, Buffer.alloc(524_289)]).toString("base64"),
      },
    });
    expect(oversizedResponse.statusCode).toBe(400);
    expect(oversizedResponse.json()).toMatchObject({ code: "PHOTO_TOO_LARGE" });
  });
});
