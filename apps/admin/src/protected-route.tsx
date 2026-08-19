import { Navigate, useLocation } from "react-router-dom";
import { backofficeRoles } from "@rongguang/contracts";

import type { BackofficeRole } from "./api";
import { BackofficeLayout } from "./backoffice-layout";
import { BackofficeLoadingSkeleton, SessionCheckingState, SessionErrorState } from "./auth-state";
import { useAuth } from "./auth-context";

export function RoleBoundary({ role }: { role: BackofficeRole }): React.JSX.Element {
  const auth = useAuth();
  const location = useLocation();

  if (auth.state.kind === "checking") {
    return <BackofficeLoadingSkeleton role={role} />;
  }

  if (auth.state.kind === "error") {
    return <SessionErrorState message={auth.state.message} retry={auth.retry} />;
  }

  if (auth.state.kind === "anonymous") {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    const params = new URLSearchParams({ returnTo });

    if (auth.state.reason === "expired") {
      params.set("reason", "expired");
    }

    return <Navigate to={`/login?${params.toString()}`} replace />;
  }

  if (auth.state.account.role !== role) {
    const expected = backofficeRoles[role];
    const current = backofficeRoles[auth.state.account.role];

    return (
      <main className="centered-state forbidden-state">
        <p className="state-code">403 · 无权限</p>
        <h1>没有权限</h1>
        <p>
          {current.label}身份不能访问{expected.label}页面。
        </p>
        <a className="primary-button" href={current.landingPath}>
          返回我的工作台
        </a>
      </main>
    );
  }

  return (
    <BackofficeLayout account={auth.state.account} initialDemoStatus={auth.state.demoStatus} />
  );
}

export function RootRedirect(): React.JSX.Element {
  const auth = useAuth();

  if (auth.state.kind === "authenticated") {
    return <Navigate to={backofficeRoles[auth.state.account.role].landingPath} replace />;
  }

  if (auth.state.kind === "checking") {
    return <SessionCheckingState />;
  }

  if (auth.state.kind === "error") {
    return <SessionErrorState message={auth.state.message} retry={auth.retry} />;
  }

  return <Navigate to="/login" replace />;
}
