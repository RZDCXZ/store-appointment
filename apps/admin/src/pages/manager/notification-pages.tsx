import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  ManagerNotificationAttempt,
  ManagerNotificationDetailResponse,
  ManagerNotificationListResponse,
  ManagerNotificationTask,
  ManagerNotificationTaskStatus,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useBackofficeResource } from "../../backoffice-resource";
import { PageHeading } from "../../page-components";

const statusLabels: Record<ManagerNotificationTaskStatus, string> = {
  pending: "待发送",
  sent: "已发送",
  failed: "失败",
  manual_retry_required: "需人工重试",
};

const attemptModeLabels: Record<ManagerNotificationAttempt["mode"], string> = {
  automatic: "自动尝试",
  manual: "人工重试",
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function NotificationStatus({
  status,
}: {
  status: ManagerNotificationTaskStatus;
}): React.JSX.Element {
  return (
    <span className={`notification-status notification-status--${status}`}>
      {statusLabels[status]}
    </span>
  );
}

function BusinessFactNotice({ children }: { children: string }): React.JSX.Element {
  return (
    <aside className="notification-business-notice">
      <span aria-hidden="true">!</span>
      <div>
        <strong>预约事实与通知投递相互独立</strong>
        <p>{children}</p>
      </div>
    </aside>
  );
}

function InitialState({
  forbidden,
  message,
  retry,
}: {
  forbidden: boolean;
  message: string | null;
  retry: () => void;
}): React.JSX.Element {
  return (
    <section className="notification-state" role={message ? "alert" : undefined}>
      <p>{forbidden ? "403" : message ? "读取失败" : "正在回源"}</p>
      <h2>
        {forbidden ? "没有权限读取通知任务" : message ? "通知任务暂时不可用" : "正在读取通知事实…"}
      </h2>
      {message ? <span>{message}</span> : null}
      {message && !forbidden ? (
        <button className="primary-button" type="button" onClick={retry}>
          重新读取
        </button>
      ) : null}
    </section>
  );
}

function NotificationList({ tasks }: { tasks: ManagerNotificationTask[] }): React.JSX.Element {
  if (tasks.length === 0) {
    return (
      <section className="notification-empty">
        <p>当前没有通知任务</p>
        <span>预约动作产生的通知与到期提醒会在这里留下可追踪事实。</span>
      </section>
    );
  }

  return (
    <section className="notification-list-panel" aria-labelledby="notification-list-title">
      <header>
        <div>
          <p>任务事实</p>
          <h2 id="notification-list-title">全部通知</h2>
        </div>
        <span>{tasks.length} 个任务</span>
      </header>
      <div className="notification-table-scroll">
        <table className="notification-table">
          <thead>
            <tr>
              <th scope="col">通知与顾客</th>
              <th scope="col">预约</th>
              <th scope="col">状态</th>
              <th scope="col">尝试</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <th scope="row">
                  <strong>{task.typeLabel}</strong>
                  <small>{task.customer.displayName}</small>
                </th>
                <td>
                  <strong>{task.booking.petName}</strong>
                  <small>{task.booking.serviceName}</small>
                  <small>{formatTime(task.booking.startsAt)}</small>
                </td>
                <td>
                  <NotificationStatus status={task.status} />
                </td>
                <td>{task.attemptCount} 次</td>
                <td>
                  <Link to={`/manager/system/notifications/${task.id}`}>查看{task.typeLabel}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ManagerNotificationListPage(): React.JSX.Element {
  const resource = useBackofficeResource<ManagerNotificationListResponse>(
    "/backoffice/manager/notifications",
    "通知任务读取失败，请稍后重试。",
  );

  return (
    <main className="page-shell notification-page">
      <PageHeading
        copy={{
          eyebrow: "MG-15 · 系统与通知",
          title: "通知任务",
          description: "查看每个模拟通知的最终状态、发送尝试与对应预约事实。",
        }}
        badge={resource.data?.channel ?? "模拟微信通道"}
      />
      <BusinessFactNotice>通知失败不会撤销已经成立的预约事实。</BusinessFactNotice>
      {resource.loading && !resource.data ? (
        <InitialState forbidden={false} message={null} retry={resource.refresh} />
      ) : null}
      {resource.forbidden ? (
        <InitialState forbidden message={resource.error} retry={resource.refresh} />
      ) : null}
      {resource.error && !resource.data && !resource.forbidden ? (
        <InitialState forbidden={false} message={resource.error} retry={resource.refresh} />
      ) : null}
      {resource.error && resource.data ? (
        <div className="notification-inline-error" role="alert">
          <span>{resource.error}</span>
          <button type="button" onClick={resource.refresh}>
            重试刷新
          </button>
        </div>
      ) : null}
      {resource.data && !resource.forbidden ? (
        <NotificationList tasks={resource.data.tasks} />
      ) : null}
    </main>
  );
}

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
                <small>{formatTime(attempt.attemptedAt)}</small>
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
  const resource = useBackofficeResource<ManagerNotificationDetailResponse>(
    path,
    "通知详情读取失败，请稍后重试。",
  );
  const { markExpired } = useAuth();
  const [action, setAction] = useState<"inject" | "retry" | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  async function postAction(kind: "inject" | "retry"): Promise<void> {
    setAction(kind);
    setActionMessage("");
    setActionError("");
    const suffix = kind === "inject" ? "simulated-failures" : "manual-retry";

    try {
      const response = await apiFetch(`${path}/${suffix}`, {
        method: "POST",
        headers: kind === "inject" ? { "Content-Type": "application/json" } : undefined,
        body: kind === "inject" ? JSON.stringify({ count: 1 }) : undefined,
      });

      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) {
          markExpired();
          return;
        }
        throw error;
      }

      if (kind === "inject") {
        setActionMessage("已注入 1 次模拟失败。");
      } else {
        setActionMessage("人工重试已受理，正在读取最新结果。");
        await new Promise((resolve) => window.setTimeout(resolve, 160));
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
        badge={detail ? statusLabels[detail.task.status] : "模拟微信通道"}
      />
      {detail ? <BusinessFactNotice>{detail.businessFactNotice}</BusinessFactNotice> : null}
      {resource.loading && !detail ? (
        <InitialState forbidden={false} message={null} retry={resource.refresh} />
      ) : null}
      {resource.forbidden ? (
        <InitialState forbidden message={resource.error} retry={resource.refresh} />
      ) : null}
      {resource.error && !detail && !resource.forbidden ? (
        <InitialState forbidden={false} message={resource.error} retry={resource.refresh} />
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
                {detail.task.booking.serviceName} · {formatTime(detail.task.booking.startsAt)}
              </small>
              <Link to={`/manager/appointments/${detail.task.booking.id}`}>
                查看已成立的预约事实
              </Link>
            </div>
            <div>
              <p>投递通道</p>
              <strong>{detail.task.channel}</strong>
              <small>任务创建于 {formatTime(detail.task.createdAt)}</small>
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
