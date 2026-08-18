import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  EditableScheduleShift,
  ManagerSchedulePlanningResponse,
  ManagerSchedulePublishResponse,
  ScheduleBusinessHours,
  ScheduleDraftStaffDay,
  SchedulePlanningStaff,
  WeeklyScheduleTemplateDay,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { PageHeading } from "../../page-components";
import {
  ScheduleExceptionEditor,
  type ScheduleExceptionInput,
} from "../../schedule-exception-editor";
import { ScheduleNavigation } from "../../schedule-navigation";
import { ScheduleShiftFields } from "../../schedule-shift-fields";
import { useDialogFocus } from "../../use-dialog-focus";

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

interface PlanningState {
  data: ManagerSchedulePlanningResponse | null;
  error: string | null;
  loading: boolean;
}

function useSchedulePlanning(): PlanningState & {
  replaceData: (data: ManagerSchedulePlanningResponse) => void;
  retry: () => void;
} {
  const { markExpired } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PlanningState>({ data: null, error: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const response = await apiFetch("/backoffice/manager/schedule/planning", {
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = await readApiError(response);
          if (error.status === 401) {
            markExpired();
            return;
          }
          setState({ data: null, error: error.message, loading: false });
          return;
        }
        setState({
          data: (await response.json()) as ManagerSchedulePlanningResponse,
          error: null,
          loading: false,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : "排班工作区读取失败，请稍后重试。",
            loading: false,
          });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [attempt, markExpired]);

  return {
    ...state,
    replaceData: (data) => setState({ data, error: null, loading: false }),
    retry: () => {
      setState((current) => ({ ...current, error: null, loading: current.data === null }));
      setAttempt((current) => current + 1);
    },
  };
}

function formatDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
}

interface TemplateSelection {
  member: SchedulePlanningStaff;
  day: WeeklyScheduleTemplateDay;
}

interface DraftSelection {
  member: SchedulePlanningStaff;
  date: string;
  businessHours: ScheduleBusinessHours;
  day: ScheduleDraftStaffDay;
}

interface AffectedBooking {
  id: string;
  petName: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  resolutionPath: string;
}

function TemplateGrid({
  data,
  onEdit,
}: {
  data: ManagerSchedulePlanningResponse;
  onEdit: (selection: TemplateSelection) => void;
}): React.JSX.Element {
  return (
    <section className="schedule-planning-panel" aria-labelledby="template-heading">
      <header>
        <div>
          <p>每周重复规则</p>
          <h2 id="template-heading">排班模板</h2>
        </div>
        <span className="schedule-object-status schedule-object-status--template">
          模板不会直接产生顾客可约容量
        </span>
      </header>
      <div className="schedule-template-list">
        {data.staff.map((member) => (
          <article key={member.id} className="schedule-template-staff">
            <header>
              <strong>{member.displayName}</strong>
              <span>员工 {String(member.employeeNumber).padStart(2, "0")}</span>
            </header>
            <div className="schedule-template-week">
              {member.templateDays.map((day) => (
                <section key={day.weekday} className="schedule-template-day">
                  <strong>{weekdayLabels[day.weekday]}</strong>
                  {day.businessHours.status === "closed" ? (
                    <span className="schedule-template-day__closed">门店闭店</span>
                  ) : day.shifts.length === 0 ? (
                    <span className="schedule-template-day__empty">不工作</span>
                  ) : (
                    day.shifts.map((shift) => (
                      <span key={`${shift.startsAt}-${shift.endsAt}`}>
                        {shift.startsAt}–{shift.endsAt}
                        <small>
                          {shift.breaks.length === 0
                            ? "无休息"
                            : shift.breaks
                                .map(
                                  (shiftBreak) =>
                                    `休息 ${shiftBreak.startsAt}–${shiftBreak.endsAt}`,
                                )
                                .join(" · ")}
                        </small>
                      </span>
                    ))
                  )}
                  <button
                    type="button"
                    aria-label={`编辑${member.displayName}${weekdayLabels[day.weekday]}模板`}
                    onClick={() => onEdit({ member, day })}
                  >
                    编辑
                  </button>
                </section>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TemplateEditor({
  selection,
  pending,
  error,
  onCancel,
  onSave,
}: {
  selection: TemplateSelection;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (body: { shifts: EditableScheduleShift[] }) => void;
}): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLElement>();
  const initialShift = selection.day.shifts[0];
  const [working, setWorking] = useState(Boolean(initialShift));
  const [shifts, setShifts] = useState<EditableScheduleShift[]>(
    selection.day.shifts.length > 0
      ? selection.day.shifts
      : [
          {
            startsAt: selection.day.businessHours.opensAt ?? "09:30",
            endsAt: selection.day.businessHours.closesAt ?? "18:00",
            breaks: [],
          },
        ],
  );
  const title = `编辑${selection.member.displayName}${weekdayLabels[selection.day.weekday]}模板`;
  const isClosed = selection.day.businessHours.status === "closed";

  return (
    <div className="schedule-editor-backdrop">
      <section
        ref={dialogRef}
        className="schedule-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-editor-title"
      >
        <header>
          <div>
            <p>每周重复规则</p>
            <h2 id="template-editor-title">{title}</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭模板编辑">
            关闭
          </button>
        </header>
        {isClosed ? (
          <p>该日门店闭店，只能保存为不工作。</p>
        ) : (
          <label className="schedule-editor-toggle">
            <input
              data-dialog-initial-focus
              type="checkbox"
              checked={working}
              onChange={(event) => setWorking(event.target.checked)}
            />
            该员工当天工作
          </label>
        )}
        {working && !isClosed ? (
          <div className="schedule-editor-fields">
            <ScheduleShiftFields
              shifts={shifts}
              businessHours={selection.day.businessHours}
              onChange={setShifts}
              errorId={error ? "template-editor-error" : undefined}
            />
          </div>
        ) : null}
        {error ? (
          <p id="template-editor-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                shifts: working && !isClosed ? shifts : [],
              })
            }
            disabled={pending}
          >
            {pending ? "正在保存…" : "保存模板"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function PublishConfirmation({
  data,
  pending,
  onCancel,
  onConfirm,
}: {
  data: ManagerSchedulePlanningResponse;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLElement>();
  return (
    <div className="schedule-editor-backdrop">
      <section
        ref={dialogRef}
        className="schedule-editor schedule-publish-confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="publish-confirmation-title"
      >
        <p>发布后将立即影响顾客可约容量</p>
        <h2 id="publish-confirmation-title">确认发布 14 天草稿</h2>
        <p>
          将发布 {data.staff.length} 名员工从 {formatDate(data.window.startsOn)} 至
          {formatDate(data.window.endsOn)} 的排班草稿。
        </p>
        <footer>
          <button type="button" disabled={pending} onClick={onCancel} data-dialog-initial-focus>
            返回检查
          </button>
          <button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? "正在发布…" : "确认发布"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ScheduleImpactNotice({ bookings }: { bookings: AffectedBooking[] }): React.JSX.Element {
  return (
    <section className="schedule-impact-notice" role="alert">
      <div>
        <p>容量变更流程</p>
        <h2>发布已阻断：{bookings.length} 笔预约受影响</h2>
        <span>排班草稿仍保留。请逐笔换员工、改期或取消后，再重新发布。</span>
      </div>
      <ul>
        {bookings.map((booking) => (
          <li key={booking.id}>
            <span>
              <strong>
                {booking.petName} · {booking.serviceName}
              </strong>
              <small>{booking.staffName}</small>
            </span>
            <Link to={booking.resolutionPath}>处理{booking.petName}的预约</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyDrafts({ generate, pending }: { generate: () => void; pending: boolean }) {
  return (
    <section className="schedule-planning-panel schedule-draft-empty">
      <span className="schedule-object-status schedule-object-status--draft">
        未发布 · 不产生容量
      </span>
      <h2>还没有 14 天草稿</h2>
      <p>从当前每周模板生成上海未来十四个自然日，确认后再发布。</p>
      <button type="button" onClick={generate} disabled={pending}>
        {pending ? "正在生成草稿…" : "从模板生成未来 14 天草稿"}
      </button>
    </section>
  );
}

function DraftWorkspace({
  data,
  onEdit,
  onPublish,
}: {
  data: ManagerSchedulePlanningResponse;
  onEdit: (selection: DraftSelection) => void;
  onPublish: () => void;
}): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState("");
  const selected = data.draftDays.find((day) => day.date === selectedDate) ?? data.draftDays[0];
  const staffById = new Map(data.staff.map((member) => [member.id, member]));

  if (!selected) return <EmptyDrafts generate={() => undefined} pending={false} />;

  return (
    <section className="schedule-planning-panel schedule-draft-workspace">
      <header>
        <div>
          <p>具体日期预览</p>
          <h2>14 天排班草稿</h2>
        </div>
        <span className="schedule-object-status schedule-object-status--draft">
          草稿 · 未发布不产生容量
        </span>
        <button type="button" onClick={onPublish}>
          发布 14 天草稿
        </button>
      </header>
      <nav className="schedule-draft-date-nav" aria-label="十四天草稿日期">
        {data.draftDays.map((day) => (
          <button
            type="button"
            key={day.date}
            aria-pressed={day.date === selected.date}
            onClick={() => setSelectedDate(day.date)}
          >
            <strong>{formatDate(day.date)}</strong>
            <span>{weekdayLabels[day.weekday]}</span>
            <small>
              {day.businessHours.status === "closed"
                ? "门店闭店"
                : `${day.staffDays.length} 名员工`}
            </small>
          </button>
        ))}
      </nav>
      <div className="schedule-draft-day-heading">
        <div>
          <p>当前草稿日期</p>
          <h3>
            {formatDate(selected.date)} {weekdayLabels[selected.weekday]}
          </h3>
        </div>
        <span>
          {selected.businessHours.status === "closed"
            ? "门店闭店"
            : `营业时间 ${selected.businessHours.opensAt}–${selected.businessHours.closesAt}`}
        </span>
      </div>
      <div className="schedule-draft-staff-grid">
        {selected.staffDays.map((day) => {
          const member = staffById.get(day.staffId);
          return (
            <article
              key={day.staffId}
              className="schedule-draft-staff-card"
              aria-label={`${member?.displayName ?? day.staffId}的${formatDate(selected.date)}排班草稿`}
            >
              <header>
                <strong>{member?.displayName ?? day.staffId}</strong>
                <span>草稿</span>
              </header>
              {day.exception ? (
                <p className="schedule-draft-exception">{day.exception.note}</p>
              ) : null}
              {day.shifts.length === 0 ? (
                <p>当天草稿无班次</p>
              ) : (
                day.shifts.map((shift) => (
                  <section key={`${shift.startsAt}-${shift.endsAt}`}>
                    <strong>
                      班次 {shift.startsAt}–{shift.endsAt}
                    </strong>
                    {shift.breaks.length === 0 ? (
                      <small>无休息</small>
                    ) : (
                      shift.breaks.map((shiftBreak) => (
                        <small key={`${shiftBreak.startsAt}-${shiftBreak.endsAt}`}>
                          休息 {shiftBreak.startsAt}–{shiftBreak.endsAt}
                        </small>
                      ))
                    )}
                  </section>
                ))
              )}
              <button
                type="button"
                aria-label={`编辑${member?.displayName ?? day.staffId}${formatDate(selected.date)}草稿`}
                onClick={() => {
                  if (member) {
                    onEdit({
                      member,
                      date: selected.date,
                      businessHours: selected.businessHours,
                      day,
                    });
                  }
                }}
              >
                编辑日期草稿
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ManagerSchedulePlanningPage(): React.JSX.Element {
  const state = useSchedulePlanning();
  const [pendingAction, setPendingAction] = useState<
    "generate" | "template" | "draft" | "publish" | null
  >(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandSuccess, setCommandSuccess] = useState<string | null>(null);
  const [templateSelection, setTemplateSelection] = useState<TemplateSelection | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);
  const [publishConfirmation, setPublishConfirmation] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState<{ count: number; date: string } | null>(
    null,
  );
  const [affectedBookings, setAffectedBookings] = useState<AffectedBooking[]>([]);
  const [editorError, setEditorError] = useState<string | null>(null);

  async function generateDrafts(): Promise<void> {
    setPendingAction("generate");
    setCommandError(null);
    try {
      const response = await apiFetch("/backoffice/manager/schedule/drafts/generate", {
        method: "POST",
      });
      if (!response.ok) {
        const error = await readApiError(response);
        setCommandError(error.message);
        return;
      }
      state.replaceData((await response.json()) as ManagerSchedulePlanningResponse);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "草稿生成失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  }

  async function saveTemplate(body: { shifts: EditableScheduleShift[] }): Promise<void> {
    if (!templateSelection) return;
    setPendingAction("template");
    setEditorError(null);
    setCommandSuccess(null);
    try {
      const response = await apiFetch(
        `/backoffice/manager/schedule/templates/${templateSelection.member.id}/${templateSelection.day.weekday}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const error = await readApiError(response);
        setEditorError(error.message);
        return;
      }
      state.replaceData((await response.json()) as ManagerSchedulePlanningResponse);
      setCommandSuccess(
        `${templateSelection.member.displayName}${weekdayLabels[templateSelection.day.weekday]}的排班模板已保存。`,
      );
      setTemplateSelection(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "排班模板保存失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  }

  async function saveDraft(body: ScheduleExceptionInput): Promise<void> {
    if (!draftSelection) return;
    setPendingAction("draft");
    setEditorError(null);
    setCommandSuccess(null);
    try {
      const response = await apiFetch(
        `/backoffice/manager/schedule/drafts/${draftSelection.member.id}/${draftSelection.date}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const error = await readApiError(response);
        setEditorError(error.message);
        return;
      }
      state.replaceData((await response.json()) as ManagerSchedulePlanningResponse);
      setCommandSuccess(
        `${draftSelection.member.displayName}${formatDate(draftSelection.date)}的排班草稿已保存。`,
      );
      setDraftSelection(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "排班草稿保存失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  }

  async function publishDrafts(): Promise<void> {
    if (!state.data) return;
    const planning = state.data;
    setPendingAction("publish");
    setCommandError(null);
    setCommandSuccess(null);
    setAffectedBookings([]);
    try {
      const response = await apiFetch("/backoffice/manager/schedule/drafts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dates: planning.draftDays.map((day) => day.date),
          staffIds: planning.staff.map((member) => member.id),
        }),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 409 && error.code === "SCHEDULE_CHANGE_AFFECTS_BOOKINGS") {
          const bookings = error.details.affectedBookings;
          if (Array.isArray(bookings)) setAffectedBookings(bookings as AffectedBooking[]);
        } else {
          setCommandError(error.message);
        }
        setPublishConfirmation(false);
        return;
      }
      const result = (await response.json()) as ManagerSchedulePublishResponse;
      setPublishSuccess({ count: result.publishedCount, date: planning.window.startsOn });
      state.replaceData({ ...planning, draftDays: [] });
      setPublishConfirmation(false);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "排班草稿发布失败，请稍后重试。");
      setPublishConfirmation(false);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="page-shell schedule-page schedule-planning-page">
      <PageHeading
        copy={{
          eyebrow: "MG-08 · 店长排班",
          title: "排班模板与 14 天草稿",
          description: "维护每周工作规则，生成并复核未来十四天草稿后再发布",
        }}
        badge="店长权限"
      />
      <ScheduleNavigation />
      {state.loading ? <p role="status">正在读取排班模板与草稿…</p> : null}
      {!state.loading && state.error ? (
        <section className="schedule-state schedule-state--error" role="alert">
          <h2>暂时无法读取排班工作区</h2>
          <p>{state.error}</p>
          <button className="primary-button" type="button" onClick={state.retry}>
            重新读取
          </button>
        </section>
      ) : null}
      {state.data ? (
        <>
          {commandError ? (
            <div className="schedule-refresh-error" role="alert">
              <strong>{commandError}</strong>
              <small>最近成功读取的模板与草稿仍保留在页面中。</small>
            </div>
          ) : null}
          {commandSuccess ? <p role="status">{commandSuccess}</p> : null}
          {publishSuccess ? (
            <section className="schedule-publish-success" role="status">
              <strong>已发布 {publishSuccess.count} 个员工日，顾客可约容量已按新排班更新。</strong>
              <Link to={`/manager/schedule/published?date=${publishSuccess.date}`}>
                查看已发布排班与日期例外
              </Link>
            </section>
          ) : null}
          {affectedBookings.length > 0 ? (
            <ScheduleImpactNotice bookings={affectedBookings} />
          ) : null}
          <TemplateGrid
            data={state.data}
            onEdit={(selection) => {
              setEditorError(null);
              setTemplateSelection(selection);
            }}
          />
          {state.data.draftDays.length === 0 ? (
            <EmptyDrafts
              generate={() => void generateDrafts()}
              pending={pendingAction === "generate"}
            />
          ) : (
            <DraftWorkspace
              data={state.data}
              onEdit={(selection) => {
                setEditorError(null);
                setDraftSelection(selection);
              }}
              onPublish={() => setPublishConfirmation(true)}
            />
          )}
        </>
      ) : null}
      {templateSelection ? (
        <TemplateEditor
          key={`${templateSelection.member.id}-${templateSelection.day.weekday}`}
          selection={templateSelection}
          pending={pendingAction === "template"}
          error={editorError}
          onCancel={() => setTemplateSelection(null)}
          onSave={(body) => void saveTemplate(body)}
        />
      ) : null}
      {draftSelection ? (
        <ScheduleExceptionEditor
          key={`${draftSelection.member.id}-${draftSelection.date}`}
          title={`编辑${draftSelection.member.displayName}${formatDate(draftSelection.date)}草稿`}
          eyebrow="具体日期例外"
          saveLabel="保存草稿"
          shifts={draftSelection.day.shifts}
          exception={draftSelection.day.exception}
          businessHours={draftSelection.businessHours}
          pending={pendingAction === "draft"}
          error={editorError}
          onCancel={() => setDraftSelection(null)}
          onSave={(body) => void saveDraft(body)}
        />
      ) : null}
      {publishConfirmation && state.data ? (
        <PublishConfirmation
          data={state.data}
          pending={pendingAction === "publish"}
          onCancel={() => setPublishConfirmation(false)}
          onConfirm={() => void publishDrafts()}
        />
      ) : null}
    </main>
  );
}
