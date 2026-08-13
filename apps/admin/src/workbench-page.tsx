import type { HealthResponse } from "@rongguang/contracts";
import { useEffect, useState } from "react";

type HealthState =
  | { kind: "loading" }
  | { kind: "ready"; response: HealthResponse }
  | { kind: "error"; message: string };

const navigation = ["工作台", "预约", "排班", "服务", "顾客", "经营", "系统"];

function BrandMark(): React.JSX.Element {
  return (
    <div className="brand-mark">
      <span className="brand-mark__glow" aria-hidden="true" />
      <div>
        <h1>茸光宠物洗护</h1>
        <p>温暖 · 清爽 · 有秩序</p>
      </div>
    </div>
  );
}

function HealthCard({ state }: { state: HealthState }): React.JSX.Element {
  if (state.kind === "loading") {
    return (
      <section className="health-card" aria-live="polite">
        <span className="status-dot status-dot--loading" aria-hidden="true" />
        <div>
          <h2>正在连接本地 API</h2>
          <p>检查 API 与 PostgreSQL migration 状态。</p>
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="health-card health-card--error" role="alert">
        <span className="status-dot status-dot--error" aria-hidden="true" />
        <div>
          <h2>本地服务尚未就绪</h2>
          <p>{state.message}</p>
          <p className="health-card__hint">请查看运行 demo:up 的终端，修复后刷新本页。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="health-card" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <div>
        <h2>API 与数据库已就绪</h2>
        <p>健康检查已确认首个 migration 和茸光演示元数据可读取。</p>
        <dl className="health-facts">
          <div>
            <dt>服务</dt>
            <dd>{state.response.service}</dd>
          </div>
          <div>
            <dt>数据库</dt>
            <dd>PostgreSQL ready</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function WorkbenchPage(): React.JSX.Element {
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    const abortController = new AbortController();
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

    async function loadHealth(): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/health`, { signal: abortController.signal });

        if (!response.ok) {
          throw new Error(`健康检查返回 HTTP ${response.status}。`);
        }

        setHealth({ kind: "ready", response: (await response.json()) as HealthResponse });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setHealth({
          kind: "error",
          message: error instanceof Error ? error.message : "无法连接本地 API。",
        });
      }
    }

    void loadHealth();
    return () => abortController.abort();
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />
        <nav aria-label="店长导航">
          <ul>
            {navigation.map((item, index) => (
              <li key={item}>
                {index === 0 ? (
                  <a
                    className="nav-item nav-item--active"
                    href="/manager/workbench"
                    aria-current="page"
                  >
                    <span className="nav-item__icon" aria-hidden="true" />
                    {item}
                  </a>
                ) : (
                  <span className="nav-item nav-item--future" aria-disabled="true">
                    <span className="nav-item__icon" aria-hidden="true" />
                    {item}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <p className="sidebar__note">后续业务页面按独立 URL 逐步接入</p>
      </aside>

      <div className="workspace">
        <header className="demo-banner">
          <span aria-hidden="true">ⓘ</span>
          <strong>本地演示模式</strong>
          <span>微信登录与消息能力将在后续工单使用明确的模拟边界</span>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <p className="page-heading__route">MG-01 · /manager/workbench</p>
              <h2>三端启动检查</h2>
            </div>
            <a className="text-link" href="http://localhost:3000/docs">
              查看 OpenAPI
            </a>
          </div>

          <div className="intro-grid">
            <section className="intro-copy">
              <p>茸光的工程骨架已经就位。</p>
              <h2>先确认本地边界，再开始预约业务。</h2>
              <p>
                PostgreSQL 单独运行在 Docker；API
                与后台保留宿主机热更新。微信小程序由开发者工具导入并使用你自己的测试 AppID。
              </p>
            </section>
            <div className="hero-image" role="img" aria-label="晨光中的柴犬" />
          </div>

          <HealthCard state={health} />

          <section className="next-step" aria-labelledby="next-step-title">
            <div>
              <p className="next-step__number">02</p>
              <div>
                <h2 id="next-step-title">导入原生小程序</h2>
                <p>
                  复制微信项目配置示例，填入自己的测试 AppID，再用微信开发者工具打开
                  apps/mini-program。
                </p>
              </div>
            </div>
            <code>pages/home/index</code>
          </section>
        </main>
      </div>
    </div>
  );
}
