import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom";
import type {
  ManagerPublishedScheduleResponse,
  PublishedScheduleStaffDay,
  ScheduleBusinessHours,
  StaffSkillId,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { PageHeading } from "../../page-components";

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

const skillLabels: Record<StaffSkillId, string> = {
  "dog-basic-care": "犬基础洗护",
  "dog-styling": "犬造型美容",
  "cat-care": "猫咪洗护",
  "nail-care": "修甲护理",
  "deshedding-care": "除废毛护理",
  "oral-care": "口腔清洁",
};

interface ScheduleRequestState {
  data: ManagerPublishedScheduleResponse | null;
  error: string | null;
  forbidden: boolean;
  loading: boolean;
  refreshing: boolean;
}

function scheduleDateFromDemoNow(value: string | undefined): string {
  const instant = value ? new Date(value) : new Date();
  const safeInstant = Number.isNaN(instant.getTime()) ? new Date() : instant;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Shanghai",
      year: "numeric",
    })
      .formatToParts(safeInstant)
      .map(({ type, value: partValue }) => [type, partValue]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateParts(date: string): { day: string; month: string; weekday: string } {
  const value = new Date(`${date}T00:00:00.000Z`);

  return {
    month: String(value.getUTCMonth() + 1),
    day: String(value.getUTCDate()),
    weekday: weekdayLabels[value.getUTCDay()] ?? "",
  };
}

function formatScheduleDate(date: string): string {
  const parts = dateParts(date);

  return `${parts.month}月${parts.day}日 ${parts.weekday}`;
}

function usePublishedSchedule(date: string): ScheduleRequestState & { refresh: () => void } {
  const { markExpired } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ScheduleRequestState>({
    data: null,
    error: null,
    forbidden: false,
    loading: true,
    refreshing: false,
  });

  useEffect(() => {
    const abortController = new AbortController();

    setState((current) => ({
      ...current,
      error: null,
      forbidden: false,
      loading: current.data === null,
      refreshing: current.data !== null,
    }));

    async function load(): Promise<void> {
      try {
        const query = new URLSearchParams({ date });
        const response = await apiFetch(`/backoffice/manager/schedule?${query.toString()}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          const error = await readApiError(response);

          if (error.status === 401) {
            markExpired();
            return;
          }

          setState((current) => ({
            ...current,
            error: error.message,
            forbidden: error.status === 403,
            loading: false,
            refreshing: false,
          }));
          return;
        }

        const data = (await response.json()) as ManagerPublishedScheduleResponse;
        setState({ data, error: null, forbidden: false, loading: false, refreshing: false });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "排班读取失败，请稍后重试。",
            loading: false,
            refreshing: false,
          }));
        }
      }
    }

    void load();
    return () => abortController.abort();
  }, [attempt, date, markExpired]);

  return { ...state, refresh: () => setAttempt((current) => current + 1) };
}

function ScheduleSectionNavigation({ date }: { date: string }): React.JSX.Element {
  return (
    <nav className="schedule-section-nav" aria-label="排班对象">
      <NavLink to="/manager/schedule/template">排班模板</NavLink>
      <NavLink to="/manager/schedule/draft">14 天草稿</NavLink>
      <NavLink to={`/manager/schedule/published?date=${date}`}>已发布排班</NavLink>
    </nav>
  );
}

function ScheduleLoading(): React.JSX.Element {
  return (
    <section className="schedule-loading" role="status" aria-label="正在读取已发布排班">
      <div className="schedule-date-skeleton schedule-shimmer" />
      <div className="schedule-staff-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="schedule-staff-skeleton schedule-shimmer"
            data-testid="schedule-staff-skeleton"
            key={index}
          />
        ))}
      </div>
    </section>
  );
}

function InitialScheduleError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="schedule-state schedule-state--error" role="alert">
      <p className="state-code">排班读取失败</p>
      <h2>暂时无法读取已发布排班</h2>
      <p>{message}</p>
      <button className="primary-button" type="button" onClick={retry}>
        重新读取
      </button>
    </section>
  );
}

function InPageForbidden(): React.JSX.Element {
  return (
    <section className="schedule-state schedule-state--error" role="alert">
      <p className="state-code">403 · 无权限</p>
      <h2>没有权限读取完整门店容量</h2>
      <p>员工只能查看本人的工作安排，不能访问排班管理。</p>
    </section>
  );
}

function RefreshError({
  dataDate,
  message,
  retry,
}: {
  dataDate: string;
  message: string;
  retry: () => void;
}): React.JSX.Element {
  const parts = dateParts(dataDate);

  return (
    <div className="schedule-refresh-error" role="alert">
      <span>
        <strong>{message}</strong>
        <small>
          仍显示最近成功读取的 {parts.month}月{parts.day}日数据。
        </small>
      </span>
      <button type="button" onClick={retry}>
        重试刷新
      </button>
    </div>
  );
}

function BusinessHoursSummary({ hours }: { hours: ScheduleBusinessHours }): React.JSX.Element {
  if (hours.status === "closed") {
    return (
      <div className="schedule-business-hours schedule-business-hours--closed">
        <strong>门店闭店</strong>
        <span>营业时间不开放；闭店与员工无排班是不同事实。</span>
      </div>
    );
  }

  return (
    <div className="schedule-business-hours">
      <strong>
        营业时间 {hours.opensAt}–{hours.closesAt}
      </strong>
      <span>营业时间是门店边界；只有员工已发布班次才形成具体容量。</span>
    </div>
  );
}

function ScheduleDateNavigation({ data }: { data: ManagerPublishedScheduleResponse }) {
  return (
    <nav className="schedule-date-nav" aria-label="十四日排班日期">
      {data.window.days.map((day) => {
        const parts = dateParts(day.date);
        const selected = day.date === data.selectedDate;

        return (
          <Link
            aria-current={selected ? "date" : undefined}
            className={
              selected ? "schedule-date-link schedule-date-link--current" : "schedule-date-link"
            }
            key={day.date}
            to={`/manager/schedule/published?date=${day.date}`}
          >
            <span>{parts.weekday}</span>
            <strong>
              {parts.month}月{parts.day}日
            </strong>
            <small>
              {day.businessHours.status === "closed" ? "闭店" : `${day.publishedStaffCount} 名员工`}
            </small>
          </Link>
        );
      })}
    </nav>
  );
}

function StaffScheduleCard({ day }: { day: PublishedScheduleStaffDay }): React.JSX.Element {
  return (
    <article className="schedule-staff-card">
      <header>
        <span className="schedule-staff-avatar" aria-hidden="true">
          {day.staff.displayName.slice(0, 1)}
        </span>
        <span>
          <strong>{day.staff.displayName}</strong>
          <small>员工 {String(day.staff.employeeNumber).padStart(2, "0")}</small>
        </span>
        <span
          className={
            day.scheduleStatus === "published"
              ? "schedule-status schedule-status--published"
              : "schedule-status"
          }
        >
          {day.scheduleStatus === "published" ? "已发布" : "无排班"}
        </span>
      </header>

      <div className="schedule-skills" aria-label={`${day.staff.displayName}员工技能`}>
        {day.staff.skills.map((skill) => (
          <span key={skill}>{skillLabels[skill]}</span>
        ))}
      </div>

      {day.exception ? (
        <div className="schedule-exception">
          <strong>日期例外</strong>
          <span>{day.exception.note}</span>
        </div>
      ) : null}

      {day.shifts.length === 0 ? (
        <div className="schedule-no-shift">
          <strong>当天无排班</strong>
          <p>当天没有已发布的具体日期班次，不形成可预约容量。</p>
        </div>
      ) : (
        <div className="schedule-shifts">
          {day.shifts.map((shift) => (
            <section className="schedule-shift" key={`${shift.startsAt}-${shift.endsAt}`}>
              <h3>
                班次 {shift.startsAt}–{shift.endsAt}
              </h3>
              {shift.breaks.length > 0 ? (
                <div className="schedule-breaks">
                  {shift.breaks.map((shiftBreak) => (
                    <span key={`${shiftBreak.startsAt}-${shiftBreak.endsAt}`}>
                      休息 {shiftBreak.startsAt}–{shiftBreak.endsAt}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="schedule-no-break">本班次无休息</p>
              )}
              <div className="schedule-capacity">
                <strong>可预约容量</strong>
                <span>
                  {shift.capacity
                    .map((interval) => `${interval.startsAt}–${interval.endsAt}`)
                    .join("、")}
                </span>
              </div>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

export function ManagerSchedulePage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const selectedDate =
    searchParams.get("date") ?? scheduleDateFromDemoNow(import.meta.env.VITE_DEMO_NOW);
  const state = usePublishedSchedule(selectedDate);

  return (
    <main className="page-shell schedule-page">
      <PageHeading
        copy={{
          eyebrow: "MG-09 · 店长排班",
          title: "已发布排班",
          description: "查看未来十四天具体日期班次、休息、日期例外与可预约容量",
        }}
        badge="店长权限"
      />
      <ScheduleSectionNavigation date={selectedDate} />

      {state.forbidden ? <InPageForbidden /> : null}
      {state.loading ? <ScheduleLoading /> : null}
      {!state.loading && !state.forbidden && !state.data && state.error ? (
        <InitialScheduleError message={state.error} retry={state.refresh} />
      ) : null}

      {state.data && !state.forbidden ? (
        <>
          <div className="schedule-toolbar">
            <div>
              <span>已发布窗口</span>
              <strong>
                {state.data.window.startsOn} 至 {state.data.window.endsOn}
              </strong>
            </div>
            <span className="schedule-draft-boundary">
              14 天草稿：
              {state.data.draftDayCount === 0 ? "当前为空" : `${state.data.draftDayCount} 天`} ·
              未发布不形成容量
            </span>
            <button type="button" onClick={state.refresh} disabled={state.refreshing}>
              {state.refreshing ? "正在刷新…" : "刷新排班"}
            </button>
          </div>

          {state.error ? (
            <RefreshError
              dataDate={state.data.selectedDate}
              message={state.error}
              retry={state.refresh}
            />
          ) : null}

          <ScheduleDateNavigation data={state.data} />

          <section className="schedule-day-heading">
            <div>
              <p>具体日期容量</p>
              <h2>{formatScheduleDate(state.data.selectedDate)}</h2>
            </div>
            <BusinessHoursSummary hours={state.data.businessHours} />
          </section>

          <section className="schedule-legend" aria-label="排班容量图例">
            <span>
              <i className="schedule-legend__hours" />
              营业边界
            </span>
            <span>
              <i className="schedule-legend__shift" />
              已发布班次
            </span>
            <span>
              <i className="schedule-legend__break" />
              休息切断容量
            </span>
            <span>
              <i className="schedule-legend__empty" />
              无排班状态
            </span>
          </section>

          <section className="schedule-staff-grid" aria-label="四名员工已发布排班">
            {state.data.staffDays.map((day) => (
              <StaffScheduleCard day={day} key={day.staff.id} />
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}

export function ManagerScheduleDraftPage(): React.JSX.Element {
  const selectedDate = scheduleDateFromDemoNow(import.meta.env.VITE_DEMO_NOW);
  const state = usePublishedSchedule(selectedDate);

  return (
    <main className="page-shell schedule-page">
      <PageHeading
        copy={{
          eyebrow: "MG-08 · 店长排班",
          title: "14 天排班草稿",
          description: "预览尚未发布的具体日期安排；草稿与顾客可预约容量严格分开",
        }}
        badge="店长权限"
      />
      <ScheduleSectionNavigation date={selectedDate} />
      {state.loading ? <ScheduleLoading /> : null}
      {state.forbidden ? <InPageForbidden /> : null}
      {!state.loading && !state.forbidden && !state.data && state.error ? (
        <InitialScheduleError message={state.error} retry={state.refresh} />
      ) : null}
      {state.data && !state.forbidden && state.data.draftDayCount === 0 ? (
        <section className="schedule-state schedule-state--empty">
          <span className="schedule-empty-mark" aria-hidden="true">
            14
          </span>
          <div>
            <p className="eyebrow">草稿为空</p>
            <h2>当前没有待发布草稿</h2>
            <p>未发布草稿不产生可预约容量；已发布排班仍可在独立页面按日期查看。</p>
            <Link
              className="primary-button"
              to={`/manager/schedule/published?date=${selectedDate}`}
            >
              查看已发布排班
            </Link>
          </div>
        </section>
      ) : null}
    </main>
  );
}

export function ManagerScheduleTemplatePage(): React.JSX.Element {
  const selectedDate = scheduleDateFromDemoNow(import.meta.env.VITE_DEMO_NOW);

  return (
    <main className="page-shell schedule-page">
      <PageHeading
        copy={{
          eyebrow: "MG-08 · 店长排班",
          title: "排班模板",
          description: "每周重复规则用于生成草稿，本身不向顾客提供可预约容量",
        }}
        badge="店长权限"
      />
      <ScheduleSectionNavigation date={selectedDate} />
      <section className="schedule-state schedule-state--boundary">
        <p className="eyebrow">容量边界</p>
        <h2>模板不是已发布排班</h2>
        <p>本 ticket 已建立模板数据模型；模板编辑与生成草稿操作不在 MG-09 的查看范围内。</p>
      </section>
    </main>
  );
}

export function ScheduleIndexRedirect(): React.JSX.Element {
  const location = useLocation();

  return <Navigate to={`published${location.search}`} replace />;
}
