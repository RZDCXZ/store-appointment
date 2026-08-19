export const businessPeriods = [7, 30, 90] as const;

export type BusinessPeriodDays = (typeof businessPeriods)[number];

export interface BusinessDateWindow {
  startsOn: string;
  endsOn: string;
}

export interface BusinessPeriodSnapshot {
  bookingCount: number;
  completedBookingCount: number;
  completedServiceMinutes: number;
  availableStaffMinutes: number;
  utilizationRate: number | null;
  completedListPriceCents: number;
  cancellationCount: number;
  cancellationDenominator: number;
  cancellationRate: number | null;
  noShowCount: number;
  noShowDenominator: number;
  noShowRate: number | null;
  terminationCount: number;
  terminationDenominator: number;
  terminationRate: number | null;
}

export interface BusinessRevisitSnapshot {
  completedCustomerCount: number;
  revisitCustomerCount: number;
  revisitRate: number | null;
}

export interface ManagerBusinessMetricsResponse {
  timeZone: "Asia/Shanghai";
  demoNow: string;
  periodDays: BusinessPeriodDays;
  currentPeriodRevision: string;
  currentWindow: BusinessDateWindow;
  previousWindow: BusinessDateWindow;
  current: BusinessPeriodSnapshot;
  previous: BusinessPeriodSnapshot;
  revisit90Days: {
    periodDays: 90;
    currentWindow: BusinessDateWindow;
    previousWindow: BusinessDateWindow;
    current: BusinessRevisitSnapshot;
    previous: BusinessRevisitSnapshot;
  };
}

export interface BusinessSeriesPoint extends BusinessPeriodSnapshot {
  localDate: string;
}

export interface ManagerBusinessSeriesResponse {
  timeZone: "Asia/Shanghai";
  periodDays: BusinessPeriodDays;
  currentPeriodRevision: string;
  window: BusinessDateWindow;
  points: BusinessSeriesPoint[];
}
