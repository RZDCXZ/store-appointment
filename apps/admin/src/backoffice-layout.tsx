import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import type { BackofficeAccount } from "./api";
import { useAuth } from "./auth-context";

const managerNavigation = [
  { to: "/manager/workbench", label: "工作台", icon: "▦" },
  { to: "/manager/appointments", label: "预约", icon: "□" },
  { to: "/manager/schedule", label: "排班", icon: "◷" },
  { to: "/manager/services", label: "服务", icon: "◇" },
  { to: "/manager/customers", label: "顾客", icon: "○" },
  { to: "/manager/business", label: "经营", icon: "⌁" },
  { to: "/manager/system", label: "系统", icon: "☷" },
];

const staffNavigation = [
  { to: "/staff/today", label: "今日工作", icon: "▦" },
  { to: "/staff/appointments", label: "我的预约", icon: "□" },
];

export interface BackofficeOutletContext {
  account: BackofficeAccount;
}

export function BackofficeLayout({ account }: { account: BackofficeAccount }): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState("");
  const navigation = account.role === "manager" ? managerNavigation : staffNavigation;
  const roleLabel = account.role === "manager" ? "店长后台" : "员工工作台";

  async function logout(): Promise<void> {
    setLogoutError("");

    try {
      await auth.signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "退出失败，请重试。");
    }
  }

  return (
    <div className={`backoffice-shell backoffice-shell--${account.role}`}>
      <aside className="sidebar">
        <a className="brand-mark" href={navigation[0]?.to ?? "/"} aria-label="茸光后台首页">
          <span className="brand-mark__glow" aria-hidden="true" />
          <span>
            <strong>茸光</strong>
            <small>宠物洗护</small>
          </span>
        </a>
        <p className="role-label">{roleLabel}</p>
        <nav aria-label={account.role === "manager" ? "店长导航" : "员工导航"}>
          <ul>
            {navigation.map((item) => (
              <li key={item.to}>
                <NavLink
                  className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}
                  to={item.to}
                >
                  <span className="nav-item__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="identity-card">
          <span className="identity-avatar" aria-hidden="true">
            {account.displayName.slice(0, 1)}
          </span>
          <span>
            <strong>{account.displayName}</strong>
            <small>
              {account.role === "manager" ? "店长" : "员工"} · {account.username}
            </small>
          </span>
        </div>
        <button className="logout-button" type="button" onClick={() => void logout()}>
          退出登录
        </button>
        {logoutError ? (
          <p className="sidebar-error" role="alert">
            {logoutError}
          </p>
        ) : null}
      </aside>

      <div className="workspace">
        <header className="demo-banner">
          <strong>本地演示模式</strong>
          <span>身份由服务端会话确认</span>
          <span className="demo-banner__route">{location.pathname}</span>
        </header>
        <Outlet context={{ account } satisfies BackofficeOutletContext} />
      </div>
    </div>
  );
}
