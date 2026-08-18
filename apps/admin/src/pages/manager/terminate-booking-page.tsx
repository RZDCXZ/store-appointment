import { useState } from "react";
import { ChevronLeftIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type {
  BookingTerminationResponse,
  ManagerBookingDetailResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import {
  discardManagerChangeIdempotencyKey,
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

function isTerminationFactConflict(status: number, code: string): boolean {
  return status === 409 && code === "BOOKING_TERMINATION_NOT_ALLOWED";
}

export function ManagerTerminateBookingPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useManagerResource<ManagerBookingDetailResponse>(
    `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}`,
    false,
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BookingTerminationResponse | null>(null);
  const booking = resource.data?.booking;
  const recoveredTermination = resource.data?.changeHistory.find(
    (event) => event.type === "booking_terminated",
  );
  const terminationReason = result?.reason ?? recoveredTermination?.reason ?? null;
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 200;

  async function terminate(): Promise<void> {
    if (!validReason) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/bookings/${encodeURIComponent(bookingId)}/terminate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: managerChangeIdempotencyKey(bookingId, "terminate"),
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
        if (isTerminationFactConflict(apiError.status, apiError.code)) {
          discardManagerChangeIdempotencyKey(bookingId, "terminate");
          resource.refresh();
          setError(`预约状态已变化，已重新读取当前事实。${apiError.message}`);
          return;
        }
        throw apiError;
      }
      setResult((await response.json()) as BookingTerminationResponse);
      resource.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "服务终止失败，请重试。");
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
        <p>到店后异常履约</p>
        <h1>服务终止</h1>
      </header>
      {resource.loading && !booking ? (
        <section className="manager-change-state manager-shimmer" role="status">
          正在读取履约状态…
        </section>
      ) : null}
      {resource.error && !booking ? (
        <section className="manager-change-state manager-change-state--error" role="alert">
          <h2>履约状态暂时无法读取</h2>
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
      {booking ? (
        <>
          <section className="manager-change-current">
            <small>当前履约事实</small>
            <h2>
              {booking.pet.name} · {booking.primaryService.name}
            </h2>
            <p>
              {booking.staff.displayName} · {formatDateTime(booking.startsAt)}–
              {formatDateTime(booking.endsAt)}
            </p>
          </section>
          {result || booking.status === "terminated" ? (
            <section
              className="manager-change-result manager-change-result--cancelled"
              role="status"
            >
              <small>异常履约结果已记录</small>
              <h2>服务已终止</h2>
              {terminationReason ? <p>原因：{terminationReason}</p> : null}
              <strong>原计划继续保留；实际结束后保留周转，再释放剩余容量。</strong>
              <Link className="manager-primary-link" to={`/manager/appointments/${bookingId}`}>
                查看预约详情
              </Link>
            </section>
          ) : booking.status !== "checked_in" ? (
            <section className="manager-change-state">
              <h2>当前预约不能终止服务</h2>
              <p>只有已到店预约可以记录服务终止；到店前请使用取消预约。</p>
            </section>
          ) : (
            <form
              className="manager-change-form manager-cancel-form"
              onSubmit={(event) => {
                event.preventDefault();
                void terminate();
              }}
            >
              <section className="manager-change-warning">
                <ExclamationTriangleIcon />
                <span>
                  <strong>服务终止与“已完成”和“已取消”不同</strong>
                  <p>仅用于宠物到店后无法继续履约的情况；原因和实际结束时间会永久保留。</p>
                </span>
              </section>
              <label className="manager-change-field">
                <span>
                  终止原因 <b>必填</b>
                </span>
                <textarea
                  aria-label="终止原因"
                  rows={5}
                  maxLength={200}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError("");
                    discardManagerChangeIdempotencyKey(bookingId, "terminate");
                  }}
                  placeholder="说明无法继续服务的具体原因"
                />
                <small>{reason.length}/200 · 必填 2–200 字</small>
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
                  {submitting ? "正在终止…" : "确认服务终止"}
                </button>
              </footer>
            </form>
          )}
        </>
      ) : null}
    </main>
  );
}
