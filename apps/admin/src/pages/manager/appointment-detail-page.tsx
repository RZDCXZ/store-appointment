import { Link, useParams } from "react-router-dom";
import { ChevronLeftIcon, ClockIcon, PersonIcon, ReaderIcon } from "@radix-ui/react-icons";
import type { ManagerBookingDetailResponse } from "@rongguang/contracts";

import { managerBookingStatusLabels } from "../../manager-booking-presentation";
import { useManagerResource } from "../../manager-live-resource";

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

const actorLabels = {
  customer: "顾客",
  staff: "员工",
  manager: "店长",
  system: "系统",
} as const;

const notificationStatusLabels = {
  pending: "待发送",
  processing: "发送中",
  sent: "已发送",
  retry: "待重试",
  failed: "发送失败",
} as const;

export function ManagerAppointmentDetailPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const resource = useManagerResource<ManagerBookingDetailResponse>(
    `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}`,
    false,
  );
  const booking = resource.data?.booking;
  const detail = resource.data;

  return (
    <main className="page-shell manager-booking-detail-page">
      {resource.loading && !booking ? (
        <section
          className="manager-detail-loading manager-shimmer"
          role="status"
          aria-label="正在读取预约详情"
        />
      ) : null}
      {resource.error && !booking ? (
        <section className="manager-fact-state manager-fact-state--error" role="alert">
          <strong>预约详情暂时无法读取</strong>
          <p>{resource.error}</p>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {booking && detail ? (
        <>
          <header className="manager-detail-header">
            <Link to={`/manager/appointments/calendar?date=${localDate(booking.startsAt)}`}>
              <ChevronLeftIcon /> 返回按员工日历
            </Link>
            <Link to="/manager/appointments/list">返回预约列表</Link>
            <div>
              <span className={`manager-booking-status manager-booking-status--${booking.status}`}>
                {managerBookingStatusLabels[booking.status]}
              </span>
              <h1>{booking.pet.name}的预约</h1>
              <p>预约编号 {booking.id}</p>
            </div>
          </header>
          <section className="manager-detail-actions" aria-label="店长预约操作">
            <span>
              <small>当前可执行操作</small>
              <strong>{detail.managerActions.message}</strong>
            </span>
            {detail.managerActions.canCancel || detail.managerActions.canReschedule ? (
              <div>
                {detail.managerActions.canCancel ? (
                  <Link
                    className="manager-secondary-link"
                    to={`/manager/appointments/${booking.id}/cancel`}
                  >
                    取消预约
                  </Link>
                ) : null}
                {detail.managerActions.canReschedule ? (
                  <Link
                    className="manager-primary-link"
                    to={`/manager/appointments/${booking.id}/reschedule`}
                  >
                    店长改期
                  </Link>
                ) : null}
              </div>
            ) : null}
            {booking.status === "checked_in" ? (
              <div>
                <span>完成服务由{booking.staff.displayName}操作</span>
                <Link
                  className="manager-secondary-link"
                  to={`/manager/appointments/${booking.id}/terminate`}
                >
                  服务终止
                </Link>
              </div>
            ) : null}
          </section>
          <section className="manager-detail-grid">
            <article>
              <PersonIcon />
              <span>
                <small>顾客与宠物</small>
                <strong>{booking.customer.displayName}</strong>
                <p>{booking.customer.phoneMasked}</p>
                <p>
                  {booking.pet.name} · {booking.pet.species === "cat" ? "猫" : "犬"}
                </p>
                <p>
                  {detail.petProfile.breed ?? "品种未记录"} · {detail.petProfile.weightKg} kg
                </p>
                <p>
                  {detail.petProfile.careTags.length > 0
                    ? detail.petProfile.careTags.join("、")
                    : "无特别护理标签"}
                </p>
                {detail.petProfile.careNotes ? <p>{detail.petProfile.careNotes}</p> : null}
              </span>
              {booking.pet.photoPath ? (
                <img src={booking.pet.photoPath} alt={booking.pet.name} />
              ) : null}
            </article>
            <article>
              <ReaderIcon />
              <span>
                <small>本次服务</small>
                <strong>{booking.primaryService.name}</strong>
                <p>
                  {booking.addons.length > 0
                    ? booking.addons.map((addon) => addon.name).join("、")
                    : "无增项"}
                </p>
                <p>预计 {booking.serviceDurationMinutes} 分钟</p>
              </span>
            </article>
            <article>
              <ClockIcon />
              <span>
                <small>时间与员工</small>
                <strong>{formatDateTime(booking.startsAt)}</strong>
                <p>至 {formatDateTime(booking.endsAt)}</p>
                <p>
                  {booking.staff.displayName} · 周转 {booking.turnoverMinutes} 分钟
                </p>
              </span>
            </article>
          </section>
          <section className="manager-detail-facts">
            <article>
              <header>
                <h2>门店服务记录</h2>
                <p>履约后由员工留下，店长更正会保留痕迹。</p>
              </header>
              {detail.serviceRecord ? (
                <div className="manager-detail-fact-list">
                  <p>
                    实际服务：{formatDateTime(detail.serviceRecord.actualStartsAt)} 至{" "}
                    {formatDateTime(detail.serviceRecord.actualEndsAt)}
                  </p>
                  <p>{detail.serviceRecord.internalText ?? "未留下内部服务说明"}</p>
                  {detail.serviceRecord.notes.map((note) => (
                    <p key={note.id}>
                      <small>{note.author.displayName}</small>
                      <span>{note.text}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="manager-detail-empty">预约尚未产生门店服务记录。</p>
              )}
            </article>
            <article>
              <header>
                <h2>预约变更历史</h2>
                <p>按时间记录预约生命周期事件。</p>
              </header>
              {detail.changeHistory.length > 0 ? (
                <ol className="manager-detail-timeline">
                  {detail.changeHistory.map((event) => (
                    <li key={event.id}>
                      <strong>
                        {actorLabels[event.actorType]} · {event.type}
                      </strong>
                      <span>{formatDateTime(event.occurredAt)}</span>
                      {event.reason ? <p>{event.reason}</p> : null}
                      {event.previous ? (
                        <p>
                          原安排：{event.previous.staff.displayName} ·{" "}
                          {formatDateTime(event.previous.startsAt)}
                        </p>
                      ) : null}
                      {event.next ? (
                        <p>
                          新安排：{event.next.staff.displayName} ·{" "}
                          {formatDateTime(event.next.startsAt)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="manager-detail-empty">暂无变更记录。</p>
              )}
            </article>
            <article>
              <header>
                <h2>通知记录</h2>
                <p>用于核对预约通知的投递状态。</p>
              </header>
              {detail.notifications.length > 0 ? (
                <ul className="manager-detail-timeline">
                  {detail.notifications.map((notification) => (
                    <li key={notification.id}>
                      <strong>{notification.type}</strong>
                      <span>
                        {notificationStatusLabels[notification.status]} · 尝试{" "}
                        {notification.attemptCount} 次
                      </span>
                      <p>{formatDateTime(notification.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="manager-detail-empty">暂无通知记录。</p>
              )}
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}
