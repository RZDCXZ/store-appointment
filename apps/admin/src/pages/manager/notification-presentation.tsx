import type { ManagerNotificationTaskStatus } from "@rongguang/contracts";

export const notificationStatusLabels: Record<ManagerNotificationTaskStatus, string> = {
  pending: "待发送",
  sent: "已发送",
  failed: "失败",
  manual_retry_required: "需人工重试",
};

export function formatNotificationTime(value: string): string {
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

export function NotificationStatus({
  status,
}: {
  status: ManagerNotificationTaskStatus;
}): React.JSX.Element {
  return (
    <span className={`notification-status notification-status--${status}`}>
      {notificationStatusLabels[status]}
    </span>
  );
}

export function NotificationBusinessFactNotice({
  children,
}: {
  children: string;
}): React.JSX.Element {
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

export function NotificationInitialState({
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
