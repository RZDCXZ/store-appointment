export * from "./manager-live-booking.js";
export * from "./staff-fulfilment.js";
export * from "./capacity-change.js";
export * from "./notification.js";
export * from "./customer-records.js";
export * from "./customer-data-rights.js";
export * from "./business.js";
export * from "./audit.js";

export interface HealthResponse {
  service: "rongguang-api";
  status: "ok";
  database: "ready";
  timestamp: string;
}

export const backofficeNavigation = {
  manager: [
    { key: "workbench", label: "工作台" },
    { key: "appointments", label: "预约" },
    { key: "schedule", label: "排班" },
    { key: "services", label: "服务" },
    { key: "customers", label: "顾客" },
    { key: "business", label: "经营" },
    { key: "system", label: "系统" },
  ],
  staff: [
    { key: "today", label: "今日工作" },
    { key: "appointments", label: "我的预约" },
  ],
} as const;

export type BackofficeRole = keyof typeof backofficeNavigation;
export type BackofficeNavigationKey = (typeof backofficeNavigation)[BackofficeRole][number]["key"];

export const backofficeRoles = {
  manager: {
    label: "店长",
    workspaceLabel: "店长后台",
    navigationLabel: "店长导航",
    loadingNavigationLabel: "店长导航加载中",
    landingPath: "/manager/workbench",
  },
  staff: {
    label: "员工",
    workspaceLabel: "员工工作台",
    navigationLabel: "员工导航",
    loadingNavigationLabel: "员工导航加载中",
    landingPath: "/staff/today",
  },
} as const satisfies Record<
  BackofficeRole,
  {
    label: string;
    workspaceLabel: string;
    navigationLabel: string;
    loadingNavigationLabel: string;
    landingPath: `/${string}`;
  }
>;

export interface BackofficeAccount {
  id: string;
  username: string;
  displayName: string;
  role: BackofficeRole;
}

export interface BackofficeAuthResponse {
  account: BackofficeAccount;
}

export interface BackofficeLandingResponse extends BackofficeAuthResponse {
  navigation: string[];
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}

export interface DemoCustomerChoice {
  key: string;
  displayName: string;
  story: "正常预约" | "已有未来预约" | "取消或爽约历史";
  avatarInitial: string;
}

export interface MiniappCustomerProfile {
  displayName: string;
  phoneMasked: string;
  story: DemoCustomerChoice["story"];
  avatarInitial: string;
}

export interface DemoCustomerChoicesResponse {
  customers: DemoCustomerChoice[];
}

export interface MiniappSessionResponse {
  accessToken: string;
  expiresAt: string;
  customerKey: string;
  customer: MiniappCustomerProfile;
}

export interface MiniappProfileResponse {
  customer: MiniappCustomerProfile;
}

export type PetSpecies = "dog" | "cat";
export type PetSize = "small" | "medium" | "large";

export type PetSex = "male" | "female";
export type PetCoatType = "short" | "long" | "double" | "curly" | "hairless" | "other";

export const petCareTags = [
  "怕吹风",
  "对陌生犬敏感",
  "不喜欢碰脚",
  "易紧张",
  "需要慢速吹干",
  "耳部需轻柔",
] as const;

export type PetCareTag = (typeof petCareTags)[number];

export interface PetFutureBooking {
  id: string;
  startsAt: string;
}

export interface PetProfile {
  id: string;
  name: string;
  species: PetSpecies;
  weightKg: number;
  petSize: PetSize;
  breed: string | null;
  sex: PetSex | null;
  birthDate: string | null;
  coatType: PetCoatType | null;
  photoId: string | null;
  photoPath: string | null;
  careTags: PetCareTag[];
  careNotes: string | null;
  archivedAt: string | null;
  futureBooking: PetFutureBooking | null;
}

export interface PetListResponse {
  active: PetProfile[];
  archived: PetProfile[];
}

export interface PetProfileResponse {
  pet: PetProfile;
}

export interface PetProfileInput {
  name: string;
  species: PetSpecies;
  weightKg: number;
  breed: string | null;
  sex: PetSex | null;
  birthDate: string | null;
  coatType: PetCoatType | null;
  photoId: string | null;
  careTags: PetCareTag[];
  careNotes: string | null;
}

export interface PrivacyNotice {
  version: string;
  title: string;
  summary: string;
  publishedAt: string;
}

export interface PrivacyConsent {
  version: string;
  source: "miniapp_booking" | "manager_offline";
  consentedAt: string;
}

export interface PrivacyConsentStatusResponse {
  notice: PrivacyNotice;
  consent: PrivacyConsent | null;
  requiresConsent: boolean;
}

