import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { apiFetch, readApiError } from "./api";
import { useAuth } from "./auth-context";
import type { BackofficeOutletContext } from "./backoffice-layout";

interface PageCopy {
  title: string;
  eyebrow: string;
  description: string;
}

export const managerPages = {
  appointments: {
    eyebrow: "店长 · 预约",
    title: "预约",
    description: "预约日历、列表和详情将在后续业务工单接入。",
  },
  schedule: {
    eyebrow: "店长 · 排班",
    title: "排班",
    description: "排班模板、已发布排班和容量变化将在后续业务工单接入。",
  },
  services: {
    eyebrow: "店长 · 服务",
    title: "服务",
    description: "宠物洗护服务、规格、增项和员工技能将在后续业务工单接入。",
  },
  customers: {
    eyebrow: "店长 · 顾客",
    title: "顾客",
    description: "顾客和宠物档案将在后续业务工单接入。",
  },
  business: {
    eyebrow: "店长 · 经营",
    title: "经营",
    description: "经营事实和周期对比将在后续业务工单接入。",
  },
  system: {
    eyebrow: "店长 · 系统",
    title: "系统",
    description: "通知、审计和演示设置将在后续业务工单接入。",
  },
} satisfies Record<string, PageCopy>;

export function PlaceholderPage({ copy }: { copy: PageCopy }): React.JSX.Element {
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p>{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <span>{copy.description}</span>
        </div>
        <span className="protected-badge">服务端身份保护</span>
      </header>
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

function useProtectedLanding(path: string): {
  kind: "loading" | "ready" | "error";
  message?: string;
  retry: () => void;
} {
  const auth = useAuth();
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

          if (error.status === 401) {
            auth.markExpired();
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
  }, [attempt, auth, path]);

  return {
    ...state,
    retry: () => setAttempt((current) => current + 1),
  };
}

function LandingStatus({
  state,
}: {
  state: ReturnType<typeof useProtectedLanding>;
}): React.JSX.Element {
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

export function ManagerWorkbenchPage(): React.JSX.Element {
  const landing = useProtectedLanding("/backoffice/manager/workbench");

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p>MG-01 · 店长</p>
          <h1>今日工作台</h1>
          <span>风险、状态与员工日时间线</span>
        </div>
        <span className="protected-badge">店长权限</span>
      </header>
      <LandingStatus state={landing} />
      <section className="welcome-panel">
        <div>
          <p className="eyebrow">后台演示账号与角色路由</p>
          <h2>店长工作区已经安全就位。</h2>
          <p>当前导航均为独立 URL；预约、排班与经营事实会由后续纵向工单接入。</p>
        </div>
        <div className="hero-image" role="img" aria-label="晨光中的柴犬" />
      </section>
    </main>
  );
}

export function StaffTodayPage(): React.JSX.Element {
  const { account } = useOutletContext<BackofficeOutletContext>();
  const landing = useProtectedLanding(`/backoffice/staff/${account.id}/today`);

  return (
    <main className="page-shell staff-page">
      <header className="page-heading">
        <div>
          <p>ST-02 · 员工</p>
          <h1>我的今日工作</h1>
          <span>{account.displayName} · 今日行动与本人预约</span>
        </div>
        <span className="protected-badge">本人范围</span>
      </header>
      <LandingStatus state={landing} />
      <section className="staff-welcome">
        <p className="eyebrow">下一位宠物</p>
        <h2>今日预约将在后续履约工单接入</h2>
        <p>当前页面已经由服务端限制为 {account.displayName} 本人范围。</p>
      </section>
    </main>
  );
}

export function StaffAppointmentsPage(): React.JSX.Element {
  const { account } = useOutletContext<BackofficeOutletContext>();

  return (
    <main className="page-shell staff-page">
      <header className="page-heading">
        <div>
          <p>员工 · 本人范围</p>
          <h1>我的预约</h1>
          <span>{account.displayName} 的预约与履约记录</span>
        </div>
        <span className="protected-badge">本人范围</span>
      </header>
      <section className="placeholder-panel">
        <span className="placeholder-panel__number">ST</span>
        <div>
          <h2>本人预约路由已就绪</h2>
          <p>预约数据将在后续工单接入，其他员工的资源仍由 API 拒绝访问。</p>
        </div>
      </section>
    </main>
  );
}
