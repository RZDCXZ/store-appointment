import { useMemo, useState } from "react";
import type { StaffBookingListResponse } from "@rongguang/contracts";

import {
  formatShanghaiDate,
  matchesStaffAppointmentFilter,
  type StaffAppointmentFilter,
} from "../../staff-booking-presentation";
import { StaffBookingRow, StaffPageError, StaffPageLoading } from "../../staff-booking-components";
import { useStaffResource } from "../../staff-resource";

export function StaffAppointmentsPage(): React.JSX.Element {
  const resource = useStaffResource<StaffBookingListResponse>("/backoffice/staff/bookings");
  const [filter, setFilter] = useState<StaffAppointmentFilter>("today");
  const bookings = useMemo(
    () =>
      resource.data?.bookings.filter((booking) =>
        matchesStaffAppointmentFilter(booking, filter, resource.data?.demoNow ?? ""),
      ) ?? [],
    [filter, resource.data],
  );

  return (
    <main className="page-shell staff-work-page staff-appointments-page">
      <header className="staff-page-header">
        <div>
          <p>本人范围</p>
          <h1>我的预约</h1>
          <span>
            {resource.data
              ? `${formatShanghaiDate(resource.data.demoNow)} · 只显示分配给我的预约`
              : "预约与履约记录"}
          </span>
        </div>
        <button type="button" onClick={resource.refresh} disabled={resource.refreshing}>
          {resource.refreshing ? "刷新中…" : "刷新"}
        </button>
      </header>

      <div className="staff-filter-tabs" role="group" aria-label="预约范围">
        {(
          [
            ["today", "今天"],
            ["attention", "待处理"],
            ["upcoming", "接下来"],
            ["ended", "已结束"],
          ] as const
        ).map(([value, label]) => (
          <button
            className={filter === value ? "active" : ""}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            key={value}
          >
            {label}
          </button>
        ))}
      </div>

      {resource.loading && !resource.data ? <StaffPageLoading label="正在读取我的预约" /> : null}
      {resource.error && !resource.data ? (
        <StaffPageError
          title="我的预约暂时无法读取"
          message={resource.error}
          retry={resource.refresh}
        />
      ) : null}
      {resource.error && resource.data ? (
        <div className="staff-inline-error" role="alert">
          <span>更新失败，已保留上次读取的预约。</span>
          <button type="button" onClick={resource.refresh}>
            重试
          </button>
        </div>
      ) : null}
      {resource.data ? (
        <section className="staff-day-panel">
          {bookings.length > 0 ? (
            <div className="staff-booking-list">
              {bookings.map((booking) => (
                <StaffBookingRow booking={booking} key={booking.id} />
              ))}
            </div>
          ) : (
            <div className="staff-list-empty">
              <strong>这个范围内还没有预约</strong>
              <p>切换上方范围可查看接下来或已结束的本人预约。</p>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
