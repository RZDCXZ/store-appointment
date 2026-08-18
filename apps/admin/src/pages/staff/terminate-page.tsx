import { useState } from "react";
import { ChevronLeftIcon, ExclamationTriangleIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type { BookingTerminationResponse, StaffBookingDetailResponse } from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { StaffPageError, StaffPageLoading } from "../../staff-booking-components";
import { formatShanghaiDateTime, serviceLabel } from "../../staff-booking-presentation";
import {
  commandIdempotencyKey,
  discardCommandIdempotencyKey,
  isFulfilmentFactConflict,
} from "../../staff-fulfilment-command";
import { useStaffResource } from "../../staff-resource";

export function StaffTerminatePage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedResult, setSubmittedResult] = useState<BookingTerminationResponse | null>(null);
  const detail = resource.data;
  const booking = detail?.booking;
  const recoveredEvent = detail?.statusHistory.find((event) => event.type === "booking_terminated");
  const terminatedAt = submittedResult?.occurredAt ?? recoveredEvent?.occurredAt ?? null;
  const terminationReason = submittedResult?.reason ?? recoveredEvent?.reason ?? null;
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 200;

  async function terminate(): Promise<void> {
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/bookings/${encodeURIComponent(bookingId)}/terminate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: commandIdempotencyKey(bookingId, "terminate"),
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
          discardCommandIdempotencyKey(bookingId, "terminate");
          resource.refresh();
          setError(`${apiError.message} 已重新读取预约当前状态。`);
          return;
        }
        throw apiError;
      }
      setSubmittedResult((await response.json()) as BookingTerminationResponse);
      resource.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "服务终止失败，请重试。");
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
          <h1>没有服务终止权限</h1>
          <p>只有这笔预约的分配员工可以进入终止页。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-fulfilment-page">
      {resource.loading && !detail ? <StaffPageLoading label="正在读取服务终止状态" /> : null}
      {resource.error && !detail ? (
        <StaffPageError
          title="终止页暂时无法读取"
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
            <p>ST-07 · 异常履约结果</p>
            <h1>服务终止</h1>
          </header>

          <section className="staff-fulfilment-summary">
            <span>
              <small>宠物</small>
              <strong>{booking?.pet.name}</strong>
            </span>
            <span>
              <small>服务</small>
              <strong>{booking ? serviceLabel(booking.service) : ""}</strong>
            </span>
            <span>
              <small>当前状态</small>
              <strong>{booking?.status === "terminated" ? "已终止" : "已到店"}</strong>
            </span>
          </section>

          {terminatedAt ? (
            <section
              className="staff-fulfilment-result staff-fulfilment-result--terminated"
              role="status"
            >
              <small>异常履约结果</small>
              <h2>服务已终止</h2>
              <p>{formatShanghaiDateTime(terminatedAt)}</p>
              {terminationReason ? <p>原因：{terminationReason}</p> : null}
              <strong>实际结束后保留 15 分钟周转，随后释放原计划剩余容量；原计划继续保留。</strong>
            </section>
          ) : null}
          {error ? (
            <p className="staff-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {!terminatedAt && booking?.status === "checked_in" ? (
            <form
              className="staff-terminate-form"
              onSubmit={(event) => {
                event.preventDefault();
                void terminate();
              }}
            >
              <section className="staff-terminate-warning">
                <ExclamationTriangleIcon />
                <span>
                  <strong>服务终止与“已完成”和“已取消”不同</strong>
                  <p>仅用于宠物到店后无法继续履约的情况；原因和实际结束时间会永久保留。</p>
                </span>
              </section>
              <label htmlFor="termination-reason">
                终止原因
                <textarea
                  id="termination-reason"
                  aria-label="终止原因"
                  rows={5}
                  maxLength={200}
                  value={reason}
                  onChange={(event) => {
                    if (error) {
                      discardCommandIdempotencyKey(bookingId, "terminate");
                      setError("");
                    }
                    setReason(event.target.value);
                  }}
                  placeholder="说明无法继续服务的具体原因"
                />
                <small>{reason.length}/200 · 必填 2–200 字</small>
              </label>
              <button
                className="staff-danger-button"
                type="submit"
                disabled={!validReason || submitting}
              >
                {submitting ? "正在终止…" : "确认服务终止"}
              </button>
            </form>
          ) : null}
          {!terminatedAt && booking?.status !== "checked_in" ? (
            <section className="staff-state staff-state--empty">
              <h2>当前状态不能终止服务</h2>
              <p>只有已到店预约可以在此记录服务终止。</p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
