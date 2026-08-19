import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  BellIcon,
  CalendarIcon,
  CheckCircledIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  ReloadIcon,
  StopwatchIcon,
} from "@radix-ui/react-icons";
import type {
  ManagerBookingFact,
  ManagerStaffDay,
  ManagerWorkbenchResponse,
} from "@rongguang/contracts";

import {
  clockMinutes,
  formatShanghaiClock,
  managerBookingStatusLabels,
} from "../../manager-booking-presentation";
import { useManagerResource } from "../../manager-live-resource";
import { HealthStatus } from "../../page-components";

const dayStartsAt = 9 * 60 + 30;
const dayEndsAt = 19 * 60;
const dayMinutes = dayEndsAt - dayStartsAt;

const statusMetadata: Array<{
  status: keyof typeof managerBookingStatusLabels;
  icon: ComponentType;
}> = [
  { status: "confirmed", icon: CalendarIcon },
  { status: "checked_in", icon: HomeIcon },
  { status: "completed", icon: CheckCircledIcon },
  { status: "cancelled", icon: CrossCircledIcon },
  { status: "no_show", icon: StopwatchIcon },
  { status: "terminated", icon: Cross2Icon },
];

function trackPosition(startsAt: number, endsAt: number): React.CSSProperties {
  const start = Math.max(dayStartsAt, startsAt);
  const end = Math.min(dayEndsAt, endsAt);
  return {
    left: `${((start - dayStartsAt) / dayMinutes) * 100}%`,
    width: `${(Math.max(0, end - start) / dayMinutes) * 100}%`,
  };
}

