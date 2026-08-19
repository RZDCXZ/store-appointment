import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  backofficeNavigation,
  backofficeRoles,
  type BackofficeNavigationKey,
  type BackofficeRole,
  type DemoStatusResponse,
} from "@rongguang/contracts";

import type { BackofficeAccount } from "./api";
import { useAuth } from "./auth-context";
import { formatShanghaiDemoTime } from "./demo-time";

function navigationPath(role: BackofficeRole, key: BackofficeNavigationKey): string {
  return `/${role}/${key}`;
}

function NavigationIcon({ name }: { name: BackofficeNavigationKey }): React.JSX.Element {
  const shapes: Record<BackofficeNavigationKey, React.JSX.Element> = {
    workbench: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    today: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v11h14V10M9 21v-7h6v7" />
      </>
    ),
    appointments: (
      <>
        <path d="M6 2v4M18 2v4M3 9h18" />
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="m8 15 2 2 5-5" />
      </>
    ),
    schedule: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    services: (
      <>
        <path d="m4 19 6-6M14 9l6-6M14 3l6 6" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="18" r="3" />
        <path d="m8 8 8 8" />
      </>
    ),
    customers: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M17 14c2 .7 4 2.8 4 5" />
      </>
    ),
    business: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    system: (
      <>
        <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="14" cy="18" r="2" />
      </>
    ),
  };

  return (
    <svg className="nav-item__icon" viewBox="0 0 24 24" aria-hidden="true">
      {shapes[name]}
    </svg>
  );
}

export interface BackofficeOutletContext {
  account: BackofficeAccount;
  demoStatus: DemoStatusResponse | null;
  setDemoStatus: (status: DemoStatusResponse) => void;
}

export function BackofficeLayout({
  account,
  initialDemoStatus,
}: {
  account: BackofficeAccount;
  initialDemoStatus?: DemoStatusResponse;
}): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState("");
  const [demoStatus, setDemoStatus] = useState<DemoStatusResponse | null>(() => {
    if (initialDemoStatus) return initialDemoStatus;
    const configuredNow = import.meta.env.VITE_DEMO_NOW;
    return configuredNow ? { enabled: true, now: configuredNow, timeZone: "Asia/Shanghai" } : null;
  });
  const navigation = backofficeNavigation[account.role].map((item) => ({
    ...item,
    to: navigationPath(account.role, item.key),
  }));
  const roleMetadata = backofficeRoles[account.role];
  const demoTime = formatShanghaiDemoTime(demoStatus?.now);

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
        <p className="role-label">{roleMetadata.workspaceLabel}</p>
        <nav aria-label={roleMetadata.navigationLabel}>
          <ul>
            {navigation.map((item) => (
              <li key={item.to}>
                <NavLink
                  className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}
                  to={item.to}
                >
                  <NavigationIcon name={item.key} />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="identity-card">
          {account.role === "manager" ? (
            <img className="identity-avatar" src="/assets/brand/rongguang-hero-shiba.png" alt="" />
          ) : (
            <span className="identity-avatar" aria-hidden="true">
              {account.displayName.slice(0, 1)}
            </span>
          )}
          <span>
            <strong>{account.displayName}</strong>
            <small>
              {roleMetadata.label} · {account.username}
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
          <strong>{demoStatus?.enabled ? "本地演示模式" : "系统时间模式"}</strong>
          <span>{demoTime ?? "演示时间跟随当前系统时间"}</span>
          <span>身份由服务端会话确认</span>
          <span className="demo-banner__route">{location.pathname}</span>
        </header>
        <Outlet
          context={
            {
              account,
              demoStatus,
              setDemoStatus,
            } satisfies BackofficeOutletContext
          }
        />
      </div>
    </div>
  );
}
