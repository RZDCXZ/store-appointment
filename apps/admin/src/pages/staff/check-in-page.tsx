import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeftIcon, LockClosedIcon } from "@radix-ui/react-icons";
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
} from "../../staff-fulfilment-command";
import { useStaffResource } from "../../staff-resource";

export function StaffCheckInPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const [verificationCode, setVerificationCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedResult, setSubmittedResult] = useState<BookingFulfilmentResponse | null>(null);
  const detail = resource.data;
  const booking = detail?.booking;
  const result = submittedResult ?? (detail ? recoveredFulfilment(detail) : null);

  async function checkIn(): Promise<void> {
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/bookings/${encodeURIComponent(bookingId)}/check-in`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: commandIdempotencyKey(bookingId, "check_in"),
            verificationCode,
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
          discardCommandIdempotencyKey(bookingId, "check_in");
          resource.refresh();
          setError(`${apiError.message} 已重新读取预约当前状态。`);
          return;
        }
        throw apiError;
      }
      setSubmittedResult((await response.json()) as BookingFulfilmentResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "到店核销失败，请重试。");
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
          <h1>没有核销权限</h1>
          <p>只有这笔预约的分配员工可以进入核销页。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-fulfilment-page">
      {resource.loading && !detail ? <StaffPageLoading label="正在读取核销状态" /> : null}
      {resource.error && !detail ? (
        <StaffPageError
          title="核销页暂时无法读取"
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
            <p>ST-04 · 正常到店</p>
            <h1>到店核销</h1>
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
            <section className="staff-state staff-state--empty">
              <h2>正常核销窗口已结束</h2>
              <p>预约已经迟到，请填写原因后选择手动核销或人工标记爽约。</p>
              <Link className="staff-primary-link" to={`/staff/appointments/${booking.id}/late`}>
                前往迟到处理
              </Link>
            </section>
          ) : null}
          {!result && booking?.action === "upcoming" ? (
            <section className="staff-state staff-state--empty">
              <h2>核销窗口尚未开始</h2>
              <p>开始前 30 分钟至开始后 15 分钟可以输入顾客的六位核销码。</p>
            </section>
          ) : null}
          {!result && booking?.action === "check_in" ? (
            <section className="staff-fulfilment-form-card">
              <header>
                <small>有效窗口</small>
                <h2>开始前 30 分钟至开始后 15 分钟</h2>
                <p>请当面向顾客确认小程序中的六位数字；成功后核销码立即失效。</p>
              </header>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void checkIn();
                }}
              >
                <label htmlFor="verification-code">六位核销码</label>
                <input
                  id="verification-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(event) => {
                    if (error) {
                      discardCommandIdempotencyKey(bookingId, "check_in");
                      setError("");
                    }
                    setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  }}
                />
                <button
                  className="staff-primary-link"
                  type="submit"
                  disabled={!/^\d{6}$/.test(verificationCode) || submitting}
                >
                  {submitting ? "正在核销…" : "确认到店核销"}
                </button>
              </form>
            </section>
          ) : null}
          {!result &&
          booking?.action !== "check_in" &&
          booking?.action !== "late" &&
          booking?.action !== "upcoming" ? (
            <section className="staff-state staff-state--empty">
              <h2>当前状态不能核销</h2>
              <p>这笔预约已经结束或进入其他履约阶段。</p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
