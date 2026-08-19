import { Link } from "react-router-dom";
import type {
  ManagerNotificationListResponse,
  ManagerNotificationTask,
} from "@rongguang/contracts";

import { useManagerResource } from "../../manager-live-resource";
import { PageHeading } from "../../page-components";
import {
  formatNotificationTime,
  NotificationBusinessFactNotice,
  NotificationInitialState,
  NotificationStatus,
} from "./notification-presentation";
import { SystemPageLinks } from "./system-page-links";

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
                  <small>{formatNotificationTime(task.booking.startsAt)}</small>
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
  const resource = useManagerResource<ManagerNotificationListResponse>(
    "/backoffice/manager/notifications",
    true,
    ["manager-notifications"],
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
      <SystemPageLinks />
      <NotificationBusinessFactNotice>
        通知失败不会撤销已经成立的预约事实。
      </NotificationBusinessFactNotice>
      {resource.loading && !resource.data ? (
        <NotificationInitialState forbidden={false} message={null} retry={resource.refresh} />
      ) : null}
      {resource.forbidden ? (
        <NotificationInitialState forbidden message={resource.error} retry={resource.refresh} />
      ) : null}
      {resource.error && !resource.data && !resource.forbidden ? (
        <NotificationInitialState
          forbidden={false}
          message={resource.error}
          retry={resource.refresh}
        />
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
