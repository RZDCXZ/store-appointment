import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type {
  ManagerPrimaryService,
  ManagerServiceAddon,
  ManagerServiceCatalogResponse,
  ManagerServiceSpecification,
  PetSize,
  PetSpecies,
  StaffSkillId,
  StorefrontCatalogResponse,
} from "@rongguang/contracts";
import type { Pool, PoolClient } from "pg";

import { AuditService } from "../audit/audit.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";

const weeklyBusinessHours: StorefrontCatalogResponse["store"]["weeklyBusinessHours"] = [
  { weekday: 1, label: "周一", openAt: null, closeAt: null },
  { weekday: 2, label: "周二", openAt: "09:30", closeAt: "19:00" },
  { weekday: 3, label: "周三", openAt: "09:30", closeAt: "19:00" },
  { weekday: 4, label: "周四", openAt: "09:30", closeAt: "19:00" },
  { weekday: 5, label: "周五", openAt: "09:30", closeAt: "19:00" },
  { weekday: 6, label: "周六", openAt: "09:30", closeAt: "19:00" },
  { weekday: 0, label: "周日", openAt: "09:30", closeAt: "19:00" },
];

const store: Omit<StorefrontCatalogResponse["store"], "demoNow"> = {
  brandName: "茸光宠物洗护",
  city: "上海",
  address: "上海市徐汇区暖茸路 18 号",
  contactPhone: "021-6488 2618",
  timeZone: "Asia/Shanghai",
  weeklyBusinessHours,
};

const speciesValues = new Set<PetSpecies>(["dog", "cat"]);
const sizeValues = new Set<PetSize>(["small", "medium", "large"]);
const skillValues = new Set<StaffSkillId>([
  "dog-basic-care",
  "dog-styling",
  "cat-care",
  "nail-care",
  "deshedding-care",
  "oral-care",
]);
const sizeOrder: Record<PetSize, number> = { small: 0, medium: 1, large: 2 };

type CatalogItemType = "primary_service" | "addon";

interface CatalogItemRow {
  id: string;
  item_type: CatalogItemType;
  name: string;
  description: string;
  applicable_species: PetSpecies[];
  required_skill_ids: StaffSkillId[];
  active: boolean;
  updated_at: Date;
}

interface CatalogSpecificationRow {
  id: string;
  item_id: string;
  pet_size: PetSize;
  price_cents: number;
  duration_minutes: number;
  active: boolean;
  updated_at: Date;
}

interface CatalogRelationRow {
  primary_service_id: string;
  addon_id: string;
}

interface BookingReferenceRow {
  primary_service_id_snapshot: string;
  pet_size_snapshot: PetSize;
  addon_snapshots: Array<{ id?: unknown }>;
}

interface NormalizedSpecification {
  petSize: PetSize;
  priceCents: number;
  durationMinutes: number;
  active: boolean;
}

interface NormalizedCatalogInput {
  expectedRevision: number;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  availableAddonIds: string[];
  specifications: NormalizedSpecification[];
}

interface ExistingCatalogConfiguration {
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  availableAddonIds: string[];
  specifications: NormalizedSpecification[];
}

interface CatalogFacts {
  revision: number;
  items: CatalogItemRow[];
  specifications: CatalogSpecificationRow[];
  relations: CatalogRelationRow[];
  bookingReferences: BookingReferenceRow[];
}

