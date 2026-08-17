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
  specifications: ServiceSpecification[];
}

export interface ServiceAddon {
  id: string;
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  specifications: ServiceSpecification[];
}

export interface StorefrontCatalogResponse {
  store: StorefrontStore;
  primaryServices: PrimaryService[];
  addons: ServiceAddon[];
}