function formatDemoTime(value: string): string {
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

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`;
}

function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function WorkbenchLoading(): React.JSX.Element {
  return (
    <section className="manager-workbench-loading" role="status" aria-label="正在读取今日工作台">
      <div className="manager-loading-summary manager-shimmer" />
      <div className="manager-loading-summary manager-shimmer" />
      <div className="manager-loading-timeline manager-shimmer" />
    </section>
  );
}

function WorkbenchError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="manager-fact-state manager-fact-state--error" role="alert">
      <strong>今日工作台暂时无法读取</strong>
      <p>{message}</p>
      <button type="button" onClick={retry}>
        重新读取
      </button>
    </section>
  );
}

function RefreshNotice({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="manager-refresh-notice" role="alert">
      <span>
        <strong>{message}</strong>
        <small>已保留上次读取的预约与容量事实。</small>
      </span>
      <button type="button" onClick={retry}>
        重试刷新
      </button>
    </div>
  );
}

function RiskIcon({ kind }: { kind: ManagerWorkbenchResponse["risks"][number]["kind"] }) {
  if (kind === "pending_time_off" || kind === "pending_store_closure") {
    return <ExclamationTriangleIcon />;
  }
  if (kind === "failed_notification") return <BellIcon />;
  return <ClockIcon />;
}

function RiskPanel({ risks }: { risks: ManagerWorkbenchResponse["risks"] }) {
  return (
    <section
      className={`manager-panel manager-risk-panel${risks.length === 0 ? " manager-risk-panel--empty" : ""}`}
    >
      <header>
        <div>
          <h2>风险队列</h2>
          <span className="manager-count-badge">{risks.length}</span>
        </div>
        {risks.length > 0 ? <strong>需优先处理</strong> : null}
      </header>
      {risks.length === 0 ? (
        <div className="manager-risk-empty">
          <CheckCircledIcon />
          <span>
            <strong>当前无高优先事项</strong>
            <small>新的停班影响、最终失败通知或迟到预约会显示在这里。</small>
          </span>
        </div>
      ) : (
        <div className="manager-risk-list">
          {risks.map((risk) => (
            <Link
              className={`manager-risk-row manager-risk-row--${risk.kind}`}
              to={risk.href}
              key={risk.id}
            >
              <RiskIcon kind={risk.kind} />
              <span>
                <strong>{risk.title}</strong>
                <small>{risk.detail}</small>
              </span>
              <b>去处理</b>
              <ChevronRightIcon />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPanel({ summary }: { summary: ManagerWorkbenchResponse["statusSummary"] }) {
  return (
    <section className="manager-panel manager-status-panel">
      <header>
        <h2>今日状态</h2>
        <span>以当前预约事实统计</span>
      </header>
      <div className="manager-status-grid">
        {statusMetadata.map(({ status, icon: Icon }) => (
          <article
            aria-label={`${managerBookingStatusLabels[status]} ${summary[status]} 笔`}
            key={status}
          >
            <Icon />
            <strong>{summary[status]}</strong>
            <span>{managerBookingStatusLabels[status]}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function TimelineBooking({ booking }: { booking: ManagerBookingFact }) {
  return (
    <Link
      className={`manager-timeline-booking manager-booking--${booking.status}`}
      style={trackPosition(
        clockMinutes(formatShanghaiClock(booking.startsAt)),
        clockMinutes(formatShanghaiClock(booking.turnoverEndsAt)),
      )}
      to={`/manager/appointments/${booking.id}`}
      aria-label={`${booking.pet.name} ${formatShanghaiClock(booking.startsAt)} 至 ${formatShanghaiClock(booking.endsAt)} ${managerBookingStatusLabels[booking.status]}`}
    >
      {booking.pet.photoPath ? <img src={booking.pet.photoPath} alt="" /> : null}
      <span>
        <strong>{booking.pet.name}</strong>
        <small>
          {formatShanghaiClock(booking.startsAt)}–{formatShanghaiClock(booking.endsAt)} ·{" "}
          {managerBookingStatusLabels[booking.status]}
        </small>
      </span>
    </Link>
  );
}

function StaffTimelineRow({ day }: { day: ManagerStaffDay }) {
  return (
    <div className="manager-timeline-row">
      <div className="manager-timeline-person">
        <img src={day.staff.avatarPath} alt={`${day.staff.displayName}头像`} />
        <span>
          <strong>{day.staff.displayName}</strong>
          <small>剩余 {formatHours(day.capacity.remainingMinutes)}</small>
        </span>
      </div>
      <div className="manager-timeline-track">
        {Array.from({ length: 19 }, (_, index) => (
          <i
            aria-hidden="true"
            className="manager-timeline-gridline"
            style={{ left: `${((index + 1) / 19) * 100}%` }}
            key={index}
          />
        ))}
        {day.shifts.flatMap((shift) =>
          shift.capacity.map((capacity) => (
            <span
              className="manager-timeline-capacity"
              style={trackPosition(clockMinutes(capacity.startsAt), clockMinutes(capacity.endsAt))}
              key={`${capacity.startsAt}-${capacity.endsAt}`}
            >
              <strong>可预约</strong>
              <small>
                {formatHours(clockMinutes(capacity.endsAt) - clockMinutes(capacity.startsAt))}
              </small>
            </span>
          )),
        )}
        {day.shifts.flatMap((shift) =>
          shift.breaks.map((shiftBreak) => (
            <span
              className="manager-timeline-break"
              style={trackPosition(
                clockMinutes(shiftBreak.startsAt),
                clockMinutes(shiftBreak.endsAt),
              )}
              key={`${shiftBreak.startsAt}-${shiftBreak.endsAt}`}
            >
              休息
            </span>
          )),
        )}
        {day.bookings.map((booking) => (
          <TimelineBooking booking={booking} key={booking.id} />
        ))}
      </div>
    </div>
  );
}

function WorkbenchTimeline({ data }: { data: ManagerWorkbenchResponse }) {
  const timeLabels = Array.from({ length: 20 }, (_, index) => clockLabel(dayStartsAt + index * 30));
  const nowMinutes = clockMinutes(formatShanghaiClock(data.demoNow));

  return (
    <section className="manager-panel manager-timeline-panel">
      <header>
        <div>
          <h2>今日排班与预约</h2>
          <span>
            09:30–19:00 · <b>当前剩余容量</b> {formatHours(data.capacity.remainingMinutes)} · 服务与
            15 分钟周转分别计算
          </span>
        </div>
        <Link to={`/manager/appointments/calendar?date=${data.localDate}`}>
          查看按员工日历 <ChevronRightIcon />
        </Link>
      </header>
      <div className="manager-timeline-ruler">
        <span />
        <div>
          {timeLabels.map((time, index) => (
            <b
              style={{
                left: trackPosition(clockMinutes(time), clockMinutes(time)).left,
                transform:
                  index === 0
                    ? "none"
                    : index === timeLabels.length - 1
                      ? "translateX(-100%)"
                      : undefined,
              }}
              key={time}
            >
              {time}
            </b>
          ))}
        </div>
      </div>
      <div className="manager-timeline-rows">
        {nowMinutes >= dayStartsAt && nowMinutes <= dayEndsAt ? (
          <i
            className="manager-now-line"
            style={{ left: `calc(158px + ${trackPosition(nowMinutes, nowMinutes).left})` }}
          >
            <span>{formatShanghaiClock(data.demoNow)}</span>
          </i>
        ) : null}
        {data.staffDays.map((day) => (
          <StaffTimelineRow day={day} key={day.staff.id} />
        ))}
      </div>
    </section>
  );
}

export function ManagerWorkbenchPage(): React.JSX.Element {
  const resource = useManagerResource<ManagerWorkbenchResponse>(
    "/backoffice/manager/workbench",
    true,
    ["manager-live-bookings", "manager-notifications"],
  );

  return (
    <main className="page-shell manager-workbench-page">
      <header className="manager-page-header">
        <div>
          <h1>
            <small aria-hidden="true">MG-01</small> 今日工作台
          </h1>
        </div>
        <div className="manager-page-actions">
          {resource.data ? <span>{formatDemoTime(resource.data.demoNow)}，上海时间</span> : null}
          <span className={`manager-live-status manager-live-status--${resource.connection}`}>
            {resource.connection === "reconnecting" ? "实时更新重连中" : "实时更新已连接"}
          </span>
          <button type="button" onClick={resource.refresh} disabled={resource.refreshing}>
            <ReloadIcon />
            {resource.refreshing ? "更新中" : "刷新"}
          </button>
          <Link to="/manager/schedule/capacity-changes/new">创建停班 / 临时闭店</Link>
        </div>
      </header>

      {resource.loading && !resource.data ? <WorkbenchLoading /> : null}
      {resource.forbidden ? (
        <section className="manager-fact-state" role="alert">
          <strong>没有权限</strong>
          <p>员工身份不能访问店长工作台或跨员工预约。</p>
        </section>
      ) : null}
      {resource.error && !resource.data ? (
        <WorkbenchError message={resource.error} retry={resource.refresh} />
      ) : null}
      {resource.error && resource.data ? (
        <RefreshNotice message={resource.error} retry={resource.refresh} />
      ) : null}

      {resource.data ? (
        <>
          <section className="manager-workbench-summary">
            <RiskPanel risks={resource.data.risks} />
            <StatusPanel summary={resource.data.statusSummary} />
          </section>
          <WorkbenchTimeline data={resource.data} />
        </>
      ) : null}
      <HealthStatus />
    </main>
  );
}
