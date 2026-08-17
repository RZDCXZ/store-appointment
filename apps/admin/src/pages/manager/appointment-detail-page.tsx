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

export function ManagerAppointmentDetailPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const resource = useManagerResource<ManagerBookingDetailResponse>(
    `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}`,
    false,
  );
  const booking = resource.data?.booking;

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
      {booking ? (
        <>
          <header className="manager-detail-header">
            <Link to={`/manager/appointments/calendar?date=${localDate(booking.startsAt)}`}>
              <ChevronLeftIcon /> 返回按员工日历
            </Link>
            <div>
              <span className={`manager-booking-status manager-booking-status--${booking.status}`}>
                {managerBookingStatusLabels[booking.status]}
              </span>
              <h1>{booking.pet.name}的预约</h1>
              <p>预约编号 {booking.id}</p>
            </div>
          </header>
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
          <section className="manager-detail-note">
            <strong>当前事实来自预约 API</strong>
            <p>直接访问或刷新本页都会按预约编号重新读取，不依赖工作台内的抽屉状态。</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
