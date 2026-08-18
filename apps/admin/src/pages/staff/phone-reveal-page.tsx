import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeftIcon, LockClosedIcon } from "@radix-ui/react-icons";
import type { StaffBookingDetailResponse, StaffPhoneRevealResponse } from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { StaffPageError, StaffPageLoading } from "../../staff-booking-components";
import { formatShanghaiDateTime } from "../../staff-booking-presentation";
import { useStaffResource } from "../../staff-resource";

function displayPhone(phone: string): string {
  if (phone.length !== 11) return phone;
  return `${phone.slice(0, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}`;
}

export function StaffPhoneRevealPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState<StaffPhoneRevealResponse | null>(null);
  const booking = resource.data?.booking;
  const revealAvailable = booking?.status === "confirmed" || booking?.status === "checked_in";

  async function revealPhone(): Promise<void> {
    setError("");
    setSubmitting(true);

    try {
      const response = await apiFetch(
        `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}/customer-phone/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed }),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (apiError.status === 401) {
          markExpired();
          return;
        }
        throw apiError;
      }
      setReveal((await response.json()) as StaffPhoneRevealResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "完整手机号揭示失败，请重试。");
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
          <h1>没有手机号访问权限</h1>
          <p>当前员工只能为分配给自己的待履约预约揭示完整手机号。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-phone-page">
      {resource.loading && !resource.data ? (
        <StaffPageLoading label="正在读取手机号揭示确认" />
      ) : null}
      {resource.error && !resource.data ? (
        <StaffPageError
          title="确认页暂时无法读取"
          message={resource.error}
          retry={resource.refresh}
        />
      ) : null}
      {resource.error && resource.data ? (
        <div className="staff-inline-error" role="alert">
          <span>更新失败，已保留上次读取的预约资料。</span>
          <button type="button" onClick={resource.refresh}>
            重试
          </button>
        </div>
      ) : null}
      {resource.data ? (
        <>
          <header className="staff-detail-header">
            <Link to={`/staff/appointments/${bookingId}`}>
              <ChevronLeftIcon /> 返回预约详情
            </Link>
            <p>ST-08 · 敏感资料访问</p>
            <h1>揭示完整手机号</h1>
          </header>
          {revealAvailable ? (
            <section className="staff-phone-confirmation">
              <LockClosedIcon />
              <div>
                <small>当前预约</small>
                <h2>
                  {resource.data.booking.pet.name} · {resource.data.booking.customer.displayName}
                </h2>
                <p className="staff-masked-phone">{resource.data.booking.customer.phoneMasked}</p>
              </div>
              <div className="staff-audit-notice">
                <strong>此次访问会记录在审计中</strong>
                <p>审计事实包含当前员工、顾客、预约和访问时间，写入后不可覆盖。</p>
              </div>

              {reveal ? (
                <div className="staff-revealed-phone" role="status">
                  <small>完整手机号</small>
                  <strong>{displayPhone(reveal.phone)}</strong>
                  <p>已于 {formatShanghaiDateTime(reveal.revealedAt)} 记录此次访问。</p>
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void revealPhone();
                  }}
                >
                  <label className="staff-confirm-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>我确认当前履约需要联系顾客</span>
                  </label>
                  {error ? (
                    <p className="staff-form-error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button
                    className="staff-primary-link"
                    type="submit"
                    disabled={!confirmed || submitting}
                  >
                    {submitting ? "正在揭示…" : "确认并揭示"}
                  </button>
                </form>
              )}
            </section>
          ) : (
            <section className="staff-state staff-state--empty">
              <LockClosedIcon />
              <h2>完整手机号不可揭示</h2>
              <p>这笔预约已经结束，完整手机号仅在待履约期间按需揭示。</p>
              <Link
                className="staff-primary-link"
                to={`/staff/appointments/${resource.data.booking.id}`}
              >
                返回预约详情
              </Link>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
