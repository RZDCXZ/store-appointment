import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router-dom";

import { AuthProvider } from "./auth-context";
import { LoginPage } from "./login-page";
import { ManagerAppointmentsPage } from "./pages/manager/appointments-page";
import { ManagerBusinessPage } from "./pages/manager/business-page";
import { ManagerCustomersPage } from "./pages/manager/customers-page";
import { ScheduleIndexRedirect } from "./pages/manager/schedule-index-redirect";
import { ManagerSchedulePage } from "./pages/manager/schedule-page";
import { ManagerServicesPage } from "./pages/manager/services-page";
import { ManagerSystemPage } from "./pages/manager/system-page";
import { ManagerWorkbenchPage } from "./pages/manager/workbench-page";
import { StaffAppointmentsPage } from "./pages/staff/appointments-page";
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
          {
            path: "schedule",
            children: [
              { index: true, element: <ScheduleIndexRedirect /> },
              { path: "published", element: <ManagerSchedulePage /> },
            ],
          },
          { path: "services", element: <ManagerServicesPage /> },
          { path: "customers", element: <ManagerCustomersPage /> },
          { path: "business", element: <ManagerBusinessPage /> },
          { path: "system", element: <ManagerSystemPage /> },
        ],
      },
      {
        path: "staff",
        element: <RoleBoundary role="staff" />,
        children: [
          { index: true, element: <Navigate to="today" replace /> },
          { path: "today", element: <StaffTodayPage /> },
          { path: "appointments", element: <StaffAppointmentsPage /> },
        ],
      },
      { path: "*", element: <RouteError /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