export interface BookingEntryResponse {
  canContinue: boolean;
  requiredPrivacyNoticeVersion: string;
}

export interface PetPhoto {
  id: string;
  photoPath: string;
  mimeType: "image/jpeg" | "image/png";
  sizeBytes: number;
}

export interface PetPhotoUploadResponse {
  photo: PetPhoto;
}

export interface WeeklyBusinessHours {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  openAt: string | null;
  closeAt: string | null;
}

export interface StorefrontStore {
  brandName: string;
  city: "上海";
  demoNow: string;
  address: string;
  contactPhone: string;
  timeZone: "Asia/Shanghai";
  weeklyBusinessHours: WeeklyBusinessHours[];
}

export interface ServiceSpecification {
  petSize: PetSize;
  priceCents: number;
  durationMinutes: number;
}

export interface PrimaryService {
  id: string;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  availableAddonIds: string[];
  requiredSkillIds?: StaffSkillId[];
  specifications: ServiceSpecification[];
}

export interface ServiceAddon {
  id: string;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds?: StaffSkillId[];
  specifications: ServiceSpecification[];
}

export interface StorefrontCatalogResponse {
  store: StorefrontStore;
  primaryServices: PrimaryService[];
  addons: ServiceAddon[];
}

export type StaffSkillId =
  "dog-basic-care" | "dog-styling" | "cat-care" | "nail-care" | "deshedding-care" | "oral-care";

export type ServiceCatalogItemStatus = "active" | "inactive";

export interface ManagerServiceSpecification extends ServiceSpecification {
  id: string;
  status: ServiceCatalogItemStatus;
  referencedByBookings: boolean;
}

export interface ManagerPrimaryService {
  id: string;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  availableAddonIds: string[];
  specifications: ManagerServiceSpecification[];
  status: ServiceCatalogItemStatus;
  referencedByBookings: boolean;
  updatedAt: string;
}

export interface ManagerServiceAddon {
  id: string;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  specifications: ManagerServiceSpecification[];
  status: ServiceCatalogItemStatus;
  referencedByBookings: boolean;
  updatedAt: string;
}

export interface ManagerServiceCatalogResponse {
  revision: number;
  primaryServices: ManagerPrimaryService[];
  addons: ManagerServiceAddon[];
}

export interface ManagerStaffSkillColumn {
  id: string;
  name: string;
  kind: "primary_service" | "addon";
  status: ServiceCatalogItemStatus;
  requiredSkillIds: StaffSkillId[];
}

export interface ManagerStaffAccount {
  id: string;
  username: string;
  displayName: string;
  employeeNumber: number;
  status: "active" | "inactive";
  skillIds: StaffSkillId[];
  shiftSummary: {
    publishedShiftCount: number;
    scheduledMinutes: number;
    nextShiftStartsAt: string | null;
  };
}

export interface ManagerStaffResponse {
  staff: ManagerStaffAccount[];
  skillColumns: ManagerStaffSkillColumn[];
}

export interface ManagerServiceSpecificationInput {
  id?: string;
  petSize: PetSize;
  priceCents: number;
  durationMinutes: number;
  active?: boolean;
}

export interface ManagerPrimaryServiceInput {
  expectedRevision: number;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  availableAddonIds: string[];
  specifications: ManagerServiceSpecificationInput[];
}

export interface ManagerServiceAddonInput {
  expectedRevision: number;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  specifications: ManagerServiceSpecificationInput[];
}

export interface ScheduleBusinessHours {
  status: "open" | "closed";
  opensAt: string | null;
  closesAt: string | null;
}

export interface ScheduleWindowDay {
  date: string;
  weekday: number;
  businessHours: ScheduleBusinessHours;
  publishedStaffCount: number;
}

export interface ScheduleTimeInterval {
  startsAt: string;
  endsAt: string;
}

