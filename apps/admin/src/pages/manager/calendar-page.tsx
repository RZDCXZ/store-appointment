import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, ReloadIcon } from "@radix-ui/react-icons";
import {
  getShanghaiLocalDate,
  type ManagerBookingFact,
  type ManagerCalendarBlock,
  type ManagerCalendarResponse,
  type ManagerStaffDay,
} from "@rongguang/contracts";

import {
  clockMinutes,
  formatShanghaiClock,
  managerBookingStatusLabels,
} from "../../manager-booking-presentation";
import { useManagerResource } from "../../manager-live-resource";

const calendarStartsAt = 9 * 60 + 30;
const calendarEndsAt = 19 * 60;
const calendarMinutes = calendarEndsAt - calendarStartsAt;

function verticalPosition(startsAt: number, endsAt: number): React.CSSProperties {
  const start = Math.max(calendarStartsAt, startsAt);
  const end = Math.min(calendarEndsAt, endsAt);
  return {
    top: `${((start - calendarStartsAt) / calendarMinutes) * 100}%`,
    height: `${(Math.max(0, end - start) / calendarMinutes) * 100}%`,
  };
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function defaultDate(): string {
  try {
    return getShanghaiLocalDate(import.meta.env.VITE_DEMO_NOW ?? new Date());
  } catch {
    return getShanghaiLocalDate(new Date());
  }
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function calendarOffShift(day: ManagerStaffDay): Array<{ startsAt: number; endsAt: number }> {
  const shifts = day.shifts
    .map((shift) => ({
      startsAt: clockMinutes(shift.startsAt),
      endsAt: clockMinutes(shift.endsAt),
    }))
    .sort((left, right) => left.startsAt - right.startsAt);
  const offShift: Array<{ startsAt: number; endsAt: number }> = [];
  let cursor = calendarStartsAt;

  for (const shift of shifts) {
    if (shift.startsAt > cursor) offShift.push({ startsAt: cursor, endsAt: shift.startsAt });
    cursor = Math.max(cursor, shift.endsAt);
  }
  if (cursor < calendarEndsAt) offShift.push({ startsAt: cursor, endsAt: calendarEndsAt });
  return offShift;
}

function CalendarLoading(): React.JSX.Element {
  return (
    <section className="manager-calendar-loading" role="status" aria-label="正在读取按员工日历">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="manager-calendar-skeleton manager-shimmer" key={index} />
      ))}
    </section>
  );
}

function RefreshNotice({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="manager-refresh-notice" role="alert">
      <span>
        <strong>{message}</strong>
        <small>旧日历仍可查看；重试会重新读取当前事实。</small>
      </span>
      <button type="button" onClick={retry}>
        重试刷新
      </button>
    </div>
  );
}

function CalendarBlock({ block }: { block: ManagerCalendarBlock }) {
  return (
    <div
      className={`manager-calendar-block manager-calendar-block--${block.kind} manager-calendar-block--${block.status}`}
      style={verticalPosition(clockMinutes(block.startsAt), clockMinutes(block.endsAt))}
    >
      <strong>{block.kind === "time_off" ? "停班" : "临时闭店"}</strong>
      <small>
        {block.startsAt}–{block.endsAt} · {block.status === "pending" ? "待处理" : "已生效"} · 影响{" "}
        {block.affectedBookingCount} 笔预约
      </small>
    </div>
  );
}

function CalendarBooking({ booking }: { booking: ManagerBookingFact }) {
  const startsAt = clockMinutes(formatShanghaiClock(booking.startsAt));
  const endsAt = clockMinutes(formatShanghaiClock(booking.endsAt));
  const turnoverEndsAt = clockMinutes(formatShanghaiClock(booking.turnoverEndsAt));

  return (
    <>
      <Link
        className={`manager-calendar-booking manager-booking--${booking.status}`}
        style={verticalPosition(startsAt, endsAt)}
        to={`/manager/appointments/${booking.id}`}
        aria-label={`${booking.pet.name} ${booking.primaryService.name} ${formatShanghaiClock(booking.startsAt)} 至 ${formatShanghaiClock(booking.endsAt)} ${managerBookingStatusLabels[booking.status]}`}
      >
        <strong>
          {formatShanghaiClock(booking.startsAt)}–{formatShanghaiClock(booking.endsAt)}
        </strong>
        <span>
          {booking.pet.name} · {booking.primaryService.name}
        </span>
        <small>{managerBookingStatusLabels[booking.status]}</small>
      </Link>
      <span className="manager-calendar-turnover" style={verticalPosition(endsAt, turnoverEndsAt)}>
        周转 {booking.turnoverMinutes} 分钟
      </span>
    </>
  );
}

