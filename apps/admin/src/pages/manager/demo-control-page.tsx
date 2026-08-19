import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type {
  DemoAdvanceResponse,
  DemoResetResponse,
  DemoStatusResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import type { BackofficeOutletContext } from "../../backoffice-layout";
import { formatShanghaiDemoTime } from "../../demo-time";
import { PageHeading } from "../../page-components";
import { useDialogFocus } from "../../use-dialog-focus";

const resetConfirmation = "重置茸光演示数据";

function ResetDialog({
  onClose,
  onReset,
  submitting,
}: {
  onClose: () => void;
  onReset: () => Promise<void>;
  submitting: boolean;
}): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLDivElement>();
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmation, setConfirmation] = useState("");

  return (
    <div className="demo-reset-backdrop">
      <div
        ref={dialogRef}
        className="demo-reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-reset-title"
      >
        <p>危险操作 · {step}/2</p>
        <h2 id="demo-reset-title">重置演示数据</h2>
        {step === 1 ? (
          <>
            <span>当前演示状态无法恢复。以下范围会由同一确定性能力重建：</span>
            <ul>
              <li>上传文件会被清理，种子素材会恢复</li>
              <li>预约、排班、通知、审计与经营样例会重建</li>
              <li>全部后台与小程序旧会话会失效</li>
            </ul>
          </>
        ) : (
          <label>
            请输入：重置茸光演示数据
            <input
              data-dialog-initial-focus
              value={confirmation}
              disabled={submitting}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
        )}
        <footer>
          <button
            type="button"
            disabled={submitting}
            onClick={() => (step === 1 ? onClose() : setStep(1))}
          >
            返回
          </button>
          {step === 1 ? (
            <button type="button" className="danger-button" onClick={() => setStep(2)}>
              继续确认
            </button>
          ) : (
            <button
              type="button"
              className="danger-button"
              disabled={submitting || confirmation !== resetConfirmation}
              onClick={() => void onReset()}
            >
              {submitting ? "正在重建…" : "确认重置演示数据"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function ManagerDemoControlPage(): React.JSX.Element {
  const { demoStatus, setDemoStatus } = useOutletContext<BackofficeOutletContext>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const demoTime = formatShanghaiDemoTime(demoStatus?.now);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus(): Promise<void> {
      try {
        const response = await apiFetch("/demo/status");
        if (!response.ok) throw await readApiError(response);
        const status = (await response.json()) as DemoStatusResponse;
        if (!cancelled) setDemoStatus(status);
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error ? requestError.message : "演示时间暂时无法读取，请重试。",
          );
        }
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [setDemoStatus]);

  async function advance(minutes: number): Promise<void> {
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch("/backoffice/manager/demo/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!response.ok) throw await readApiError(response);
      const result = (await response.json()) as DemoAdvanceResponse;
      setDemoStatus({ enabled: true, now: result.now, timeZone: result.timeZone });
      setMessage(`演示时间已推进，并生成 ${result.remindersCreated} 个到期提醒。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "演示时间推进失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function reset(): Promise<void> {
    setSubmitting(true);
    setMessage("");
    setError("");
    try {
      const response = await apiFetch("/backoffice/manager/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: resetConfirmation }),
      });
      if (!response.ok) throw await readApiError(response);
      const result = (await response.json()) as DemoResetResponse;
      setDemoStatus({ enabled: true, now: result.now, timeZone: result.timeZone });
      setResetOpen(false);
      setResetComplete(true);
      setMessage("演示数据已恢复；全部旧会话现在均已失效。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "演示数据重置失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell demo-control-page">
      <PageHeading
        copy={{
          eyebrow: "MG-18 · 系统与演示",
          title: "演示时间与数据重置",
          description: "固定复现正常与异常流程，并安全推进时间或恢复本地种子。",
        }}
        badge={demoStatus?.enabled ? "DEMO_NOW 已启用" : "演示操作已关闭"}
      />

      <nav className="demo-system-links" aria-label="系统页面">
        <Link to="/manager/system/notifications">通知任务</Link>
        <Link to="/manager/system/audit">审计记录</Link>
        <span aria-current="page">演示与重置</span>
      </nav>

      {message ? (
        <div className="demo-control-feedback" role="status">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="demo-control-feedback demo-control-feedback--error" role="alert">
          {error}
        </div>
      ) : null}
      {resetComplete ? (
        <div className="demo-control-feedback">
          当前页面只保留重置结果；<Link to="/login?reason=reset">请重新登录</Link>后继续。
        </div>
      ) : null}

      <section className="demo-boundary-panel">
        <header>
          <div>
            <p>本地作品集边界</p>
            <h2>当前演示环境</h2>
          </div>
          <strong>{demoTime ?? "正在读取上海演示时间"}</strong>
        </header>
        <ul>
          <li>
            <strong>模拟身份</strong>
            <span>店长、员工与顾客均为本地演示账号。</span>
          </li>
          <li>
            <strong>模拟微信消息</strong>
            <span>通知只进入本地模拟通道。</span>
          </li>
          <li>
            <strong>本地文件存储</strong>
            <span>宠物照片只写入当前仓库数据目录。</span>
          </li>
          <li>
            <strong>上海演示时间</strong>
            <span>{demoTime ?? "读取中"}</span>
          </li>
        </ul>
      </section>

      <section className="demo-action-panel">
        <div>
          <p>可审计操作</p>
          <h2>推进演示时间</h2>
          <span>推进会立即重新计算到期提醒、核销窗口和行动队列，并写入审计事实。</span>
        </div>
        <div className="demo-advance-actions">
          <button
            type="button"
            disabled={submitting || !demoStatus?.enabled || resetComplete}
            onClick={() => void advance(15)}
          >
            +15 分钟
          </button>
          <button
            type="button"
            disabled={submitting || !demoStatus?.enabled || resetComplete}
            onClick={() => void advance(60)}
          >
            +1 小时
          </button>
        </div>
      </section>

      <section className="demo-danger-panel">
        <div>
          <p>危险操作</p>
          <h2>重置演示数据</h2>
          <span>清理上传、重建全部业务样例，并使全部旧会话失效。</span>
        </div>
        <button
          type="button"
          className="danger-button"
          disabled={!demoStatus?.enabled || resetComplete}
          onClick={() => setResetOpen(true)}
        >
          重置演示数据
        </button>
      </section>

      {resetOpen ? (
        <ResetDialog onClose={() => setResetOpen(false)} onReset={reset} submitting={submitting} />
      ) : null}
    </main>
  );
}
