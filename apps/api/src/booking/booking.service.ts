import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { quoteBookingSelection } from "@rongguang/contracts";
import type {
  BookingDetailResponse,
  BookingAvailabilityResponse,
  BookingConflictSuggestion,
  BookingVerificationWindow,
  BookingSelectionLine,
  BookingSelectionQuote,
  CancelBookingInput,
  CancelBookingResponse,
  CapacityChangeAffectedBooking,
  CapacityChangeKind,
  CapacityChangeResolution,
  CapacityChangeStatus,
  ConfirmedBooking,
  CreateBookingInput,
  CreateBookingResponse,
  CustomerBookingActions,
  CustomerBookingChange,
  CustomerBookingSchedule,
  CustomerBookingHistoryResponse,
  CustomerMessage,
  CustomerMessageDetailResponse,
  CustomerMessageKind,
  CustomerMessagesResponse,
  ManagerCancelBookingInput,
  ManagerBookingChange,
  ManagerBookingChangeResponse,
  ManagerBookingContentCorrectionInput,
  ManagerBookingContentCorrectionResponse,
  ManagerBookingCorrectionDraft,
  ManagerBookingCorrectionOptionsResponse,
  ManagerBookingCorrectionPreviewResponse,
  ManagerOfflineConsentSource,
  ManagerProxyBookingResponse,
  ManagerRescheduleBookingOptionsResponse,
  ManagerRescheduleBookingInput,
  PetSize,
  RescheduleBookingOptionsResponse,
  RescheduleBookingInput,
  RescheduleBookingResponse,
  ResolveCapacityChangeBookingInput,
  ResolveCapacityChangeBookingResponse,
  StaffSkillId,
} from "@rongguang/contracts";
import type { PoolClient } from "pg";

import {
  bookingWindowFor,
  earliestCustomerCandidate,
  earliestManagerCandidate,
} from "../booking-availability/availability.js";
import { BookingAvailabilityService } from "../booking-availability/booking-availability.service.js";
import { getBookingCodeSecret, getDemoNow } from "../config/environment.js";
import { DatabaseService } from "../database/database.service.js";
import { getShanghaiLocalDate } from "../schedule/schedule-date.js";
import { ServiceCatalogService } from "../service-catalog/service-catalog.service.js";
import type { BackofficeIdentity } from "../auth/auth.types.js";
import { managerBookingActions } from "./manager-booking-actions.js";

interface PetRow {
  id: string;
  name: string;
  species: "dog" | "cat";
  weight_kg: string;
  archived_at: Date | null;
}

interface StaffRow {
  id: string;
  display_name: string;
  skills: StaffSkillId[];
}

interface BookingRow {
  id: string;
  customer_id: string;
  pet_id: string;
  staff_id: string;
  status: ConfirmedBooking["status"];
  starts_at: Date;
  ends_at: Date;
  occupancy_ends_at: Date | null;
  service_duration_minutes: number;
  pet_name_snapshot: string;
  pet_species_snapshot: "dog" | "cat";
  pet_weight_kg_snapshot: string;
  pet_size_snapshot: PetSize;
  primary_service_id_snapshot: string;
  primary_service_name_snapshot: string;
  primary_service_price_cents: number;
  primary_service_duration_minutes: number;
  addon_snapshots: BookingSelectionLine[];
  required_skill_ids_snapshot: StaffSkillId[];
  total_price_cents: number;
  staff_display_name_snapshot: string;
  turnover_minutes: number;
  original_starts_at: Date;
  original_ends_at: Date;
  original_occupancy_starts_at: Date;
  original_occupancy_ends_at: Date;
  verification_code_digest: string;
  verification_code_seed: string;
  verification_code_version: number;
  completed_at: Date | null;
  created_at: Date;
}

interface CustomerMessageRow {
  id: string;
  notification_type: CustomerMessageKind;
  booking_id: string;
  created_at: Date;
  pet_name_snapshot: string;
  primary_service_name_snapshot: string;
  staff_display_name_snapshot: string;
  starts_at: Date;
  payload: {
    petName?: string;
    serviceName?: string;
    staffName?: string;
    startsAt?: string;
    previous?: CustomerBookingSchedule;
    next?: CustomerBookingSchedule | null;
  };
}

interface IdempotencyRow {
  request_digest: string;
  booking_id: string | null;
  response_status: number | null;
  response_body: unknown | null;
}

interface ManagerChangeIdempotencyRow {
  request_digest: string;
  booking_id: string | null;
  response_status: number;
  response_body: unknown;
}

interface ManagerProxyIdempotencyRow {
  request_digest: string;
  booking_id: string | null;
  customer_id: string | null;
  response_status: number;
  response_body: unknown;
  privacy_notice_version: string | null;
  offline_consent_source: ManagerOfflineConsentSource | null;
  manager_display_name: string | null;
  created_at: Date | null;
}

interface StoredManagerProxySuccess {
  kind: "manager_proxy_booking_success";
  booking: ManagerProxyBookingResponse["booking"];
  verificationWindow: ManagerProxyBookingResponse["verificationWindow"];
  proxyRecord: ManagerProxyBookingResponse["proxyRecord"];
}

type ManagerProxyProfile =
  | { kind: "existing"; customerId: string; petId: string }
  | {
      kind: "new";
      customer: { displayName: string; phone: string };
      pet: { name: string; species: "dog" | "cat"; weightKg: number };
    };

interface ParsedManagerProxyInput {
  idempotencyKey: string;
  profile: ManagerProxyProfile;
  primaryServiceId: string;
  addonIds: string[];
  staffId: string;
  startsAt: string;
  offlineConsentSource: ManagerOfflineConsentSource;
}

interface StoredRescheduleSuccess {
  kind: "customer_reschedule_success";
  booking: RescheduleBookingResponse["booking"];
  verificationWindow: RescheduleBookingResponse["verificationWindow"];
  customerActions: RescheduleBookingResponse["customerActions"];
  changeHistory: RescheduleBookingResponse["changeHistory"];
  verificationCodeVersion: number;
}

interface BookingChangeRow {
  id: string;
  event_type: "booking_cancelled" | "booking_rescheduled";
  actor_type: "customer" | "manager";
  actor_id: string;
  payload: {
    reason: string;
    previous: CustomerBookingSchedule;
    next: CustomerBookingSchedule | null;
  };
  occurred_at: Date;
}

interface BookingConflictBody {
  code: "BOOKING_TIME_CONFLICT";
  message: string;
  nextStep: "conflict";
  suggestions: BookingConflictSuggestion[];
}

interface RescheduleConflictBody extends BookingConflictBody {
  booking: ConfirmedBooking;
  requested: {
    staffId: string;
    startsAt: string;
  };
}

interface AppliedReschedule {
  booking: BookingRow;
  verificationCode: string;
  verificationCodeVersion: number;
  eventId: string;
  occurredAt: string;
  previous: CustomerBookingSchedule;
  next: CustomerBookingSchedule;
}

interface AppliedCancellation {
  booking: BookingRow;
  eventId: string;
  occurredAt: string;
  previous: CustomerBookingSchedule;
}

interface AppliedContentCorrection {
  booking: BookingRow;
  eventId: string;
  occurredAt: string;
  previous: BookingSelectionQuote;
  next: BookingSelectionQuote;
}

interface CapacityChangeMutationRow {
  status: CapacityChangeStatus;
  affected_booking_count: number;
  impact_snapshot: CapacityChangeAffectedBooking[];
  staff_id: string | null;
  interval_starts_at: Date;
  interval_ends_at: Date;
}

interface CapacityChangeResolutionReplayRow {
  request_digest: string;
  response_body: ResolveCapacityChangeBookingResponse | null;
}

export interface AppliedCapacityChangeResolution {
  response: ResolveCapacityChangeBookingResponse;
}

interface DatabaseError {
  code?: string;
  constraint?: string;
}

const idPattern = /^[a-z0-9][a-z0-9-]{1,79}$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function businessError(code: string, message: string, status: HttpStatus, details = {}): never {
  throw new HttpException({ code, message, ...details }, status);
}

function isStoredRescheduleSuccess(value: unknown): value is StoredRescheduleSuccess {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredRescheduleSuccess>;
  return (
    candidate.kind === "customer_reschedule_success" &&
    typeof candidate.verificationCodeVersion === "number" &&
    Boolean(candidate.booking) &&
    Boolean(candidate.verificationWindow) &&
    Boolean(candidate.customerActions) &&
    Array.isArray(candidate.changeHistory)
  );
}

function validationError(fieldErrors: Record<string, string>): never {
  businessError("VALIDATION_ERROR", "预约草稿无效，请检查后重试。", HttpStatus.BAD_REQUEST, {
    fieldErrors,
  });
}

function parseCreateInput(body: unknown): CreateBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};

  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  for (const key of ["petId", "primaryServiceId", "staffId"] as const) {
    if (typeof input[key] !== "string" || !idPattern.test(input[key])) {
      fieldErrors[key] = "请选择有效值。";
    }
  }
  if (
    !Array.isArray(input.addonIds) ||
    input.addonIds.length > 3 ||
    input.addonIds.some((id) => typeof id !== "string" || !idPattern.test(id)) ||
    new Set(input.addonIds).size !== input.addonIds.length
  ) {
    fieldErrors.addonIds = "增项选择无效，请重新选择。";
  }
  if (typeof input.startsAt !== "string" || !Number.isFinite(Date.parse(input.startsAt))) {
    fieldErrors.startsAt = "请选择有效的预约开始时间。";
  }
  const staffPreference = (() => {
    if (input.staffPreference === undefined) {
      return { kind: "specified", staffId: input.staffId } as const;
    }
    if (!input.staffPreference || typeof input.staffPreference !== "object") {
      fieldErrors.staffPreference = "请选择有效的员工偏好。";
      return null;
    }
    const preference = input.staffPreference as Record<string, unknown>;
    if (preference.kind === "fastest") {
      return { kind: "fastest" } as const;
    }
    if (
      preference.kind === "specified" &&
      typeof preference.staffId === "string" &&
      idPattern.test(preference.staffId) &&
      preference.staffId === input.staffId
    ) {
      return { kind: "specified", staffId: preference.staffId } as const;
    }
    fieldErrors.staffPreference = "指定员工偏好必须与本次分配员工一致。";
    return null;
  })();
  if (Object.keys(fieldErrors).length > 0) {
    validationError(fieldErrors);
  }

  return {
    idempotencyKey: input.idempotencyKey as string,
    petId: input.petId as string,
    primaryServiceId: input.primaryServiceId as string,
    addonIds: [...(input.addonIds as string[])].sort(),
    staffId: input.staffId as string,
    staffPreference: staffPreference as CreateBookingInput["staffPreference"],
    startsAt: new Date(input.startsAt as string).toISOString(),
  };
}

function parseManagerProxyInput(body: unknown): ParsedManagerProxyInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const common = parseCreateInput({ ...input, petId: "proxy-pet" });
  const fieldErrors: Record<string, string> = {};
  const source = input.offlineConsentSource;

  if (source !== "phone" && source !== "chat" && source !== "in_store") {
    fieldErrors.offlineConsentSource = "请选择电话、聊天或到店确认来源。";
  }

  const profileInput =
    input.profile && typeof input.profile === "object"
      ? (input.profile as Record<string, unknown>)
      : null;
  let profile: ManagerProxyProfile | null = null;

  if (profileInput?.kind === "existing") {
    if (typeof profileInput.customerId !== "string" || !idPattern.test(profileInput.customerId)) {
      fieldErrors.customerId = "请选择已有顾客。";
    }
    if (typeof profileInput.petId !== "string" || !idPattern.test(profileInput.petId)) {
      fieldErrors.petId = "请选择已有宠物。";
    }
    if (!fieldErrors.customerId && !fieldErrors.petId) {
      profile = {
        kind: "existing",
        customerId: profileInput.customerId as string,
        petId: profileInput.petId as string,
      };
    }
  } else if (profileInput?.kind === "new") {
    const customer =
      profileInput.customer && typeof profileInput.customer === "object"
        ? (profileInput.customer as Record<string, unknown>)
        : {};
    const pet =
      profileInput.pet && typeof profileInput.pet === "object"
        ? (profileInput.pet as Record<string, unknown>)
        : {};
    const displayName = typeof customer.displayName === "string" ? customer.displayName.trim() : "";
    const phone = typeof customer.phone === "string" ? customer.phone.trim() : "";
    const petName = typeof pet.name === "string" ? pet.name.trim() : "";
    const weightKg = typeof pet.weightKg === "number" ? pet.weightKg : Number.NaN;

    if (displayName.length < 1 || displayName.length > 30) {
      fieldErrors.customerName = "请填写 1–30 字顾客姓名。";
    }
    if (!/^1[3-9][0-9]{9}$/.test(phone)) {
      fieldErrors.customerPhone = "请填写有效的中国大陆手机号。";
    }
    if (petName.length < 1 || petName.length > 30) {
      fieldErrors.petName = "请填写 1–30 字宠物名称。";
    }
    if (pet.species !== "dog" && pet.species !== "cat") {
      fieldErrors.petSpecies = "请选择犬或猫。";
    }
    if (!Number.isFinite(weightKg) || weightKg < 0.1 || weightKg > 99.99) {
      fieldErrors.petWeightKg = "请填写 0.1–99.99kg 的当前体重。";
    }
    if (Object.keys(fieldErrors).length === 0) {
      profile = {
        kind: "new",
        customer: { displayName, phone },
        pet: {
          name: petName,
          species: pet.species as "dog" | "cat",
          weightKg,
        },
      };
    }
  } else {
    fieldErrors.profile = "请选择已有档案或填写新顾客与宠物最小资料。";
  }

  if (Object.keys(fieldErrors).length > 0 || !profile) {
    validationError(fieldErrors);
  }

  return {
    idempotencyKey: common.idempotencyKey,
    profile,
    primaryServiceId: common.primaryServiceId,
    addonIds: common.addonIds,
    staffId: common.staffId,
    startsAt: common.startsAt,
    offlineConsentSource: source as ManagerOfflineConsentSource,
  };
}

function petSizeFor(weightKg: number): PetSize {
  if (weightKg <= 10) return "small";
  if (weightKg <= 25) return "medium";
  return "large";
}

function hasAllSkills(staff: StaffRow, requiredSkills: StaffSkillId[]): boolean {
  const skills = new Set(staff.skills);
  return requiredSkills.every((skill) => skills.has(skill));
}

function requestDigest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function capacityChangeAffectsBooking(
  kind: CapacityChangeKind,
  change: CapacityChangeMutationRow,
  booking: BookingRow,
): boolean {
  return (
    (booking.status === "confirmed" || booking.status === "checked_in") &&
    (kind === "store_closure" || booking.staff_id === change.staff_id) &&
    booking.starts_at < change.interval_ends_at &&
    Boolean(booking.occupancy_ends_at && booking.occupancy_ends_at > change.interval_starts_at)
  );
}

