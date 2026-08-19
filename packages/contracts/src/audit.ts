export type AuditActorType = "customer" | "staff" | "manager" | "system";
export type AuditActorFilterValue = `${AuditActorType}:${string}`;

export type AuditActionType =
  | "booking_created"
  | "customer_booking_cancelled"
  | "customer_booking_rescheduled"
  | "customer_phone_revealed"
  | "manager_booking_cancelled"
  | "manager_booking_rescheduled"
  | "manager_booking_content_corrected"
  | "booking_checked_in"
  | "booking_late_checked_in"
  | "booking_completed"
  | "booking_no_show"
  | "booking_terminated"
  | "service_catalog_created"
  | "service_catalog_updated"
  | "service_catalog_deactivated"
  | "staff_account_created"
  | "staff_skills_updated"
  | "staff_account_deactivated"
  | "schedule_template_updated"
  | "schedule_drafts_generated"
  | "schedule_draft_updated"
  | "schedule_published"
  | "schedule_exception_updated"
  | "capacity_change_created"
  | "capacity_change_status_changed"
  | "capacity_change_booking_resolved"
  | "capacity_change_revoked"
  | "notification_manual_retry_requested"
  | "data_exported"
  | "customer_data_anonymized"
  | "demo_time_advanced"
  | "demo_data_reset";

export type AuditSubjectType =
  | "booking"
  | "primary_service"
  | "addon"
  | "staff"
  | "schedule_template"
  | "schedule_draft"
  | "published_schedule"
  | "staff_time_off"
  | "store_closure"
  | "notification"
  | "store"
  | "customer";

export interface ManagerAuditRecord {
  id: string;
  occurredAt: string;
  actor: { type: AuditActorType; id: string; label: string };
  action: { type: AuditActionType; label: string };
  subject: { type: AuditSubjectType; id: string; label: string };
  changes: string[];
}

export interface ManagerAuditListResponse {
  appliedFilters: {
    actor: AuditActorFilterValue | null;
    action: AuditActionType | null;
    subjectType: AuditSubjectType | null;
    subjectId: string | null;
    from: string | null;
    to: string | null;
    page: number;
  };
  filterOptions: {
    actors: Array<{ value: AuditActorFilterValue; label: string }>;
    actions: Array<{ value: AuditActionType; label: string }>;
    subjectTypes: Array<{ value: AuditSubjectType; label: string }>;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  records: ManagerAuditRecord[];
}
