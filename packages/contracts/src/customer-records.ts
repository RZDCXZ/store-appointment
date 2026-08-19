import type { PetCoatType, PetSex, PetSize, PetSpecies, PrivacyConsent } from "./index.js";
import type { ManagerBookingStatus } from "./manager-live-booking.js";
import type { StoreServiceRecord } from "./staff-fulfilment.js";

export interface ManagerCustomerListFilters {
  query: string;
  page: number;
}

export interface ManagerCustomerListPet {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string | null;
  photoPath: string | null;
  archivedAt: string | null;
}

export interface ManagerCustomerListItem {
  id: string;
  displayName: string;
  phoneMasked: string;
  pets: ManagerCustomerListPet[];
  futureBookingCount: number;
  completedServiceCount: number;
}

export interface ManagerCustomerListResponse {
  appliedFilters: ManagerCustomerListFilters;
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  customers: ManagerCustomerListItem[];
}

export interface ManagerCustomerPetProfile {
  id: string;
  name: string;
  species: PetSpecies;
  weightKg: number;
  petSize: PetSize;
  breed: string | null;
  sex: PetSex | null;
  birthDate: string | null;
  coatType: PetCoatType | null;
  photoPath: string | null;
  careTags: string[];
  careNotes: string | null;
  archivedAt: string | null;
}

export interface ManagerCustomerProfileResponse {
  customer: {
    id: string;
    displayName: string;
    phoneMasked: string;
    createdAt: string;
    privacyConsents: PrivacyConsent[];
  };
  pets: ManagerCustomerPetProfile[];
}

export interface ManagerCustomerBookingHistoryItem {
  id: string;
  status: ManagerBookingStatus;
  pet: { id: string; name: string; species: PetSpecies };
  primaryService: { id: string; name: string };
  addons: Array<{ id: string; name: string }>;
  staff: { id: string; displayName: string };
  startsAt: string;
  endsAt: string;
  totalPriceCents: number;
  serviceDurationMinutes: number;
}

export interface ManagerCustomerHistoryResponse {
  bookings: ManagerCustomerBookingHistoryItem[];
  serviceRecords: StoreServiceRecord[];
}

export interface ManagerPetDetailResponse {
  customer: Pick<ManagerCustomerProfileResponse["customer"], "id" | "displayName" | "phoneMasked">;
  pet: ManagerCustomerPetProfile;
  bookings: ManagerCustomerBookingHistoryItem[];
  serviceRecords: StoreServiceRecord[];
}
