import { useState } from "react";
import { ChevronLeftIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import {
  storeServiceCareTags,
  type BookingCompletionResponse,
  type StaffBookingDetailResponse,
  type StoreServiceCareTag,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import {
  StaffInlineRefreshError,
  StaffPageError,
  StaffPageLoading,
} from "../../staff-booking-components";
import { formatShanghaiDateTime, serviceLabel } from "../../staff-booking-presentation";
import {
  commandIdempotencyKey,
  discardCommandIdempotencyKey,
  isFulfilmentFactConflict,
} from "../../staff-fulfilment-command";
import { useStaffResource } from "../../staff-resource";
import { StoreServiceRecordView } from "../../store-service-record";

export function StaffCompletePage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const [careTags, setCareTags] = useState<StoreServiceCareTag[]>([]);
  const [internalText, setInternalText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedResult, setSubmittedResult] = useState<BookingCompletionResponse | null>(null);
  const detail = resource.data;
  const booking = detail?.booking;
  const record = detail?.serviceRecord ?? submittedResult?.serviceRecord ?? null;
  const canComplete =
    booking?.status === "checked_in" &&
    detail !== null &&
    Date.parse(detail.demoNow) >= Date.parse(booking.startsAt);

  async function complete(): Promise<void> {
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/bookings/${encodeURIComponent(bookingId)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: commandIdempotencyKey(bookingId, "complete"),
            careTags,
            internalText: internalText.trim() || null,
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
          discardCommandIdempotencyKey(bookingId, "complete");
          resource.refresh();
          setError(`${apiError.message} 已重新读取预约当前状态。`);
          return;
        }
        throw apiError;
      }
      setSubmittedResult((await response.json()) as BookingCompletionResponse);
      resource.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "完成服务失败，请重试。");
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
          <h1>没有完成服务权限</h1>
          <p>只有这笔预约的分配员工可以进入完成页。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-fulfilment-page">
      {resource.loading && !detail ? <StaffPageLoading label="正在读取完成服务状态" /> : null}
      {resource.error && !detail ? (
        <StaffPageError
          title="完成页暂时无法读取"
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
            <p>ST-06 · 正常履约结果</p>
            <h1>完成服务</h1>
          </header>

          {resource.error ? (
            <StaffInlineRefreshError message={resource.error} retry={resource.refresh} />
          ) : null}

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
              <small>员工</small>
              <strong>{booking?.staff.displayName}</strong>
            </span>
          </section>

          {submittedResult ? (
            <section className="staff-fulfilment-result" role="status">
              <small>正常完成</small>
              <h2>门店服务记录已保存</h2>
              <p>{formatShanghaiDateTime(submittedResult.occurredAt)}</p>
              <strong>实际结束后保留 15 分钟周转，原计划快照继续保留。</strong>
            </section>
          ) : null}
          {error ? (
            <p className="staff-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {record ? <StoreServiceRecordView record={record} /> : null}
          {!record && booking?.status === "checked_in" ? (
            <form
              className="staff-complete-form"
              onSubmit={(event) => {
                event.preventDefault();
                void complete();
              }}
            >
              <header>
                <small>自动生成</small>
                <h2>结构化服务摘要已生成</h2>
                <p>宠物、主要服务、增项、员工和实际时间会自动保存；下面两项均可留空。</p>
              </header>
              <fieldset className="staff-care-tag-picker">
                <legend>本次护理标签（选填）</legend>
                {storeServiceCareTags.map((tag) => {
                  const selected = careTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={selected}
                      className={selected ? "selected" : ""}
                      onClick={() =>
                        setCareTags((current) =>
                          selected ? current.filter((item) => item !== tag) : [...current, tag],
                        )
                      }
                    >
                      {tag}
                    </button>
                  );
                })}
              </fieldset>
              <label htmlFor="completion-internal-text">
                内部文字记录（选填）
                <textarea
                  id="completion-internal-text"
                  aria-label="内部文字记录（选填）"
                  rows={5}
                  maxLength={1000}
                  value={internalText}
                  onChange={(event) => setInternalText(event.target.value)}
                  placeholder="有值得保留的信息时再填写"
                />
                <small>{internalText.length}/1000 · 可以留空</small>
              </label>
              {!canComplete ? <p>尚未到计划开始时间，暂时不能完成服务。</p> : null}
              <button
                className="staff-primary-link"
                type="submit"
                disabled={!canComplete || submitting}
              >
                {submitting ? "正在保存…" : "完成服务并保存记录"}
              </button>
            </form>
          ) : null}
          {!record && booking?.status !== "checked_in" ? (
            <section className="staff-state staff-state--empty">
              <h2>当前状态不能完成服务</h2>
              <p>只有已到店预约可以在此保存正常完成结果。</p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
