import { useMemo, useState } from "react";
import { ChevronLeftIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type {
  BookingConflictSuggestion,
  ManagerBookingChangeResponse,
  ManagerRescheduleBookingOptionsResponse,
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

function price(value: number): string {
  return `¥${(value / 100).toLocaleString("zh-CN")}`;
}

export function ManagerRescheduleBookingPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useManagerResource<ManagerRescheduleBookingOptionsResponse>(
    `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}/reschedule-options`,
    false,
  );
  const [selectedKey, setSelectedKey] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [conflictSuggestions, setConflictSuggestions] = useState<BookingConflictSuggestion[]>([]);
  const [result, setResult] = useState<ManagerBookingChangeResponse | null>(null);
  const booking = resource.data?.booking;
  const slots = useMemo(
    () => resource.data?.availability?.days.flatMap((day) => day.slots) ?? [],
    [resource.data],
  );
  const presentedSlots = conflictSuggestions.length > 0 ? conflictSuggestions : slots;
  const selected = presentedSlots.find(
    (slot) => `${slot.staff.id}:${slot.startsAt}` === selectedKey,
  );
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 120;

  function choose(value: string): void {
    setSelectedKey(value);
    setError("");
    discardManagerChangeIdempotencyKey(bookingId, "reschedule");
  }

  async function submit(): Promise<void> {
    if (!booking || !selected || !validReason) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}/reschedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: managerChangeIdempotencyKey(bookingId, "reschedule"),
            reason: reason.trim(),
            expectedStaffId: booking.staff.id,
            expectedStartsAt: booking.startsAt,
            staffId: selected.staff.id,
            startsAt: selected.startsAt,
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
          discardManagerChangeIdempotencyKey(bookingId, "reschedule");
          resource.refresh();
          setError(`预约状态已变化，已重新读取当前事实。${apiError.message}`);
          return;
        }
        if (apiError.code === "BOOKING_TIME_CONFLICT") {
          const suggestions = apiError.details.suggestions;
          setConflictSuggestions(Array.isArray(suggestions) ? suggestions : []);
          setSelectedKey("");
          discardManagerChangeIdempotencyKey(bookingId, "reschedule");
        }
        throw apiError;
      }
      setResult((await response.json()) as ManagerBookingChangeResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "改期失败，请重试。");
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
        <p>MG-06 · 显式改期面板</p>
        <h1>店长改期</h1>
        <strong>新安排失败时，原安排、实际占用与核销码保持不变。</strong>
      </header>
      {resource.loading && !booking ? (
        <section className="manager-change-state manager-shimmer" role="status">
          正在读取原安排与可用建议…
        </section>
      ) : null}
      {resource.error && !booking ? (
        <section className="manager-change-state manager-change-state--error" role="alert">
          <h2>改期信息暂时无法读取</h2>
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
      {booking && resource.data ? (
        <>
          <section className="manager-change-current">
            <small>原安排（持续有效，直到改期成功）</small>
            <h2>
              {booking.pet.name} · {booking.primaryService.name}
            </h2>
            <p>
              原安排：{booking.staff.displayName} · {formatDateTime(booking.startsAt)}–
              {formatDateTime(booking.endsAt)}
            </p>
            <span>
              {price(booking.totalPriceCents)} · {booking.serviceDurationMinutes} 分钟 · 周转{" "}
              {booking.turnoverMinutes} 分钟
            </span>
          </section>
          {!resource.data.managerActions.canReschedule ? (
            <section className="manager-change-state">
              <h2>当前预约不能改期</h2>
              <p>{resource.data.managerActions.message}</p>
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
          ) : result ? (
            <section className="manager-change-result" role="status">
              <small>当前事实已更新</small>
              <h2>改期成功</h2>
              <p>
                {result.change.next?.staff.displayName} ·{" "}
                {result.change.next ? formatDateTime(result.change.next.startsAt) : ""}
              </p>
              <strong>核销码已轮换；原安排已保留在变更历史中。</strong>
              <Link className="manager-primary-link" to={`/manager/appointments/${bookingId}`}>
                查看预约详情
              </Link>
            </section>
          ) : (
            <form
              className="manager-change-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <section>
                <header>
                  <h2>可用建议</h2>
                  <p>建议来自当前已发布排班、员工技能和连续容量。</p>
                </header>
                <div className="manager-change-suggestions">
                  {presentedSlots.slice(0, 5).map((slot) => {
                    const key = `${slot.staff.id}:${slot.startsAt}`;
                    return (
                      <label key={key}>
                        <input
                          type="radio"
                          name="suggestion"
                          checked={selectedKey === key}
                          onChange={() => choose(key)}
                        />
                        <span>
                          <strong>{slot.staff.displayName}</strong>
                          <small>
                            {formatDateTime(slot.startsAt)}–{formatDateTime(slot.endsAt)}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <label className="manager-change-field">
                  <span>手动选择新安排</span>
                  <select
                    aria-label="手动选择新安排"
                    value={selectedKey}
                    onChange={(event) => choose(event.target.value)}
                  >
                    <option value="">请选择员工与时间</option>
                    {presentedSlots.map((slot) => {
                      const key = `${slot.staff.id}:${slot.startsAt}`;
                      return (
                        <option key={key} value={key}>
                          {slot.staff.displayName} · {formatDateTime(slot.startsAt)}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </section>
              {conflictSuggestions.length > 0 ? (
                <section className="manager-change-conflict">
                  <ExclamationTriangleIcon />
                  <span>
                    <strong>新安排未能成立，原安排保持不变</strong>
                    <p>服务端返回了 {conflictSuggestions.length} 个更新建议，请重新选择。</p>
                  </span>
                </section>
              ) : null}
              <section className="manager-change-summary">
                <h2>变更后摘要</h2>
                <p>新员工 {selected?.staff.displayName ?? "待选择"}</p>
                <p>
                  新时间{" "}
                  {selected
                    ? `${formatDateTime(selected.startsAt)}–${formatDateTime(selected.endsAt)}`
                    : "待选择"}
                </p>
                <p>价格 {price(booking.totalPriceCents)} · 未变化</p>
                <p>服务时长 {booking.serviceDurationMinutes} 分钟 · 未变化</p>
              </section>
              <label className="manager-change-field">
                <span>
                  改期原因 <b>必填</b>
                </span>
                <textarea
                  aria-label="改期原因"
                  rows={4}
                  maxLength={120}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError("");
                    discardManagerChangeIdempotencyKey(bookingId, "reschedule");
                  }}
                  placeholder="记录已经与顾客达成的线下约定"
                />
                <small>{reason.length}/120 · 必填 2–120 字</small>
              </label>
              <footer>
                <Link className="manager-secondary-link" to={`/manager/appointments/${bookingId}`}>
                  保留原安排
                </Link>
                <button type="submit" disabled={!selected || !validReason || submitting}>
                  {submitting ? "正在确认…" : "确认新安排"}
                </button>
              </footer>
            </form>
          )}
        </>
      ) : null}
    </main>
  );
}
