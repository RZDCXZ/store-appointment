import { useState } from "react";
import { ChevronLeftIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type {
  ManagerBookingChangeResponse,
  ManagerBookingDetailResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import {
  discardManagerChangeIdempotencyKey,
  isManagerBookingFactConflict,
  managerChangeIdempotencyKey,
} from "../../manager-booking-change-command";
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

export function ManagerCancelBookingPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useManagerResource<ManagerBookingDetailResponse>(
    `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}`,
    false,
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ManagerBookingChangeResponse | null>(null);
  const detail = resource.data;
  const booking = detail?.booking;
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 120;

  async function submit(): Promise<void> {
    if (!validReason || !booking) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: managerChangeIdempotencyKey(bookingId, "cancel"),
            reason: reason.trim(),
            expectedStaffId: booking.staff.id,
            expectedStartsAt: booking.startsAt,
            expectedBookingRevision: detail.bookingRevision,
          }),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (apiError.status === 401) {
          markExpired();
          return;
        }
        if (isManagerBookingFactConflict(apiError.status, apiError.code)) {
          discardManagerChangeIdempotencyKey(bookingId, "cancel");
          resource.refresh();
          setError(`预约状态已变化，已重新读取当前事实。${apiError.message}`);
          return;
        }
        throw apiError;
      }
      setResult((await response.json()) as ManagerBookingChangeResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消预约失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell manager-change-page">
      <header className="manager-change-header">
        <Link to={`/manager/appointments/${bookingId}`}>
          <ChevronLeftIcon /> 返回预约详情
        </Link>
        <p>店长取消 · 后果确认</p>
        <h1>取消预约</h1>
      </header>
      {resource.loading && !booking ? (
        <section className="manager-change-state manager-shimmer" role="status">
          正在读取预约当前事实…
        </section>
      ) : null}
      {resource.error && !booking ? (
        <section className="manager-change-state manager-change-state--error" role="alert">
          <h2>预约暂时无法读取</h2>
          <p>{resource.error}</p>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {error ? (
        <p className="manager-change-alert" role="alert">
          {error}
        </p>
      ) : null}
      {booking && detail ? (
        <>
          <section className="manager-change-current">
            <small>当前预约事实</small>
            <h2>
              {booking.pet.name} · {booking.primaryService.name}
            </h2>
            <p>
              {booking.staff.displayName} · {formatDateTime(booking.startsAt)}–
              {formatDateTime(booking.endsAt)}
            </p>
          </section>
          {result || booking.status === "cancelled" ? (
            <section
              className="manager-change-result manager-change-result--cancelled"
              role="status"
            >
              <small>取消事实已成立</small>
              <h2>预约已取消</h2>
              <p>实际占用已释放，核销码已作废；取消通知任务已经生成。</p>
              <Link className="manager-primary-link" to={`/manager/appointments/${bookingId}`}>
                查看历史与通知
              </Link>
            </section>
          ) : !detail.managerActions.canCancel ? (
            <section className="manager-change-state">
              <h2>当前预约不能取消</h2>
              <p>{detail.managerActions.message}</p>
              {booking.status === "checked_in" ? (
                <div className="manager-change-actions">
                  <span>完成服务由{booking.staff.displayName}操作</span>
                  <Link
                    className="manager-secondary-link"
                    to={`/manager/appointments/${bookingId}/terminate`}
                  >
                    服务终止
                  </Link>
                </div>
              ) : null}
            </section>
          ) : (
            <form
              className="manager-change-form manager-cancel-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <section className="manager-change-warning">
                <ExclamationTriangleIcon />
                <span>
                  <strong>取消与到店后的服务终止不同</strong>
                  <p>取消后将立即释放实际占用、作废核销码，并向顾客生成取消通知。</p>
                </span>
              </section>
              <label className="manager-change-field">
                <span>
                  取消原因 <b>必填</b>
                </span>
                <textarea
                  aria-label="取消原因"
                  rows={5}
                  maxLength={120}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError("");
                    discardManagerChangeIdempotencyKey(bookingId, "cancel");
                  }}
                  placeholder="记录已经与顾客确认的取消原因"
                />
                <small>{reason.length}/120 · 必填 2–120 字</small>
              </label>
              <footer>
                <Link className="manager-secondary-link" to={`/manager/appointments/${bookingId}`}>
                  返回预约
                </Link>
                <button
                  className="manager-danger-button"
                  type="submit"
                  disabled={!validReason || submitting}
                >
                  {submitting ? "正在取消…" : "确认取消预约"}
                </button>
              </footer>
            </form>
          )}
        </>
      ) : null}
    </main>
  );
}
