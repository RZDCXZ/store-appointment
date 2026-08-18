import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircledIcon, ChevronLeftIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Link, useParams } from "react-router-dom";
import type {
  BookingSelectionQuote,
  ManagerBookingContentCorrectionResponse,
  ManagerBookingCorrectionFailureDetails,
  ManagerBookingCorrectionOptionsResponse,
  ManagerBookingCorrectionPreviewResponse,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import {
  discardManagerChangeIdempotencyKey,
  isManagerBookingFactConflict,
  managerChangeIdempotencyKey,
} from "../../manager-booking-change-command";
import { useManagerResource } from "../../manager-live-resource";

const sizeLabels = {
  small: "小型",
  medium: "中型",
  large: "大型",
} as const;

function price(value: number): string {
  return `¥${(value / 100).toLocaleString("zh-CN")}`;
}

function ContentSnapshot({
  label,
  content,
}: {
  label: string;
  content: BookingSelectionQuote;
}): React.JSX.Element {
  return (
    <article className="manager-correction-snapshot">
      <small>{label}</small>
      <h3>
        {content.pet.weightKg} kg · {sizeLabels[content.pet.petSize]}
      </h3>
      <p>
        主要服务规格：{content.primaryService.name} · {sizeLabels[content.pet.petSize]} ·{" "}
        {price(content.primaryService.priceCents)} · {content.primaryService.durationMinutes} 分钟
      </p>
      <p>
        增项：
        {content.addons.length > 0
          ? content.addons.map((addon) => addon.name).join("、")
          : "无增项"}
      </p>
      <p>
        预约总计：{price(content.totalPriceCents)} · {content.serviceDurationMinutes} 分钟
      </p>
      <p>所需技能：{content.requiredSkillIds.join("、")}</p>
    </article>
  );
}

function correctionNextSteps(details: Record<string, unknown>): string[] {
  return Array.isArray(details.nextSteps)
    ? details.nextSteps.filter((step): step is string => typeof step === "string")
    : [];
}

function isBookingSelectionQuote(value: unknown): value is BookingSelectionQuote {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    !!candidate.pet &&
    typeof candidate.pet === "object" &&
    !!candidate.primaryService &&
    typeof candidate.primaryService === "object" &&
    Array.isArray(candidate.addons) &&
    typeof candidate.totalPriceCents === "number" &&
    typeof candidate.serviceDurationMinutes === "number" &&
    Array.isArray(candidate.requiredSkillIds)
  );
}

function correctionFailure(
  details: Record<string, unknown>,
): ManagerBookingCorrectionFailureDetails | null {
  return isBookingSelectionQuote(details.candidate)
    ? (details as unknown as ManagerBookingCorrectionFailureDetails)
    : null;
}

function correctionDraftFingerprint(
  weight: number,
  primaryServiceId: string,
  addonIds: string[],
): string {
  return JSON.stringify({
    petWeightKg: Number(weight.toFixed(2)),
    primaryServiceId,
    addonIds: [...addonIds].sort(),
  });
}