function validationError(fieldErrors: Record<string, string>): never {
  throw new HttpException(
    { code: "VALIDATION_ERROR", message: "请检查服务配置后重试。", fieldErrors },
    HttpStatus.BAD_REQUEST,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  const strings = value as string[];
  return [...new Set(strings)];
}

function normalizeInput(type: CatalogItemType, body: unknown): NormalizedCatalogInput {
  if (!isRecord(body)) validationError({ form: "请求内容必须是服务配置对象。" });

  const fieldErrors: Record<string, string> = {};
  const expectedRevision = body.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) <= 0) {
    fieldErrors.expectedRevision = "请基于当前目录版本保存。";
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) fieldErrors.name = "名称为必填项，且不能超过 80 个字。";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > 500) fieldErrors.description = "说明不能超过 500 个字。";

  const species = uniqueStrings(body.applicableSpecies);
  if (
    !species ||
    species.length === 0 ||
    species.some((value) => !speciesValues.has(value as PetSpecies))
  ) {
    fieldErrors.applicableSpecies = "至少选择一种适用宠物：犬或猫。";
  }

  const skills = uniqueStrings(body.requiredSkillIds);
  if (
    !skills ||
    skills.length === 0 ||
    skills.some((value) => !skillValues.has(value as StaffSkillId))
  ) {
    fieldErrors.requiredSkillIds = "至少选择一项已有员工技能要求。";
  }

  const availableAddonIds = type === "primary_service" ? uniqueStrings(body.availableAddonIds) : [];
  if (type === "primary_service" && !availableAddonIds) {
    fieldErrors.availableAddonIds = "关联增项必须是目录中的增项标识列表。";
  }

  const specificationErrors: string[] = [];
  const specifications: NormalizedSpecification[] = [];
  if (!Array.isArray(body.specifications) || body.specifications.length === 0) {
    specificationErrors.push("至少填写一个服务规格");
  } else {
    for (const raw of body.specifications) {
      if (!isRecord(raw)) {
        specificationErrors.push("规格格式无效");
        continue;
      }
      const petSize = raw.petSize;
      const priceCents = raw.priceCents;
      const durationMinutes = raw.durationMinutes;
      if (typeof petSize !== "string" || !sizeValues.has(petSize as PetSize)) {
        specificationErrors.push("体型语义无效");
        continue;
      }
      if (!Number.isSafeInteger(priceCents) || Number(priceCents) < 0) {
        specificationErrors.push("金额不能为负数");
      }
      if (
        !Number.isSafeInteger(durationMinutes) ||
        Number(durationMinutes) < 5 ||
        Number(durationMinutes) > 480 ||
        Number(durationMinutes) % 5 !== 0
      ) {
        specificationErrors.push("时长须为 5–480 分钟且按 5 分钟递增");
      }
      specifications.push({
        petSize: petSize as PetSize,
        priceCents: Number(priceCents),
        durationMinutes: Number(durationMinutes),
        active: raw.active !== false,
      });
    }
  }
  if (new Set(specifications.map((item) => item.petSize)).size !== specifications.length) {
    specificationErrors.push("同一体型不能出现重叠规格");
  }
  if (specifications.length > 0 && specifications.every((item) => !item.active)) {
    specificationErrors.push("至少保留一个启用的服务规格");
  }
  if (specificationErrors.length > 0) {
    fieldErrors.specifications = [...new Set(specificationErrors)].join("；");
  }

  if (Object.keys(fieldErrors).length > 0) validationError(fieldErrors);

  return {
    expectedRevision: expectedRevision as number,
    name,
    description,
    applicableSpecies: species as PetSpecies[],
    requiredSkillIds: skills as StaffSkillId[],
    availableAddonIds: availableAddonIds ?? [],
    specifications,
  };
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function specificationSummary(specification: NormalizedSpecification): string {
  return `${specification.priceCents} 分 / ${specification.durationMinutes} 分钟 / ${
    specification.active ? "启用" : "停用"
  }`;
}

