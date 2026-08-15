import { useEffect, useState } from "react";

import { apiFetch, createApiUrl, readApiError } from "./api";
import { useAuth } from "./auth-context";

export interface PageCopy {
  title: string;
  eyebrow: string;
  description: string;
}

export function PageHeading({ copy, badge }: { copy: PageCopy; badge: string }): React.JSX.Element {
  return (
    <header className="page-heading">
      <div>
        <p>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <span>{copy.description}</span>
      </div>
      <span className="protected-badge">{badge}</span>
    </header>
  );
}

export function RoleRouteReadyPage({ copy }: { copy: PageCopy }): React.JSX.Element {
  return (
    <main className="page-shell">
      <PageHeading copy={copy} badge="服务端身份保护" />
      <section className="placeholder-panel">
        <span className="placeholder-panel__number">02</span>
        <div>
          <h2>角色路由已就绪</h2>
          <p>此页面可直接访问和刷新恢复；当前工单仅建立身份、导航与权限边界。</p>
        </div>
      </section>
    </main>
  );
}

function useRequestStatus(
  path: string,
  onUnauthorized?: () => void,
): {
  kind: "loading" | "ready" | "error";
  message?: string;
  retry: () => void;
} {
  const [state, setState] = useState<{ kind: "loading" | "ready" | "error"; message?: string }>({
    kind: "loading",
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    async function load(): Promise<void> {
      try {
        const response = await apiFetch(path, { signal: abortController.signal });

        if (!response.ok) {
          const error = await readApiError(response);

          if (error.status === 401 && onUnauthorized) {
            onUnauthorized();
            return;
          }

          setState({ kind: "error", message: error.message });
          return;
        }

        setState({ kind: "ready" });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "页面数据加载失败。",
          });
        }
      }
    }

    setState({ kind: "loading" });
    void load();
    return () => abortController.abort();
  }, [attempt, onUnauthorized, path]);

  return {
    ...state,
    retry: () => setAttempt((current) => current + 1),
  };
}

export function ProtectedLandingStatus({ path }: { path: string }): React.JSX.Element {
  const { markExpired } = useAuth();
  const state = useRequestStatus(path, markExpired);

  if (state.kind === "loading") {
    return (
      <p className="landing-status" aria-live="polite">
        正在读取角色工作区…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="landing-status landing-status--error" role="alert">
        <span>{state.message}</span>
        <button type="button" onClick={state.retry}>
          重试
        </button>
      </div>
    );
  }

  return <p className="landing-status landing-status--ready">服务端已确认当前身份与访问范围。</p>;
}

export function HealthStatus(): React.JSX.Element {
  const state = useRequestStatus("/health");

  if (state.kind === "loading") {
    return (
      <p className="landing-status" aria-live="polite">
        正在检查 API 与 PostgreSQL…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="landing-status landing-status--error" role="alert">
        <span>{state.message}</span>
        <button type="button" onClick={state.retry}>
          重新检查基础服务
        </button>
      </div>
    );
  }

  return (
    <p className="landing-status landing-status--ready">
      <span>API 与数据库已就绪</span>
      <a href={createApiUrl("/docs")}>查看 OpenAPI</a>
    </p>
  );
}
