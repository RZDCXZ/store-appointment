import { backofficeNavigation, backofficeRoles, type BackofficeRole } from "@rongguang/contracts";

export function SessionCheckingState(): React.JSX.Element {
  return (
    <main className="centered-state" aria-live="polite">
      <span className="loading-mark" aria-hidden="true" />
      <h1>正在确认后台身份</h1>
    </main>
  );
}

export function SessionErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}): React.JSX.Element {
  return (
    <main className="centered-state" role="alert">
      <p className="state-code">连接失败</p>
      <h1>暂时无法确认登录状态</h1>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={retry}>
        重新检查
      </button>
    </main>
  );
}

export function BackofficeLoadingSkeleton({ role }: { role: BackofficeRole }): React.JSX.Element {
  const roleMetadata = backofficeRoles[role];

  return (
    <div
      className={`backoffice-shell backoffice-shell--${role} backoffice-skeleton`}
      role="status"
      aria-label={`正在确认${roleMetadata.label}后台身份`}
    >
      <aside className="sidebar">
        <div className="skeleton-brand skeleton-block" />
        <div className="skeleton-role skeleton-block" />
        <nav aria-label={roleMetadata.loadingNavigationLabel}>
          <ul>
            {backofficeNavigation[role].map((item) => (
              <li key={item.key}>
                <span className="skeleton-nav skeleton-block" />
              </li>
            ))}
          </ul>
        </nav>
        <div className="skeleton-identity skeleton-block" />
      </aside>
      <div className="workspace" aria-hidden="true">
        <header className="demo-banner">
          <span className="skeleton-banner skeleton-block" />
        </header>
        <main className="page-shell">
          <header className="page-heading">
            <div className="skeleton-heading">
              <span className="skeleton-eyebrow skeleton-block" />
              <span className="skeleton-title skeleton-block" />
              <span className="skeleton-copy skeleton-block" />
            </div>
          </header>
          <section className="skeleton-panel skeleton-block" />
        </main>
      </div>
    </div>
  );
}
