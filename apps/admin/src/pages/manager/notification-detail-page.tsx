import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  ManagerNotificationAttempt,
  ManagerNotificationDetailResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useManagerResource } from "../../manager-live-resource";
import { PageHeading } from "../../page-components";
import {
  formatNotificationTime,
  NotificationBusinessFactNotice,
  NotificationInitialState,
  NotificationStatus,
  notificationStatusLabels,
} from "./notification-presentation";

const attemptModeLabels: Record<ManagerNotificationAttempt["mode"], string> = {
  automatic: "自动尝试",
  manual: "人工重试",
};

const notificationActions = {
  inject: {
    suffix: "simulated-failures",
    request: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    },
    successMessage: "已注入 1 次模拟失败。",
    refresh: false,
  },
  retry: {
    suffix: "manual-retry",
    request: { method: "POST" },
    successMessage: "人工重试已受理，正在读取最新结果。",
    refresh: true,
  },
} as const satisfies Record<
  "inject" | "retry",
  {
    suffix: string;
    request: RequestInit;
    successMessage: string;
    refresh: boolean;
  }
>;

function Attempts({ attempts }: { attempts: ManagerNotificationAttempt[] }): React.JSX.Element {
  return (
    <section className="notification-attempt-panel" aria-labelledby="notification-attempt-title">
      <header>
        <div>
          <p>不可覆盖的投递记录</p>
          <h2 id="notification-attempt-title">发送尝试</h2>
        </div>
        <span>{attempts.length} 次</span>
      </header>
      {attempts.length === 0 ? (
        <p className="notification-attempt-empty">尚未开始第一次发送。</p>
      ) : (
        <ol>
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <span
                className={`notification-attempt-result notification-attempt-result--${attempt.result}`}
              >
                {attempt.result === "sent" ? "成功" : "失败"}
              </span>
              <div>
                <strong>
                  第 {attempt.number} 次 · {attemptModeLabels[attempt.mode]}
                </strong>
                <small>{formatNotificationTime(attempt.attemptedAt)}</small>
                <p>{attempt.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ManagerNotificationDetailPage(): React.JSX.Element {
  const { notificationId = "" } = useParams<{ notificationId: string }>();
  const path = `/backoffice/manager/notifications/${encodeURIComponent(notificationId)}`;
  const resource = useManagerResource<ManagerNotificationDetailResponse>(path, true, [
    "manager-notifications",
  ]);
  const { markExpired } = useAuth();
  const [action, setAction] = useState<"inject" | "retry" | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  async function postAction(kind: "inject" | "retry"): Promise<void> {
    setAction(kind);
    setActionMessage("");
    setActionError("");
    const actionConfig = notificationActions[kind];

    try {
      const response = await apiFetch(`${path}/${actionConfig.suffix}`, actionConfig.request);
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) {
          markExpired();
          return;
        }
        throw error;
      }
      setActionMessage(actionConfig.successMessage);
      if (actionConfig.refresh) {
        resource.refresh();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作失败，请稍后重试。");
    } finally {
      setAction(null);
    }
  }

  const detail = resource.data;

  return (
    <main className="page-shell notification-page notification-detail-page">
      <Link className="notification-back-link" to="/manager/system/notifications">
        ← 返回通知任务
      </Link>
      <PageHeading
        copy={{
          eyebrow: "MG-15 · 通知详情",
          title: detail?.task.typeLabel ?? "通知详情",
          description: "按任务身份恢复预约、顾客、通道与每一次发送结果。",
        }}
        badge={detail ? notificationStatusLabels[detail.task.status] : "模拟微信通道"}
      />
      {detail ? (
        <NotificationBusinessFactNotice>{detail.businessFactNotice}</NotificationBusinessFactNotice>
      ) : null}
      {resource.loading && !detail ? (
        <NotificationInitialState forbidden={false} message={null} retry={resource.refresh} />
      ) : null}
      {resource.forbidden ? (
        <NotificationInitialState forbidden message={resource.error} retry={resource.refresh} />
      ) : null}
      {resource.error && !detail && !resource.forbidden ? (
        <NotificationInitialState
          forbidden={false}
          message={resource.error}
          retry={resource.refresh}
        />
      ) : null}
      {detail && !resource.forbidden ? (
        <>
          <section className="notification-detail-summary">
            <div>
              <p>任务状态</p>
              <NotificationStatus status={detail.task.status} />
              <small>累计尝试 {detail.task.attemptCount} 次</small>
            </div>
            <div>
              <p>顾客与预约</p>
              <strong>
                {detail.task.customer.displayName} · {detail.task.booking.petName}
              </strong>
              <small>
                {detail.task.booking.serviceName} ·{" "}
                {formatNotificationTime(detail.task.booking.startsAt)}
              </small>
              <Link to={`/manager/appointments/${detail.task.booking.id}`}>
                查看已成立的预约事实
              </Link>
            </div>
            <div>
              <p>投递通道</p>
              <strong>{detail.task.channel}</strong>
              <small>任务创建于 {formatNotificationTime(detail.task.createdAt)}</small>
            </div>
          </section>
          {detail.task.status !== "sent" ? (
            <section className="notification-actions" aria-label="通知演示操作">
              <div>
                <p>可预测失败演示</p>
                <span>仅影响下一次模拟发送，不改变预约状态。</span>
              </div>
              <button
                type="button"
                disabled={action !== null}
                onClick={() => void postAction("inject")}
              >
                注入下一次模拟失败
              </button>
              {detail.task.status === "manual_retry_required" ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={action !== null}
                  onClick={() => void postAction("retry")}
                >
                  人工重试
                </button>
              ) : null}
            </section>
          ) : null}
          {actionMessage ? (
            <p className="notification-action-message" role="status">
              {actionMessage}
            </p>
          ) : null}
          {actionError ? (
            <p className="notification-action-error" role="alert">
              {actionError}
            </p>
          ) : null}
          {resource.error ? (
            <div className="notification-inline-error" role="alert">
              <span>{resource.error}</span>
              <button type="button" onClick={resource.refresh}>
                重试刷新
              </button>
            </div>
          ) : null}
          <Attempts attempts={detail.task.attempts} />
        </>
      ) : null}
    </main>
  );
}