export function ManagerContentCorrectionPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const { markExpired } = useAuth();
  const resource = useManagerResource<ManagerBookingCorrectionOptionsResponse>(
    `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}/correction-options`,
    false,
  );
  const [weight, setWeight] = useState("");
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [previewState, setPreviewState] = useState<{
    fingerprint: string;
    response: ManagerBookingCorrectionPreviewResponse;
  } | null>(null);
  const [result, setResult] = useState<ManagerBookingContentCorrectionResponse | null>(null);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<Record<string, unknown>>({});
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validationRequest = useRef(0);

  useEffect(() => {
    if (!resource.data) return;
    setWeight(String(resource.data.currentContent.pet.weightKg));
    setAddonIds(resource.data.currentContent.addons.map((addon) => addon.id));
    validationRequest.current += 1;
    setPreviewState(null);
    setResult(null);
    setError("");
    setErrorDetails({});
  }, [resource.data]);

  const options = resource.data;
  const booking = options?.booking;
  const parsedWeight = Number(weight);
  const validWeight = Number.isFinite(parsedWeight) && parsedWeight >= 0.1 && parsedWeight <= 99.99;
  const validReason = reason.trim().length >= 2 && reason.trim().length <= 120;
  const normalizedAddonIds = useMemo(() => [...addonIds].sort(), [addonIds]);
  const draftFingerprint =
    options && validWeight
      ? correctionDraftFingerprint(
          parsedWeight,
          options.currentContent.primaryService.id,
          normalizedAddonIds,
        )
      : "";
  const currentFingerprint = options
    ? correctionDraftFingerprint(
        options.currentContent.pet.weightKg,
        options.currentContent.primaryService.id,
        options.currentContent.addons.map((addon) => addon.id),
      )
    : "";
  const draftChanged = draftFingerprint !== "" && draftFingerprint !== currentFingerprint;
  const preview = previewState?.fingerprint === draftFingerprint ? previewState.response : null;
  const failure = correctionFailure(errorDetails);
  const steps = correctionNextSteps(errorDetails);

  function invalidatePreview(): void {
    validationRequest.current += 1;
    setPreviewState(null);
    setValidating(false);
    setError("");
    setErrorDetails({});
    discardManagerChangeIdempotencyKey(bookingId, "correction");
  }

  function toggleAddon(addonId: string): void {
    setAddonIds((current) =>
      current.includes(addonId)
        ? current.filter((candidate) => candidate !== addonId)
        : [...current, addonId],
    );
    invalidatePreview();
  }

  const validateCorrection = useCallback(async (): Promise<void> => {
    if (!options || !validWeight || !draftFingerprint) return;
    const requestId = validationRequest.current + 1;
    validationRequest.current = requestId;
    const requestedFingerprint = draftFingerprint;
    setValidating(true);
    setPreviewState(null);
    setError("");
    setErrorDetails({});
    try {
      const response = await apiFetch(
        `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}/correction-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            petWeightKg: parsedWeight,
            primaryServiceId: options.currentContent.primaryService.id,
            addonIds: normalizedAddonIds,
          }),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (requestId !== validationRequest.current || requestedFingerprint !== draftFingerprint) {
          return;
        }
        if (apiError.status === 401) {
          markExpired();
          return;
        }
        setErrorDetails(apiError.details);
        throw apiError;
      }
      const responseBody = (await response.json()) as ManagerBookingCorrectionPreviewResponse;
      if (requestId !== validationRequest.current || requestedFingerprint !== draftFingerprint) {
        return;
      }
      setPreviewState({ fingerprint: requestedFingerprint, response: responseBody });
    } catch (caught) {
      if (requestId === validationRequest.current && requestedFingerprint === draftFingerprint) {
        setError(caught instanceof Error ? caught.message : "纠正内容校验失败，请重试。");
      }
    } finally {
      if (requestId === validationRequest.current) setValidating(false);
    }
  }, [
    bookingId,
    draftFingerprint,
    markExpired,
    normalizedAddonIds,
    options,
    parsedWeight,
    validWeight,
  ]);

  useEffect(() => {
    if (!draftChanged || !options?.managerActions.canCorrectContent) return;
    const timer = globalThis.setTimeout(() => void validateCorrection(), 200);
    return () => globalThis.clearTimeout(timer);
  }, [draftChanged, options?.managerActions.canCorrectContent, validateCorrection]);

  async function submit(): Promise<void> {
    if (!options || !booking || !preview?.canSave || !validReason || !validWeight) return;
    setSubmitting(true);
    setError("");
    setErrorDetails({});
    try {
      const response = await apiFetch(
        `/backoffice/manager/bookings/${encodeURIComponent(bookingId)}/correct-content`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: managerChangeIdempotencyKey(bookingId, "correction"),
            reason: reason.trim(),
            expectedStaffId: booking.staff.id,
            expectedStartsAt: booking.startsAt,
            expectedBookingRevision: options.bookingRevision,
            expectedContentDigest: options.contentDigest,
            petWeightKg: parsedWeight,
            primaryServiceId: options.currentContent.primaryService.id,
            addonIds,
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
          discardManagerChangeIdempotencyKey(bookingId, "correction");
          validationRequest.current += 1;
          setPreviewState(null);
          setErrorDetails({});
          resource.refresh();
          setError(`预约事实已变化，已重新读取当前内容。${apiError.message}`);
          return;
        }
        discardManagerChangeIdempotencyKey(bookingId, "correction");
        validationRequest.current += 1;
        setPreviewState(null);
        setErrorDetails(apiError.details);
        throw apiError;
      }
      setResult((await response.json()) as ManagerBookingContentCorrectionResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "预约内容纠正失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell manager-change-page manager-correction-page">
      <header className="manager-change-header">
        <Link to={`/manager/appointments/${bookingId}`}>
          <ChevronLeftIcon /> 返回预约详情
        </Link>
        <p>MG-07 · 预约内容纠正</p>
        <h1>纠正预约内容</h1>
        <strong>先校验技能与连续容量；未成功保存前，原预约内容持续有效。</strong>
      </header>

      {resource.loading && !booking ? (
        <section className="manager-change-state manager-shimmer" role="status">
          正在读取当前预约快照…
        </section>
      ) : null}
      {resource.error && !booking ? (
        <section className="manager-change-state manager-change-state--error" role="alert">
          <h2>纠正信息暂时无法读取</h2>
          <p>{resource.error}</p>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {error ? (
        <section className="manager-change-alert" role="alert">
          <strong>{error}</strong>
          {options ? (
            <p>
              原内容仍有效：{options.currentContent.pet.weightKg} kg ·{" "}
              {sizeLabels[options.currentContent.pet.petSize]} ·{" "}
              {options.currentContent.primaryService.name}
            </p>
          ) : null}
        </section>
      ) : null}

      {booking && options ? (
        <>
          <section className="manager-correction-comparison" aria-label="纠正前后对比">
            <ContentSnapshot label="纠正前 · 当前有效" content={options.currentContent} />
            <ContentSnapshot
              label="纠正后 · 待保存"
              content={preview?.candidateContent ?? failure?.candidate ?? options.currentContent}
            />
          </section>

          {!options.managerActions.canCorrectContent ? (
            <section className="manager-change-state">
              <h2>当前预约不能纠正内容</h2>
              <p>{options.managerActions.message}</p>
            </section>
          ) : result ? (
            <section className="manager-change-result" role="status">
              <small>当前事实已原子更新</small>
              <h2>预约内容已纠正</h2>
              <p>
                {result.booking.pet.weightKg} kg · {sizeLabels[result.booking.pet.petSize]} ·{" "}
                {price(result.booking.totalPriceCents)} · {result.booking.serviceDurationMinutes}{" "}
                分钟
              </p>
              <strong>核销码保持不变；原内容与原因已写入变更历史。</strong>
              <Link className="manager-primary-link" to={`/manager/appointments/${bookingId}`}>
                查看预约详情
              </Link>
            </section>
          ) : (
            <form
              className="manager-change-form manager-correction-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <section>
                <header>
                  <h2>纠正内容</h2>
                  <p>体型与服务规格由体重自动重算，不能直接选择。</p>
                </header>
                <div className="manager-correction-fields">
                  <label className="manager-change-field">
                    <span>纠正后体重（kg）</span>
                    <input
                      aria-label="纠正后体重（kg）"
                      type="number"
                      min="0.1"
                      max="99.99"
                      step="0.01"
                      value={weight}
                      onChange={(event) => {
                        setWeight(event.target.value);
                        invalidatePreview();
                      }}
                    />
                    <small>0.1–99.99 kg；体型由体重自动计算</small>
                  </label>
                  <div className="manager-correction-service">
                    <span>主要服务</span>
                    <strong>{options.currentContent.primaryService.name}</strong>
                    <small>主要服务不可替换；如需更换，请取消后重新预约。</small>
                  </div>
                </div>
                <fieldset className="manager-correction-addons">
                  <legend>增项</legend>
                  {options.availableAddons.map((addon) => (
                    <label key={addon.id}>
                      <input
                        type="checkbox"
                        checked={addonIds.includes(addon.id)}
                        onChange={() => toggleAddon(addon.id)}
                      />
                      <span>
                        <strong>{addon.name}</strong>
                        <small>{addon.description}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  disabled={!validWeight || validating}
                  onClick={() => void validateCorrection()}
                >
                  {validating ? "正在校验…" : "校验纠正后内容"}
                </button>
              </section>

              {preview ? (
                <section className="manager-correction-validation" aria-label="服务端校验结果">
                  <h2>保存前校验</h2>
                  <p>
                    <CheckCircledIcon /> 员工技能满足
                  </p>
                  <p>
                    <CheckCircledIcon /> 排班与连续容量可用
                  </p>
                </section>
              ) : failure ? (
                <section className="manager-correction-validation" aria-label="服务端最新校验结果">
                  <h2>保存前校验已失效</h2>
                  <p>
                    {failure.validation.skill.status === "satisfied"
                      ? "员工技能满足"
                      : `员工技能不足：${failure.validation.skill.missingSkillIds.join("、")}`}
                  </p>
                  <p>
                    {failure.validation.capacity.status === "insufficient"
                      ? "排班或连续容量不可用，请重新校验"
                      : "容量尚未校验，请重新校验"}
                  </p>
                </section>
              ) : null}

              {steps.length > 0 ? (
                <section className="manager-change-conflict">
                  <ExclamationTriangleIcon />
                  <span>
                    <strong>当前纠正不能安全保存</strong>
                    <p>可继续选择以下处理方式，原预约内容不会被覆盖。</p>
                    <nav aria-label="纠正失败后的处理方式">
                      {steps.includes("change_staff") ? (
                        <Link to={`/manager/appointments/${bookingId}/reschedule`}>换员工</Link>
                      ) : null}
                      {steps.includes("reschedule") ? (
                        <Link to={`/manager/appointments/${bookingId}/reschedule`}>改期</Link>
                      ) : null}
                      {steps.includes("cancel") ? (
                        <Link to={`/manager/appointments/${bookingId}/cancel`}>取消预约</Link>
                      ) : null}
                    </nav>
                  </span>
                </section>
              ) : null}

              <label className="manager-change-field">
                <span>
                  纠正原因 <b>必填</b>
                </span>
                <textarea
                  aria-label="纠正原因"
                  rows={4}
                  maxLength={120}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError("");
                    discardManagerChangeIdempotencyKey(bookingId, "correction");
                  }}
                  placeholder="记录已与顾客确认的事实及录入错误"
                />
                <small>{reason.length}/120 · 必填 2–120 字</small>
              </label>
              <footer>
                <Link className="manager-secondary-link" to={`/manager/appointments/${bookingId}`}>
                  保留原内容
                </Link>
                <button type="submit" disabled={!preview?.canSave || !validReason || submitting}>
                  {submitting ? "正在保存…" : "确认并保存纠正"}
                </button>
              </footer>
            </form>
          )}
        </>
      ) : null}
    </main>
  );
}