function CalendarStaffColumn({ day }: { day: ManagerStaffDay }) {
  const lines = Array.from({ length: 20 }, (_, index) => index);

  return (
    <article className="manager-calendar-staff" data-testid="manager-calendar-staff">
      <header>
        <img src={day.staff.avatarPath} alt={`${day.staff.displayName}头像`} />
        <span>
          <strong>{day.staff.displayName}</strong>
          <small>
            {day.shifts.length > 0
              ? day.shifts.map((shift) => `${shift.startsAt}–${shift.endsAt}`).join(" / ")
              : "今日无班次"}
          </small>
        </span>
        <b>余 {formatHours(day.capacity.remainingMinutes)}</b>
      </header>
      <div className="manager-calendar-column-body">
        {lines.map((line) => (
          <i
            className="manager-calendar-grid-line"
            style={{ top: `${(line / 19) * 100}%` }}
            key={line}
          />
        ))}
        {calendarOffShift(day).map((interval) => (
          <span
            className="manager-calendar-offshift"
            style={verticalPosition(interval.startsAt, interval.endsAt)}
            key={`${interval.startsAt}-${interval.endsAt}`}
          >
            非班次
          </span>
        ))}
        {day.shifts.flatMap((shift) =>
          shift.breaks.map((shiftBreak) => (
            <span
              className="manager-calendar-break"
              style={verticalPosition(
                clockMinutes(shiftBreak.startsAt),
                clockMinutes(shiftBreak.endsAt),
              )}
              key={`${shiftBreak.startsAt}-${shiftBreak.endsAt}`}
            >
              <strong>休息</strong>
              <small>
                {shiftBreak.startsAt}–{shiftBreak.endsAt}
              </small>
            </span>
          )),
        )}
        {day.blocks.map((block) => (
          <CalendarBlock block={block} key={block.id} />
        ))}
        {day.bookings.map((booking) => (
          <CalendarBooking booking={booking} key={booking.id} />
        ))}
      </div>
    </article>
  );
}

function CalendarBoard({ data }: { data: ManagerCalendarResponse }) {
  const labels = Array.from({ length: 20 }, (_, index) => {
    const minutes = calendarStartsAt + index * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  });

  return (
    <section className="manager-calendar-board" aria-label="四名员工日历">
      <div className="manager-calendar-axis" aria-hidden="true">
        <span />
        <div>
          {labels.map((label, index) => (
            <b style={{ top: `${(index / 19) * 100}%` }} key={label}>
              {label}
            </b>
          ))}
        </div>
      </div>
      {data.staffDays.map((day) => (
        <CalendarStaffColumn day={day} key={day.staff.id} />
      ))}
    </section>
  );
}

export function ManagerCalendarPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const date = searchParams.get("date") ?? defaultDate();
  const resource = useManagerResource<ManagerCalendarResponse>(
    `/backoffice/manager/calendar?${new URLSearchParams({ date }).toString()}`,
  );
  const selectedIndex = resource.data?.window.days.findIndex((day) => day.date === date) ?? -1;
  const previousDate =
    selectedIndex > 0 ? resource.data?.window.days[selectedIndex - 1]?.date : null;
  const nextDate =
    selectedIndex >= 0 && resource.data && selectedIndex < resource.data.window.days.length - 1
      ? resource.data.window.days[selectedIndex + 1]?.date
      : null;

  return (
    <main className="page-shell manager-calendar-page">
      <header className="manager-page-header">
        <div>
          <p>MG-02 · 预约</p>
          <h1>按员工日历</h1>
          <span>班次、休息、预约、周转和容量变化同屏</span>
        </div>
        <div className="manager-page-actions">
          <span className={`manager-live-status manager-live-status--${resource.connection}`}>
            {resource.connection === "reconnecting" ? "实时更新重连中" : "实时更新已连接"}
          </span>
          <button type="button" onClick={resource.refresh} disabled={resource.refreshing}>
            <ReloadIcon />
            {resource.refreshing ? "更新中" : "刷新"}
          </button>
        </div>
      </header>

      {resource.loading && !resource.data ? <CalendarLoading /> : null}
      {resource.forbidden ? (
        <section className="manager-fact-state" role="alert">
          <strong>没有权限</strong>
          <p>员工不能读取完整员工日历或跨员工预约。</p>
        </section>
      ) : null}
      {resource.error && !resource.data ? (
        <section className="manager-fact-state manager-fact-state--error" role="alert">
          <strong>日历暂时无法读取</strong>
          <p>{resource.error}</p>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {resource.error && resource.data ? (
        <RefreshNotice message={resource.error} retry={resource.refresh} />
      ) : null}

      {resource.data ? (
        <>
          <section className="manager-calendar-toolbar">
            <div>
              <ClockIcon />
              <span>
                <strong>{formatDate(resource.data.selectedDate)}</strong>
                <small>
                  {resource.data.businessHours.status === "open"
                    ? `${resource.data.businessHours.opensAt}–${resource.data.businessHours.closesAt} · 剩余 ${formatHours(resource.data.capacity.remainingMinutes)}`
                    : "门店闭店"}
                </small>
              </span>
            </div>
            <nav aria-label="日历日期切换">
              {previousDate ? (
                <Link
                  to={`/manager/appointments/calendar?date=${previousDate}`}
                  aria-label="前一天"
                >
                  <ChevronLeftIcon />
                </Link>
              ) : (
                <span className="manager-calendar-date-disabled" aria-hidden="true">
                  <ChevronLeftIcon />
                </span>
              )}
              <span>{formatDate(resource.data.selectedDate)}</span>
              {nextDate ? (
                <Link to={`/manager/appointments/calendar?date=${nextDate}`} aria-label="后一天">
                  <ChevronRightIcon />
                </Link>
              ) : (
                <span className="manager-calendar-date-disabled" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              )}
            </nav>
          </section>
          <section className="manager-calendar-legend" aria-label="日历图例">
            <span className="legend-offshift">非班次</span>
            <span className="legend-break">休息</span>
            <span className="legend-booking">预约</span>
            <span className="legend-turnover">15 分钟周转</span>
            <span className="legend-block">已生效停班 / 临时闭店</span>
            <span className="legend-block-pending">待处理容量变化</span>
          </section>
          <CalendarBoard data={resource.data} />
        </>
      ) : null}
    </main>
  );
}
