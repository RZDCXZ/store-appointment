import { useState } from "react";
import { ChevronLeftIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type {
  StaffBookingDetailResponse,
  StoreServiceRecordNote,
  StoreServiceRecordNoteResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import {
  StaffInlineRefreshError,
  StaffPageError,
  StaffPageLoading,
} from "../../staff-booking-components";
import { formatShanghaiDateTime } from "../../staff-booking-presentation";
import {
  commandIdempotencyKey,
  discardCommandIdempotencyKey,
} from "../../staff-fulfilment-command";
import { useStaffResource } from "../../staff-resource";
import { StoreServiceRecordView } from "../../store-service-record";

export function StaffServiceRecordPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submittedNote, setSubmittedNote] = useState<StoreServiceRecordNoteResponse | null>(null);
  const detail = resource.data;
  const booking = detail?.booking;
  const record = detail?.serviceRecord;
  const validText = text.trim().length >= 2 && text.trim().length <= 500;
  const notes: StoreServiceRecordNote[] = record
    ? submittedNote && !record.notes.some((note) => note.id === submittedNote.note.id)
      ? [...record.notes, submittedNote.note]
      : record.notes
    : [];

  async function appendNote(): Promise<void> {
    setError("");
    setSubmitting(true);
    try {
      const response = await apiFetch(
        `/backoffice/bookings/${encodeURIComponent(bookingId)}/service-record/notes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: commandIdempotencyKey(bookingId, "service_record_note"),
            text: text.trim(),
          }),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (apiError.status === 401) {
          markExpired();
          return;
        }
        discardCommandIdempotencyKey(bookingId, "service_record_note");
        if (apiError.status === 409) resource.refresh();
        throw apiError;
      }
      setSubmittedNote((await response.json()) as StoreServiceRecordNoteResponse);
      discardCommandIdempotencyKey(bookingId, "service_record_note");
      setText("");
      resource.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "追加说明失败，请重试。");
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
          <h1>没有门店服务记录访问权限</h1>
          <p>只有这笔预约的分配员工可以读取和追加说明。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-fulfilment-page">
      {resource.loading && !detail ? <StaffPageLoading label="正在读取门店服务记录" /> : null}
      {resource.error && !detail ? (
        <StaffPageError
          title="门店服务记录暂时无法读取"
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
            <p>ST-09 · 只追加记录</p>
            <h1>门店服务记录与追加说明</h1>
          </header>

          {resource.error ? (
            <StaffInlineRefreshError message={resource.error} retry={resource.refresh} />
          ) : null}

          {submittedNote ? (
            <section className="staff-fulfilment-result" role="status">
              <small>追加完成</small>
              <h2>说明已追加</h2>
              <p>原门店服务记录保持不变。</p>
            </section>
          ) : null}
          {error ? (
            <p className="staff-form-error" role="alert">
              {error}
            </p>
          ) : null}
          {record ? (
            <>
              <StoreServiceRecordView record={record} />
              <section className="staff-service-record-notes">
                <header>
                  <small>追加历史</small>
                  <h2>说明与更正</h2>
                </header>
                {notes.length > 0 ? (
                  <ol>
                    {notes.map((note) => (
                      <li key={note.id}>
                        <strong>
                          {note.kind === "manager_correction" ? "店长更正说明" : "员工追加说明"}
                        </strong>
                        <p>{note.text}</p>
                        <p>
                          {note.author.displayName} · {formatShanghaiDateTime(note.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>尚无追加说明。</p>
                )}
              </section>
              <form
                className="staff-service-record-note-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void appendNote();
                }}
              >
                <label htmlFor="service-record-note">
                  追加说明
                  <textarea
                    id="service-record-note"
                    aria-label="追加说明"
                    rows={5}
                    maxLength={500}
                    value={text}
                    onChange={(event) => {
                      if (error) {
                        discardCommandIdempotencyKey(bookingId, "service_record_note");
                        setError("");
                      }
                      setText(event.target.value);
                    }}
                    placeholder="只补充新增事实；原记录不会被覆盖"
                  />
                  <small>{text.length}/500 · 必填 2–500 字</small>
                </label>
                <button
                  className="staff-primary-link"
                  type="submit"
                  disabled={!validText || submitting}
                >
                  {submitting ? "正在保存…" : "保存追加说明"}
                </button>
              </form>
            </>
          ) : (
            <section className="staff-state staff-state--empty">
              <h2>尚无门店服务记录</h2>
              <p>只有正常完成服务后才会生成可追加说明的只读记录。</p>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}