export function getShanghaiLocalDate(instant: string | Date): string {
  const date = instant instanceof Date ? instant : new Date(instant);

  if (Number.isNaN(date.getTime())) {
    throw new Error("无法把无效时刻转换为上海本地日期。");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export interface PublishedScheduleShift extends ScheduleTimeInterval {
  breaks: ScheduleTimeInterval[];
  capacity: ScheduleTimeInterval[];
}

export interface PublishedScheduleStaffDay {
  staff: {
    id: string;
    displayName: string;
    employeeNumber: number;
    skills: StaffSkillId[];
  };
  scheduleStatus: "published" | "no_schedule";
  source: "weekly_template" | "date_exception" | null;
  exception: {
    kind: "adjusted_shift" | "overtime" | "special_break" | "day_off";
    note: string;
  } | null;
  shifts: PublishedScheduleShift[];
}

export interface ManagerPublishedScheduleResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  selectedDate: string;
  window: {
    startsOn: string;
    endsOn: string;
    days: ScheduleWindowDay[];
  };
  businessHours: ScheduleBusinessHours;
  draftDayCount: number;
  staffDays: PublishedScheduleStaffDay[];
}

export interface EditableScheduleShift extends ScheduleTimeInterval {
  breaks: ScheduleTimeInterval[];
}

export interface WeeklyScheduleTemplateDay {
  weekday: number;
  businessHours: ScheduleBusinessHours;
  shifts: EditableScheduleShift[];
}

export interface SchedulePlanningStaff {
  id: string;
  displayName: string;
  employeeNumber: number;
  templateDays: WeeklyScheduleTemplateDay[];
}

export interface ScheduleDraftStaffDay {
  staffId: string;
  status: "draft";
  source: "weekly_template" | "date_exception";
  exception: PublishedScheduleStaffDay["exception"];
  shifts: EditableScheduleShift[];
}

export interface ScheduleDraftDay {
  date: string;
  weekday: number;
  businessHours: ScheduleBusinessHours;
  staffDays: ScheduleDraftStaffDay[];
}

export interface ManagerSchedulePlanningResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  window: {
    startsOn: string;
    endsOn: string;
  };
  staff: SchedulePlanningStaff[];
  draftDays: ScheduleDraftDay[];
}

export interface ManagerSchedulePublishResponse {
  publishedCount: number;
}

export type BookingAvailabilityReason =
  "closed" | "no_qualified_staff" | "fully_booked" | "outside_open_window";

export interface BookingSelectionLine {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

export interface BookingSelectionQuote {
  pet: {
    id: string;
    name: string;
    species: PetSpecies;
    petSize: PetSize;
    weightKg: number;
  };
  primaryService: BookingSelectionLine;
  addons: BookingSelectionLine[];
  totalPriceCents: number;
  serviceDurationMinutes: number;
  requiredSkillIds: StaffSkillId[];
}

export function quoteBookingSelection(
  pet: BookingSelectionQuote["pet"],
  catalog: StorefrontCatalogResponse,
  primaryServiceId: string,
  addonIds: string[],
): BookingSelectionQuote {
  const primaryService = catalog.primaryServices.find((service) => service.id === primaryServiceId);
  const primarySpecification = primaryService?.specifications.find(
    (specification) => specification.petSize === pet.petSize,
  );
  if (
    !primaryService ||
    !primaryService.applicableSpecies.includes(pet.species) ||
    !primarySpecification
  ) {
    throw new Error("这项主要服务不适用于所选宠物。");
  }

  const allowedAddonIds = new Set(primaryService.availableAddonIds);
  const addons = addonIds.map((addonId) => {
    const addon = catalog.addons.find((item) => item.id === addonId);
    const specification = addon?.specifications.find((item) => item.petSize === pet.petSize);
    if (
      !addon ||
      !allowedAddonIds.has(addon.id) ||
      !addon.applicableSpecies.includes(pet.species) ||
      !specification
    ) {
      throw new Error("所选增项与主要服务或宠物不兼容。");
    }
    return {
      id: addon.id,
      name: addon.name,
      priceCents: specification.priceCents,
      durationMinutes: specification.durationMinutes,
    };
  });
  const primaryLine = {
    id: primaryService.id,
    name: primaryService.name,
    priceCents: primarySpecification.priceCents,
    durationMinutes: primarySpecification.durationMinutes,
  };

  return {
    pet: { ...pet },
    primaryService: primaryLine,
    addons,
    totalPriceCents:
      primaryLine.priceCents + addons.reduce((total, addon) => total + addon.priceCents, 0),
    serviceDurationMinutes:
      primaryLine.durationMinutes +
      addons.reduce((total, addon) => total + addon.durationMinutes, 0),
    requiredSkillIds: [
      ...(primaryService.requiredSkillIds ?? [primaryService.id as StaffSkillId]),
      ...addons.flatMap((line) => {
        const addon = catalog.addons.find((item) => item.id === line.id);
        return addon?.requiredSkillIds ?? [line.id as StaffSkillId];
      }),
    ].filter((skill, index, skills) => skills.indexOf(skill) === index),
  };
}

export interface BookingAvailabilityStaff {
  id: string;
  displayName: string;
  employeeNumber: number;
  earliestSlot: {
    startsAt: string;
    endsAt: string;
  } | null;
}

export interface BookingAvailableSlot {
  startsAt: string;
  endsAt: string;
  turnoverEndsAt: string;
  staff: {
    id: string;
    displayName: string;
    employeeNumber: number;
  };
}

export interface BookingAvailabilityDay {
  date: string;
  weekday: number;
  reason: BookingAvailabilityReason | null;
  reasonLabel: string;
  slots: BookingAvailableSlot[];
}

export interface BookingAvailabilityResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  window: {
    startsOn: string;
    endsOn: string;
    earliestStartsAt: string;
  };
  selection: BookingSelectionQuote;
  staffOptions: BookingAvailabilityStaff[];
  days: BookingAvailabilityDay[];
}

