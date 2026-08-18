import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import type {
  CapacityChangeCreateResponse,
  CapacityChangeInput,
  CapacityChangePreviewResponse,
  ManagerCapacityChangeOptionsResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useBackofficeResource } from "../../backoffice-resource";
import { PageHeading } from "../../page-components";
import { ScheduleNavigation } from "../../schedule-navigation";

type FormState = Required<
  Pick<CapacityChangeInput, "kind" | "localDate" | "startsAt" | "endsAt" | "reason">
> & {
  staffId: string;
};

function formatCapacity(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 员工小时`;
}

function formatBookingTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function FieldError({ id, message }: { id: string; message?: string }): React.JSX.Element | null {
  return message ? (
    <small className="capacity-change-field-error" id={id}>
      {message}
    </small>
  ) : null;
}

function ImpactSummary({ preview }: { preview: CapacityChangePreviewResponse }): React.JSX.Element {
  return (
    <section className="capacity-change-impact" aria-labelledby="capacity-impact-heading">
      <header>
        <div>
          <p>提交前确认</p>
          <h2 id="capacity-impact-heading">影响摘要</h2>
        </div>
        <span className={`capacity-change-outcome capacity-change-outcome--${preview.outcome}`}>
          {preview.outcome === "pending" ? "将进入待处理" : "将直接生效"}
        </span>
      </header>
      <div className="capacity-change-metrics">
        <article>
          <span>目标容量</span>
          <strong>{formatCapacity(preview.targetCapacityMinutes)}</strong>
        </article>
        <article>
          <span>受影响预约</span>
          <strong>{preview.affectedBookingCount} 笔预约</strong>
        </article>
        <article>
          <span>变化对象</span>
          <strong>{preview.target.label}</strong>
        </article>
      </div>
      {preview.affectedBookings.length > 0 ? (
        <div className="capacity-change-bookings">
          {preview.affectedBookings.map((booking) => (
            <article key={booking.id}>
              <span>
                <strong>
                  {booking.petName} · {booking.customerName}
                </strong>
                <small>
                  {booking.serviceName} · {booking.staff.displayName} ·{" "}
                  {formatBookingTime(booking.startsAt)}–{formatBookingTime(booking.endsAt)}
                </small>
              </span>
              <b>保持已确认</b>
            </article>
          ))}
        </div>
      ) : (
        <p className="capacity-change-empty-impact">
          <CheckCircledIcon /> 当前没有预约落入所选区间。
        </p>
      )}
      <p className="capacity-change-consequence">
        <ExclamationTriangleIcon />
        <span>{preview.consequence}</span>
      </p>
    </section>
  );
}

function CapacityChangeForm({
  options,
}: {
  options: ManagerCapacityChangeOptionsResponse;
}): React.JSX.Element {
  const { markExpired } = useAuth();
  const firstOpenDay = options.window.days.find((day) => day.businessHours.status === "open");
  const [form, setForm] = useState<FormState>(() => ({
    kind: "time_off",
    staffId: options.staff[0]?.id ?? "",
    localDate: firstOpenDay?.date ?? options.window.startsOn,
    startsAt: firstOpenDay?.businessHours.opensAt ?? "09:30",
    endsAt: firstOpenDay?.businessHours.closesAt ?? "19:00",
    reason: "",
  }));
  const [preview, setPreview] = useState<CapacityChangePreviewResponse | null>(null);
  const [created, setCreated] = useState<CapacityChangeCreateResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [working, setWorking] = useState<"preview" | "create" | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      if (key === "startsAt" || key === "endsAt" || key === "localDate") delete next.interval;
      return next;
    });
    setRequestError(null);
    setPreview(null);
    setCreated(null);
  };
  const payload = (): CapacityChangeInput => ({
    kind: form.kind,
    ...(form.kind === "time_off" ? { staffId: form.staffId } : {}),
    localDate: form.localDate,
    startsAt: form.startsAt,
    endsAt: form.endsAt,
    reason: form.reason,
  });
  const handleFailure = async (response: Response): Promise<void> => {
    const error = await readApiError(response);
    if (error.status === 401) {
      markExpired();
      return;
    }
    const errors = error.details.fieldErrors;
    setFieldErrors(
      typeof errors === "object" && errors !== null ? (errors as Record<string, string>) : {},
    );
    setRequestError(error.message);
  };
  const requestPreview = async (): Promise<void> => {
    setWorking("preview");
    setFieldErrors({});
    setRequestError(null);
    setCreated(null);
    try {
      const response = await apiFetch("/backoffice/manager/capacity-changes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) {
        await handleFailure(response);
        return;
      }
      setPreview((await response.json()) as CapacityChangePreviewResponse);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "影响预览失败，请稍后重试。");
    } finally {
      setWorking(null);
    }
  };
  const create = async (): Promise<void> => {
    setWorking("create");
    setFieldErrors({});
    setRequestError(null);
    try {
      const response = await apiFetch("/backoffice/manager/capacity-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) {
        await handleFailure(response);
        setPreview(null);
        return;
      }
      setCreated((await response.json()) as CapacityChangeCreateResponse);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "容量变化创建失败，请稍后重试。");
    } finally {
      setWorking(null);
    }
  };

  return (
    <>
      <section
        className="capacity-change-form-panel"
        aria-labelledby="capacity-change-form-heading"
      >
        <header>
          <div>
            <p>容量变化</p>
            <h2 id="capacity-change-form-heading">选择对象与区间</h2>
          </div>
          <span>[开始, 结束) · 左闭右开</span>
        </header>
        <div className="capacity-change-fields">
          <fieldset className="capacity-change-kind">
            <legend>变化类型</legend>
            <label>
              <input
                type="radio"
                name="capacity-kind"
                checked={form.kind === "time_off"}
                onChange={() => update("kind", "time_off")}
              />
              <span>
                <strong>员工停班</strong>
                <small>只冻结一名员工的已发布容量</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="capacity-kind"
                checked={form.kind === "store_closure"}
                onChange={() => update("kind", "store_closure")}
              />
              <span>
                <strong>临时闭店</strong>
                <small>作为门店整体事实冻结全部员工容量</small>
              </span>
            </label>
          </fieldset>

          {form.kind === "time_off" ? (
            <label>
              员工
              <select
                value={form.staffId}
                onChange={(event) => update("staffId", event.target.value)}
                aria-describedby={fieldErrors.staffId ? "capacity-error-staff" : undefined}
              >
                {options.staff.map((staff) => (
                  <option value={staff.id} key={staff.id}>
                    {staff.displayName} · 员工 {String(staff.employeeNumber).padStart(2, "0")}
                  </option>
                ))}
              </select>
              <FieldError id="capacity-error-staff" message={fieldErrors.staffId} />
            </label>
          ) : null}
          <label>
            日期
            <select
              value={form.localDate}
              onChange={(event) => {
                const selected = options.window.days.find((day) => day.date === event.target.value);
                update("localDate", event.target.value);
                if (selected?.businessHours.status === "open") {
                  setForm((current) => ({
                    ...current,
                    startsAt: selected.businessHours.opensAt ?? current.startsAt,
                    endsAt: selected.businessHours.closesAt ?? current.endsAt,
                  }));
                }
              }}
              aria-describedby={fieldErrors.localDate ? "capacity-error-date" : undefined}
            >
              {options.window.days.map((day) => (
                <option
                  value={day.date}
                  disabled={day.businessHours.status === "closed"}
                  key={day.date}
                >
                  {formatDate(day.date)}
                  {day.businessHours.status === "closed" ? " · 固定闭店" : ""}
                </option>
              ))}
            </select>
            <FieldError id="capacity-error-date" message={fieldErrors.localDate} />
          </label>
          <label>
            开始时间
            <input
              type="time"
              value={form.startsAt}
              onChange={(event) => update("startsAt", event.target.value)}
              aria-describedby={fieldErrors.startsAt ? "capacity-error-start" : undefined}
            />
            <FieldError id="capacity-error-start" message={fieldErrors.startsAt} />
          </label>
          <label>
            结束时间
            <input
              type="time"
              value={form.endsAt}
              onChange={(event) => update("endsAt", event.target.value)}
              aria-describedby={fieldErrors.endsAt ? "capacity-error-end" : undefined}
            />
            <FieldError id="capacity-error-end" message={fieldErrors.endsAt} />
          </label>
          <label className="capacity-change-reason">
            原因
            <textarea
              value={form.reason}
              maxLength={200}
              placeholder="说明停班或临时闭店原因"
              onChange={(event) => update("reason", event.target.value)}
              aria-describedby={fieldErrors.reason ? "capacity-error-reason" : undefined}
            />
            <FieldError id="capacity-error-reason" message={fieldErrors.reason} />
          </label>
          <FieldError id="capacity-error-interval" message={fieldErrors.interval} />
        </div>
        {requestError ? (
          <p className="capacity-change-request-error" role="alert">
            {requestError}
          </p>
        ) : null}
        <footer>
          <span>预览不会保存；确认创建时服务端会重新检查预约影响。</span>
          <button
            type="button"
            className="primary-button"
            onClick={() => void requestPreview()}
            disabled={working !== null}
          >
            {working === "preview" ? "正在检查" : "预览影响"}
          </button>
        </footer>
      </section>

      {preview ? (
        <>
          <ImpactSummary preview={preview} />
          <div className="capacity-change-confirm">
            <span>系统不提供强制生效；有影响时必须逐笔处理预约。</span>
            <button
              type="button"
              className="primary-button"
              onClick={() => void create()}
              disabled={working !== null || created !== null}
            >
              {working === "create"
                ? "正在创建"
                : preview.outcome === "pending"
                  ? "确认并进入待处理"
                  : "确认并直接生效"}
            </button>
          </div>
        </>
      ) : null}

      {created ? (
        <section
          className={`capacity-change-success capacity-change-success--${created.change.status}`}
          role="status"
        >
          <CheckCircledIcon />
          <span>
            <strong>
              {created.change.status === "pending" ? "容量变化已进入待处理" : "容量变化已直接生效"}
            </strong>
            <small>{created.change.consequence}</small>
          </span>
          <Link to={created.nextStep.href}>{created.nextStep.label}</Link>
        </section>
      ) : null}
    </>
  );
}

export function ManagerCapacityChangePage(): React.JSX.Element {
  const resource = useBackofficeResource<ManagerCapacityChangeOptionsResponse>(
    "/backoffice/manager/capacity-changes/options",
    "容量资料读取失败，请稍后重试。",
  );

  return (
    <main className="page-shell capacity-change-page">
      <PageHeading
        copy={{
          eyebrow: "MG-10 · 排班容量",
          title: "创建停班或临时闭店",
          description: "先预览目标容量与预约影响，再决定直接生效或进入待处理。",
        }}
        badge="影响处理保护"
      />
      <ScheduleNavigation />

      {resource.loading && !resource.data ? (
        <section className="capacity-change-loading" role="status">
          正在读取员工与十四日已发布排班…
        </section>
      ) : null}
      {resource.error && !resource.data ? (
        <section className="schedule-state schedule-state--error" role="alert">
          <p className="state-code">容量资料读取失败</p>
          <h2>暂时无法创建容量变化</h2>
          <p>{resource.error}</p>
          <button className="primary-button" type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {resource.forbidden ? (
        <section className="schedule-state schedule-state--error" role="alert">
          <p className="state-code">403 · 无权限</p>
          <h2>只有店长可以创建容量变化</h2>
        </section>
      ) : null}
      {resource.data ? <CapacityChangeForm options={resource.data} /> : null}
    </main>
  );
}
