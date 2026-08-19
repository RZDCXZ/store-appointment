import { randomUUID } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type {
  AuditActionType,
  AuditActorFilterValue,
  AuditActorType,
  AuditSubjectType,
  ManagerAuditListResponse,
  ManagerAuditRecord,
} from "@rongguang/contracts";
import type { Pool, PoolClient } from "pg";

import { DatabaseService } from "../database/database.service.js";

export interface AppendAuditFact {
  eventType: AuditActionType;
  actor: {
    type: AuditActorType;
    id: string;
  };
  subject: {
    type: AuditSubjectType;
    id: string;
  };
  payload: Record<string, unknown>;
  occurredAt: string;
}

interface AuditRow {
  id: string;
  event_type: AuditActionType;
  actor_type: AuditActorType;
  actor_id: string;
  actor_label: string;
  subject_type: AuditSubjectType;
  subject_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

const auditActionLabels: Record<AuditActionType, string> = {
  booking_created: "创建预约",
  customer_booking_cancelled: "顾客取消",
  customer_booking_rescheduled: "顾客改期",
  customer_phone_revealed: "揭示完整手机号",
  manager_booking_cancelled: "店长取消",
  manager_booking_rescheduled: "店长改期",
  manager_booking_content_corrected: "纠正预约内容",
  booking_checked_in: "到店核销",
  booking_late_checked_in: "迟到核销",
  booking_completed: "完成服务",
  booking_no_show: "标记爽约",
  booking_terminated: "终止服务",
  service_catalog_created: "创建服务配置",
  service_catalog_updated: "更新服务配置",
  service_catalog_deactivated: "停用服务配置",
  staff_account_created: "创建员工账号",
  staff_skills_updated: "更新员工技能",
  staff_account_deactivated: "停用员工账号",
  schedule_template_updated: "更新排班模板",
  schedule_drafts_generated: "生成排班草稿",
  schedule_draft_updated: "更新排班草稿",
  schedule_published: "发布排班",
  schedule_exception_updated: "更新日期例外",
  capacity_change_created: "创建容量变化",
  capacity_change_status_changed: "更新容量变化状态",
  capacity_change_booking_resolved: "确认影响处理",
  capacity_change_revoked: "撤销容量变化",
  notification_manual_retry_requested: "人工重试通知",
  data_exported: "导出数据",
  customer_data_anonymized: "匿名化顾客资料",
  demo_time_advanced: "推进演示时间",
  demo_data_reset: "重置演示数据",
};

const auditSubjectLabels: Record<AuditSubjectType, string> = {
  booking: "预约",
  primary_service: "主要服务",
  addon: "增项",
  staff: "员工",
  schedule_template: "排班模板",
  schedule_draft: "排班草稿",
  published_schedule: "已发布排班",
  staff_time_off: "停班",
  store_closure: "临时闭店",
  notification: "通知",
  store: "门店",
  customer: "顾客",
};

const auditActorTypes = new Set<AuditActorType>(["customer", "staff", "manager", "system"]);
const auditActionTypes = new Set<AuditActionType>(
  Object.keys(auditActionLabels) as AuditActionType[],
);
const auditSubjectTypes = new Set<AuditSubjectType>(
  Object.keys(auditSubjectLabels) as AuditSubjectType[],
);
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const auditActorLabelSql = `CASE
  WHEN audit.actor_type = 'manager' THEN
    COALESCE(actor_account.display_name, audit.actor_id) || ' · 店长'
  WHEN audit.actor_type = 'staff' THEN
    COALESCE(actor_account.display_name, audit.actor_id) || ' · 员工'
  WHEN audit.actor_type = 'customer' THEN
    COALESCE(actor_customer.display_name, '已匿名顾客') || ' · 顾客'
  ELSE '系统'
END`;

const auditActorJoinsSql = `LEFT JOIN backoffice_accounts AS actor_account
  ON audit.actor_type IN ('manager', 'staff') AND actor_account.id = audit.actor_id
LEFT JOIN customers AS actor_customer
  ON audit.actor_type = 'customer' AND actor_customer.id = audit.actor_id`;

function invalidFilter(message: string): never {
  throw new HttpException({ code: "INVALID_AUDIT_FILTER", message }, HttpStatus.BAD_REQUEST);
}

function validLocalDate(value: string | undefined, label: string): string | null {
  if (!value) return null;
  const match = localDatePattern.exec(value);
  if (!match) invalidFilter(`${label}必须是有效的上海日期。`);
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    invalidFilter(`${label}必须是有效的上海日期。`);
  }
  return value;
}

function nextLocalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function positivePage(value: string | undefined): number {
  if (!value) return 1;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100_000) {
    invalidFilter("页码必须是正整数。");
  }
  return Number(value);
}

interface AuditListInput {
  actor?: string;
  action?: string;
  subjectType?: string;
  subjectId?: string;
  from?: string;
  to?: string;
  page?: string;
}

function parseActorFilter(value: string | null): {
  value: AuditActorFilterValue;
  type: AuditActorType;
  id: string;
} | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  const type = value.slice(0, separator) as AuditActorType;
  const id = value.slice(separator + 1);
  if (separator < 1 || !auditActorTypes.has(type) || id.length === 0) {
    invalidFilter("操作者筛选无效。");
  }
  return { value: value as AuditActorFilterValue, type, id };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length <= 100 ? value : null;
}

function numberValue(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayLength(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return Array.isArray(value) ? value.length : null;
}

function catalogSummary(
  payload: Record<string, unknown>,
  fallback: "服务配置已创建" | "服务配置已更新" | "服务配置已停用",
): string {
  const revision = numberValue(payload, "catalogRevision");
  return revision === null ? fallback : `${fallback}；版本 ${revision}`;
}

function localDateValue(payload: Record<string, unknown>, key: string): string | null {
  const value = stringValue(payload, key);
  return value && localDatePattern.test(value) ? value : null;
}

function bookingTransition(payload: Record<string, unknown>, fallback: string): string {
  const labels: Record<string, string> = {
    confirmed: "已确认",
    checked_in: "已到店",
    completed: "已完成",
    no_show: "已爽约",
    terminated: "已终止",
    cancelled: "已取消",
  };
  const previous = stringValue(payload, "previousStatus");
  const next = stringValue(payload, "status");
  return previous && next && labels[previous] && labels[next]
    ? `${labels[previous]} → ${labels[next]}`
    : fallback;
}

function exportSummary(payload: Record<string, unknown>): string {
  const exportLabels: Record<string, string> = {
    bookings_csv: "预约 CSV",
    customers_pets_json: "顾客与宠物 JSON",
    customer_data_json: "顾客资料 JSON",
    business_metrics_csv: "经营数据 CSV",
  };
  const exportType = stringValue(payload, "exportType");
  const label = exportType ? exportLabels[exportType] : null;
  const count = numberValue(payload, "recordCount") ?? numberValue(payload, "rowCount");
  if (label && count !== null) return `导出${label}；共 ${count} 条`;
  if (label) return `导出${label}`;
  const petCount = numberValue(payload, "petCount");
  const bookingCount = numberValue(payload, "bookingCount");
  const messageCount = numberValue(payload, "messageCount");
  if (petCount !== null && bookingCount !== null && messageCount !== null) {
    return `导出顾客资料；宠物 ${petCount}、预约 ${bookingCount}、消息 ${messageCount} 条`;
  }
  return "结构化数据已导出";
}

function rescheduleSummary(payload: Record<string, unknown>): string {
  const previous = objectValue(payload.previous);
  const next = objectValue(payload.next);
  const previousStart = previous ? stringValue(previous, "startsAt") : null;
  const nextStart = next ? stringValue(next, "startsAt") : null;
  if (
    previousStart &&
    nextStart &&
    instantPattern.test(previousStart) &&
    instantPattern.test(nextStart) &&
    previousStart !== nextStart
  ) {
    return `预约时间：${previousStart} → ${nextStart}`;
  }
  const previousStaff = previous ? stringValue(previous, "staffId") : null;
  const nextStaff = next ? stringValue(next, "staffId") : null;
  if (previousStaff && nextStaff && previousStaff !== nextStaff) {
    return `分配员工：${previousStaff} → ${nextStaff}`;
  }
  return "预约时间或分配员工已变更";
}

function correctionChanges(payload: Record<string, unknown>): string[] {
  const previous = objectValue(payload.previous);
  const next = objectValue(payload.next);
  if (!previous || !next) return ["服务内容、时长或标价已纠正"];
  const changes: string[] = [];
  const previousService = objectValue(previous.primaryService);
  const nextService = objectValue(next.primaryService);
  const previousServiceId = previousService ? stringValue(previousService, "id") : null;
  const nextServiceId = nextService ? stringValue(nextService, "id") : null;
  if (previousServiceId && nextServiceId && previousServiceId !== nextServiceId) {
    changes.push(`主要服务：${previousServiceId} → ${nextServiceId}`);
  }
  const previousDuration = numberValue(previous, "serviceDurationMinutes");
  const nextDuration = numberValue(next, "serviceDurationMinutes");
  if (previousDuration !== null && nextDuration !== null && previousDuration !== nextDuration) {
    changes.push(`服务时长：${previousDuration} → ${nextDuration} 分钟`);
  }
  const previousPrice = numberValue(previous, "totalPriceCents");
  const nextPrice = numberValue(next, "totalPriceCents");
  if (previousPrice !== null && nextPrice !== null && previousPrice !== nextPrice) {
    changes.push(`总标价：¥${(previousPrice / 100).toFixed(2)} → ¥${(nextPrice / 100).toFixed(2)}`);
  }
  return changes.length > 0 ? changes : ["服务内容已复核，审计快照已更新"];
}

function auditChanges(row: AuditRow): string[] {
  const payload = row.payload;
  switch (row.event_type) {
    case "customer_phone_revealed":
      return ["敏感资料已受控揭示"];
    case "booking_created":
      return ["预约已确认并分配员工"];
    case "customer_booking_cancelled":
    case "manager_booking_cancelled":
      return [bookingTransition({ status: "cancelled", ...payload }, "已确认 → 已取消")];
    case "customer_booking_rescheduled":
    case "manager_booking_rescheduled":
      return [rescheduleSummary(payload)];
    case "manager_booking_content_corrected":
      return correctionChanges(payload);
    case "booking_checked_in":
      return [bookingTransition(payload, "已确认 → 已到店")];
    case "booking_late_checked_in":
      return [bookingTransition(payload, "迟到处理 → 已到店")];
    case "booking_completed":
      return [bookingTransition(payload, "已到店 → 已完成")];
    case "booking_no_show":
      return [bookingTransition(payload, "已确认 → 已爽约")];
    case "booking_terminated":
      return [bookingTransition(payload, "已到店 → 已终止")];
    case "service_catalog_created":
      return [catalogSummary(payload, "服务配置已创建")];
    case "service_catalog_updated":
      return [catalogSummary(payload, "服务配置已更新")];
    case "service_catalog_deactivated":
      return [catalogSummary(payload, "服务配置已停用")];
    case "staff_account_created":
      return [`员工账号已创建；初始技能 ${arrayLength(payload, "skillIds") ?? 0} 项`];
    case "staff_skills_updated":
      return [
        `员工技能已更新；新增 ${arrayLength(payload, "addedSkillIds") ?? 0} 项，移除 ${arrayLength(payload, "removedSkillIds") ?? 0} 项`,
      ];
    case "staff_account_deactivated":
      return [`员工账号已停用；失效会话 ${numberValue(payload, "revokedSessionCount") ?? 0} 个`];
    case "schedule_template_updated":
      return [
        `周${numberValue(payload, "weekday") ?? "?"}模板已更新；${arrayLength(payload, "shifts") ?? 0} 个班次`,
      ];
    case "schedule_drafts_generated":
      return [
        `已生成 ${numberValue(payload, "dayCount") ?? 0} 天草稿；覆盖 ${numberValue(payload, "staffCount") ?? 0} 名员工`,
      ];
    case "schedule_draft_updated":
      return [`${localDateValue(payload, "date") ?? "指定日期"}排班草稿已更新`];
    case "schedule_published":
      return [`排班草稿已发布；${numberValue(payload, "publishedCount") ?? 0} 个员工日`];
    case "schedule_exception_updated":
      return [`${localDateValue(payload, "date") ?? "指定日期"}的已发布排班例外已更新`];
    case "capacity_change_created":
      return [`容量变化已创建；影响 ${numberValue(payload, "affectedBookingCount") ?? 0} 笔预约`];
    case "capacity_change_status_changed": {
      const labels: Record<string, string> = {
        pending: "待处理",
        active: "已生效",
        cancelled: "已撤销",
      };
      const previous = stringValue(payload, "previousStatus");
      const next = stringValue(payload, "status");
      return [
        `容量变化状态：${(previous && labels[previous]) || "新建"} → ${(next && labels[next]) || "已更新"}`,
      ];
    }
    case "capacity_change_booking_resolved": {
      const labels: Record<string, string> = {
        change_staff: "更换员工",
        reschedule: "预约改期",
        cancel: "取消预约",
        acknowledge_existing: "确认既有处理",
      };
      const action = stringValue(payload, "action");
      return [`受影响预约处理：${(action && labels[action]) || "已确认"}`];
    }
    case "capacity_change_revoked":
      return ["容量变化已撤销"];
    case "notification_manual_retry_requested":
      return [
        `最终失败通知已进入人工重试；此前尝试 ${numberValue(payload, "attemptCount") ?? 0} 次`,
      ];
    case "data_exported":
      return [exportSummary(payload)];
    case "customer_data_anonymized":
      return ["可识别资料已匿名化，经营事实继续保留"];
    case "demo_time_advanced":
      return [`演示时间推进 ${numberValue(payload, "minutes") ?? 0} 分钟并重新计算到期任务`];
    case "demo_data_reset":
      return ["演示数据库已重建，旧会话已失效"];
  }
}

@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async append(
    fact: AppendAuditFact,
    connection: Pool | PoolClient = this.database.pool,
  ): Promise<void> {
    await connection.query(
      `
        INSERT INTO audit_events (
          id, event_type, actor_type, actor_id,
          subject_type, subject_id, payload, occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `,
      [
        `audit-${randomUUID()}`,
        fact.eventType,
        fact.actor.type,
        fact.actor.id,
        fact.subject.type,
        fact.subject.id,
        JSON.stringify(fact.payload),
        fact.occurredAt,
      ],
    );
  }

  async list(input: AuditListInput): Promise<ManagerAuditListResponse> {
    const actor = parseActorFilter(input.actor?.trim() || null);
    const action = input.action?.trim() || null;
    const subjectType = input.subjectType?.trim() || null;
    const subjectId = input.subjectId?.trim() || null;
    const from = validLocalDate(input.from?.trim(), "开始日期");
    const to = validLocalDate(input.to?.trim(), "结束日期");
    const page = positivePage(input.page?.trim());
    const pageSize = 20;
    if (from && to && from > to) invalidFilter("结束日期不能早于开始日期。");
    if (action && !auditActionTypes.has(action as AuditActionType)) {
      invalidFilter("动作类型无效。");
    }
    if (subjectType && !auditSubjectTypes.has(subjectType as AuditSubjectType)) {
      invalidFilter("对象类型无效。");
    }
    const values: unknown[] = [];
    const where: string[] = [];
    if (actor) {
      values.push(actor.type, actor.id);
      where.push(`audit.actor_type = $${values.length - 1} AND audit.actor_id = $${values.length}`);
    }
    if (action) {
      values.push(action);
      where.push(`audit.event_type = $${values.length}`);
    }
    if (subjectType) {
      values.push(subjectType);
      where.push(`audit.subject_type = $${values.length}`);
    }
    if (subjectId) {
      values.push(subjectId);
      where.push(`audit.subject_id = $${values.length}`);
    }
    if (from) {
      values.push(`${from}T00:00:00+08:00`);
      where.push(`audit.occurred_at >= $${values.length}::timestamptz`);
    }
    if (to) {
      values.push(`${nextLocalDate(to)}T00:00:00+08:00`);
      where.push(`audit.occurred_at < $${values.length}::timestamptz`);
    }
    const predicate = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const totalResult = await this.database.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM effective_audit_events AS audit ${predicate}`,
      values,
    );
    const result = await this.database.pool.query<AuditRow>(
      `SELECT audit.id,
              audit.event_type,
              audit.actor_type,
              audit.actor_id,
              ${auditActorLabelSql} AS actor_label,
              audit.subject_type,
              audit.subject_id,
              audit.payload,
              audit.occurred_at
       FROM effective_audit_events AS audit
       ${auditActorJoinsSql}
       ${predicate}
       ORDER BY audit.occurred_at DESC, audit.id DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      values,
    );
    const actorOptions = await this.database.pool.query<{
      value: AuditActorFilterValue;
      label: string;
    }>(
      `SELECT DISTINCT actor_type || ':' || actor_id AS value,
              ${auditActorLabelSql} AS label
       FROM effective_audit_events AS audit
       ${auditActorJoinsSql}
       ORDER BY label, value`,
    );
    const records: ManagerAuditRecord[] = result.rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      actor: { type: row.actor_type, id: row.actor_id, label: row.actor_label },
      action: { type: row.event_type, label: auditActionLabels[row.event_type] },
      subject: {
        type: row.subject_type,
        id: row.subject_id,
        label: `${auditSubjectLabels[row.subject_type]} ${row.subject_id}`,
      },
      changes: auditChanges(row),
    }));
    const totalItems = totalResult.rows[0]?.count ?? 0;

    return {
      appliedFilters: {
        actor: actor?.value ?? null,
        action: action as AuditActionType | null,
        subjectType: subjectType as AuditSubjectType | null,
        subjectId,
        from,
        to,
        page,
      },
      filterOptions: {
        actors: actorOptions.rows,
        actions: Object.entries(auditActionLabels).map(([value, label]) => ({
          value: value as AuditActionType,
          label,
        })),
        subjectTypes: Object.entries(auditSubjectLabels).map(([value, label]) => ({
          value: value as AuditSubjectType,
          label,
        })),
      },
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
      records,
    };
  }

  async redactCustomer(
    customerId: string,
    redactedAt: string,
    connection: Pool | PoolClient = this.database.pool,
  ): Promise<void> {
    await connection.query(
      `INSERT INTO audit_event_redactions (
         audit_event_id, actor_id, payload, redacted_at, reason
       )
       SELECT audit.id,
              CASE
                WHEN audit.actor_type = 'customer' THEN 'anonymized-customer'
                ELSE audit.actor_id
              END,
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      CASE
                        WHEN audit.payload ? 'reason' THEN jsonb_set(
                          audit.payload,
                          '{reason}',
                          to_jsonb('[原原因已匿名化]'::text),
                          false
                        )
                        ELSE audit.payload
                      END - 'customerPhone' - 'phone' - 'customer' - 'serviceRecord',
                      '{customerName}',
                      to_jsonb('已匿名顾客'::text),
                      false
                    ),
                    '{petName}',
                    to_jsonb('已匿名宠物'::text),
                    false
                  ),
                  '{previous,pet,name}',
                  to_jsonb('已匿名宠物'::text),
                  false
                ),
                '{next,pet,name}',
                to_jsonb('已匿名宠物'::text),
                false
              ),
              $2::timestamptz,
              'customer_data_anonymized'
       FROM audit_events AS audit
       WHERE (
         audit.actor_id = $1
         OR (audit.subject_type = 'customer' AND audit.subject_id = $1)
         OR EXISTS (
           SELECT 1
           FROM bookings AS booking
           WHERE booking.customer_id = $1
             AND (
               (audit.subject_type = 'booking' AND audit.subject_id = booking.id)
               OR audit.payload ->> 'bookingId' = booking.id
             )
         )
       )
       ON CONFLICT (audit_event_id) DO NOTHING`,
      [customerId, redactedAt],
    );
  }
}