export interface CreateBookingInput {
  idempotencyKey: string;
  petId: string;
  primaryServiceId: string;
  addonIds: string[];
  staffId: string;
  staffPreference: { kind: "fastest" } | { kind: "specified"; staffId: string };
  startsAt: string;
}

export interface BookingConflictSuggestion {
  date: string;
  startsAt: string;
  endsAt: string;
  staff: {
    id: string;
    displayName: string;
  };
}

export type CustomerBookingStatus =
  "confirmed" | "checked_in" | "completed" | "terminated" | "cancelled" | "no_show";

export interface CustomerBooking {
  id: string;
  status: CustomerBookingStatus;
  pet: {
    id: string;
    name: string;
    species: PetSpecies;
    weightKg: number;
    petSize: PetSize;
  };
  primaryService: BookingSelectionLine;
  addons: BookingSelectionLine[];
  staff: {
    id: string;
    displayName: string;
  };
  startsAt: string;
  endsAt: string;
  turnoverEndsAt: string;
  totalPriceCents: number;
  serviceDurationMinutes: number;
  turnoverMinutes: number;
  originalSchedule: {
    startsAt: string;
    endsAt: string;
    occupancyStartsAt: string;
    occupancyEndsAt: string;
  };
  completedAt: string | null;
  createdAt: string;
}

export type ConfirmedBooking = CustomerBooking;

export interface BookingVerificationWindow {
  opensAt: string;
  closesAt: string;
  description: "可在开始前 30 分钟至开始后 15 分钟内出示";
}

export interface BookingFactResponse {
  booking: CustomerBooking;
  verificationCode: string | null;
  verificationWindow: BookingVerificationWindow | null;
}

export interface CustomerBookingActions {
  canCancel: boolean;
  canReschedule: boolean;
  cutoffAt: string;
  message: string;
}

export interface CustomerBookingSchedule {
  staff: {
    id: string;
    displayName: string;
  };
  startsAt: string;
  endsAt: string;
  turnoverEndsAt: string;
}

export interface CustomerBookingChange {
  id: string;
  kind: "customer_cancelled" | "customer_rescheduled" | "manager_cancelled" | "manager_rescheduled";
  actor: {
    type: "customer" | "manager";
    id: string;
  };
  reason: string;
  previous: CustomerBookingSchedule;
  next: CustomerBookingSchedule | null;
  occurredAt: string;
}

export interface BookingDetailResponse extends BookingFactResponse {
  customerActions: CustomerBookingActions;
  changeHistory: CustomerBookingChange[];
}

export interface CreateBookingResponse extends BookingFactResponse {
  verificationCode: string;
  verificationWindow: BookingVerificationWindow;
}

export interface CancelBookingInput {
  idempotencyKey: string;
  reason: string;
}

export type CancelBookingResponse = BookingDetailResponse;

export interface RescheduleBookingOptionsResponse {
  booking: CustomerBooking;
  customerActions: CustomerBookingActions;
  availability: BookingAvailabilityResponse | null;
}

export interface RescheduleBookingInput {
  idempotencyKey: string;
  staffId: string;
  startsAt: string;
}

export interface RescheduleBookingResponse extends BookingDetailResponse {
  verificationCode: string;
  verificationWindow: BookingVerificationWindow;
}

export interface CustomerBookingHistoryResponse {
  demoNow: string;
  upcoming: CustomerBooking[];
  history: CustomerBooking[];
}

export type CustomerMessageKind =
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "booking_content_corrected"
  | "booking_reminder";

export interface CustomerMessage {
  id: string;
  kind: CustomerMessageKind;
  title: string;
  body: string;
  occurredAt: string;
  bookingId: string;
  actionLabel: "查看预约" | "查看核销码";
}

export interface CustomerMessagesResponse {
  messages: CustomerMessage[];
}

export interface CustomerMessageDetailResponse {
  message: CustomerMessage;
}
