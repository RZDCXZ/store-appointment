import { Link, useOutletContext } from "react-router-dom";
import {
  CalendarIcon,
  CheckCircledIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";
import type { StaffBookingAction, StaffTodayResponse } from "@rongguang/contracts";

import type { BackofficeOutletContext } from "../../backoffice-layout";
import {
  formatShanghaiClock,
  formatShanghaiDate,
  serviceLabel,
  staffActionLabels,
} from "../../staff-booking-presentation";
import {
  StaffActionLabel,
  StaffBookingRow,
  StaffPageError,
  StaffPageLoading,
  StaffStatusTag,
} from "../../staff-booking-components";
import { useStaffResource } from "../../staff-resource";

const actionMetadata: Array<{
  action: Extract<StaffBookingAction, "late" | "check_in" | "complete">;
  icon: typeof ClockIcon;
}> = [
  { action: "late", icon: ExclamationTriangleIcon },
  { action: "check_in", icon: CalendarIcon },
  { action: "complete", icon: CheckCircledIcon },
];

function shiftLabel(data: StaffTodayResponse): string {
  if (data.shifts.length === 0) return "今日未发布班次";
  return `班次 ${data.shifts.map((shift) => `${shift.startsAt}–${shift.endsAt}`).join("、")}`;
}

function NextBooking({ booking }: { booking: NonNullable<StaffTodayResponse["nextBooking"]> }) {
  return (
    <section className="staff-next-card">
      <header>
        <span>
          <small>现场优先</small>
          <h2>下一位宠物</h2>
        </span>
        <StaffActionLabel booking={booking} />
      </header>
      <div className="staff-next-card__body">
        {booking.pet.photoPath ? <img src={booking.pet.photoPath} alt={booking.pet.name} /> : null}
        <div>
          <StaffStatusTag booking={booking} />
          <h3>{booking.pet.name}</h3>
          <p>{serviceLabel(booking.service)}</p>
          <div className="staff-care-tags">
            {booking.pet.careTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <time>
          <strong>{formatShanghaiClock(booking.startsAt)}</strong>
          <small>至 {formatShanghaiClock(booking.endsAt)}</small>
        </time>
      </div>
      <Link
        className="staff-primary-link"
        to={`/staff/appointments/${booking.id}`}
        aria-label={`查看${booking.pet.name}预约详情`}
      >
        查看预约详情
      </Link>
    </section>
  );
}

function ActionQueue({ data }: { data: StaffTodayResponse }): React.JSX.Element {
  const counts = new Map<StaffBookingAction, number>();
  for (const booking of data.actionQueue) {
    counts.set(booking.action, (counts.get(booking.action) ?? 0) + 1);
  }

  return (
    <section className="staff-action-panel">
      <header>
        <span>
          <small>按行动紧迫度排序</small>
          <h2>行动队列</h2>
        </span>
        <b>{data.actionQueue.length} 项</b>
      </header>
      <div className="staff-action-counts" aria-label="行动队列分类">
        {actionMetadata.map(({ action, icon: Icon }) => (
          <span className={`staff-action-count staff-action-count--${action}`} key={action}>
            <Icon />
            <small>{staffActionLabels[action]}</small>
            <strong>{counts.get(action) ?? 0}</strong>
          </span>
        ))}
      </div>
      {data.actionQueue.length > 0 ? (
        <div className="staff-action-list">
          {data.actionQueue.map((booking) => (
            <StaffBookingRow booking={booking} key={booking.id} />
          ))}
        </div>
      ) : (
        <p className="staff-empty-copy">当前没有需要立即处理的核销、迟到或完成事项。</p>
      )}
    </section>
  );
}

export function StaffTodayPage(): React.JSX.Element {
  const { account } = useOutletContext<BackofficeOutletContext>();
  const resource = useStaffResource<StaffTodayResponse>("/backoffice/staff/today");
  const data = resource.data;
  const activeBookings = data?.bookings.filter((booking) => booking.action !== "ended") ?? [];
  const endedBookings = data?.bookings.filter((booking) => booking.action === "ended") ?? [];

  return (
    <main className="page-shell staff-work-page">
      <header className="staff-page-header">
        <div>
          <p>ST-02 · 本人范围</p>
          <h1>我的今日工作</h1>
          <span>{data ? formatShanghaiDate(data.demoNow) : "正在读取上海演示时间"}</span>
        </div>
        <button type="button" onClick={resource.refresh} disabled={resource.refreshing}>
          {resource.refreshing ? "刷新中…" : "刷新"}
        </button>
      </header>

      {resource.loading && !data ? <StaffPageLoading label="正在读取我的今日工作" /> : null}
      {resource.error && !data ? (
        <StaffPageError
          title="今日工作暂时无法读取"
          message={resource.error}
          retry={resource.refresh}
        />
      ) : null}
      {resource.error && data ? (
        <div className="staff-inline-error" role="alert">
          <span>更新失败，已保留上次读取的今日事实。</span>
          <button type="button" onClick={resource.refresh}>
            重试
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          <section className="staff-context-strip">
            <span>
              <strong>{account.displayName} · 员工</strong>
              <small>{shiftLabel(data)}</small>
            </span>
            <b>本地演示</b>
          </section>

          {data.nextBooking ? (
            <NextBooking booking={data.nextBooking} />
          ) : (
            <section className="staff-state staff-state--empty">
              <CalendarIcon />
              <h2>今天没有待履约预约</h2>
              <p>当前身份与班次仍已加载；新的本人预约会显示在这里。</p>
            </section>
          )}

          <ActionQueue data={data} />

          <section className="staff-day-panel">
            <header>
              <h2>今日时间线</h2>
              <Link to="/staff/appointments">查看我的全部预约</Link>
            </header>
            {activeBookings.length > 0 ? (
              <div className="staff-booking-list">
                {activeBookings.map((booking) => (
                  <StaffBookingRow booking={booking} key={booking.id} />
                ))}
              </div>
            ) : (
              <p className="staff-empty-copy">今日没有进行中或即将开始的预约。</p>
            )}
            {endedBookings.length > 0 ? (
              <details className="staff-ended-bookings">
                <summary>已结束事项（{endedBookings.length}）</summary>
                {endedBookings.map((booking) => (
                  <StaffBookingRow booking={booking} key={booking.id} />
                ))}
              </details>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