function summarizeCatalogChanges(
  type: CatalogItemType,
  existing: ExistingCatalogConfiguration,
  input: NormalizedCatalogInput,
): string[] {
  const changes: string[] = [];
  if (existing.name !== input.name) changes.push(`名称：“${existing.name}”→“${input.name}”`);
  if (existing.description !== input.description) changes.push("说明已修改");
  if (!sameMembers(existing.applicableSpecies, input.applicableSpecies)) {
    changes.push(
      `适用犬猫：${existing.applicableSpecies.join("、")}→${input.applicableSpecies.join("、")}`,
    );
  }
  if (!sameMembers(existing.requiredSkillIds, input.requiredSkillIds)) {
    changes.push(
      `技能要求：${existing.requiredSkillIds.join("、")}→${input.requiredSkillIds.join("、")}`,
    );
  }

  for (const petSize of sizeValues) {
    const before = existing.specifications.find((item) => item.petSize === petSize);
    const submitted = input.specifications.find((item) => item.petSize === petSize);
    const after = submitted ?? (before ? { ...before, active: false } : undefined);
    if (!before && after) {
      changes.push(`新增 ${petSize} 规格：${specificationSummary(after)}`);
    } else if (
      before &&
      after &&
      (before.priceCents !== after.priceCents ||
        before.durationMinutes !== after.durationMinutes ||
        before.active !== after.active)
    ) {
      changes.push(
        `${petSize} 规格：${specificationSummary(before)}→${specificationSummary(after)}`,
      );
    }
  }

  if (
    type === "primary_service" &&
    !sameMembers(existing.availableAddonIds, input.availableAddonIds)
  ) {
    changes.push(
      `关联增项：${existing.availableAddonIds.join("、") || "无"}→${input.availableAddonIds.join("、") || "无"}`,
    );
  }
  return changes.length > 0 ? changes : ["重新保存配置（内容未变化）"];
}

function referencesAddon(row: BookingReferenceRow, addonId: string): boolean {
  return (
    Array.isArray(row.addon_snapshots) &&
    row.addon_snapshots.some((addon) => isRecord(addon) && addon.id === addonId)
  );
}

function toManagerCatalog(facts: CatalogFacts): ManagerServiceCatalogResponse {
  const specificationsByItem = new Map<string, ManagerServiceSpecification[]>();
  for (const specification of facts.specifications) {
    const item = facts.items.find((candidate) => candidate.id === specification.item_id);
    const referencedByBookings = facts.bookingReferences.some(
      (booking) =>
        booking.pet_size_snapshot === specification.pet_size &&
        (item?.item_type === "primary_service"
          ? booking.primary_service_id_snapshot === item.id
          : Boolean(item && referencesAddon(booking, item.id))),
    );
    const managerSpecification: ManagerServiceSpecification = {
      id: specification.id,
      petSize: specification.pet_size,
      priceCents: specification.price_cents,
      durationMinutes: specification.duration_minutes,
      status: specification.active ? "active" : "inactive",
      referencedByBookings,
    };
    const list = specificationsByItem.get(specification.item_id) ?? [];
    list.push(managerSpecification);
    specificationsByItem.set(specification.item_id, list);
  }
  for (const specifications of specificationsByItem.values()) {
    specifications.sort((left, right) => sizeOrder[left.petSize] - sizeOrder[right.petSize]);
  }

  const primaryServices: ManagerPrimaryService[] = [];
  const addons: ManagerServiceAddon[] = [];
  for (const item of facts.items) {
    const common = {
      id: item.id,
      name: item.name,
      description: item.description,
      applicableSpecies: item.applicable_species,
      requiredSkillIds: item.required_skill_ids,
      specifications: specificationsByItem.get(item.id) ?? [],
      status: item.active ? ("active" as const) : ("inactive" as const),
      referencedByBookings: facts.bookingReferences.some((booking) =>
        item.item_type === "primary_service"
          ? booking.primary_service_id_snapshot === item.id
          : referencesAddon(booking, item.id),
      ),
      updatedAt: item.updated_at.toISOString(),
    };
    if (item.item_type === "primary_service") {
      primaryServices.push({
        ...common,
        availableAddonIds: facts.relations
          .filter((relation) => relation.primary_service_id === item.id)
          .map((relation) => relation.addon_id),
      });
    } else {
      addons.push(common);
    }
  }
  return { revision: facts.revision, primaryServices, addons };
}