function isStoredManagerProxySuccess(value: unknown): value is StoredManagerProxySuccess {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredManagerProxySuccess>;
  return (
    candidate.kind === "manager_proxy_booking_success" &&
    Boolean(candidate.booking) &&
    Boolean(candidate.verificationWindow) &&
    Boolean(candidate.proxyRecord)
  );
}

function isStoredLegacyManagerProxySuccess(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "manager_proxy_booking_legacy_success"
  );
}

function nearbySuggestions(
  availability: BookingAvailabilityResponse,
  requestedStartsAt: string,
): BookingConflictSuggestion[] {
  const requestedStart = Date.parse(requestedStartsAt);
  const suggestions = availability.days
    .flatMap((day) =>
      day.slots.map((slot) => ({
        date: day.date,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        staff: { id: slot.staff.id, displayName: slot.staff.displayName },
      })),
    )
    .filter((suggestion) => suggestion.startsAt !== requestedStartsAt)
    .sort((left, right) => {
      const distance =
        Math.abs(Date.parse(left.startsAt) - requestedStart) -
        Math.abs(Date.parse(right.startsAt) - requestedStart);
      return distance || left.startsAt.localeCompare(right.startsAt);
    })
    .slice(0, 5);
  return suggestions.length >= 3 ? suggestions : [];
}

function parseCancelInput(body: unknown): CancelBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length < 2 ||
    input.reason.trim().length > 120
  ) {
    fieldErrors.reason = "请选择或填写 2–120 字的取消原因。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    validationError(fieldErrors);
  }
  return {
    idempotencyKey: input.idempotencyKey as string,
    reason: (input.reason as string).trim(),
  };
}

function parseRescheduleInput(body: unknown): RescheduleBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if ("petId" in input || "primaryServiceId" in input || "addonIds" in input) {
    businessError(
      "BOOKING_CONTENT_CHANGE_NOT_ALLOWED",
      "改期不能更换宠物或主要服务，请取消后重新预约。",
      HttpStatus.BAD_REQUEST,
    );
  }
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (typeof input.staffId !== "string" || !idPattern.test(input.staffId)) {
    fieldErrors.staffId = "请选择有效员工。";
  }
  if (typeof input.startsAt !== "string" || !Number.isFinite(Date.parse(input.startsAt))) {
    fieldErrors.startsAt = "请选择有效的预约开始时间。";
  }
  if (Object.keys(fieldErrors).length > 0) {
    validationError(fieldErrors);
  }
  return {
    idempotencyKey: input.idempotencyKey as string,
    staffId: input.staffId as string,
    startsAt: new Date(input.startsAt as string).toISOString(),
  };
}

function parseManagerRescheduleInput(body: unknown): ManagerRescheduleBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const schedule = parseRescheduleInput(body);
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length < 2 ||
    input.reason.trim().length > 120
  ) {
    validationError({ reason: "请填写 2–120 字的改期原因。" });
  }
  return {
    ...schedule,
    reason: (input.reason as string).trim(),
    ...parseManagerExpectedFact(input),
  };
}

function parseManagerCancelInput(body: unknown): ManagerCancelBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    ...parseCancelInput(body),
    ...parseManagerExpectedFact(input),
  };
}

function parseManagerCorrectionDraft(body: unknown): ManagerBookingCorrectionDraft {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if ("petId" in input) {
    businessError(
      "BOOKING_CONTENT_REPLACEMENT_NOT_ALLOWED",
      "纠正不能更换宠物；请取消当前预约后新建。",
      HttpStatus.BAD_REQUEST,
      { nextStep: "cancel_and_rebook" },
    );
  }
  const fieldErrors: Record<string, string> = {};
  if (
    typeof input.petWeightKg !== "number" ||
    !Number.isFinite(input.petWeightKg) ||
    input.petWeightKg < 0.1 ||
    input.petWeightKg > 99.99
  ) {
    fieldErrors.petWeightKg = "请填写 0.1–99.99kg 的当前体重。";
  }
  if (typeof input.primaryServiceId !== "string" || !idPattern.test(input.primaryServiceId)) {
    fieldErrors.primaryServiceId = "主要服务无效。";
  }
  if (
    !Array.isArray(input.addonIds) ||
    input.addonIds.length > 3 ||
    input.addonIds.some((id) => typeof id !== "string" || !idPattern.test(id)) ||
    new Set(input.addonIds).size !== input.addonIds.length
  ) {
    fieldErrors.addonIds = "增项选择无效，请重新选择。";
  }
  if (Object.keys(fieldErrors).length > 0) validationError(fieldErrors);
  return {
    petWeightKg: Number((input.petWeightKg as number).toFixed(2)),
    primaryServiceId: input.primaryServiceId as string,
    addonIds: [...(input.addonIds as string[])].sort(),
  };
}

function parseManagerContentCorrectionInput(body: unknown): ManagerBookingContentCorrectionInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const draft = parseManagerCorrectionDraft(body);
  const fieldErrors: Record<string, string> = {};
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length < 2 ||
    input.reason.trim().length > 120
  ) {
    fieldErrors.reason = "请填写 2–120 字的纠正原因。";
  }
  if (
    typeof input.expectedContentDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.expectedContentDigest)
  ) {
    fieldErrors.expectedContentDigest = "请提供页面读取时的当前内容摘要。";
  }
  if (Object.keys(fieldErrors).length > 0) validationError(fieldErrors);
  return {
    idempotencyKey: input.idempotencyKey as string,
    reason: (input.reason as string).trim(),
    ...parseManagerExpectedFact(input),
    expectedContentDigest: input.expectedContentDigest as string,
    ...draft,
  };
}

function parseManagerExpectedFact(input: Record<string, unknown>): {
  expectedStaffId: string;
  expectedStartsAt: string;
  expectedBookingRevision: number;
} {
  const fieldErrors: Record<string, string> = {};
  if (typeof input.expectedStaffId !== "string" || !idPattern.test(input.expectedStaffId)) {
    fieldErrors.expectedStaffId = "请提供页面读取时的当前员工。";
  }
  if (
    typeof input.expectedStartsAt !== "string" ||
    !Number.isFinite(Date.parse(input.expectedStartsAt))
  ) {
    fieldErrors.expectedStartsAt = "请提供页面读取时的当前开始时间。";
  }
  if (
    typeof input.expectedBookingRevision !== "number" ||
    !Number.isInteger(input.expectedBookingRevision) ||
    input.expectedBookingRevision <= 0
  ) {
    fieldErrors.expectedBookingRevision = "请提供页面读取时的预约修订版本。";
  }
  if (Object.keys(fieldErrors).length > 0) validationError(fieldErrors);
  return {
    expectedStaffId: input.expectedStaffId as string,
    expectedStartsAt: new Date(input.expectedStartsAt as string).toISOString(),
    expectedBookingRevision: input.expectedBookingRevision as number,
  };
}

function parseCapacityChangeResolutionInput(body: unknown): ResolveCapacityChangeBookingInput {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  const action = input.action;

  if (
    action !== "change_staff" &&
    action !== "reschedule" &&
    action !== "cancel" &&
    action !== "acknowledge_existing"
  ) {
    fieldErrors.action = "请选择同时间换员工、改期或取消。";
  }
  if (typeof input.idempotencyKey !== "string" || !idempotencyPattern.test(input.idempotencyKey)) {
    fieldErrors.idempotencyKey = "请提供 8–128 位稳定幂等键。";
  }
  if (
    typeof input.reason !== "string" ||
    input.reason.trim().length < 2 ||
    input.reason.trim().length > 120
  ) {
    fieldErrors.reason = "请填写 2–120 字的处理原因。";
  }
  if (
    typeof input.expectedBookingRevision !== "number" ||
    !Number.isInteger(input.expectedBookingRevision) ||
    input.expectedBookingRevision <= 0
  ) {
    fieldErrors.expectedBookingRevision = "请提供页面读取时的预约修订版本。";
  }
  if (
    (action === "change_staff" || action === "reschedule") &&
    (typeof input.staffId !== "string" || !idPattern.test(input.staffId))
  ) {
    fieldErrors.staffId = "请选择有效员工。";
  }
  if (
    action === "reschedule" &&
    (typeof input.startsAt !== "string" || !Number.isFinite(Date.parse(input.startsAt)))
  ) {
    fieldErrors.startsAt = "请选择有效的改期开始时间。";
  }
  if (Object.keys(fieldErrors).length > 0) validationError(fieldErrors);

  return {
    action: action as ResolveCapacityChangeBookingInput["action"],
    idempotencyKey: input.idempotencyKey as string,
    reason: (input.reason as string).trim(),
    expectedBookingRevision: input.expectedBookingRevision as number,
    ...(typeof input.staffId === "string" ? { staffId: input.staffId } : {}),
    ...(typeof input.startsAt === "string"
      ? { startsAt: new Date(input.startsAt).toISOString() }
      : {}),
  };
}

