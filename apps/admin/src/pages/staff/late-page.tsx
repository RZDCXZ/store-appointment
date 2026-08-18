import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeftIcon, ExclamationTriangleIcon, LockClosedIcon } from "@radix-ui/react-icons";
import type { BookingFulfilmentResponse, StaffBookingDetailResponse } from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { StaffPageError, StaffPageLoading } from "../../staff-booking-components";
import { formatShanghaiDateTime, serviceLabel } from "../../staff-booking-presentation";
import {
  commandIdempotencyKey,
  discardCommandIdempotencyKey,
  isFulfilmentFactConflict,
  recoveredFulfilment,
  StaffFulfilmentResult,
  type StaffFulfilmentCommand,
} from "../../staff-fulfilment-command";
import { useStaffResource } from "../../staff-resource";

type LateMode = "late_check_in" | "no_show";

export function StaffLatePage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const [mode, setMode] = useState<LateMode>("late_check_in");
  const [reason, setReason] = useState("");
  const [confirmedNoShow, setConfirmedNoShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedResult, setSubmittedResult] = useState<BookingFulfilmentResponse | null>(null);
  const detail = resource.data;
  const booking = detail?.booking;
  const result = submittedResult ?? (detail ? recoveredFulfilment(detail) : null);
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 120;

  async function submitLateAction(): Promise<void> {
    setError("");
    setSubmitting(true);
    const command = mode satisfies StaffFulfilmentCommand;
    try {
      const endpoint = mode === "no_show" ? "no-show" : "late-check-in";
      const response = await apiFetch(
        `/backoffice/bookings/${encodeURIComponent(bookingId)}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: commandIdempotencyKey(bookingId, command),
            reason: reason.trim(),
          }),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (apiError.status === 401) {
          markExpired();
          return;
        }
        if (isFulfilmentFactConflict(apiError.status, apiError.code)) {
          discardCommandIdempotencyKey(bookingId, command);
          resource.refresh();
          setError(`${apiError.message} 已重新读取预约当前状态。`);
          return;
        }
        throw apiError;
      }
      setSubmittedResult((await response.json()) as BookingFulfilmentResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "迟到处理失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (resource.forbidden && !booking) {
    return (
      <main className="page-shell staff-work-page">
        <section className="staff-state staff-state--forbidden">
          <LockClosedIcon />
          <p className="state-code">403 · 无权限</p>
          <h1>没有迟到处理权限</h1>
          <p>只有分配员工可以处理这笔预约。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-fulfilment-page">
      {resource.loading && !detail ? <StaffPageLoading label="正在读取迟到状态" /> : null}
      {resource.error && !detail ? (
        <StaffPageError
          title="迟到页暂时无法读取"
          message={resource.error}
          retry={resource.refresh}
        />
      ) : null}
      {detail ? (
        <>
          <header className="staff-detail-header">
            <Link to={`/staff/appointments/${bookingId}`}>
              <ChevronLeftIcon /> 返回预约详情
            </Link>
            <p>ST-05 · 人工迟到决策</p>
            <h1>迟到处理</h1>
          </header>

          <section className="staff-fulfilment-summary">
            <span>
              <small>履约对象</small>
              <strong>{booking?.pet.name}</strong>
            </span>
            <span>
              <small>服务</small>
              <strong>{booking ? serviceLabel(booking.service) : ""}</strong>
            </span>
            <span>
              <small>计划开始</small>
              <strong>{booking ? formatShanghaiDateTime(booking.startsAt) : ""}</strong>
            </span>
          </section>

          {result ? <StaffFulfilmentResult result={result} /> : null}
          {error ? (
            <p className="staff-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {!result && booking?.action === "late" ? (
            <form
              className="staff-late-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitLateAction();
              }}
            >
              <fieldset className="staff-late-options">
                <legend>选择处理结果</legend>
                <label className={mode === "late_check_in" ? "selected" : ""}>
                  <input
                    type="radio"
                    name="late-mode"
                    checked={mode === "late_check_in"}
                    onChange={() => {
                      setMode("late_check_in");
                      setConfirmedNoShow(false);
                      setError("");
                    }}
                  />
                  <span>
                    <strong>手动迟到核销</strong>
                    <small>顾客已到店，记录实际到店时间；不改变原计划容量占用。</small>
                  </span>
                </label>
                <label className={`danger${mode === "no_show" ? " selected" : ""}`}>
                  <input
                    type="radio"
                    name="late-mode"
                    checked={mode === "no_show"}
                    onChange={() => {
                      setMode("no_show");
                      setError("");
                    }}
                  />
                  <span>
                    <strong>标记爽约</strong>
                    <small>顾客没有到店，结束预约并释放处理时刻之后的实际占用。</small>
                  </span>
                </label>
              </fieldset>

              <label className="staff-late-reason" htmlFor="late-reason">
                处理原因
                <textarea
                  id="late-reason"
                  aria-label="处理原因"
                  maxLength={120}
                  rows={4}
                  value={reason}
                  onChange={(event) => {
                    if (error) {
                      discardCommandIdempotencyKey(bookingId, mode);
                      setError("");
                    }
                    setReason(event.target.value);
                  }}
                  placeholder={
                    mode === "no_show" ? "例如：多次联系未到店" : "例如：路上拥堵，已确认到店"
                  }
                />
                <small>{reason.length}/120 · 必填 2–120 字</small>
              </label>

              {mode === "no_show" ? (
                <section className="staff-no-show-warning">
                  <ExclamationTriangleIcon />
                  <div>
                    <strong>这是危险的终态操作</strong>
                    <p>
                      系统不会仅因时间流逝自动爽约，也不会自动处罚顾客；操作后保留原计划区间供追溯。
                    </p>
                    <label className="staff-confirm-check">
                      <input
                        type="checkbox"
                        checked={confirmedNoShow}
                        onChange={(event) => setConfirmedNoShow(event.target.checked)}
                      />
                      <span>我确认顾客未到店，并理解此操作会结束预约</span>
                    </label>
                  </div>
                </section>
              ) : null}

              <button
                className={mode === "no_show" ? "staff-danger-button" : "staff-primary-link"}
                type="submit"
                disabled={!validReason || submitting || (mode === "no_show" && !confirmedNoShow)}
              >
                {submitting ? "正在提交…" : mode === "no_show" ? "确认标记爽约" : "确认手动核销"}
              </button>
            </form>
          ) : null}
          {!result && booking?.action !== "late" ? (
            <section className="staff-state staff-state--empty">
              <h2>当前不需要迟到处理</h2>
              <p>只有开始超过 15 分钟且仍为已确认的预约可以在此人工处理。</p>
              {booking?.action === "check_in" || booking?.action === "upcoming" ? (
                <Link
                  className="staff-primary-link"
                  to={`/staff/appointments/${booking.id}/check-in`}
                >
                  返回正常核销
                </Link>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
