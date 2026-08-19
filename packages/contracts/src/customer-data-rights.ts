import type {
  CustomerBooking,
  CustomerMessage,
  PetCoatType,
  PetSex,
  PetSize,
  PetSpecies,
  PrivacyConsent,
} from "./index.js";

export interface CustomerDataRightsFutureBooking {
  id: string;
  petName: string;
  primaryServiceName: string;
  startsAt: string;
  endsAt: string;
}

export interface CustomerDataRightsStatusResponse {
  customer: {
    displayName: string;
    phoneMasked: string;
  };
  dataSummary: {
    petCount: number;
    privacyConsentCount: number;
    bookingCount: number;
    messageCount: number;
  };
  futureBookings: CustomerDataRightsFutureBooking[];
  canDelete: boolean;
  retentionPolicy: {
    anonymized: string[];
    retained: string[];
    disclaimer: string;
  };
}

export interface CustomerDataExportPet {
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
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDataExport {
  exportType: "customer_personal_data_json";
  exportedAt: string;
  subjectScope: "authenticated_customer";
  customer: {
    displayName: string;
    phone: string;
    createdAt: string;
  };
  pets: CustomerDataExportPet[];
  privacyConsents: PrivacyConsent[];
  bookings: CustomerBooking[];
  messages: CustomerMessage[];
}

export interface CustomerDataDeletionInput {
  confirmAnonymization: true;
}

export interface CustomerDataDeletionResponse {
  anonymizedAt: string;
  retained: {
    bookingCount: number;
    completedBookingCount: number;
    totalPriceCents: number;
  };
  sessionsRevoked: true;
}