function verificationCode(
  customerId: string,
  bookingId: string,
  seed: string,
  version = 1,
): string {
  const digest = createHmac("sha256", getBookingCodeSecret())
    .update(
      version === 1
        ? `${customerId}:${seed}:${bookingId}`
        : `${customerId}:${seed}:${bookingId}:v${version}`,
    )
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function verificationCodeDigest(bookingId: string, code: string): string {
  return createHmac("sha256", getBookingCodeSecret())
    .update(`booking-code:${bookingId}:${code}`)
    .digest("hex");
}

function verificationWindow(row: BookingRow): BookingVerificationWindow {
  return {
    opensAt: new Date(row.starts_at.getTime() - 30 * 60_000).toISOString(),
    closesAt: new Date(row.starts_at.getTime() + 15 * 60_000).toISOString(),
    description: "可在开始前 30 分钟至开始后 15 分钟内出示",
  };
}

function activeVerificationCode(row: BookingRow): string | null {
  if (row.status !== "confirmed") return null;
  const code = verificationCode(
    row.customer_id,
    row.id,
    row.verification_code_seed,
    row.verification_code_version,
  );
  const expected = Buffer.from(verificationCodeDigest(row.id, code), "hex");
  const actual = Buffer.from(row.verification_code_digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? code : null;
}

function currentSchedule(row: BookingRow): CustomerBookingSchedule {
  return {
    staff: { id: row.staff_id, displayName: row.staff_display_name_snapshot },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    turnoverEndsAt: bookingTurnoverEndsAt(row),
  };
}

function bookingTurnoverEndsAt(row: BookingRow): string {
  return (
    row.occupancy_ends_at ?? new Date(row.ends_at.getTime() + row.turnover_minutes * 60_000)
  ).toISOString();
}

function currentSelection(row: BookingRow): BookingSelectionQuote {
  return {
    pet: {
      id: row.pet_id,
      name: row.pet_name_snapshot,
      species: row.pet_species_snapshot,
      weightKg: Number(row.pet_weight_kg_snapshot),
      petSize: row.pet_size_snapshot,
    },
    primaryService: {
      id: row.primary_service_id_snapshot,
      name: row.primary_service_name_snapshot,
      priceCents: row.primary_service_price_cents,
      durationMinutes: row.primary_service_duration_minutes,
    },
    addons: row.addon_snapshots,
    totalPriceCents: row.total_price_cents,
    serviceDurationMinutes: row.service_duration_minutes,
    requiredSkillIds: row.required_skill_ids_snapshot,
  };
}

function customerActions(row: BookingRow): CustomerBookingActions {
  const cutoffAt = new Date(row.starts_at.getTime() - 12 * 60 * 60_000).toISOString();
  const beforeOrAtCutoff = Date.parse(getDemoNow()) <= Date.parse(cutoffAt);
  const allowed = row.status === "confirmed" && beforeOrAtCutoff;
  return {
    canCancel: allowed,
    canReschedule: allowed,
    cutoffAt,
    message: allowed
      ? "可在截止时间前自行改期或取消。"
      : row.status === "confirmed"
        ? "开始前已不足 12 小时，请联系门店处理。"
        : "当前预约状态不支持顾客自行改期或取消，如需帮助请联系门店。",
  };
}

function localMinuteOfDay(instant: Date): number {
  const local = new Date(instant.getTime() + 8 * 60 * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function asBooking(row: BookingRow): ConfirmedBooking {
  return {
    id: row.id,
    status: row.status,
    pet: {
      id: row.pet_id,
      name: row.pet_name_snapshot,
      species: row.pet_species_snapshot,
      weightKg: Number(row.pet_weight_kg_snapshot),
      petSize: row.pet_size_snapshot,
    },
    primaryService: {
      id: row.primary_service_id_snapshot,
      name: row.primary_service_name_snapshot,
      priceCents: row.primary_service_price_cents,
      durationMinutes: row.primary_service_duration_minutes,
    },
    addons: row.addon_snapshots,
    staff: { id: row.staff_id, displayName: row.staff_display_name_snapshot },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    turnoverEndsAt: bookingTurnoverEndsAt(row),
    totalPriceCents: row.total_price_cents,
    serviceDurationMinutes: row.service_duration_minutes,
    turnoverMinutes: row.turnover_minutes,
    originalSchedule: {
      startsAt: row.original_starts_at.toISOString(),
      endsAt: row.original_ends_at.toISOString(),
      occupancyStartsAt: row.original_occupancy_starts_at.toISOString(),
      occupancyEndsAt: row.original_occupancy_ends_at.toISOString(),
    },
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export function bookingCancellationNotificationBody(petName: string): string {
  return `${petName}的本次预约已取消。`;
}

function asCustomerMessage(row: CustomerMessageRow): CustomerMessage {
  const startsAt =
    row.notification_type === "booking_rescheduled"
      ? row.payload.next?.startsAt
      : row.notification_type === "booking_cancelled"
        ? row.payload.previous?.startsAt
        : row.payload.startsAt;
  const localStart = new Date(
    (startsAt ? Date.parse(startsAt) : row.starts_at.getTime()) + 8 * 60 * 60_000,
  );
  const time = `${String(localStart.getUTCHours()).padStart(2, "0")}:${String(localStart.getUTCMinutes()).padStart(2, "0")}`;
  const petName = row.payload.petName ?? row.pet_name_snapshot;
  const serviceName = row.payload.serviceName ?? row.primary_service_name_snapshot;
  const staffName =
    row.notification_type === "booking_rescheduled"
      ? (row.payload.next?.staff.displayName ?? row.staff_display_name_snapshot)
      : (row.payload.staffName ?? row.staff_display_name_snapshot);
  const messages: Record<
    CustomerMessageKind,
    Pick<CustomerMessage, "title" | "body" | "actionLabel">
  > = {
    booking_confirmed: {
      title: "预约已确认",
      body: `${petName}的${serviceName}已确认，员工为${staffName}。`,
      actionLabel: "查看预约",
    },
    booking_rescheduled: {
      title: "预约已改期",
      body: `${petName}的新安排已确认，开始时间为 ${time}。`,
      actionLabel: "查看核销码",
    },
    booking_cancelled: {
      title: "预约已取消",
      body: bookingCancellationNotificationBody(petName),
      actionLabel: "查看预约",
    },
    booking_content_corrected: {
      title: "预约内容已更新",
      body: `${petName}的${serviceName}内容已由门店纠正，请查看新的价格与预计时长。`,
      actionLabel: "查看预约",
    },
    booking_reminder: {
      title: "到店提醒",
      body: `${petName}的预约将在 ${time} 开始。`,
      actionLabel: "查看核销码",
    },
  };
  return {
    id: row.id,
    kind: row.notification_type,
    ...messages[row.notification_type],
    occurredAt: row.created_at.toISOString(),
    bookingId: row.booking_id,
  };
}

const bookingColumns = `
  id, customer_id, pet_id, staff_id, status, starts_at, ends_at, occupancy_ends_at,
  service_duration_minutes, pet_name_snapshot, pet_species_snapshot,
  pet_weight_kg_snapshot::text, pet_size_snapshot,
  primary_service_id_snapshot, primary_service_name_snapshot,
  primary_service_price_cents, primary_service_duration_minutes,
  addon_snapshots, required_skill_ids_snapshot, total_price_cents, staff_display_name_snapshot,
  turnover_minutes, original_starts_at, original_ends_at,
  original_occupancy_starts_at, original_occupancy_ends_at,
  verification_code_digest, verification_code_seed, verification_code_version,
  completed_at, created_at
`;

@Injectable()
export class BookingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ServiceCatalogService) private readonly catalog: ServiceCatalogService,
    @Inject(BookingAvailabilityService)
    private readonly availability: BookingAvailabilityService,
  ) {}

  async createConfirmed(customerId: string, body: unknown): Promise<CreateBookingResponse> {
    const input = parseCreateInput(body);
    const digest = requestDigest(input);
    const client = await this.database.pool.connect();
    const idempotencyLockKey = `${customerId}:create_booking:${input.idempotencyKey}`;
    let idempotencyLockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [idempotencyLockKey]);
      idempotencyLockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<IdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM booking_idempotency_keys
          WHERE customer_id = $1
            AND command_type = 'create_booking'
            AND idempotency_key = $2
        `,
        [customerId, input.idempotencyKey],
      );
      const previous = existing.rows[0];

      if (previous) {
        if (previous.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一份预约草稿，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!previous.booking_id) {
          if (
            previous.response_status &&
            previous.response_body &&
            typeof previous.response_body === "object"
          ) {
            await client.query("COMMIT");
            throw new HttpException(previous.response_body, previous.response_status);
          }
          throw new Error("预约幂等结果缺少成功预约或失败响应。");
        }
        const row = await this.findBookingRow(client, customerId, previous.booking_id);
        const code = activeVerificationCode(row);
        if (!code) {
          throw new Error("当前预约核销码摘要与服务端派生值不一致。");
        }
        await client.query("COMMIT");
        return {
          booking: asBooking(row),
          verificationCode: code,
          verificationWindow: verificationWindow(row),
        };
      }

      await this.requirePrivacyConsent(client, customerId);
      const pet = await this.requireActivePet(client, customerId, input.petId);
      const selection = this.quote(pet, input.primaryServiceId, input.addonIds);
      const staff = await this.requireQualifiedStaff(client, input.staffId, selection);
      const interval = await this.requireAvailableInterval(client, input, selection);
      const createdAt = getDemoNow();
      const { bookingId, code } = await this.insertConfirmedBooking(client, {
        customerId,
        pet,
        selection,
        staff,
        interval,
        idempotencyKey: input.idempotencyKey,
        actor: { type: "customer", id: customerId },
        createdAt,
      });
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest, booking_id, created_at
          )
          VALUES ($1, 'create_booking', $2, $3, $4, $5)
        `,
        [customerId, input.idempotencyKey, digest, bookingId, createdAt],
      );
      const row = await this.findBookingRow(client, customerId, bookingId);
      await client.query("COMMIT");
      return {
        booking: asBooking(row),
        verificationCode: code,
        verificationWindow: verificationWindow(row),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      if (
        this.isBookingTimeConflict(error) ||
        databaseError.code === "23P01" ||
        databaseError.code === "40001" ||
        databaseError.code === "40P01"
      ) {
        await this.throwBookingTimeConflict(customerId, input, digest, client);
      }
      if (error instanceof HttpException) throw error;
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (idempotencyLockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [idempotencyLockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("预约幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError =
            error instanceof Error ? error : new Error("预约幂等锁释放失败，连接不可复用。");
        }
      }
      client.release(releaseError);
    }
  }

  async createProxy(
    manager: BackofficeIdentity,
    body: unknown,
  ): Promise<ManagerProxyBookingResponse> {
    if (manager.role !== "manager") {
      businessError("FORBIDDEN", "当前身份不能创建代客预约。", HttpStatus.FORBIDDEN);
    }
    const input = parseManagerProxyInput(body);
    const digest = requestDigest(input);
    const client = await this.database.pool.connect();
    const lockKey = `${manager.id}:manager_proxy_booking:${input.idempotencyKey}`;
    let lockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<ManagerProxyIdempotencyRow>(
        `
          SELECT idempotency.request_digest,
                 idempotency.booking_id,
                 booking.customer_id,
                 idempotency.response_status,
                 idempotency.response_body,
                 record.privacy_notice_version,
                 record.offline_consent_source,
                 account.display_name AS manager_display_name,
                 record.created_at
          FROM manager_proxy_booking_idempotency_keys AS idempotency
          LEFT JOIN bookings AS booking ON booking.id = idempotency.booking_id
          LEFT JOIN manager_proxy_booking_records AS record
            ON record.booking_id = idempotency.booking_id
          LEFT JOIN backoffice_accounts AS account ON account.id = record.manager_id
          WHERE idempotency.manager_id = $1 AND idempotency.idempotency_key = $2
        `,
        [manager.id, input.idempotencyKey],
      );
      const previous = existing.rows[0];

      if (previous) {
        if (previous.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一份代客预约，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!previous.booking_id) {
          await client.query("COMMIT");
          throw new HttpException(
            previous.response_body as Record<string, unknown>,
            previous.response_status,
          );
        }
        if (
          previous.customer_id &&
          isStoredLegacyManagerProxySuccess(previous.response_body) &&
          previous.privacy_notice_version &&
          previous.offline_consent_source &&
          previous.manager_display_name &&
          previous.created_at
        ) {
          const row = await this.findBookingRow(client, previous.customer_id, previous.booking_id);
          const code = activeVerificationCode(row);
          if (!code) {
            throw new Error("旧版代客预约幂等结果的核销码已不可恢复。");
          }
          await client.query("COMMIT");
          return {
            booking: asBooking(row),
            verificationCode: code,
            verificationWindow: verificationWindow(row),
            proxyRecord: {
              privacyNoticeVersion: previous.privacy_notice_version,
              offlineConsentSource: previous.offline_consent_source,
              manager: { id: manager.id, displayName: previous.manager_display_name },
              createdAt: previous.created_at.toISOString(),
            },
          };
        }
        if (!previous.customer_id || !isStoredManagerProxySuccess(previous.response_body)) {
          throw new Error("代客预约幂等结果缺少完整的首次成功快照。");
        }
        const code = verificationCode(
          previous.customer_id,
          previous.booking_id,
          input.idempotencyKey,
        );
        await client.query("COMMIT");
        return {
          booking: previous.response_body.booking,
          verificationCode: code,
          verificationWindow: previous.response_body.verificationWindow,
          proxyRecord: previous.response_body.proxyRecord,
        };
      }

      const createdAt = getDemoNow();
      let customerId: string;
      let pet: PetRow;

      if (input.profile.kind === "existing") {
        customerId = input.profile.customerId;
        pet = await this.requireActivePet(client, customerId, input.profile.petId);
      } else {
        customerId = randomUUID();
        const petId = randomUUID();
        await client.query(
          `
            INSERT INTO customers (id, display_name, phone, created_at)
            VALUES ($1, $2, $3, $4)
          `,
          [customerId, input.profile.customer.displayName, input.profile.customer.phone, createdAt],
        );
        await client.query(
          `
            INSERT INTO pets (
              id, customer_id, name, species, weight_kg, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $6)
          `,
          [
            petId,
            customerId,
            input.profile.pet.name,
            input.profile.pet.species,
            input.profile.pet.weightKg,
            createdAt,
          ],
        );
        pet = {
          id: petId,
          name: input.profile.pet.name,
          species: input.profile.pet.species,
          weight_kg: String(input.profile.pet.weightKg),
          archived_at: null,
        };
      }

      const noticeResult = await client.query<{ version: string }>(
        "SELECT version FROM privacy_notices WHERE is_current = true FOR SHARE",
      );
      const noticeVersion = noticeResult.rows[0]?.version;
      if (!noticeVersion) {
        throw new Error("当前隐私说明不存在，无法记录代客预约同意事实。");
      }
      await client.query(
        `
          INSERT INTO privacy_consents (customer_id, notice_version, source, consented_at)
          VALUES ($1, $2, 'manager_offline', $3)
          ON CONFLICT (customer_id, notice_version) DO NOTHING
        `,
        [customerId, noticeVersion, createdAt],
      );

      const createInput: CreateBookingInput = {
        idempotencyKey: input.idempotencyKey,
        petId: pet.id,
        primaryServiceId: input.primaryServiceId,
        addonIds: input.addonIds,
        staffId: input.staffId,
        staffPreference: { kind: "specified", staffId: input.staffId },
        startsAt: input.startsAt,
      };
      const selection = this.quote(pet, input.primaryServiceId, input.addonIds);
      const staff = await this.requireQualifiedStaff(client, input.staffId, selection);
      const interval = await this.requireAvailableInterval(
        client,
        createInput,
        selection,
        null,
        "manager",
      );
      const { bookingId, code } = await this.insertConfirmedBooking(client, {
        customerId,
        pet,
        selection,
        staff,
        interval,
        idempotencyKey: input.idempotencyKey,
        actor: { type: "manager", id: manager.id },
        createdAt,
        extraFactPayload: {
          channel: "manager_proxy",
          privacyNoticeVersion: noticeVersion,
          offlineConsentSource: input.offlineConsentSource,
        },
      });
      await client.query(
        `
          INSERT INTO manager_proxy_booking_records (
            booking_id, privacy_notice_version, offline_consent_source, manager_id, created_at
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [bookingId, noticeVersion, input.offlineConsentSource, manager.id, createdAt],
      );
      const row = await this.findBookingRow(client, customerId, bookingId);
      const storedResponse: StoredManagerProxySuccess = {
        kind: "manager_proxy_booking_success",
        booking: asBooking(row),
        verificationWindow: verificationWindow(row),
        proxyRecord: {
          privacyNoticeVersion: noticeVersion,
          offlineConsentSource: input.offlineConsentSource,
          manager: { id: manager.id, displayName: manager.displayName },
          createdAt,
        },
      };
      await client.query(
        `
          INSERT INTO manager_proxy_booking_idempotency_keys (
            manager_id, idempotency_key, request_digest, booking_id,
            response_status, response_body, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          manager.id,
          input.idempotencyKey,
          digest,
          bookingId,
          HttpStatus.CREATED,
          JSON.stringify(storedResponse),
          createdAt,
        ],
      );
      await client.query("COMMIT");
      return {
        booking: storedResponse.booking,
        verificationCode: code,
        verificationWindow: storedResponse.verificationWindow,
        proxyRecord: storedResponse.proxyRecord,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      if (
        this.isBookingTimeConflict(error) ||
        databaseError.code === "23P01" ||
        databaseError.code === "40001" ||
        databaseError.code === "40P01"
      ) {
        await this.throwManagerProxyTimeConflict(manager, input, digest, client);
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("代客预约幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("代客预约幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async cancel(
    customerId: string,
    bookingId: string,
    body: unknown,
  ): Promise<CancelBookingResponse> {
    this.requireBookingId(bookingId);
    const input = parseCancelInput(body);
    const digest = requestDigest({ bookingId, ...input });
    const client = await this.database.pool.connect();
    const lockKey = `${customerId}:customer_cancel:${input.idempotencyKey}`;
    let lockHeld = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<IdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM booking_idempotency_keys
          WHERE customer_id = $1
            AND command_type = 'customer_cancel'
            AND idempotency_key = $2
        `,
        [customerId, input.idempotencyKey],
      );
      const previousResult = existing.rows[0];
      if (previousResult) {
        if (previousResult.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条取消命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!previousResult.booking_id) {
          if (
            previousResult.response_status &&
            previousResult.response_body &&
            typeof previousResult.response_body === "object"
          ) {
            await client.query("COMMIT");
            throw new HttpException(previousResult.response_body, previousResult.response_status);
          }
          throw new Error("取消幂等结果缺少成功预约或失败响应。");
        }
        if (
          previousResult.response_status &&
          previousResult.response_status >= 200 &&
          previousResult.response_status < 300 &&
          previousResult.response_body &&
          typeof previousResult.response_body === "object"
        ) {
          await client.query("COMMIT");
          return previousResult.response_body as CancelBookingResponse;
        }
        const row = await this.findBookingRow(client, customerId, previousResult.booking_id);
        const response = await this.detailResponse(client, row);
        await client.query("COMMIT");
        return response;
      }

      const row = await this.findBookingRow(client, customerId, bookingId, true);
      this.requireCustomerChangeAllowed(row);
      const applied = await this.applyAtomicCancellation(client, row, {
        actorType: "customer",
        actorId: customerId,
        reason: input.reason,
        auditEventType: "customer_booking_cancelled",
      });
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest, booking_id, created_at
          )
          VALUES ($1, 'customer_cancel', $2, $3, $4, $5)
        `,
        [customerId, input.idempotencyKey, digest, bookingId, applied.occurredAt],
      );
      const cancelled = applied.booking;
      const response = await this.detailResponse(client, cancelled);
      await client.query(
        `
          UPDATE booking_idempotency_keys
          SET response_status = $4, response_body = $5::jsonb
          WHERE customer_id = $1
            AND command_type = 'customer_cancel'
            AND idempotency_key = $2
            AND request_digest = $3
        `,
        [customerId, input.idempotencyKey, digest, HttpStatus.CREATED, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof HttpException) {
        const response = error.getResponse();
        if (response && typeof response === "object") {
          try {
            await client.query("BEGIN");
            await client.query(
              `
                INSERT INTO booking_idempotency_keys (
                  customer_id, command_type, idempotency_key, request_digest,
                  booking_id, response_status, response_body, created_at
                )
                VALUES ($1, 'customer_cancel', $2, $3, NULL, $4, $5::jsonb, $6)
                ON CONFLICT (customer_id, command_type, idempotency_key) DO NOTHING
              `,
              [
                customerId,
                input.idempotencyKey,
                digest,
                error.getStatus(),
                JSON.stringify(response),
                getDemoNow(),
              ],
            );
            await client.query("COMMIT");
          } catch (persistError) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw persistError;
          }
        }
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("取消预约幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("取消预约幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async managerCancel(
    manager: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<ManagerBookingChangeResponse> {
    this.requireManager(manager);
    this.requireBookingId(bookingId);
    const input = parseManagerCancelInput(body);
    const digest = requestDigest({ bookingId, ...input });
    const client = await this.database.pool.connect();
    const lockKey = `${manager.id}:manager_cancel:${input.idempotencyKey}`;
    let lockHeld = false;
    let replayedFailure = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<ManagerChangeIdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM manager_booking_change_idempotency_keys
          WHERE manager_id = $1
            AND command_type = 'manager_cancel'
            AND idempotency_key = $2
        `,
        [manager.id, input.idempotencyKey],
      );
      const previousResult = existing.rows[0];
      if (previousResult) {
        if (previousResult.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条店长取消命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        await client.query("COMMIT");
        if (previousResult.booking_id && previousResult.response_status < 300) {
          return previousResult.response_body as ManagerBookingChangeResponse;
        }
        if (!previousResult.response_body || typeof previousResult.response_body !== "object") {
          throw new Error("店长取消幂等结果缺少失败响应。");
        }
        replayedFailure = true;
        throw new HttpException(previousResult.response_body, previousResult.response_status);
      }

      const row = await this.findManagerBookingRow(client, bookingId, true);
      this.requireManagerChangeAllowed(row);
      this.requireManagerExpectedFact(row, input);
      const applied = await this.applyAtomicCancellation(client, row, {
        actorType: "manager",
        actorId: manager.id,
        reason: input.reason,
        auditEventType: "manager_booking_cancelled",
      });
      const change: ManagerBookingChange = {
        id: applied.eventId,
        kind: "manager_cancelled",
        actor: {
          type: "manager",
          id: manager.id,
          displayName: manager.displayName,
        },
        reason: input.reason,
        previous: applied.previous,
        next: null,
        occurredAt: applied.occurredAt,
      };
      const response: ManagerBookingChangeResponse = {
        booking: asBooking(applied.booking),
        bookingRevision: applied.booking.verification_code_version,
        managerActions: managerBookingActions(applied.booking.status),
        verificationCodeStatus: "invalidated",
        change,
      };
      await client.query(
        `
          INSERT INTO manager_booking_change_idempotency_keys (
            manager_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'manager_cancel', $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          manager.id,
          input.idempotencyKey,
          digest,
          bookingId,
          HttpStatus.CREATED,
          JSON.stringify(response),
          applied.occurredAt,
        ],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!replayedFailure && error instanceof HttpException) {
        await this.persistManagerChangeFailure(
          client,
          manager.id,
          "manager_cancel",
          input.idempotencyKey,
          digest,
          error,
        );
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("店长取消幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("店长取消幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async resolveCapacityChangeImpact(
    manager: BackofficeIdentity,
    kind: CapacityChangeKind,
    capacityChangeId: string,
    bookingId: string,
    body: unknown,
  ): Promise<AppliedCapacityChangeResolution> {
    this.requireManager(manager);
    this.requireBookingId(bookingId);
    if (kind !== "time_off" && kind !== "store_closure") {
      businessError("CAPACITY_CHANGE_NOT_FOUND", "找不到这项容量变化。", HttpStatus.NOT_FOUND);
    }
    if (!idPattern.test(capacityChangeId) && !/^[0-9a-f-]{36}$/.test(capacityChangeId)) {
      businessError("CAPACITY_CHANGE_NOT_FOUND", "找不到这项容量变化。", HttpStatus.NOT_FOUND);
    }
    const input = parseCapacityChangeResolutionInput(body);
    const digest = requestDigest({ kind, capacityChangeId, bookingId, ...input });
    const client = await this.database.pool.connect();
    const idempotencyLockKey = `${manager.id}:resolve_capacity_impact:${input.idempotencyKey}`;
    let idempotencyLockHeld = false;
    let replayedFailure = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [idempotencyLockKey]);
      idempotencyLockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const previousFailureResult = await client.query<ManagerChangeIdempotencyRow>(
        `SELECT request_digest, booking_id, response_status, response_body
         FROM manager_booking_change_idempotency_keys
         WHERE manager_id = $1
           AND command_type = 'capacity_impact_resolution'
           AND idempotency_key = $2`,
        [manager.id, input.idempotencyKey],
      );
      const previousFailure = previousFailureResult.rows[0];
      if (previousFailure) {
        if (previousFailure.request_digest !== digest) {
          replayedFailure = true;
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一项受影响预约处理，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!previousFailure.response_body || typeof previousFailure.response_body !== "object") {
          throw new Error("受影响预约处理幂等结果缺少失败响应。");
        }
        await client.query("COMMIT");
        replayedFailure = true;
        throw new HttpException(previousFailure.response_body, previousFailure.response_status);
      }
      const replayResult = await client.query<CapacityChangeResolutionReplayRow>(
        `SELECT resolution.request_digest, resolution.response_body
         FROM capacity_change_booking_resolutions AS resolution
         WHERE resolution.manager_id = $1
           AND resolution.idempotency_key = $2`,
        [manager.id, input.idempotencyKey],
      );
      const replay = replayResult.rows[0];
      if (replay) {
        if (replay.request_digest !== digest) {
          replayedFailure = true;
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一项受影响预约处理，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!replay.response_body) {
          throw new Error("受影响预约处理的幂等结果缺少首次响应。");
        }
        await client.query("COMMIT");
        return { response: replay.response_body };
      }
      const changeResult = await client.query<CapacityChangeMutationRow>(
        kind === "time_off"
          ? `SELECT status, affected_booking_count, impact_snapshot, staff_id,
                    ((local_date + starts_at) AT TIME ZONE 'Asia/Shanghai') AS interval_starts_at,
                    ((local_date + ends_at) AT TIME ZONE 'Asia/Shanghai') AS interval_ends_at
             FROM staff_time_off_intervals
             WHERE id = $1
             FOR UPDATE`
          : `SELECT status, affected_booking_count, impact_snapshot, NULL::text AS staff_id,
                    ((local_date + starts_at) AT TIME ZONE 'Asia/Shanghai') AS interval_starts_at,
                    ((local_date + ends_at) AT TIME ZONE 'Asia/Shanghai') AS interval_ends_at
             FROM store_closure_intervals
             WHERE id = $1
             FOR UPDATE`,
        [capacityChangeId],
      );
      const change = changeResult.rows[0];
      if (!change) {
        businessError("CAPACITY_CHANGE_NOT_FOUND", "找不到这项容量变化。", HttpStatus.NOT_FOUND);
      }
      if (change.status !== "pending") {
        businessError(
          "CAPACITY_CHANGE_NOT_PENDING",
          "这项容量变化已经生效或撤销，不能继续处理预约。",
          HttpStatus.CONFLICT,
        );
      }
      const impact = change.impact_snapshot.find((booking) => booking.id === bookingId);
      if (!impact) {
        businessError(
          "BOOKING_NOT_IMPACTED",
          "这笔预约不在该容量变化的影响快照中。",
          HttpStatus.NOT_FOUND,
        );
      }
      const resolutionResult = await client.query<{ id: string }>(
        `SELECT id
         FROM capacity_change_booking_resolutions
         WHERE booking_id = $1
           AND ($2::text = 'time_off' AND staff_time_off_id = $3
             OR $2::text = 'store_closure' AND store_closure_id = $3)`,
        [bookingId, kind, capacityChangeId],
      );
      if (resolutionResult.rows[0]) {
        businessError(
          "IMPACT_ALREADY_RESOLVED",
          "这笔受影响预约已经由其他操作处理，请重新读取进度。",
          HttpStatus.CONFLICT,
        );
      }

      const row = await this.findManagerBookingRow(client, bookingId, true);
      const stillAffected = capacityChangeAffectsBooking(kind, change, row);
      const factChanged =
        row.verification_code_version !== impact.revision ||
        row.status !== impact.status ||
        row.staff_id !== impact.staff.id ||
        row.starts_at.toISOString() !== impact.startsAt;

      let bookingEventId: string | undefined;
      let occurredAt: string | undefined;
      let result: CustomerBookingSchedule | null | undefined;
      const resolutionAction: CapacityChangeResolution["action"] = input.action;
      if (input.action === "acknowledge_existing") {
        if (input.expectedBookingRevision !== row.verification_code_version) {
          businessError(
            "BOOKING_FACT_CHANGED",
            "预约事实已再次变化，请刷新并核对最新结果后再确认。",
            HttpStatus.CONFLICT,
          );
        }
        if (!factChanged || stillAffected) {
          businessError(
            "BOOKING_STILL_IMPACTED",
            "当前预约仍占用这项容量变化的区间，请换员工、改期或取消。",
            HttpStatus.CONFLICT,
          );
        }
        const existingEvent = await client.query<{ id: string }>(
          `SELECT id
           FROM booking_events
           WHERE booking_id = $1
           ORDER BY occurred_at DESC, id DESC
           LIMIT 1`,
          [bookingId],
        );
        if (!existingEvent.rows[0]) {
          throw new Error("预约事实已经变化，但缺少可关联的预约历史事件。");
        }
        bookingEventId = existingEvent.rows[0].id;
        occurredAt = getDemoNow();
        result = row.status === "confirmed" ? currentSchedule(row) : null;
      } else {
        if (input.expectedBookingRevision !== row.verification_code_version) {
          businessError(
            "BOOKING_FACT_CHANGED",
            "预约安排已被其他操作者更新，原处理页不会覆盖新事实；请重新读取。",
            HttpStatus.CONFLICT,
          );
        }
        if (!stillAffected) {
          businessError(
            "BOOKING_FACT_CHANGED",
            "预约已经在其他入口解除本次影响，请刷新后确认现有结果。",
            HttpStatus.CONFLICT,
          );
        }
        this.requireManagerChangeAllowed(row);
        this.requireManagerExpectedFact(row, {
          expectedStaffId: row.staff_id,
          expectedStartsAt: row.starts_at.toISOString(),
          expectedBookingRevision: row.verification_code_version,
        });
      }

      if (input.action === "cancel") {
        const applied = await this.applyAtomicCancellation(client, row, {
          actorType: "manager",
          actorId: manager.id,
          reason: input.reason,
          auditEventType: "manager_booking_cancelled",
        });
        bookingEventId = applied.eventId;
        occurredAt = applied.occurredAt;
        result = null;
      } else if (input.action === "change_staff" || input.action === "reschedule") {
        const applied = await this.applyAtomicReschedule(
          client,
          row,
          {
            idempotencyKey: input.idempotencyKey,
            staffId: input.staffId as string,
            startsAt:
              input.action === "change_staff"
                ? row.starts_at.toISOString()
                : (input.startsAt as string),
          },
          {
            actorType: "manager",
            actorId: manager.id,
            reason: input.reason,
            auditEventType: "manager_booking_rescheduled",
            availabilityActor: "manager",
          },
        );
        bookingEventId = applied.eventId;
        occurredAt = applied.occurredAt;
        result = applied.next;
      }
      if (!bookingEventId || !occurredAt || result === undefined) {
        throw new Error("受影响预约处理没有产生完整的原子结果。");
      }

      const resolutionId = `capacity-resolution-${randomUUID()}`;
      await client.query(
        `INSERT INTO capacity_change_booking_resolutions (
           id, staff_time_off_id, store_closure_id, booking_id, action,
           manager_id, idempotency_key, request_digest, reason,
           original_snapshot, result_summary, booking_event_id, resolved_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
        [
          resolutionId,
          kind === "time_off" ? capacityChangeId : null,
          kind === "store_closure" ? capacityChangeId : null,
          bookingId,
          resolutionAction,
          manager.id,
          input.idempotencyKey,
          digest,
          input.reason,
          JSON.stringify(impact),
          result ? JSON.stringify(result) : null,
          bookingEventId,
          occurredAt,
        ],
      );
      const subjectType = kind === "time_off" ? "staff_time_off" : "store_closure";
      await client.query(
        `INSERT INTO audit_events (
           id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
         )
         VALUES ($1, 'capacity_change_booking_resolved', 'manager', $2, $3, $4, $5::jsonb, $6)`,
        [
          `audit-${randomUUID()}`,
          manager.id,
          subjectType,
          capacityChangeId,
          JSON.stringify({
            bookingId,
            action: resolutionAction,
            reason: input.reason,
            bookingEventId,
          }),
          occurredAt,
        ],
      );
      const countResult = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM capacity_change_booking_resolutions
         WHERE ($1::text = 'time_off' AND staff_time_off_id = $2
           OR $1::text = 'store_closure' AND store_closure_id = $2)`,
        [kind, capacityChangeId],
      );
      const resolvedCount = countResult.rows[0]?.count ?? 0;
      const activated = resolvedCount === change.affected_booking_count;
      if (activated) {
        await client.query(
          kind === "time_off"
            ? `UPDATE staff_time_off_intervals
               SET status = 'active', activated_at = $2
               WHERE id = $1 AND status = 'pending'`
            : `UPDATE store_closure_intervals
               SET status = 'active', activated_at = $2
               WHERE id = $1 AND status = 'pending'`,
          [capacityChangeId, occurredAt],
        );
        await client.query(
          `INSERT INTO audit_events (
             id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
           )
           VALUES ($1, 'capacity_change_status_changed', 'manager', $2, $3, $4, $5::jsonb, $6)`,
          [
            `audit-${randomUUID()}`,
            manager.id,
            subjectType,
            capacityChangeId,
            JSON.stringify({ previousStatus: "pending", status: "active" }),
            occurredAt,
          ],
        );
      }
      const response: ResolveCapacityChangeBookingResponse = {
        change: {
          id: capacityChangeId,
          kind,
          status: activated ? "active" : "pending",
        },
        progress: { resolved: resolvedCount, total: change.affected_booking_count },
        resolvedBooking: {
          id: resolutionId,
          bookingId,
          action: resolutionAction,
          operator: { id: manager.id, displayName: manager.displayName },
          reason: input.reason,
          result,
          bookingEventId,
          resolvedAt: occurredAt,
        },
      };
      await client.query(
        `UPDATE capacity_change_booking_resolutions
         SET response_body = $2::jsonb
         WHERE id = $1`,
        [resolutionId, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return { response };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      let finalError = error;
      if (
        this.isBookingTimeConflict(error) ||
        databaseError.code === "23P01" ||
        databaseError.code === "40001" ||
        databaseError.code === "40P01"
      ) {
        finalError = new HttpException(
          {
            code: "BOOKING_TIME_CONFLICT",
            message: "新安排未能成立，原安排和处理进度保持不变；请重新读取相近建议。",
          },
          HttpStatus.CONFLICT,
        );
      }
      if (!replayedFailure && finalError instanceof HttpException) {
        await this.persistManagerChangeFailure(
          client,
          manager.id,
          "capacity_impact_resolution",
          input.idempotencyKey,
          digest,
          finalError,
        );
      }
      throw finalError;
    } finally {
      let releaseError: Error | undefined;
      if (idempotencyLockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [idempotencyLockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("受影响预约处理幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError =
            error instanceof Error ? error : new Error("受影响预约处理幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async rescheduleOptions(
    customerId: string,
    bookingId: string,
  ): Promise<RescheduleBookingOptionsResponse> {
    this.requireBookingId(bookingId);
    const client = await this.database.pool.connect();
    let row: BookingRow;
    try {
      row = await this.findBookingRow(client, customerId, bookingId);
    } finally {
      client.release();
    }
    const actions = customerActions(row);
    if (!actions.canReschedule) {
      return {
        booking: asBooking(row),
        customerActions: actions,
        availability: null,
      };
    }
    const selection = currentSelection(row);
    const availability = await this.availability.discover({
      customerId,
      petId: row.pet_id,
      primaryServiceId: row.primary_service_id_snapshot,
      addonIds: row.addon_snapshots.map((addon) => addon.id).join(","),
      excludeBookingId: row.id,
      selectionOverride: selection,
    });
    return {
      booking: asBooking(row),
      customerActions: actions,
      availability: {
        ...availability,
        days: availability.days.map((day) => ({
          ...day,
          slots: day.slots.filter(
            (slot) =>
              !(slot.staff.id === row.staff_id && slot.startsAt === row.starts_at.toISOString()),
          ),
        })),
      },
    };
  }

  async managerRescheduleOptions(
    bookingId: string,
    staffId?: string,
  ): Promise<ManagerRescheduleBookingOptionsResponse> {
    this.requireBookingId(bookingId);
    const client = await this.database.pool.connect();
    let row: BookingRow;
    try {
      row = await this.findManagerBookingRow(client, bookingId);
    } finally {
      client.release();
    }
    const actions = managerBookingActions(row.status);
    if (!actions.canReschedule) {
      return {
        booking: asBooking(row),
        bookingRevision: row.verification_code_version,
        managerActions: actions,
        availability: null,
      };
    }
    const availability = await this.availability.discover({
      customerId: row.customer_id,
      petId: row.pet_id,
      primaryServiceId: row.primary_service_id_snapshot,
      addonIds: row.addon_snapshots.map((addon) => addon.id).join(","),
      ...(staffId ? { staffId } : {}),
      excludeBookingId: row.id,
      selectionOverride: currentSelection(row),
      earliestStartsAtOverride: earliestManagerCandidate(getDemoNow()),
    });
    return {
      booking: asBooking(row),
      bookingRevision: row.verification_code_version,
      managerActions: actions,
      availability: {
        ...availability,
        days: availability.days.map((day) => ({
          ...day,
          slots: day.slots.filter(
            (slot) =>
              !(slot.staff.id === row.staff_id && slot.startsAt === row.starts_at.toISOString()),
          ),
        })),
      },
    };
  }

  async managerCorrectionOptions(
    bookingId: string,
  ): Promise<ManagerBookingCorrectionOptionsResponse> {
    this.requireBookingId(bookingId);
    const client = await this.database.pool.connect();
    let row: BookingRow;
    try {
      row = await this.findManagerBookingRow(client, bookingId);
    } finally {
      client.release();
    }
    const currentContent = currentSelection(row);
    const catalog = this.catalog.getStorefront();
    const primaryService = catalog.primaryServices.find(
      (service) => service.id === row.primary_service_id_snapshot,
    );
    const availableAddonIds = new Set(primaryService?.availableAddonIds ?? []);

    return {
      booking: asBooking(row),
      bookingRevision: row.verification_code_version,
      contentDigest: requestDigest(currentContent),
      managerActions: managerBookingActions(row.status),
      currentContent,
      availableAddons: catalog.addons
        .filter(
          (addon) =>
            availableAddonIds.has(addon.id) &&
            addon.applicableSpecies.includes(row.pet_species_snapshot),
        )
        .map(({ id, name, description }) => ({ id, name, description })),
    };
  }

  async managerCorrectionPreview(
    bookingId: string,
    body: unknown,
  ): Promise<ManagerBookingCorrectionPreviewResponse> {
    this.requireBookingId(bookingId);
    const draft = parseManagerCorrectionDraft(body);
    const client = await this.database.pool.connect();
    try {
      const row = await this.findManagerBookingRow(client, bookingId);
      this.requireManagerChangeAllowed(row);
      const candidateContent = this.correctedSelection(row, draft);
      const staff = await this.requireQualifiedCorrectionStaff(client, row, candidateContent);
      const interval = await this.requireCorrectionCapacity(client, row, draft, candidateContent);
      return {
        booking: asBooking(row),
        currentContent: currentSelection(row),
        candidateContent,
        interval,
        validation: {
          skill: {
            status: "satisfied",
            staff: { id: staff.id, displayName: staff.display_name },
          },
          capacity: { status: "available" },
        },
        canSave: true,
      };
    } finally {
      client.release();
    }
  }

  async managerCorrectContent(
    manager: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<ManagerBookingContentCorrectionResponse> {
    this.requireManager(manager);
    this.requireBookingId(bookingId);
    const input = parseManagerContentCorrectionInput(body);
    const digest = requestDigest({ bookingId, ...input });
    const client = await this.database.pool.connect();
    const lockKey = `${manager.id}:manager_content_correction:${input.idempotencyKey}`;
    let lockHeld = false;
    let replayedFailure = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<ManagerChangeIdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM manager_booking_change_idempotency_keys
          WHERE manager_id = $1
            AND command_type = 'manager_content_correction'
            AND idempotency_key = $2
        `,
        [manager.id, input.idempotencyKey],
      );
      const previousResult = existing.rows[0];
      if (previousResult) {
        if (previousResult.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条预约内容纠正命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        await client.query("COMMIT");
        if (previousResult.booking_id && previousResult.response_status < 300) {
          return previousResult.response_body as ManagerBookingContentCorrectionResponse;
        }
        if (!previousResult.response_body || typeof previousResult.response_body !== "object") {
          throw new Error("预约内容纠正幂等结果缺少失败响应。");
        }
        replayedFailure = true;
        throw new HttpException(previousResult.response_body, previousResult.response_status);
      }

      const row = await this.findManagerBookingRow(client, bookingId, true);
      this.requireManagerChangeAllowed(row);
      this.requireManagerExpectedFact(row, input);
      if (requestDigest(currentSelection(row)) !== input.expectedContentDigest) {
        businessError(
          "BOOKING_FACT_CHANGED",
          "预约内容已被其他操作者更新，原页面不会覆盖新事实；请重新读取后再操作。",
          HttpStatus.CONFLICT,
          {
            booking: asBooking(row),
            bookingRevision: row.verification_code_version,
            contentDigest: requestDigest(currentSelection(row)),
            managerActions: managerBookingActions(row.status),
          },
        );
      }
      const next = this.correctedSelection(row, input);
      if (requestDigest(next) === input.expectedContentDigest) {
        businessError(
          "BOOKING_CONTENT_UNCHANGED",
          "体重、服务规格和增项均未变化，无需保存纠正。",
          HttpStatus.BAD_REQUEST,
        );
      }
      await this.requireQualifiedCorrectionStaff(client, row, next);
      const interval = await this.requireCorrectionCapacity(client, row, input, next);
      const applied = await this.applyAtomicContentCorrection(client, row, input, next, interval, {
        id: manager.id,
        displayName: manager.displayName,
      });
      const response: ManagerBookingContentCorrectionResponse = {
        booking: asBooking(applied.booking),
        bookingRevision: applied.booking.verification_code_version,
        contentDigest: requestDigest(applied.next),
        managerActions: managerBookingActions(applied.booking.status),
        verificationCodeStatus: "unchanged",
        change: {
          id: applied.eventId,
          kind: "manager_content_corrected",
          actor: { type: "manager", id: manager.id, displayName: manager.displayName },
          reason: input.reason,
          previous: applied.previous,
          next: applied.next,
          occurredAt: applied.occurredAt,
        },
      };
      await client.query(
        `
          INSERT INTO manager_booking_change_idempotency_keys (
            manager_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'manager_content_correction', $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          manager.id,
          input.idempotencyKey,
          digest,
          bookingId,
          HttpStatus.CREATED,
          JSON.stringify(response),
          applied.occurredAt,
        ],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      if (
        !replayedFailure &&
        (this.isBookingTimeConflict(error) ||
          databaseError.code === "23P01" ||
          databaseError.code === "40001" ||
          databaseError.code === "40P01")
      ) {
        await this.throwManagerCorrectionCapacityConflict(
          manager,
          bookingId,
          input,
          digest,
          client,
        );
      }
      if (!replayedFailure && error instanceof HttpException) {
        await this.persistManagerChangeFailure(
          client,
          manager.id,
          "manager_content_correction",
          input.idempotencyKey,
          digest,
          error,
        );
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("预约内容纠正幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("预约内容纠正幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async managerReschedule(
    manager: BackofficeIdentity,
    bookingId: string,
    body: unknown,
  ): Promise<ManagerBookingChangeResponse> {
    this.requireManager(manager);
    this.requireBookingId(bookingId);
    const input = parseManagerRescheduleInput(body);
    const digest = requestDigest({ bookingId, ...input });
    const client = await this.database.pool.connect();
    const lockKey = `${manager.id}:manager_reschedule:${input.idempotencyKey}`;
    let lockHeld = false;
    let replayedFailure = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<ManagerChangeIdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM manager_booking_change_idempotency_keys
          WHERE manager_id = $1
            AND command_type = 'manager_reschedule'
            AND idempotency_key = $2
        `,
        [manager.id, input.idempotencyKey],
      );
      const previousResult = existing.rows[0];
      if (previousResult) {
        if (previousResult.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条店长改期命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        await client.query("COMMIT");
        if (previousResult.booking_id && previousResult.response_status < 300) {
          return previousResult.response_body as ManagerBookingChangeResponse;
        }
        if (!previousResult.response_body || typeof previousResult.response_body !== "object") {
          throw new Error("店长改期幂等结果缺少失败响应。");
        }
        replayedFailure = true;
        throw new HttpException(previousResult.response_body, previousResult.response_status);
      }

      const row = await this.findManagerBookingRow(client, bookingId, true);
      this.requireManagerChangeAllowed(row);
      this.requireManagerExpectedFact(row, input);
      const applied = await this.applyAtomicReschedule(client, row, input, {
        actorType: "manager",
        actorId: manager.id,
        reason: input.reason,
        auditEventType: "manager_booking_rescheduled",
        availabilityActor: "manager",
      });
      const change: ManagerBookingChange = {
        id: applied.eventId,
        kind: "manager_rescheduled",
        actor: {
          type: "manager",
          id: manager.id,
          displayName: manager.displayName,
        },
        reason: input.reason,
        previous: applied.previous,
        next: applied.next,
        occurredAt: applied.occurredAt,
      };
      const response: ManagerBookingChangeResponse = {
        booking: asBooking(applied.booking),
        bookingRevision: applied.booking.verification_code_version,
        managerActions: managerBookingActions(applied.booking.status),
        verificationCodeStatus: "rotated",
        change,
      };
      await client.query(
        `
          INSERT INTO manager_booking_change_idempotency_keys (
            manager_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'manager_reschedule', $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          manager.id,
          input.idempotencyKey,
          digest,
          bookingId,
          HttpStatus.CREATED,
          JSON.stringify(response),
          applied.occurredAt,
        ],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      if (
        !replayedFailure &&
        (this.isBookingTimeConflict(error) ||
          databaseError.code === "23P01" ||
          databaseError.code === "40001" ||
          databaseError.code === "40P01")
      ) {
        await this.throwManagerRescheduleTimeConflict(manager, bookingId, input, digest, client);
      }
      if (!replayedFailure && error instanceof HttpException) {
        await this.persistManagerChangeFailure(
          client,
          manager.id,
          "manager_reschedule",
          input.idempotencyKey,
          digest,
          error,
        );
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("店长改期幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("店长改期幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  async reschedule(
    customerId: string,
    bookingId: string,
    body: unknown,
  ): Promise<RescheduleBookingResponse> {
    this.requireBookingId(bookingId);
    const input = parseRescheduleInput(body);
    const digest = requestDigest({ bookingId, ...input });
    const client = await this.database.pool.connect();
    const lockKey = `${customerId}:customer_reschedule:${input.idempotencyKey}`;
    let lockHeld = false;
    let replayedFailure = false;

    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
      lockHeld = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED");
      const existing = await client.query<IdempotencyRow>(
        `
          SELECT request_digest, booking_id, response_status, response_body
          FROM booking_idempotency_keys
          WHERE customer_id = $1
            AND command_type = 'customer_reschedule'
            AND idempotency_key = $2
        `,
        [customerId, input.idempotencyKey],
      );
      const previousResult = existing.rows[0];
      if (previousResult) {
        if (previousResult.request_digest !== digest) {
          businessError(
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已经用于另一条改期命令，请重新提交。",
            HttpStatus.CONFLICT,
          );
        }
        if (!previousResult.booking_id) {
          if (
            previousResult.response_status &&
            previousResult.response_body &&
            typeof previousResult.response_body === "object"
          ) {
            await client.query("COMMIT");
            replayedFailure = true;
            throw new HttpException(previousResult.response_body, previousResult.response_status);
          }
          throw new Error("改期幂等结果缺少成功预约或失败响应。");
        }
        if (
          previousResult.response_status &&
          previousResult.response_status >= 200 &&
          previousResult.response_status < 300 &&
          isStoredRescheduleSuccess(previousResult.response_body)
        ) {
          const storedBooking = await this.findBookingRow(
            client,
            customerId,
            previousResult.booking_id,
          );
          const stored = previousResult.response_body;
          await client.query("COMMIT");
          return {
            booking: stored.booking,
            verificationCode: verificationCode(
              customerId,
              previousResult.booking_id,
              storedBooking.verification_code_seed,
              stored.verificationCodeVersion,
            ),
            verificationWindow: stored.verificationWindow,
            customerActions: stored.customerActions,
            changeHistory: stored.changeHistory,
          };
        }
        const row = await this.findBookingRow(client, customerId, previousResult.booking_id);
        const response = await this.detailResponse(client, row);
        await client.query("COMMIT");
        if (!response.verificationCode || !response.verificationWindow) {
          throw new Error("改期成功结果缺少有效核销码。");
        }
        return {
          ...response,
          verificationCode: response.verificationCode,
          verificationWindow: response.verificationWindow,
        };
      }

      const row = await this.findBookingRow(client, customerId, bookingId, true);
      this.requireCustomerChangeAllowed(row);
      const applied = await this.applyAtomicReschedule(client, row, input, {
        actorType: "customer",
        actorId: customerId,
        reason: "顾客自行改期",
        auditEventType: "customer_booking_rescheduled",
        availabilityActor: "customer",
      });
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest, booking_id, created_at
          )
          VALUES ($1, 'customer_reschedule', $2, $3, $4, $5)
        `,
        [customerId, input.idempotencyKey, digest, bookingId, applied.occurredAt],
      );
      const rescheduled = applied.booking;
      const response = await this.detailResponse(client, rescheduled);
      const result: RescheduleBookingResponse = {
        ...response,
        verificationCode: applied.verificationCode,
        verificationWindow: verificationWindow(rescheduled),
      };
      const storedResult: StoredRescheduleSuccess = {
        kind: "customer_reschedule_success",
        booking: result.booking,
        verificationWindow: result.verificationWindow,
        customerActions: result.customerActions,
        changeHistory: result.changeHistory,
        verificationCodeVersion: applied.verificationCodeVersion,
      };
      await client.query(
        `
          UPDATE booking_idempotency_keys
          SET response_status = $4, response_body = $5::jsonb
          WHERE customer_id = $1
            AND command_type = 'customer_reschedule'
            AND idempotency_key = $2
            AND request_digest = $3
        `,
        [
          customerId,
          input.idempotencyKey,
          digest,
          HttpStatus.CREATED,
          JSON.stringify(storedResult),
        ],
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const databaseError = error as DatabaseError;
      if (
        !replayedFailure &&
        (this.isBookingTimeConflict(error) ||
          databaseError.code === "23P01" ||
          databaseError.code === "40001" ||
          databaseError.code === "40P01")
      ) {
        await this.throwRescheduleTimeConflict(customerId, bookingId, input, digest, client);
      }
      if (!replayedFailure && error instanceof HttpException) {
        const response = error.getResponse();
        if (response && typeof response === "object") {
          try {
            await client.query("BEGIN");
            await client.query(
              `
                INSERT INTO booking_idempotency_keys (
                  customer_id, command_type, idempotency_key, request_digest,
                  booking_id, response_status, response_body, created_at
                )
                VALUES ($1, 'customer_reschedule', $2, $3, NULL, $4, $5::jsonb, $6)
                ON CONFLICT (customer_id, command_type, idempotency_key) DO NOTHING
              `,
              [
                customerId,
                input.idempotencyKey,
                digest,
                error.getStatus(),
                JSON.stringify(response),
                getDemoNow(),
              ],
            );
            await client.query("COMMIT");
          } catch (persistError) {
            await client.query("ROLLBACK").catch(() => undefined);
            throw persistError;
          }
        }
      }
      throw error;
    } finally {
      let releaseError: Error | undefined;
      if (lockHeld) {
        try {
          const unlocked = await client.query<{ unlocked: boolean }>(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
            [lockKey],
          );
          if (!unlocked.rows[0]?.unlocked) {
            releaseError = new Error("改期幂等锁未能释放，连接不可复用。");
          }
        } catch (error) {
          releaseError = error instanceof Error ? error : new Error("改期幂等锁释放失败。");
        }
      }
      client.release(releaseError);
    }
  }

  private async throwManagerProxyTimeConflict(
    manager: BackofficeIdentity,
    input: ParsedManagerProxyInput,
    digest: string,
    client: PoolClient,
  ): Promise<never> {
    const commonDiscovery = {
      primaryServiceId: input.primaryServiceId,
      addonIds: input.addonIds.join(","),
      staffId: input.staffId,
      earliestStartsAtOverride: earliestManagerCandidate(getDemoNow()),
    };
    const availability =
      input.profile.kind === "existing"
        ? await this.availability.discover(
            {
              ...commonDiscovery,
              customerId: input.profile.customerId,
              petId: input.profile.petId,
            },
            client,
          )
        : await (() => {
            const pet: PetRow = {
              id: "manager-proxy-pet",
              name: input.profile.pet.name,
              species: input.profile.pet.species,
              weight_kg: String(input.profile.pet.weightKg),
              archived_at: null,
            };
            return this.availability.discover(
              {
                ...commonDiscovery,
                customerId: "manager-proxy-customer",
                petId: pet.id,
                petOverride: {
                  id: pet.id,
                  name: pet.name,
                  species: pet.species,
                  weightKg: Number(pet.weight_kg),
                },
                selectionOverride: this.quote(pet, input.primaryServiceId, input.addonIds),
              },
              client,
            );
          })();
    const proposed: BookingConflictBody = {
      code: "BOOKING_TIME_CONFLICT",
      message: "这个时段刚被占用，代客预约没有建立，请选择相近可用安排。",
      nextStep: "conflict",
      suggestions: nearbySuggestions(availability, input.startsAt),
    };
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO manager_proxy_booking_idempotency_keys (
            manager_id, idempotency_key, request_digest, booking_id,
            response_status, response_body, created_at
          )
          VALUES ($1, $2, $3, NULL, $4, $5::jsonb, $6)
        `,
        [
          manager.id,
          input.idempotencyKey,
          digest,
          HttpStatus.CONFLICT,
          JSON.stringify(proposed),
          getDemoNow(),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    throw new HttpException(proposed, HttpStatus.CONFLICT);
  }

  private async insertConfirmedBooking(
    client: PoolClient,
    facts: {
      customerId: string;
      pet: PetRow;
      selection: BookingSelectionQuote;
      staff: StaffRow;
      interval: { startsAt: string; endsAt: string; turnoverEndsAt: string };
      idempotencyKey: string;
      actor: { type: "customer" | "manager"; id: string };
      createdAt: string;
      extraFactPayload?: Record<string, unknown>;
    },
  ): Promise<{ bookingId: string; code: string }> {
    const bookingId = randomUUID();
    const code = verificationCode(facts.customerId, bookingId, facts.idempotencyKey);
    await client.query(
      `
        INSERT INTO bookings (
          id, customer_id, pet_id, staff_id, starts_at, ends_at,
          occupancy_starts_at, occupancy_ends_at, service_duration_minutes, status,
          pet_name_snapshot, pet_species_snapshot, pet_weight_kg_snapshot, pet_size_snapshot,
          primary_service_id_snapshot, primary_service_name_snapshot,
          primary_service_price_cents, primary_service_duration_minutes,
          addon_snapshots, required_skill_ids_snapshot, total_price_cents,
          staff_display_name_snapshot, turnover_minutes,
          original_starts_at, original_ends_at,
          original_occupancy_starts_at, original_occupancy_ends_at,
          verification_code_digest, verification_code_seed, created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $5, $7, $8, 'confirmed',
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17::jsonb, $18::jsonb, $19, $20, 15,
          $5, $6, $5, $7, $21, $22, $23
        )
      `,
      [
        bookingId,
        facts.customerId,
        facts.pet.id,
        facts.staff.id,
        facts.interval.startsAt,
        facts.interval.endsAt,
        facts.interval.turnoverEndsAt,
        facts.selection.serviceDurationMinutes,
        facts.pet.name,
        facts.pet.species,
        Number(facts.pet.weight_kg),
        facts.selection.pet.petSize,
        facts.selection.primaryService.id,
        facts.selection.primaryService.name,
        facts.selection.primaryService.priceCents,
        facts.selection.primaryService.durationMinutes,
        JSON.stringify(facts.selection.addons),
        JSON.stringify(facts.selection.requiredSkillIds),
        facts.selection.totalPriceCents,
        facts.staff.display_name,
        verificationCodeDigest(bookingId, code),
        facts.idempotencyKey,
        facts.createdAt,
      ],
    );
    const factPayload = JSON.stringify({
      status: "confirmed",
      petId: facts.pet.id,
      staffId: facts.staff.id,
      startsAt: facts.interval.startsAt,
      endsAt: facts.interval.endsAt,
      turnoverEndsAt: facts.interval.turnoverEndsAt,
      totalPriceCents: facts.selection.totalPriceCents,
      ...facts.extraFactPayload,
    });
    await client.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES ($1, $2, 'booking_confirmed', $3, $4, $5::jsonb, $6)
      `,
      [randomUUID(), bookingId, facts.actor.type, facts.actor.id, factPayload, facts.createdAt],
    );
    await client.query(
      `
        INSERT INTO audit_events (
          id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
        )
        VALUES ($1, 'booking_created', $2, $3, 'booking', $4, $5::jsonb, $6)
      `,
      [randomUUID(), facts.actor.type, facts.actor.id, bookingId, factPayload, facts.createdAt],
    );
    await client.query(
      `
        INSERT INTO notification_outbox (
          id, booking_id, customer_id, notification_type, payload,
          status, available_at, created_at
        )
        VALUES ($1, $2, $3, 'booking_confirmed', $4::jsonb, 'pending', $5, $5)
      `,
      [
        randomUUID(),
        bookingId,
        facts.customerId,
        JSON.stringify({
          bookingId,
          petName: facts.pet.name,
          serviceName: facts.selection.primaryService.name,
          staffName: facts.staff.display_name,
          startsAt: facts.interval.startsAt,
        }),
        facts.createdAt,
      ],
    );
    return { bookingId, code };
  }

  private async applyAtomicCancellation(
    client: PoolClient,
    row: BookingRow,
    context: {
      actorType: "customer" | "manager";
      actorId: string;
      reason: string;
      auditEventType: "customer_booking_cancelled" | "manager_booking_cancelled";
    },
  ): Promise<AppliedCancellation> {
    const occurredAt = getDemoNow();
    const previous = currentSchedule(row);
    const payload = { reason: context.reason, previous, next: null };
    const eventId = randomUUID();
    await client.query(
      `
        UPDATE bookings
        SET status = 'cancelled', occupancy_starts_at = NULL, occupancy_ends_at = NULL
        WHERE id = $1
      `,
      [row.id],
    );
    await client.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES ($1, $2, 'booking_cancelled', $3, $4, $5::jsonb, $6)
      `,
      [eventId, row.id, context.actorType, context.actorId, JSON.stringify(payload), occurredAt],
    );
    await client.query(
      `
        INSERT INTO audit_events (
          id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
        )
        VALUES ($1, $2, $3, $4, 'booking', $5, $6::jsonb, $7)
      `,
      [
        randomUUID(),
        context.auditEventType,
        context.actorType,
        context.actorId,
        row.id,
        JSON.stringify(payload),
        occurredAt,
      ],
    );
    await client.query(
      `
        INSERT INTO notification_outbox (
          id, booking_id, customer_id, notification_type, payload,
          status, available_at, created_at
        )
        VALUES ($1, $2, $3, 'booking_cancelled', $4::jsonb, 'pending', $5, $5)
      `,
      [randomUUID(), row.id, row.customer_id, JSON.stringify(payload), occurredAt],
    );
    return {
      booking: await this.findManagerBookingRow(client, row.id),
      eventId,
      occurredAt,
      previous,
    };
  }

  private async applyAtomicReschedule(
    client: PoolClient,
    row: BookingRow,
    input: RescheduleBookingInput,
    context: {
      actorType: "customer" | "manager";
      actorId: string;
      reason: string;
      auditEventType: "customer_booking_rescheduled" | "manager_booking_rescheduled";
      availabilityActor: "customer" | "manager";
    },
  ): Promise<AppliedReschedule> {
    if (row.staff_id === input.staffId && row.starts_at.toISOString() === input.startsAt) {
      businessError(
        "BOOKING_SCHEDULE_UNCHANGED",
        "新安排与当前安排相同，请选择其他员工或时段。",
        HttpStatus.BAD_REQUEST,
      );
    }
    const selection = currentSelection(row);
    const staff = await this.requireQualifiedStaff(client, input.staffId, selection);
    const interval = await this.requireAvailableInterval(
      client,
      {
        idempotencyKey: input.idempotencyKey,
        petId: row.pet_id,
        primaryServiceId: row.primary_service_id_snapshot,
        addonIds: row.addon_snapshots.map((addon) => addon.id),
        staffId: input.staffId,
        staffPreference: { kind: "specified", staffId: input.staffId },
        startsAt: input.startsAt,
      },
      selection,
      row.id,
      context.availabilityActor,
    );
    const previousCode = activeVerificationCode(row);
    if (!previousCode) {
      throw new Error("当前预约核销码摘要与服务端派生值不一致。");
    }
    let verificationCodeVersion = row.verification_code_version + 1;
    let nextVerificationCode = verificationCode(
      row.customer_id,
      row.id,
      row.verification_code_seed,
      verificationCodeVersion,
    );
    while (nextVerificationCode === previousCode) {
      verificationCodeVersion += 1;
      nextVerificationCode = verificationCode(
        row.customer_id,
        row.id,
        row.verification_code_seed,
        verificationCodeVersion,
      );
    }
    const occurredAt = getDemoNow();
    const previous = currentSchedule(row);
    const next: CustomerBookingSchedule = {
      staff: { id: staff.id, displayName: staff.display_name },
      ...interval,
    };
    const payload = { reason: context.reason, previous, next };
    const eventId = randomUUID();

    await client.query(
      `
        UPDATE bookings
        SET staff_id = $2,
            staff_display_name_snapshot = $3,
            starts_at = $4,
            ends_at = $5,
            occupancy_starts_at = $4,
            occupancy_ends_at = $6,
            verification_code_version = $7,
            verification_code_digest = $8
        WHERE id = $1
      `,
      [
        row.id,
        staff.id,
        staff.display_name,
        interval.startsAt,
        interval.endsAt,
        interval.turnoverEndsAt,
        verificationCodeVersion,
        verificationCodeDigest(row.id, nextVerificationCode),
      ],
    );
    await client.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES ($1, $2, 'booking_rescheduled', $3, $4, $5::jsonb, $6)
      `,
      [eventId, row.id, context.actorType, context.actorId, JSON.stringify(payload), occurredAt],
    );
    await client.query(
      `
        INSERT INTO audit_events (
          id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
        )
        VALUES ($1, $2, $3, $4, 'booking', $5, $6::jsonb, $7)
      `,
      [
        randomUUID(),
        context.auditEventType,
        context.actorType,
        context.actorId,
        row.id,
        JSON.stringify(payload),
        occurredAt,
      ],
    );
    await client.query(
      `
        INSERT INTO notification_outbox (
          id, booking_id, customer_id, notification_type, payload,
          status, available_at, created_at
        )
        VALUES ($1, $2, $3, 'booking_rescheduled', $4::jsonb, 'pending', $5, $5)
      `,
      [randomUUID(), row.id, row.customer_id, JSON.stringify(payload), occurredAt],
    );
    const booking = await this.findManagerBookingRow(client, row.id);
    return {
      booking,
      verificationCode: nextVerificationCode,
      verificationCodeVersion,
      eventId,
      occurredAt,
      previous,
      next,
    };
  }

  private async applyAtomicContentCorrection(
    client: PoolClient,
    row: BookingRow,
    input: ManagerBookingContentCorrectionInput,
    next: BookingSelectionQuote,
    interval: { startsAt: string; endsAt: string; turnoverEndsAt: string },
    manager: { id: string; displayName: string },
  ): Promise<AppliedContentCorrection> {
    const occurredAt = getDemoNow();
    const previous = currentSelection(row);
    const payload = { reason: input.reason, previous, next };
    const eventId = randomUUID();

    await client.query("UPDATE pets SET weight_kg = $2, updated_at = $3 WHERE id = $1", [
      row.pet_id,
      input.petWeightKg,
      occurredAt,
    ]);
    await client.query(
      `
        UPDATE bookings
        SET pet_weight_kg_snapshot = $2,
            pet_size_snapshot = $3,
            primary_service_name_snapshot = $4,
            primary_service_price_cents = $5,
            primary_service_duration_minutes = $6,
            addon_snapshots = $7::jsonb,
            required_skill_ids_snapshot = $8::jsonb,
            total_price_cents = $9,
            service_duration_minutes = $10,
            ends_at = $11,
            occupancy_ends_at = $12
        WHERE id = $1
      `,
      [
        row.id,
        input.petWeightKg,
        next.pet.petSize,
        next.primaryService.name,
        next.primaryService.priceCents,
        next.primaryService.durationMinutes,
        JSON.stringify(next.addons),
        JSON.stringify(next.requiredSkillIds),
        next.totalPriceCents,
        next.serviceDurationMinutes,
        interval.endsAt,
        interval.turnoverEndsAt,
      ],
    );
    await client.query(
      `
        INSERT INTO booking_events (
          id, booking_id, event_type, actor_type, actor_id, payload, occurred_at
        )
        VALUES ($1, $2, 'booking_content_corrected', 'manager', $3, $4::jsonb, $5)
      `,
      [eventId, row.id, manager.id, JSON.stringify(payload), occurredAt],
    );
    await client.query(
      `
        INSERT INTO audit_events (
          id, event_type, actor_type, actor_id, subject_type, subject_id, payload, occurred_at
        )
        VALUES (
          $1, 'manager_booking_content_corrected', 'manager', $2,
          'booking', $3, $4::jsonb, $5
        )
      `,
      [randomUUID(), manager.id, row.id, JSON.stringify(payload), occurredAt],
    );
    await client.query(
      `
        INSERT INTO notification_outbox (
          id, booking_id, customer_id, notification_type, payload,
          status, available_at, created_at
        )
        VALUES (
          $1, $2, $3, 'booking_content_corrected', $4::jsonb,
          'pending', $5, $5
        )
      `,
      [
        randomUUID(),
        row.id,
        row.customer_id,
        JSON.stringify({
          ...payload,
          petName: next.pet.name,
          serviceName: next.primaryService.name,
          staffName: row.staff_display_name_snapshot,
          startsAt: row.starts_at.toISOString(),
          managerDisplayName: manager.displayName,
        }),
        occurredAt,
      ],
    );
    return {
      booking: await this.findManagerBookingRow(client, row.id),
      eventId,
      occurredAt,
      previous,
      next,
    };
  }

  private async throwManagerRescheduleTimeConflict(
    manager: BackofficeIdentity,
    bookingId: string,
    input: ManagerRescheduleBookingInput,
    digest: string,
    client: PoolClient,
  ): Promise<never> {
    const row = await this.findManagerBookingRow(client, bookingId);
    const availability = await this.availability.discover(
      {
        customerId: row.customer_id,
        petId: row.pet_id,
        primaryServiceId: row.primary_service_id_snapshot,
        addonIds: row.addon_snapshots.map((addon) => addon.id).join(","),
        excludeBookingId: row.id,
        selectionOverride: currentSelection(row),
        earliestStartsAtOverride: earliestManagerCandidate(getDemoNow()),
      },
      client,
    );
    const proposed: RescheduleConflictBody = {
      code: "BOOKING_TIME_CONFLICT",
      message: "新安排刚刚被占用，原安排和核销码保持不变，请选择相近可用安排。",
      nextStep: "conflict",
      booking: asBooking(row),
      requested: { staffId: input.staffId, startsAt: input.startsAt },
      suggestions: nearbySuggestions(availability, input.startsAt),
    };
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO manager_booking_change_idempotency_keys (
            manager_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'manager_reschedule', $2, $3, NULL, $4, $5::jsonb, $6)
        `,
        [
          manager.id,
          input.idempotencyKey,
          digest,
          HttpStatus.CONFLICT,
          JSON.stringify(proposed),
          getDemoNow(),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    throw new HttpException(proposed, HttpStatus.CONFLICT);
  }

  private async throwManagerCorrectionCapacityConflict(
    manager: BackofficeIdentity,
    bookingId: string,
    input: ManagerBookingContentCorrectionInput,
    digest: string,
    client: PoolClient,
  ): Promise<never> {
    const row = await this.findManagerBookingRow(client, bookingId);
    const candidate = this.correctedSelection(row, input);
    const candidateEndsAt = new Date(
      row.starts_at.getTime() + candidate.serviceDurationMinutes * 60_000,
    );
    const candidateOccupancyEndsAt = new Date(
      candidateEndsAt.getTime() + row.turnover_minutes * 60_000,
    );
    const blocker = await client.query<{ id: string }>(
      `
        SELECT id
        FROM bookings
        WHERE id <> $1
          AND status NOT IN ('cancelled', 'no_show')
          AND (staff_id = $2 OR pet_id = $3)
          AND tstzrange(occupancy_starts_at, occupancy_ends_at, '[)')
              && tstzrange($4::timestamptz, $5::timestamptz, '[)')
        ORDER BY starts_at, id
        LIMIT 1
      `,
      [
        row.id,
        row.staff_id,
        row.pet_id,
        row.starts_at.toISOString(),
        candidateOccupancyEndsAt.toISOString(),
      ],
    );
    const proposed = {
      code: "BOOKING_CORRECTION_CAPACITY_UNAVAILABLE",
      message: "纠正保存时连续容量刚刚发生变化，原快照和实际占用保持不变；请换员工、改期或取消。",
      booking: asBooking(row),
      blocker: blocker.rows[0] ? { bookingId: blocker.rows[0].id } : null,
      candidate,
      validation: {
        skill: { status: "satisfied" },
        capacity: { status: "insufficient", reason: "concurrent_change" },
      },
      nextSteps: ["change_staff", "reschedule", "cancel"],
    };
    const conflict = new HttpException(proposed, HttpStatus.CONFLICT);
    await this.persistManagerChangeFailure(
      client,
      manager.id,
      "manager_content_correction",
      input.idempotencyKey,
      digest,
      conflict,
    );
    throw conflict;
  }

  private async persistManagerChangeFailure(
    client: PoolClient,
    managerId: string,
    commandType:
      | "manager_reschedule"
      | "manager_cancel"
      | "manager_content_correction"
      | "capacity_impact_resolution",
    idempotencyKey: string,
    digest: string,
    error: HttpException,
  ): Promise<void> {
    const response = error.getResponse();
    if (!response || typeof response !== "object") return;
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO manager_booking_change_idempotency_keys (
            manager_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, $2, $3, $4, NULL, $5, $6::jsonb, $7)
          ON CONFLICT (manager_id, command_type, idempotency_key) DO NOTHING
        `,
        [
          managerId,
          commandType,
          idempotencyKey,
          digest,
          error.getStatus(),
          JSON.stringify(response),
          getDemoNow(),
        ],
      );
      await client.query("COMMIT");
    } catch (persistError) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw persistError;
    }
  }

  private async throwRescheduleTimeConflict(
    customerId: string,
    bookingId: string,
    input: RescheduleBookingInput,
    digest: string,
    client: PoolClient,
  ): Promise<never> {
    const row = await this.findBookingRow(client, customerId, bookingId);
    const availability = await this.availability.discover(
      {
        customerId,
        petId: row.pet_id,
        primaryServiceId: row.primary_service_id_snapshot,
        addonIds: row.addon_snapshots.map((addon) => addon.id).join(","),
        excludeBookingId: row.id,
        selectionOverride: currentSelection(row),
      },
      client,
    );
    const proposed: RescheduleConflictBody = {
      code: "BOOKING_TIME_CONFLICT",
      message: "刚刚有人选走了这个安排，原安排保持不变，请选择相近可用安排。",
      nextStep: "conflict",
      booking: asBooking(row),
      requested: { staffId: input.staffId, startsAt: input.startsAt },
      suggestions: nearbySuggestions(availability, input.startsAt),
    };

    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'customer_reschedule', $2, $3, NULL, $4, $5::jsonb, $6)
        `,
        [
          customerId,
          input.idempotencyKey,
          digest,
          HttpStatus.CONFLICT,
          JSON.stringify(proposed),
          getDemoNow(),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    throw new HttpException(proposed, HttpStatus.CONFLICT);
  }

  private isBookingTimeConflict(error: unknown): boolean {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    if (!response || typeof response !== "object") return false;
    const code = (response as { code?: unknown }).code;
    return code === "STAFF_TIME_CONFLICT" || code === "PET_TIME_CONFLICT";
  }

  private async throwBookingTimeConflict(
    customerId: string,
    input: CreateBookingInput,
    digest: string,
    client: PoolClient,
  ): Promise<never> {
    const availability = await this.availability.discover(
      {
        customerId,
        petId: input.petId,
        primaryServiceId: input.primaryServiceId,
        addonIds: input.addonIds.join(","),
        staffId:
          input.staffPreference.kind === "specified" ? input.staffPreference.staffId : undefined,
      },
      client,
    );
    const proposed: BookingConflictBody = {
      code: "BOOKING_TIME_CONFLICT",
      message: "刚刚有人选走了这个时段，请选择相近可用安排。",
      nextStep: "conflict",
      suggestions: nearbySuggestions(availability, input.startsAt),
    };
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO booking_idempotency_keys (
            customer_id, command_type, idempotency_key, request_digest,
            booking_id, response_status, response_body, created_at
          )
          VALUES ($1, 'create_booking', $2, $3, NULL, $4, $5::jsonb, $6)
        `,
        [
          customerId,
          input.idempotencyKey,
          digest,
          HttpStatus.CONFLICT,
          JSON.stringify(proposed),
          getDemoNow(),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    throw new HttpException(proposed, HttpStatus.CONFLICT);
  }

  async detail(customerId: string, bookingId: string): Promise<BookingDetailResponse> {
    this.requireBookingId(bookingId);
    const client = await this.database.pool.connect();
    try {
      const row = await this.findBookingRow(client, customerId, bookingId);
      return this.detailResponse(client, row);
    } finally {
      client.release();
    }
  }

  async history(customerId: string): Promise<CustomerBookingHistoryResponse> {
    const result = await this.database.pool.query<BookingRow>(
      `
        SELECT ${bookingColumns}
        FROM bookings
        WHERE customer_id = $1
        ORDER BY starts_at DESC, id DESC
      `,
      [customerId],
    );
    const now = Date.parse(getDemoNow());
    const upcoming: ConfirmedBooking[] = [];
    const history: ConfirmedBooking[] = [];
    for (const row of result.rows) {
      const booking = asBooking(row);
      const remainsCurrent =
        (row.status === "confirmed" || row.status === "checked_in") && row.ends_at.getTime() >= now;
      (remainsCurrent ? upcoming : history).push(booking);
    }
    upcoming.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    return { demoNow: getDemoNow(), upcoming, history };
  }

  async messages(customerId: string): Promise<CustomerMessagesResponse> {
    const result = await this.database.pool.query<CustomerMessageRow>(
      `
        SELECT notification.id,
               notification.notification_type,
               notification.booking_id,
               notification.created_at,
               notification.payload,
               booking.pet_name_snapshot,
               booking.primary_service_name_snapshot,
               booking.staff_display_name_snapshot,
               booking.starts_at
        FROM notification_outbox AS notification
        JOIN bookings AS booking ON booking.id = notification.booking_id
        WHERE notification.customer_id = $1
          AND booking.customer_id = $1
        ORDER BY notification.created_at DESC, notification.sequence DESC
      `,
      [customerId],
    );
    return { messages: result.rows.map(asCustomerMessage) };
  }

  async message(customerId: string, messageId: string): Promise<CustomerMessageDetailResponse> {
    if (!idPattern.test(messageId) && !/^[0-9a-f-]{36}$/.test(messageId)) {
      businessError("MESSAGE_NOT_FOUND", "找不到这条消息。", HttpStatus.NOT_FOUND);
    }
    const result = await this.database.pool.query<CustomerMessageRow>(
      `
        SELECT notification.id,
               notification.notification_type,
               notification.booking_id,
               notification.created_at,
               notification.payload,
               booking.pet_name_snapshot,
               booking.primary_service_name_snapshot,
               booking.staff_display_name_snapshot,
               booking.starts_at
        FROM notification_outbox AS notification
        JOIN bookings AS booking ON booking.id = notification.booking_id
        WHERE notification.id = $1
          AND notification.customer_id = $2
          AND booking.customer_id = $2
      `,
      [messageId, customerId],
    );
    const row = result.rows[0];
    if (!row) {
      businessError("MESSAGE_NOT_FOUND", "找不到这条消息。", HttpStatus.NOT_FOUND);
    }
    return { message: asCustomerMessage(row) };
  }

  private async findBookingRow(
    client: PoolClient,
    customerId: string,
    bookingId: string,
    forUpdate = false,
  ): Promise<BookingRow> {
    const result = await client.query<BookingRow>(
      `SELECT ${bookingColumns} FROM bookings WHERE id = $1 AND customer_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [bookingId, customerId],
    );
    const row = result.rows[0];
    if (!row) {
      businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    }
    return row;
  }

  private async findManagerBookingRow(
    client: PoolClient,
    bookingId: string,
    forUpdate = false,
  ): Promise<BookingRow> {
    const result = await client.query<BookingRow>(
      `SELECT ${bookingColumns} FROM bookings WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
      [bookingId],
    );
    const row = result.rows[0];
    if (!row) {
      businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    }
    return row;
  }

  private requireBookingId(bookingId: string): void {
    if (!idPattern.test(bookingId) && !/^[0-9a-f-]{36}$/.test(bookingId)) {
      businessError("BOOKING_NOT_FOUND", "找不到这笔预约。", HttpStatus.NOT_FOUND);
    }
  }

  private requireManager(identity: BackofficeIdentity): void {
    if (identity.role !== "manager") {
      businessError("FORBIDDEN", "只有店长可以变更门店预约。", HttpStatus.FORBIDDEN);
    }
  }

  private requireManagerChangeAllowed(row: BookingRow): void {
    if (row.status !== "confirmed") {
      businessError(
        "BOOKING_CHANGE_NOT_ALLOWED",
        managerBookingActions(row.status).message,
        HttpStatus.CONFLICT,
        {
          managerActions: managerBookingActions(row.status),
          booking: asBooking(row),
          bookingRevision: row.verification_code_version,
        },
      );
    }
  }

  private requireManagerExpectedFact(
    row: BookingRow,
    expected: {
      expectedStaffId: string;
      expectedStartsAt: string;
      expectedBookingRevision: number;
    },
  ): void {
    if (
      row.verification_code_version !== expected.expectedBookingRevision ||
      row.staff_id !== expected.expectedStaffId ||
      row.starts_at.toISOString() !== expected.expectedStartsAt
    ) {
      businessError(
        "BOOKING_FACT_CHANGED",
        "预约安排已被其他操作者更新，已保留对方成立的事实；请重新读取后再操作。",
        HttpStatus.CONFLICT,
        {
          managerActions: managerBookingActions(row.status),
          booking: asBooking(row),
          bookingRevision: row.verification_code_version,
        },
      );
    }
  }

  private requireCustomerChangeAllowed(row: BookingRow): void {
    if (row.status !== "confirmed") {
      businessError(
        "BOOKING_CHANGE_NOT_ALLOWED",
        "当前预约状态不支持顾客自行改期或取消，请联系门店处理。",
        HttpStatus.CONFLICT,
      );
    }
    if (Date.parse(getDemoNow()) > row.starts_at.getTime() - 12 * 60 * 60_000) {
      businessError(
        "BOOKING_CHANGE_CUTOFF_PASSED",
        "开始前已不足 12 小时，请联系门店处理。",
        HttpStatus.CONFLICT,
        { customerActions: customerActions(row) },
      );
    }
  }

  private async detailResponse(
    client: PoolClient,
    row: BookingRow,
  ): Promise<BookingDetailResponse> {
    const code = activeVerificationCode(row);
    const changes = await client.query<BookingChangeRow>(
      `
        SELECT id, event_type, actor_type, actor_id, payload, occurred_at
        FROM booking_events
        WHERE booking_id = $1
          AND event_type IN ('booking_cancelled', 'booking_rescheduled')
        ORDER BY occurred_at DESC, sequence DESC
      `,
      [row.id],
    );
    const changeHistory: CustomerBookingChange[] = changes.rows.map((change) => ({
      id: change.id,
      kind:
        change.actor_type === "manager"
          ? change.event_type === "booking_cancelled"
            ? "manager_cancelled"
            : "manager_rescheduled"
          : change.event_type === "booking_cancelled"
            ? "customer_cancelled"
            : "customer_rescheduled",
      actor: { type: change.actor_type, id: change.actor_id },
      reason: change.payload.reason,
      previous: change.payload.previous,
      next: change.payload.next,
      occurredAt: change.occurred_at.toISOString(),
    }));
    return {
      booking: asBooking(row),
      verificationCode: code,
      verificationWindow: code ? verificationWindow(row) : null,
      customerActions: customerActions(row),
      changeHistory,
    };
  }

  private async requirePrivacyConsent(client: PoolClient, customerId: string): Promise<void> {
    const result = await client.query<{ accepted: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM privacy_notices AS notice
          JOIN privacy_consents AS consent
            ON consent.notice_version = notice.version
           AND consent.customer_id = $1
          WHERE notice.is_current
        ) AS accepted
      `,
      [customerId],
    );
    if (!result.rows[0]?.accepted) {
      businessError(
        "PRIVACY_CONSENT_REQUIRED",
        "隐私说明尚未同意或已经更新，请确认后再提交预约。",
        HttpStatus.CONFLICT,
        { nextStep: "privacy" },
      );
    }
  }

  private async requireActivePet(
    client: PoolClient,
    customerId: string,
    petId: string,
  ): Promise<PetRow> {
    const result = await client.query<PetRow>(
      `
        SELECT id, name, species, weight_kg::text, archived_at
        FROM pets
        WHERE id = $1 AND customer_id = $2
      `,
      [petId, customerId],
    );
    const pet = result.rows[0];
    if (!pet) {
      businessError(
        "PET_NOT_FOUND",
        "找不到这份宠物档案，或当前顾客无权访问。",
        HttpStatus.NOT_FOUND,
      );
    }
    if (pet.archived_at) {
      businessError(
        "PET_ARCHIVED",
        "已归档宠物不能用于新预约，请先恢复使用。",
        HttpStatus.CONFLICT,
        { nextStep: "pet" },
      );
    }
    return pet;
  }

  private quote(pet: PetRow, primaryServiceId: string, addonIds: string[]): BookingSelectionQuote {
    try {
      return quoteBookingSelection(
        {
          id: pet.id,
          name: pet.name,
          species: pet.species,
          weightKg: Number(pet.weight_kg),
          petSize: petSizeFor(Number(pet.weight_kg)),
        },
        this.catalog.getStorefront(),
        primaryServiceId,
        addonIds,
      );
    } catch (error) {
      businessError(
        "SERVICE_NOT_AVAILABLE",
        error instanceof Error ? error.message : "服务已经停用或不再适用于这只宠物。",
        HttpStatus.CONFLICT,
        { nextStep: "service" },
      );
    }
  }

  private correctedSelection(
    row: BookingRow,
    input: ManagerBookingCorrectionDraft,
  ): BookingSelectionQuote {
    if (input.primaryServiceId !== row.primary_service_id_snapshot) {
      businessError(
        "BOOKING_CONTENT_REPLACEMENT_NOT_ALLOWED",
        "纠正不能更换为完全不同的主要服务；请取消当前预约后新建。",
        HttpStatus.BAD_REQUEST,
        { nextStep: "cancel_and_rebook" },
      );
    }
    try {
      return quoteBookingSelection(
        {
          id: row.pet_id,
          name: row.pet_name_snapshot,
          species: row.pet_species_snapshot,
          weightKg: input.petWeightKg,
          petSize: petSizeFor(input.petWeightKg),
        },
        this.catalog.getStorefront(),
        input.primaryServiceId,
        input.addonIds,
      );
    } catch (error) {
      businessError(
        "SERVICE_NOT_AVAILABLE",
        error instanceof Error ? error.message : "服务已经停用或不再适用于这只宠物。",
        HttpStatus.CONFLICT,
        { nextStep: "service" },
      );
    }
  }

  private async requireQualifiedStaff(
    client: PoolClient,
    staffId: string,
    selection: BookingSelectionQuote,
  ): Promise<StaffRow> {
    const staff = await this.lockCurrentStaffFacts(client, staffId);
    if (!staff || !hasAllSkills(staff, selection.requiredSkillIds)) {
      businessError(
        "STAFF_NOT_QUALIFIED",
        "所选员工当前无法完成全部服务，请重新选择员工或时段。",
        HttpStatus.CONFLICT,
        { nextStep: "staff" },
      );
    }
    return staff;
  }

  private async requireQualifiedCorrectionStaff(
    client: PoolClient,
    row: BookingRow,
    selection: BookingSelectionQuote,
  ): Promise<StaffRow> {
    const staff = await this.lockCurrentStaffFacts(client, row.staff_id);
    const currentSkills = new Set(staff?.skills ?? []);
    const missingSkillIds = selection.requiredSkillIds.filter((skill) => !currentSkills.has(skill));
    if (!staff || missingSkillIds.length > 0) {
      businessError(
        "BOOKING_CORRECTION_SKILL_MISMATCH",
        `${staff?.display_name ?? row.staff_display_name_snapshot}当前不能覆盖纠正后全部员工技能，请换员工、改期或取消。`,
        HttpStatus.CONFLICT,
        {
          booking: asBooking(row),
          candidate: selection,
          validation: {
            skill: { status: "insufficient", missingSkillIds },
            capacity: { status: "not_checked" },
          },
          nextSteps: ["change_staff", "reschedule", "cancel"],
        },
      );
    }
    return staff;
  }

  private async lockCurrentStaffFacts(
    client: PoolClient,
    staffId: string,
  ): Promise<StaffRow | undefined> {
    const identity = await client.query<{ id: string; display_name: string }>(
      `
        SELECT staff.id, account.display_name
        FROM staff_members AS staff
        JOIN backoffice_accounts AS account ON account.id = staff.id
        WHERE staff.id = $1 AND staff.active = true AND account.active = true
        FOR SHARE OF staff, account
      `,
      [staffId],
    );
    const member = identity.rows[0];
    if (!member) return undefined;

    const skills = await client.query<{ skill_id: StaffSkillId }>(
      "SELECT skill_id FROM staff_skills WHERE staff_id = $1 ORDER BY skill_id",
      [staffId],
    );
    return { ...member, skills: skills.rows.map((skill) => skill.skill_id) };
  }

  private async requireCorrectionCapacity(
    client: PoolClient,
    row: BookingRow,
    input: ManagerBookingCorrectionDraft & { idempotencyKey?: string },
    selection: BookingSelectionQuote,
  ): Promise<{ startsAt: string; endsAt: string; turnoverEndsAt: string }> {
    try {
      return await this.requireAvailableInterval(
        client,
        {
          idempotencyKey: input.idempotencyKey ?? "manager-correction-preview",
          petId: row.pet_id,
          primaryServiceId: row.primary_service_id_snapshot,
          addonIds: input.addonIds,
          staffId: row.staff_id,
          staffPreference: { kind: "specified", staffId: row.staff_id },
          startsAt: row.starts_at.toISOString(),
        },
        selection,
        row.id,
        "correction",
      );
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== HttpStatus.CONFLICT) {
        throw error;
      }
      const response = error.getResponse();
      const code =
        response && typeof response === "object" && "code" in response
          ? String((response as { code: unknown }).code)
          : "";
      if (
        ![
          "STAFF_TIME_CONFLICT",
          "PET_TIME_CONFLICT",
          "SLOT_NO_LONGER_AVAILABLE",
          "SLOT_OUTSIDE_OPEN_WINDOW",
        ].includes(code)
      ) {
        throw error;
      }
      const candidateEndsAt = new Date(
        row.starts_at.getTime() + selection.serviceDurationMinutes * 60_000,
      );
      const candidateOccupancyEndsAt = new Date(
        candidateEndsAt.getTime() + row.turnover_minutes * 60_000,
      );
      const blocker = await client.query<{ id: string }>(
        `
          SELECT id
          FROM bookings
          WHERE id <> $1
            AND staff_id = $2
            AND status NOT IN ('cancelled', 'no_show')
            AND tstzrange(occupancy_starts_at, occupancy_ends_at, '[)')
                && tstzrange($3::timestamptz, $4::timestamptz, '[)')
          ORDER BY starts_at, id
          LIMIT 1
        `,
        [row.id, row.staff_id, row.starts_at.toISOString(), candidateOccupancyEndsAt.toISOString()],
      );
      businessError(
        "BOOKING_CORRECTION_CAPACITY_UNAVAILABLE",
        "纠正后的连续容量不足，原快照和实际占用保持不变；请换员工、改期或取消。",
        HttpStatus.CONFLICT,
        {
          booking: asBooking(row),
          blocker: blocker.rows[0] ? { bookingId: blocker.rows[0].id } : null,
          candidate: selection,
          validation: {
            skill: { status: "satisfied" },
            capacity: { status: "insufficient", reason: code },
          },
          nextSteps: ["change_staff", "reschedule", "cancel"],
        },
      );
    }
  }

  private async requireAvailableInterval(
    client: PoolClient,
    input: CreateBookingInput,
    selection: BookingSelectionQuote,
    excludeBookingId: string | null = null,
    actor: "customer" | "manager" | "correction" = "customer",
  ): Promise<{ startsAt: string; endsAt: string; turnoverEndsAt: string }> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(startsAt.getTime() + selection.serviceDurationMinutes * 60_000);
    const turnoverEndsAt = new Date(endsAt.getTime() + 15 * 60_000);
    const localDate = getShanghaiLocalDate(startsAt);
    const window = bookingWindowFor(getDemoNow());
    const localMinute = localMinuteOfDay(startsAt);
    const earliestCandidate =
      actor === "manager" || actor === "correction"
        ? earliestManagerCandidate(getDemoNow())
        : earliestCustomerCandidate(getDemoNow());
    const enforceOpenWindow = actor !== "correction";

    if (
      startsAt.getUTCSeconds() !== 0 ||
      startsAt.getUTCMilliseconds() !== 0 ||
      localMinute % 30 !== 0 ||
      (enforceOpenWindow && startsAt.getTime() < Date.parse(earliestCandidate)) ||
      (enforceOpenWindow && localDate < window.startsOn) ||
      (enforceOpenWindow && localDate > window.endsOn) ||
      getShanghaiLocalDate(turnoverEndsAt) !== localDate
    ) {
      businessError(
        "SLOT_OUTSIDE_OPEN_WINDOW",
        "所选时间已超出预约开放窗口，请重新选择。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }

    const capacity = await client.query<{
      within_business_hours: boolean;
      within_published_schedule: boolean;
      capacity_blocked: boolean;
      staff_conflict: boolean;
      pet_conflict: boolean;
    }>(
      `
        SELECT
          EXISTS (
            SELECT 1
            FROM store_business_hours
            WHERE weekday = extract(dow FROM $1::timestamptz AT TIME ZONE 'Asia/Shanghai')::int
              AND opens_at IS NOT NULL
              AND opens_at <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              AND closes_at >= ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
          ) AS within_business_hours,
          EXISTS (
            SELECT 1
            FROM staff_schedule_days AS day
            JOIN staff_schedule_shifts AS shift ON shift.schedule_day_id = day.id
            WHERE day.staff_id = $4
              AND day.local_date = $6::date
              AND day.publication_status = 'published'
              AND day.published_at IS NOT NULL
              AND shift.starts_at <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              AND shift.ends_at >= ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              AND NOT EXISTS (
                SELECT 1
                FROM staff_schedule_breaks AS shift_break
                WHERE shift_break.schedule_shift_id = shift.id
                  AND shift_break.starts_at < ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
                  AND shift_break.ends_at > ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
              )
          ) AS within_published_schedule,
          (
            EXISTS (
              SELECT 1
              FROM staff_time_off_intervals
              WHERE staff_id = $4
                AND local_date = $6::date
                AND status IN ('pending', 'active')
                AND starts_at < ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
                AND ends_at > ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
            )
            OR EXISTS (
              SELECT 1
              FROM store_closure_intervals
              WHERE local_date = $6::date
                AND status IN ('pending', 'active')
                AND starts_at < ($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
                AND ends_at > ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::time
            )
          ) AS capacity_blocked,
          EXISTS (
            SELECT 1 FROM bookings
            WHERE staff_id = $4
              AND status NOT IN ('cancelled', 'no_show')
              AND ($7::text IS NULL OR id <> $7)
              AND tstzrange(occupancy_starts_at, occupancy_ends_at, '[)')
                  && tstzrange($1::timestamptz, $3::timestamptz, '[)')
          ) AS staff_conflict,
          EXISTS (
            SELECT 1 FROM bookings
            WHERE pet_id = $5
              AND status NOT IN ('cancelled', 'no_show')
              AND ($7::text IS NULL OR id <> $7)
              AND tstzrange(starts_at, ends_at, '[)')
                  && tstzrange($1::timestamptz, $2::timestamptz, '[)')
          ) AS pet_conflict
      `,
      [
        startsAt.toISOString(),
        endsAt.toISOString(),
        turnoverEndsAt.toISOString(),
        input.staffId,
        input.petId,
        localDate,
        excludeBookingId,
      ],
    );
    const result = capacity.rows[0];
    if (result?.pet_conflict) {
      businessError(
        "PET_TIME_CONFLICT",
        "这只宠物在所选时间已有预约，请选择其他时段。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }
    if (result?.staff_conflict) {
      businessError(
        "STAFF_TIME_CONFLICT",
        "这个员工的时段刚被占用，请选择相近时段。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }
    if (
      !result?.within_business_hours ||
      !result.within_published_schedule ||
      result.capacity_blocked
    ) {
      businessError(
        "SLOT_NO_LONGER_AVAILABLE",
        "所选时段已不在当前已发布排班或可用容量内，请重新选择。",
        HttpStatus.CONFLICT,
        { nextStep: "time" },
      );
    }
    return {
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      turnoverEndsAt: turnoverEndsAt.toISOString(),
    };
  }
}
