import { useState } from "react";
import {
  CalendarIcon,
  CheckCircledIcon,
  ChevronLeftIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  PersonIcon,
} from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type {
  CapacityChangeDetailResponse,
  CapacityChangeImpactedBooking,
  CapacityChangeResolutionAction,
  ResolveCapacityChangeBookingResponse,
  RevokeCapacityChangeResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useBackofficeResource } from "../../backoffice-resource";
import { managerBookingStatusLabels } from "../../manager-booking-presentation";

const actionLabels: Record<CapacityChangeResolutionAction, string> = {
  change_staff: "同时间换员工",
  reschedule: "改期",
  cancel: "取消预约",
  acknowledge_existing: "确认现有结果",
};

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

function commandKey(changeId: string, bookingId: string, action: string): string {
  const storageKey = `capacity-resolution:${changeId}:${bookingId}:${action}`;
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const generated = `capacity-${action}-${globalThis.crypto.randomUUID()}`;
  sessionStorage.setItem(storageKey, generated);
  return generated;
}

function discardCommandKeys(changeId: string, bookingId: string): void {
  for (const action of Object.keys(actionLabels)) {
    sessionStorage.removeItem(`capacity-resolution:${changeId}:${bookingId}:${action}`);
  }
}

function ResolutionSummary({ booking }: { booking: CapacityChangeImpactedBooking }) {
  const resolution = booking.resolution;
  if (!resolution) return null;
  return (
    <section className="impact-resolution-result" aria-label={`${booking.petName}处理结果`}>
      <CheckCircledIcon />
      <span>
        <strong>{actionLabels[resolution.action]}已成立</strong>
        <small>
          {resolution.operator.displayName} · {resolution.reason} ·{" "}
          {formatDateTime(resolution.resolvedAt)}
        </small>
        {resolution.result ? (
          <small>
            新安排：{resolution.result.staff.displayName} ·{" "}
            {formatDateTime(resolution.result.startsAt)}
          </small>
        ) : (
          <small>预约已取消，顾客通知任务已经生成。</small>
        )}
      </span>
      <Link to={`/manager/appointments/${booking.id}`}>查看历史</Link>
    </section>
  );
}

