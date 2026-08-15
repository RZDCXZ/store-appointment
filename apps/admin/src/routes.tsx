import { createBrowserRouter, Navigate, Outlet, type RouteObject } from "react-router-dom";

import { AuthProvider } from "./auth-context";
import {
  ManagerWorkbenchPage,
  PlaceholderPage,
  StaffAppointmentsPage,
  StaffTodayPage,
  managerPages,
} from "./backoffice-pages";
import { LoginPage } from "./login-page";
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
          {
            path: "appointments",
            element: <PlaceholderPage copy={managerPages.appointments} />,
          },
          { path: "schedule", element: <PlaceholderPage copy={managerPages.schedule} /> },
          { path: "services", element: <PlaceholderPage copy={managerPages.services} /> },
          { path: "customers", element: <PlaceholderPage copy={managerPages.customers} /> },
          { path: "business", element: <PlaceholderPage copy={managerPages.business} /> },
          { path: "system", element: <PlaceholderPage copy={managerPages.system} /> },
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
