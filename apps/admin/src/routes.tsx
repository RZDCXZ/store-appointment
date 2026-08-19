import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router-dom";

import { AuthProvider } from "./auth-context";
import { LoginPage } from "./login-page";
import { ManagerAppointmentsPage } from "./pages/manager/appointments-page";
import { ManagerAppointmentDetailPage } from "./pages/manager/appointment-detail-page";
import { ManagerAppointmentListPage } from "./pages/manager/appointment-list-page";
import { ManagerCancelBookingPage } from "./pages/manager/cancel-booking-page";
import { ManagerContentCorrectionPage } from "./pages/manager/content-correction-page";
import { ManagerProxyBookingPage } from "./pages/manager/proxy-booking-page";
import { ManagerRescheduleBookingPage } from "./pages/manager/reschedule-booking-page";
import { ManagerTerminateBookingPage } from "./pages/manager/terminate-booking-page";
import { ManagerBusinessPage } from "./pages/manager/business-page";
import { ManagerCalendarPage } from "./pages/manager/calendar-page";
import { ManagerCustomersPage } from "./pages/manager/customers-page";
import { ManagerCustomerDetailPage } from "./pages/manager/customer-detail-page";
import { ManagerPetDetailPage } from "./pages/manager/pet-detail-page";
import { ScheduleIndexRedirect } from "./pages/manager/schedule-index-redirect";
import { ManagerSchedulePage } from "./pages/manager/schedule-page";
import { ManagerSchedulePlanningPage } from "./pages/manager/schedule-planning-page";
import { ManagerCapacityChangePage } from "./pages/manager/capacity-change-page";
import { ManagerCapacityChangeResolutionPage } from "./pages/manager/capacity-change-resolution-page";
import { ManagerServicesPage } from "./pages/manager/services-page";
import { ManagerStaffPage } from "./pages/manager/staff-page";
import { ManagerNotificationDetailPage } from "./pages/manager/notification-detail-page";
import { ManagerNotificationListPage } from "./pages/manager/notification-list-page";
import { ManagerDemoControlPage } from "./pages/manager/demo-control-page";
import { ManagerAuditLogPage } from "./pages/manager/audit-log-page";
import { ManagerWorkbenchPage } from "./pages/manager/workbench-page";
import { StaffAppointmentsPage } from "./pages/staff/appointments-page";
import { StaffAppointmentDetailPage } from "./pages/staff/appointment-detail-page";
import { StaffCheckInPage } from "./pages/staff/check-in-page";
import { StaffCompletePage } from "./pages/staff/complete-page";
import { StaffLatePage } from "./pages/staff/late-page";
import { StaffPhoneRevealPage } from "./pages/staff/phone-reveal-page";
import { StaffServiceRecordPage } from "./pages/staff/service-record-page";
import { StaffTerminatePage } from "./pages/staff/terminate-page";
import { StaffTodayPage } from "./pages/staff/today-page";
import { RoleBoundary, RootRedirect } from "./protected-route";

function AppRoot(): React.JSX.Element {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

function RouteError(): React.JSX.Element {
  return (
    <main className="route-error">
      <p className="route-error__code">404</p>
      <h1>这个页面还没有建立</h1>
      <a href="/">返回我的工作台</a>
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppRoot />,
    children: [
      { index: true, element: <RootRedirect /> },
      { path: "login", element: <LoginPage /> },
      {
        path: "manager",
        element: <RoleBoundary role="manager" />,
        children: [
          { index: true, element: <Navigate to="workbench" replace /> },
          { path: "workbench", element: <ManagerWorkbenchPage /> },
          { path: "appointments", element: <ManagerAppointmentsPage /> },
          { path: "appointments/list", element: <ManagerAppointmentListPage /> },
          { path: "appointments/calendar", element: <ManagerCalendarPage /> },
          { path: "appointments/proxy", element: <ManagerProxyBookingPage /> },
          {
            path: "appointments/:bookingId/reschedule",
            element: <ManagerRescheduleBookingPage />,
          },
          {
            path: "appointments/:bookingId/correction",
            element: <ManagerContentCorrectionPage />,
          },
          { path: "appointments/:bookingId/cancel", element: <ManagerCancelBookingPage /> },
          {
            path: "appointments/:bookingId/terminate",
            element: <ManagerTerminateBookingPage />,
          },
          { path: "appointments/:bookingId", element: <ManagerAppointmentDetailPage /> },
          {
            path: "schedule",
            children: [
              { index: true, element: <ScheduleIndexRedirect /> },
              { path: "planning", element: <ManagerSchedulePlanningPage /> },
              { path: "published", element: <ManagerSchedulePage /> },
              { path: "capacity-changes/new", element: <ManagerCapacityChangePage /> },
              {
                path: "capacity-changes/:kind/:changeId",
                element: <ManagerCapacityChangeResolutionPage />,
              },
            ],
          },
          { path: "services", element: <ManagerServicesPage /> },
          { path: "services/staff", element: <ManagerStaffPage /> },
          { path: "customers", element: <ManagerCustomersPage /> },
          { path: "customers/:customerId", element: <ManagerCustomerDetailPage /> },
          {
            path: "customers/:customerId/pets/:petId",
            element: <ManagerPetDetailPage />,
          },
          { path: "business", element: <ManagerBusinessPage /> },
          {
            path: "system",
            children: [
              { index: true, element: <Navigate to="demo" replace /> },
              { path: "audit", element: <ManagerAuditLogPage /> },
              { path: "demo", element: <ManagerDemoControlPage /> },
              { path: "notifications", element: <ManagerNotificationListPage /> },
              {
                path: "notifications/:notificationId",
                element: <ManagerNotificationDetailPage />,
              },
            ],
          },
        ],
      },
      {
        path: "staff",
        element: <RoleBoundary role="staff" />,
        children: [
          { index: true, element: <Navigate to="today" replace /> },
          { path: "today", element: <StaffTodayPage /> },
          { path: "appointments", element: <StaffAppointmentsPage /> },
          { path: "appointments/:bookingId", element: <StaffAppointmentDetailPage /> },
          { path: "appointments/:bookingId/check-in", element: <StaffCheckInPage /> },
          { path: "appointments/:bookingId/complete", element: <StaffCompletePage /> },
          { path: "appointments/:bookingId/terminate", element: <StaffTerminatePage /> },
          { path: "appointments/:bookingId/service-record", element: <StaffServiceRecordPage /> },
          { path: "appointments/:bookingId/late", element: <StaffLatePage /> },
          { path: "appointments/:bookingId/phone", element: <StaffPhoneRevealPage /> },
        ],
      },
      { path: "*", element: <RouteError /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
