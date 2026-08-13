import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";

import { WorkbenchPage } from "./workbench-page";

function RouteError(): React.JSX.Element {
  return (
    <main className="route-error">
      <p className="route-error__code">404</p>
      <h1>这个页面还没有建立</h1>
      <a href="/manager/workbench">返回启动检查</a>
    </main>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <Navigate to="/manager/workbench" replace />,
  },
  {
    path: "/manager/workbench",
    element: <WorkbenchPage />,
  },
  {
    path: "*",
    element: <RouteError />,
  },
];

export const router = createBrowserRouter(routes);