function toStorefrontCatalog(manager: ManagerServiceCatalogResponse): StorefrontCatalogResponse {
  const activeAddonIds = new Set(
    manager.addons.filter((addon) => addon.status === "active").map((addon) => addon.id),
  );
  return {
    store: { ...store, demoNow: getDemoNow() },
    primaryServices: manager.primaryServices
      .filter((service) => service.status === "active")
      .map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        applicableSpecies: service.applicableSpecies,
        requiredSkillIds: service.requiredSkillIds,
        availableAddonIds: service.availableAddonIds.filter((id) => activeAddonIds.has(id)),
        specifications: service.specifications
          .filter((specification) => specification.status === "active")
          .map(({ petSize, priceCents, durationMinutes }) => ({
            petSize,
            priceCents,
            durationMinutes,
          })),
      })),
    addons: manager.addons
      .filter((addon) => addon.status === "active")
      .map((addon) => ({
        id: addon.id,
        name: addon.name,
        description: addon.description,
        applicableSpecies: addon.applicableSpecies,
        requiredSkillIds: addon.requiredSkillIds,
        specifications: addon.specifications
          .filter((specification) => specification.status === "active")
          .map(({ petSize, priceCents, durationMinutes }) => ({
            petSize,
            priceCents,
            durationMinutes,
          })),
      })),
  };
}

@Injectable()
export class ServiceCatalogService implements OnModuleInit {
  private managerCatalog: ManagerServiceCatalogResponse = {
    revision: 1,
    primaryServices: [],
    addons: [],
  };
  private storefrontCatalog: StorefrontCatalogResponse = {
    store: { ...store, demoNow: getDemoNow() },
    primaryServices: [],
    addons: [],
  };

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audits: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  getStorefront(): StorefrontCatalogResponse {
    return {
      ...this.storefrontCatalog,
      store: { ...this.storefrontCatalog.store, demoNow: getDemoNow() },
    };
  }

  async getManagerCatalog(): Promise<ManagerServiceCatalogResponse> {
    await this.refresh();
    return this.managerCatalog;
  }

  async createPrimaryService(
    manager: BackofficeIdentity,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.createItem(manager, "primary_service", body);
  }

  async createAddon(
    manager: BackofficeIdentity,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.createItem(manager, "addon", body);
  }

  async updatePrimaryService(
    manager: BackofficeIdentity,
    itemId: string,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.updateItem(manager, "primary_service", itemId, body);
  }

  async updateAddon(
    manager: BackofficeIdentity,
    itemId: string,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.updateItem(manager, "addon", itemId, body);
  }

  async deactivatePrimaryService(
    manager: BackofficeIdentity,
    itemId: string,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.deactivateItem(manager, "primary_service", itemId, body);
  }

  async deactivateAddon(
    manager: BackofficeIdentity,
    itemId: string,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    return this.deactivateItem(manager, "addon", itemId, body);
  }

  private async loadFacts(connection: Pool | PoolClient): Promise<CatalogFacts> {
    const [state, items, specifications, relations, bookingReferences] = await Promise.all([
      connection.query<{ revision: string }>(
        "SELECT revision::text AS revision FROM service_catalog_state WHERE singleton = true",
      ),
      connection.query<CatalogItemRow>(
        `
          SELECT id, item_type, name, description, applicable_species,
                 required_skill_ids, active, updated_at
          FROM service_catalog_items
          ORDER BY item_type DESC, display_order, created_at, id
        `,
      ),
      connection.query<CatalogSpecificationRow>(
        `
          SELECT id, item_id, pet_size, price_cents, duration_minutes, active, updated_at
          FROM service_catalog_specifications
          ORDER BY created_at, id
        `,
      ),
      connection.query<CatalogRelationRow>(
        `
          SELECT relation.primary_service_id, relation.addon_id
          FROM service_catalog_primary_addons AS relation
          JOIN service_catalog_items AS addon ON addon.id = relation.addon_id
          ORDER BY addon.display_order, relation.created_at, relation.addon_id
        `,
      ),
      connection.query<BookingReferenceRow>(
        `
          SELECT primary_service_id_snapshot, pet_size_snapshot, addon_snapshots
          FROM bookings
        `,
      ),
    ]);
    const revision = Number(state.rows[0]?.revision);
    if (!Number.isSafeInteger(revision)) throw new Error("服务目录版本尚未初始化。");
    return {
      revision,
      items: items.rows,
      specifications: specifications.rows,
      relations: relations.rows,
      bookingReferences: bookingReferences.rows,
    };
  }

