import { Navigate, useLocation } from "react-router-dom";

import type { BackofficeRole } from "./api";
import { BackofficeLayout } from "./backoffice-layout";
import { useAuth } from "./auth-context";

export function RoleBoundary({ role }: { role: BackofficeRole }): React.JSX.Element {
  const auth = useAuth();
  const location = useLocation();

  if (auth.state.kind === "checking") {
    return (
      <main className="centered-state" aria-live="polite">
        <span className="loading-mark" aria-hidden="true" />
        <h1>正在确认后台身份</h1>
      </main>
    );
  }

  if (auth.state.kind === "error") {
    return (
      <main className="centered-state" role="alert">
        <p className="state-code">连接失败</p>
        <h1>暂时无法确认登录状态</h1>
        <p>{auth.state.message}</p>
        <button className="primary-button" type="button" onClick={auth.retry}>
          重新检查
        </button>
      </main>
    );
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
    const expected = role === "manager" ? "店长" : "员工";
    const current = auth.state.account.role === "manager" ? "店长" : "员工";

    return (
      <main className="centered-state forbidden-state">
        <p className="state-code">403 · 无权限</p>
        <h1>没有权限</h1>
        <p>
          {current}身份不能访问{expected}页面。
        </p>
        <a
          className="primary-button"
          href={current === "店长" ? "/manager/workbench" : "/staff/today"}
        >
          返回我的工作台
        </a>
      </main>
    );
  }

  return <BackofficeLayout account={auth.state.account} />;
}

export function RootRedirect(): React.JSX.Element {
  const auth = useAuth();

  if (auth.state.kind === "authenticated") {
    return (
      <Navigate
        to={auth.state.account.role === "manager" ? "/manager/workbench" : "/staff/today"}
        replace
      />
    );
  }

  if (auth.state.kind === "checking") {
    return (
      <main className="centered-state" aria-live="polite">
        <span className="loading-mark" aria-hidden="true" />
        <h1>正在确认后台身份</h1>
      </main>
    );
  }

  if (auth.state.kind === "error") {
    return (
      <main className="centered-state" role="alert">
        <p className="state-code">连接失败</p>
        <h1>暂时无法确认登录状态</h1>
        <p>{auth.state.message}</p>
        <button className="primary-button" type="button" onClick={auth.retry}>
          重新检查
        </button>
      </main>
    );
  }

  return <Navigate to="/login" replace />;
}
