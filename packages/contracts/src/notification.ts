import type { CustomerMessageKind } from "./index.js";

export type ManagerNotificationTaskStatus = "pending" | "sent" | "failed" | "manual_retry_required";

export type NotificationAttemptMode = "automatic" | "manual";

export interface ManagerNotificationAttempt {
  id: string;
  number: number;
  mode: NotificationAttemptMode;
  attemptedAt: string;
  result: "sent" | "failed";
  detail: string;
}

export interface ManagerNotificationTask {
  id: string;
  type: CustomerMessageKind;
  typeLabel: string;
  status: ManagerNotificationTaskStatus;
  channel: "模拟微信通道";
  customer: {
    id: string;
    displayName: string;
  };
  booking: {
    id: string;
    petName: string;
    serviceName: string;
    startsAt: string;
  };
  attemptCount: number;
  createdAt: string;
  availableAt: string;
}

export interface ManagerNotificationListResponse {
  channel: "模拟微信通道";
  tasks: ManagerNotificationTask[];
}

export interface ManagerNotificationDetailResponse {
  task: ManagerNotificationTask & {
    attempts: ManagerNotificationAttempt[];
  };
  businessFactNotice: "通知失败不会撤销已经成立的预约事实。";
}

export interface ManagerNotificationFailureInjectionResponse {
  notificationId: string;
  simulatedFailuresRemaining: number;
}

export interface ManagerNotificationManualRetryResponse {
  notificationId: string;
  status: "pending";
  acceptedAt: string;
}