  private async refresh(): Promise<void> {
    const facts = await this.loadFacts(this.database.pool);
    this.managerCatalog = toManagerCatalog(facts);
    this.storefrontCatalog = toStorefrontCatalog(this.managerCatalog);
  }

  private async lockRevision(client: PoolClient, expectedRevision: number): Promise<number> {
    const result = await client.query<{ revision: string }>(
      `
        SELECT revision::text AS revision
        FROM service_catalog_state
        WHERE singleton = true
        FOR UPDATE
      `,
    );
    const revision = Number(result.rows[0]?.revision);
    if (revision !== expectedRevision) {
      throw new HttpException(
        {
          code: "CATALOG_REVISION_CONFLICT",
          message: "服务目录刚刚被其他店长更新，请重新读取后再保存。",
          revision,
        },
        HttpStatus.CONFLICT,
      );
    }
    return revision;
  }

  private async requireCompatible(
    client: PoolClient,
    type: CatalogItemType,
    input: NormalizedCatalogInput,
    itemId?: string,
  ): Promise<void> {
    const activeSizes = new Set(
      input.specifications.filter((item) => item.active).map((item) => item.petSize),
    );
    if (type === "primary_service" && input.availableAddonIds.length > 0) {
      const addons = await client.query<{
        id: string;
        applicable_species: PetSpecies[];
        sizes: PetSize[];
      }>(
        `
          SELECT item.id, item.applicable_species,
                 COALESCE(array_agg(spec.pet_size ORDER BY spec.pet_size)
                   FILTER (WHERE spec.active), '{}') AS sizes
          FROM service_catalog_items AS item
          LEFT JOIN service_catalog_specifications AS spec ON spec.item_id = item.id
          WHERE item.item_type = 'addon' AND item.active = true AND item.id = ANY($1::text[])
          GROUP BY item.id
        `,
        [input.availableAddonIds],
      );
      if (addons.rows.length !== input.availableAddonIds.length) {
        validationError({ availableAddonIds: "关联增项不存在或已经停用。" });
      }
      const incompatible = addons.rows.find(
        (addon) =>
          input.applicableSpecies.some((species) => !addon.applicable_species.includes(species)) ||
          [...activeSizes].some((size) => !addon.sizes.includes(size)),
      );
      if (incompatible) {
        validationError({
          availableAddonIds: "关联增项必须覆盖主要服务的全部适用犬猫和启用体型。",
        });
      }
    }

    if (type === "addon" && itemId) {
      const primaries = await client.query<{
        name: string;
        applicable_species: PetSpecies[];
        sizes: PetSize[];
      }>(
        `
          SELECT item.name, item.applicable_species,
                 COALESCE(array_agg(spec.pet_size ORDER BY spec.pet_size)
                   FILTER (WHERE spec.active), '{}') AS sizes
          FROM service_catalog_primary_addons AS relation
          JOIN service_catalog_items AS item ON item.id = relation.primary_service_id
          LEFT JOIN service_catalog_specifications AS spec ON spec.item_id = item.id
          WHERE relation.addon_id = $1 AND item.active = true
          GROUP BY item.id
        `,
        [itemId],
      );
      const incompatible = primaries.rows.find(
        (primary) =>
          primary.applicable_species.some(
            (species) => !input.applicableSpecies.includes(species),
          ) || primary.sizes.some((size) => !activeSizes.has(size)),
      );
      if (incompatible) {
        validationError({
          applicableSpecies: `当前配置与已关联的“${incompatible.name}”不兼容，请先调整关联。`,
        });
      }
    }
  }