function ImpactBookingCard({
  booking,
  changeId,
  submitting,
  onResolve,
}: {
  booking: CapacityChangeImpactedBooking;
  changeId: string;
  submitting: boolean;
  onResolve: (
    booking: CapacityChangeImpactedBooking,
    action: CapacityChangeResolutionAction,
    reason: string,
    selection: { staffId?: string; startsAt?: string },
  ) => Promise<void>;
}): React.JSX.Element {
  const [action, setAction] = useState<CapacityChangeResolutionAction>(
    booking.sameTimeStaffCandidates.length > 0 ? "change_staff" : "reschedule",
  );
  const [staffId, setStaffId] = useState(booking.sameTimeStaffCandidates[0]?.id ?? "");
  const [suggestionKey, setSuggestionKey] = useState(() => {
    const suggestion = booking.rescheduleSuggestions[0];
    return suggestion ? `${suggestion.staff.id}:${suggestion.startsAt}` : "";
  });
  const [reason, setReason] = useState("");
  const suggestion = booking.rescheduleSuggestions.find(
    (candidate) => `${candidate.staff.id}:${candidate.startsAt}` === suggestionKey,
  );
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 120;
  const validSelection =
    action === "cancel" ||
    (action === "change_staff" && Boolean(staffId)) ||
    (action === "reschedule" && Boolean(suggestion));

  function edit(): void {
    discardCommandKeys(changeId, booking.id);
  }

  return (
    <article
      className={`impact-booking-card${booking.resolution ? " impact-booking-card--done" : ""}`}
    >
      <header>
        <span className="impact-booking-avatar" aria-hidden="true">
          {booking.petName.slice(0, 1)}
        </span>
        <div>
          <span
            className={booking.resolution ? "impact-status impact-status--done" : "impact-status"}
          >
            {booking.resolution ? "已处理" : "待处理"}
          </span>
          <h2>
            {booking.petName} · {booking.serviceName}
          </h2>
          <p>
            {booking.customerName} · 原员工{booking.staff.displayName} ·{" "}
            {formatDateTime(booking.startsAt)}–{formatDateTime(booking.endsAt)}
          </p>
          {booking.factChanged ? (
            <p className="impact-current-fact">
              当前事实：{managerBookingStatusLabels[booking.currentFact.status]} ·
              {booking.currentFact.staff.displayName} ·{" "}
              {formatDateTime(booking.currentFact.startsAt)}
            </p>
          ) : null}
          <small>当前状态：{managerBookingStatusLabels[booking.status]}</small>
        </div>
      </header>

      {booking.resolution ? (
        <ResolutionSummary booking={booking} />
      ) : booking.blockedByFulfilment ? (
        <section className="impact-fulfilment-block">
          <ExclamationTriangleIcon />
          <span>
            <strong>预约已经到店，不能再改期或取消</strong>
            <small>请先在预约详情完成或终止服务；形成终态后刷新本页确认现有结果。</small>
          </span>
          <Link to={`/manager/appointments/${booking.id}`}>前往预约详情</Link>
        </section>
      ) : booking.requiresAcknowledgement ? (
        <form
          className="impact-resolution-form impact-acknowledgement-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validReason) return;
            void onResolve(booking, "acknowledge_existing", reason.trim(), {});
          }}
        >
          <p className="impact-existing-fact-notice">
            <CheckCircledIcon />
            <span>
              <strong>这笔预约已在其他入口解除本次容量影响</strong>
              <small>
                当前为{managerBookingStatusLabels[booking.currentFact.status]} ·
                {booking.currentFact.staff.displayName} ·
                {formatDateTime(booking.currentFact.startsAt)}
                。确认后只记录关联结果，不再次移动或取消预约。
              </small>
            </span>
          </p>
          <label className="impact-resolution-field impact-reason-field">
            <span>确认原因（必填）</span>
            <textarea
              aria-label={`${booking.petName}确认现有结果原因`}
              rows={3}
              maxLength={120}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                edit();
              }}
              placeholder="记录核对现有预约事实的原因"
            />
            <small>{reason.length}/120 · 需填写 2–120 字</small>
          </label>
          <footer>
            <span>确认只推进本次影响处理进度，现有预约事实保持不变。</span>
            <button type="submit" disabled={!validReason || submitting}>
              {submitting ? "正在确认…" : "确认现有结果"}
            </button>
          </footer>
        </form>
      ) : (
        <form
          className="impact-resolution-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!validReason || !validSelection) return;
            void onResolve(booking, action, reason.trim(), {
              ...(action === "change_staff" ? { staffId } : {}),
              ...(action === "reschedule" && suggestion
                ? { staffId: suggestion.staff.id, startsAt: suggestion.startsAt }
                : {}),
            });
          }}
        >
          <fieldset className="impact-action-choices">
            <legend>选择本笔处理方式</legend>
            <label className={action === "change_staff" ? "is-selected" : ""}>
              <input
                type="radio"
                name={`action-${booking.id}`}
                value="change_staff"
                checked={action === "change_staff"}
                disabled={booking.sameTimeStaffCandidates.length === 0}
                onChange={() => {
                  setAction("change_staff");
                  edit();
                }}
              />
              <PersonIcon />
              <span>
                <strong>同时间换员工</strong>
                <small>
                  {booking.sameTimeStaffCandidates.length > 0
                    ? `${booking.sameTimeStaffCandidates.length} 名员工覆盖全部技能与连续容量`
                    : "当前没有合格的同时间员工"}
                </small>
              </span>
            </label>
            <label className={action === "reschedule" ? "is-selected" : ""}>
              <input
                type="radio"
                name={`action-${booking.id}`}
                value="reschedule"
                checked={action === "reschedule"}
                disabled={booking.rescheduleSuggestions.length === 0}
                onChange={() => {
                  setAction("reschedule");
                  edit();
                }}
              />
              <CalendarIcon />
              <span>
                <strong>改期</strong>
                <small>选择当前排班与容量计算出的相近建议</small>
              </span>
            </label>
            <label className={`impact-danger-choice${action === "cancel" ? " is-selected" : ""}`}>
              <input
                type="radio"
                name={`action-${booking.id}`}
                value="cancel"
                checked={action === "cancel"}
                onChange={() => {
                  setAction("cancel");
                  edit();
                }}
              />
              <CrossCircledIcon />
              <span>
                <strong>取消预约</strong>
                <small>填写原因并确认将生成的顾客通知</small>
              </span>
            </label>
          </fieldset>

          {action === "change_staff" ? (
            <label className="impact-resolution-field">
              <span>接手员工</span>
              <select
                aria-label={`${booking.petName}接手员工`}
                value={staffId}
                onChange={(event) => {
                  setStaffId(event.target.value);
                  edit();
                }}
              >
                {booking.sameTimeStaffCandidates.map((staff) => (
                  <option value={staff.id} key={staff.id}>
                    {staff.displayName} · 同时间连续容量可用
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {action === "reschedule" ? (
            <fieldset className="impact-suggestions">
              <legend>相近可用建议</legend>
              {booking.rescheduleSuggestions.map((candidate) => {
                const key = `${candidate.staff.id}:${candidate.startsAt}`;
                return (
                  <label key={key} className={suggestionKey === key ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name={`suggestion-${booking.id}`}
                      checked={suggestionKey === key}
                      onChange={() => {
                        setSuggestionKey(key);
                        edit();
                      }}
                    />
                    <span>
                      <strong>{candidate.staff.displayName}</strong>
                      <small>{formatDateTime(candidate.startsAt)}</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}

          {action === "cancel" ? (
            <p className="impact-notification-preview">
              <ExclamationTriangleIcon />
              <span>
                <strong>通知预览</strong>
                <small>
                  {booking.cancelNotificationPreview.message}
                  {reason.trim() ? ` 取消原因：${reason.trim()}` : " 取消原因：待填写。"}
                </small>
              </span>
            </p>
          ) : null}

          <label className="impact-resolution-field impact-reason-field">
            <span>{action === "cancel" ? "取消原因" : "处理原因"}（必填）</span>
            <textarea
              aria-label={`${booking.petName}${action === "cancel" ? "取消" : "处理"}原因`}
              rows={3}
              maxLength={120}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                edit();
              }}
              placeholder="记录已与顾客确认的原因"
            />
            <small>{reason.length}/120 · 需填写 2–120 字</small>
          </label>
          <footer>
            <span>提交成功才会更新预约和完成进度；失败时原安排保持不变。</span>
            <button type="submit" disabled={!validReason || !validSelection || submitting}>
              {submitting ? "正在保存…" : "保存本笔处理结果"}
            </button>
          </footer>
        </form>
      )}
    </article>
  );
}

export function ManagerCapacityChangeResolutionPage(): React.JSX.Element {
  const { kind = "", changeId = "" } = useParams();
  const { markExpired } = useAuth();
  const path = `/backoffice/manager/capacity-changes/${encodeURIComponent(kind)}/${encodeURIComponent(changeId)}`;
  const resource = useBackofficeResource<CapacityChangeDetailResponse>(
    path,
    "受影响预约与处理进度读取失败，请稍后重试。",
  );
  const [submittingBookingId, setSubmittingBookingId] = useState("");
  const [requestError, setRequestError] = useState("");
  const [notice, setNotice] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const detail = resource.data;

  async function handleFailure(response: Response, fallback: string): Promise<never> {
    const error = await readApiError(response);
    if (error.status === 401) {
      markExpired();
      throw error;
    }
    if (
      error.code === "BOOKING_FACT_CHANGED" ||
      error.code === "IMPACT_ALREADY_RESOLVED" ||
      error.code === "CAPACITY_CHANGE_NOT_PENDING" ||
      error.code === "BOOKING_TIME_CONFLICT"
    ) {
      resource.refresh();
    }
    throw new Error(error.message || fallback);
  }

  async function resolveBooking(
    booking: CapacityChangeImpactedBooking,
    action: CapacityChangeResolutionAction,
    reason: string,
    selection: { staffId?: string; startsAt?: string },
  ): Promise<void> {
    setSubmittingBookingId(booking.id);
    setRequestError("");
    setNotice("");
    try {
      const response = await apiFetch(
        `${path}/bookings/${encodeURIComponent(booking.id)}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            reason,
            ...selection,
            expectedBookingRevision: booking.bookingRevision,
            idempotencyKey: commandKey(changeId, booking.id, action),
          }),
        },
      );
      if (!response.ok) await handleFailure(response, "本笔处理失败，请重试。");
      const result = (await response.json()) as ResolveCapacityChangeBookingResponse;
      discardCommandKeys(changeId, booking.id);
      setNotice(
        result.change.status === "active"
          ? "全部受影响预约已处理，容量变化已正式生效。"
          : `${booking.petName}的处理结果已保存，完成进度已更新。`,
      );
      resource.refresh();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "本笔处理失败，请重试。");
    } finally {
      setSubmittingBookingId("");
    }
  }

  async function revoke(): Promise<void> {
    if (revokeReason.trim().length < 2 || revokeReason.trim().length > 120) return;
    setRevoking(true);
    setRequestError("");
    try {
      const response = await apiFetch(`${path}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: revokeReason.trim() }),
      });
      if (!response.ok) await handleFailure(response, "撤销停班失败，请重试。");
      const result = (await response.json()) as RevokeCapacityChangeResponse;
      setNotice(
        `待处理停班已撤销，已释放未处理容量；${result.retainedResolutions.length} 笔已成立处理结果保持不变。`,
      );
      setRevokeReason("");
      resource.refresh();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "撤销停班失败，请重试。");
    } finally {
      setRevoking(false);
    }
  }

  const progressPercent = detail
    ? detail.progress.total === 0
      ? 100
      : Math.round((detail.progress.resolved / detail.progress.total) * 100)
    : 0;

  return (
    <main className="page-shell impact-resolution-page">
      <header className="impact-page-header">
        <Link to="/manager/workbench">
          <ChevronLeftIcon /> 返回工作台
        </Link>
        <p>MG-11 · 受影响预约处理</p>
        <h1>处理受影响预约</h1>
        <strong>逐笔结果成功后才计入进度；全部完成前没有强制生效入口。</strong>
      </header>

      {resource.loading && !detail ? (
        <section className="impact-page-state manager-shimmer" role="status">
          正在读取容量变化与处理进度…
        </section>
      ) : null}
      {resource.error && !detail ? (
        <section className="impact-page-state impact-page-state--error" role="alert">
          <h2>受影响预约暂时无法读取</h2>
          <p>{resource.error}</p>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {requestError ? (
        <p className="manager-change-alert" role="alert">
          {requestError}
        </p>
      ) : null}
      {notice ? (
        <p className="impact-page-notice" role="status">
          <CheckCircledIcon />
          {notice}
        </p>
      ) : null}

      {detail ? (
        <>
          <section
            className={`impact-change-summary impact-change-summary--${detail.change.status}`}
          >
            <header>
              <div>
                <small>{detail.change.kind === "time_off" ? "员工停班" : "门店临时闭店"}</small>
                <h2>{detail.change.target.label}</h2>
                <p>
                  {detail.change.interval.localDate} · {detail.change.interval.startsAt}–
                  {detail.change.interval.endsAt} · {detail.change.reason}
                </p>
              </div>
              <span className="impact-change-status">
                {detail.change.status === "pending"
                  ? "待处理"
                  : detail.change.status === "active"
                    ? "已生效"
                    : "已撤销"}
              </span>
            </header>
            <div className="impact-summary-metrics">
              <article>
                <small>目标容量</small>
                <strong>{detail.change.targetCapacityMinutes} 分钟</strong>
              </article>
              <article>
                <small>受影响预约</small>
                <strong>{detail.progress.total} 笔</strong>
              </article>
              <article>
                <small>处理状态</small>
                <strong>
                  {detail.progress.resolved} / {detail.progress.total} 已处理
                </strong>
              </article>
            </div>
            <p>{detail.change.consequence}</p>
          </section>

          <section className="impact-progress-panel" aria-labelledby="impact-progress-title">
            <div>
              <h2 id="impact-progress-title">
                {detail.progress.resolved} / {detail.progress.total} 已处理
              </h2>
              <p>
                {detail.change.status === "pending"
                  ? "全部完成后容量变化才正式生效"
                  : detail.change.status === "active"
                    ? "全部处理结果均已成立"
                    : "停班已撤销，已有处理结果仍可追踪"}
              </p>
            </div>
            <div
              className="impact-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={detail.progress.total}
              aria-valuenow={detail.progress.resolved}
            >
              <i style={{ width: `${progressPercent}%` }} />
            </div>
            <strong>{progressPercent}%</strong>
          </section>

          {detail.canRevoke ? (
            <section className="impact-revoke-panel">
              <div>
                <h2>撤销待处理停班</h2>
                <p>撤销只恢复尚未处理的容量，不回滚已经成立的换员工、改期或取消结果。</p>
              </div>
              <label>
                <span>撤销原因</span>
                <input
                  value={revokeReason}
                  maxLength={120}
                  onChange={(event) => setRevokeReason(event.target.value)}
                  placeholder="说明为何恢复原容量"
                />
              </label>
              <button
                type="button"
                disabled={revokeReason.trim().length < 2 || revoking}
                onClick={() => void revoke()}
              >
                {revoking ? "正在撤销…" : "确认撤销停班"}
              </button>
            </section>
          ) : null}

          <section className="impact-booking-list" aria-labelledby="impact-booking-list-title">
            <header>
              <div>
                <h2 id="impact-booking-list-title">预约处理列表</h2>
                <p>原预约事实、操作人、原因和处理结果会持续保留。</p>
              </div>
              {resource.refreshing ? <span>正在刷新进度…</span> : null}
            </header>
            {detail.impactedBookings.map((booking) => (
              <ImpactBookingCard
                booking={booking}
                changeId={changeId}
                submitting={submittingBookingId === booking.id}
                onResolve={resolveBooking}
                key={booking.id}
              />
            ))}
          </section>
        </>
      ) : null}
    </main>
  );
}
