import { NavLink } from "react-router-dom";

const systemPages = [
  { to: "/manager/system/notifications", label: "通知任务" },
  { to: "/manager/system/audit", label: "审计记录" },
] as const;

export function SystemPageLinks(): React.JSX.Element {
  return (
    <nav className="system-page-links" aria-label="系统页面">
      {systemPages.map((page) => (
        <NavLink
          key={page.to}
          className={({ isActive }) => (isActive ? "system-page-link--active" : undefined)}
          to={page.to}
        >
          {page.label}
        </NavLink>
      ))}
    </nav>
  );
}