  private async replaceSpecifications(
    client: PoolClient,
    itemId: string,
    specifications: NormalizedSpecification[],
  ): Promise<void> {
    await client.query(
      "UPDATE service_catalog_specifications SET active = false, updated_at = now() WHERE item_id = $1",
      [itemId],
    );
    for (const specification of specifications) {
      await client.query(
        `
          INSERT INTO service_catalog_specifications (
            id, item_id, pet_size, price_cents, duration_minutes, active
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (item_id, pet_size) DO UPDATE
          SET price_cents = excluded.price_cents,
              duration_minutes = excluded.duration_minutes,
              active = excluded.active,
              updated_at = now()
        `,
        [
          `service-specification-${randomUUID()}`,
          itemId,
          specification.petSize,
          specification.priceCents,
          specification.durationMinutes,
          specification.active,
        ],
      );
    }
  }

  private async replaceAddonRelations(
    client: PoolClient,
    primaryServiceId: string,
    addonIds: string[],
  ): Promise<void> {
    await client.query("DELETE FROM service_catalog_primary_addons WHERE primary_service_id = $1", [
      primaryServiceId,
    ]);
    for (const addonId of addonIds) {
      await client.query(
        `
          INSERT INTO service_catalog_primary_addons (primary_service_id, addon_id)
          VALUES ($1, $2)
        `,
        [primaryServiceId, addonId],
      );
    }
  }

  private async advanceRevision(client: PoolClient): Promise<number> {
    const result = await client.query<{ revision: string }>(
      `
        UPDATE service_catalog_state
        SET revision = revision + 1, updated_at = now()
        WHERE singleton = true
        RETURNING revision::text AS revision
      `,
    );
    return Number(result.rows[0]?.revision);
  }

  private async createItem(
    manager: BackofficeIdentity,
    type: CatalogItemType,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    const input = normalizeInput(type, body);
    const client = await this.database.pool.connect();
    const itemId = `${type === "primary_service" ? "primary-service" : "addon"}-${randomUUID()}`;
    try {
      await client.query("BEGIN");
      await this.lockRevision(client, input.expectedRevision);
      await this.requireCompatible(client, type, input);
      await client.query(
        `
          INSERT INTO service_catalog_items (
            id, item_type, name, description, applicable_species, required_skill_ids, display_order
          )
          SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(display_order), 0) + 10
          FROM service_catalog_items
          WHERE item_type = $2
        `,
        [
          itemId,
          type,
          input.name,
          input.description,
          input.applicableSpecies,
          input.requiredSkillIds,
        ],
      );
      await this.replaceSpecifications(client, itemId, input.specifications);
      if (type === "primary_service") {
        await this.replaceAddonRelations(client, itemId, input.availableAddonIds);
      }
      const revision = await this.advanceRevision(client);
      await this.audits.append(
        {
          eventType: "service_catalog_created",
          actor: { type: "manager", id: manager.id },
          subject: { type, id: itemId },
          payload: {
            objectName: input.name,
            changes: [
              `创建${type === "primary_service" ? "主要服务" : "增项"}“${input.name}”`,
              `适用犬猫：${input.applicableSpecies.join("、")}`,
              `技能要求：${input.requiredSkillIds.join("、")}`,
              ...input.specifications.map(
                (specification) =>
                  `${specification.petSize} 规格：${specificationSummary(specification)}`,
              ),
              ...(type === "primary_service"
                ? [`关联增项：${input.availableAddonIds.join("、") || "无"}`]
                : []),
            ],
            catalogRevision: revision,
          },
          occurredAt: getDemoNow(),
        },
        client,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.refresh();
    return this.managerCatalog;
  }

  private async updateItem(
    manager: BackofficeIdentity,
    type: CatalogItemType,
    itemId: string,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    const input = normalizeInput(type, body);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockRevision(client, input.expectedRevision);
      const existing = await client.query<{
        name: string;
        description: string;
        applicable_species: PetSpecies[];
        required_skill_ids: StaffSkillId[];
      }>(
        `
          SELECT name, description, applicable_species, required_skill_ids
          FROM service_catalog_items
          WHERE id = $1 AND item_type = $2
          FOR UPDATE
        `,
        [itemId, type],
      );
      const existingItem = existing.rows[0];
      if (!existingItem) {
        throw new HttpException(
          { code: "CATALOG_ITEM_NOT_FOUND", message: "找不到这项服务配置。" },
          HttpStatus.NOT_FOUND,
        );
      }
      const [existingSpecifications, existingRelations] = await Promise.all([
        client.query<{
          pet_size: PetSize;
          price_cents: number;
          duration_minutes: number;
          active: boolean;
        }>(
          `
            SELECT pet_size, price_cents, duration_minutes, active
            FROM service_catalog_specifications
            WHERE item_id = $1
          `,
          [itemId],
        ),
        type === "primary_service"
          ? client.query<{ addon_id: string }>(
              `
                SELECT addon_id
                FROM service_catalog_primary_addons
                WHERE primary_service_id = $1
              `,
              [itemId],
            )
          : Promise.resolve({ rows: [] as Array<{ addon_id: string }> }),
      ]);
      const changes = summarizeCatalogChanges(
        type,
        {
          name: existingItem.name,
          description: existingItem.description,
          applicableSpecies: existingItem.applicable_species,
          requiredSkillIds: existingItem.required_skill_ids,
          availableAddonIds: existingRelations.rows.map((row) => row.addon_id),
          specifications: existingSpecifications.rows.map((row) => ({
            petSize: row.pet_size,
            priceCents: row.price_cents,
            durationMinutes: row.duration_minutes,
            active: row.active,
          })),
        },
        input,
      );
      await this.requireCompatible(client, type, input, itemId);
      await client.query(
        `
          UPDATE service_catalog_items
          SET name = $3, description = $4, applicable_species = $5,
              required_skill_ids = $6, updated_at = now()
          WHERE id = $1 AND item_type = $2
        `,
        [
          itemId,
          type,
          input.name,
          input.description,
          input.applicableSpecies,
          input.requiredSkillIds,
        ],
      );
      await this.replaceSpecifications(client, itemId, input.specifications);
      if (type === "primary_service") {
        await this.replaceAddonRelations(client, itemId, input.availableAddonIds);
      }
      const revision = await this.advanceRevision(client);
      await this.audits.append(
        {
          eventType: "service_catalog_updated",
          actor: { type: "manager", id: manager.id },
          subject: { type, id: itemId },
          payload: {
            objectName: input.name,
            previousName: existingItem.name,
            changes,
            catalogRevision: revision,
          },
          occurredAt: getDemoNow(),
        },
        client,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.refresh();
    return this.managerCatalog;
  }

  private async deactivateItem(
    manager: BackofficeIdentity,
    type: CatalogItemType,
    itemId: string,
    body: unknown,
  ): Promise<ManagerServiceCatalogResponse> {
    if (!isRecord(body) || !Number.isSafeInteger(body.expectedRevision)) {
      validationError({ expectedRevision: "请基于当前目录版本停用。" });
    }
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockRevision(client, body.expectedRevision as number);
      const existing = await client.query<{ name: string; active: boolean }>(
        `
          SELECT name, active
          FROM service_catalog_items
          WHERE id = $1 AND item_type = $2
          FOR UPDATE
        `,
        [itemId, type],
      );
      const item = existing.rows[0];
      if (!item) {
        throw new HttpException(
          { code: "CATALOG_ITEM_NOT_FOUND", message: "找不到这项服务配置。" },
          HttpStatus.NOT_FOUND,
        );
      }
      if (item.active) {
        await client.query(
          "UPDATE service_catalog_items SET active = false, updated_at = now() WHERE id = $1",
          [itemId],
        );
        const revision = await this.advanceRevision(client);
        await this.audits.append(
          {
            eventType: "service_catalog_deactivated",
            actor: { type: "manager", id: manager.id },
            subject: { type, id: itemId },
            payload: {
              objectName: item.name,
              changes: [
                `停用${type === "primary_service" ? "主要服务" : "增项"}“${item.name}”`,
                "新预约不再展示，历史预约继续使用快照",
              ],
              catalogRevision: revision,
            },
            occurredAt: getDemoNow(),
          },
          client,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.refresh();
    return this.managerCatalog;
  }
}
