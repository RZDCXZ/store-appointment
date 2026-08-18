import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircledIcon, ChevronLeftIcon, LockClosedIcon } from "@radix-ui/react-icons";
import type {
  BookingConflictSuggestion,
  ManagerOfflineConsentSource,
  ManagerProxyBookingOptionsResponse,
  ManagerProxyBookingResponse,
} from "@rongguang/contracts";

import { ApiError, apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { useManagerResource } from "../../manager-live-resource";

type ProfileKind = "existing" | "new";

interface ProxyDraft {
  profileKind: ProfileKind;
  customerId: string;
  petId: string;
  customerName: string;
  customerPhone: string;
  petName: string;
  petSpecies: "dog" | "cat";
  petWeightKg: string;
  primaryServiceId: string;
  addonIds: string[];
  staffId: string;
  startsAt: string;
  offlineConsentSource: ManagerOfflineConsentSource | "";
  consentConfirmed: boolean;
}

const initialDraft: ProxyDraft = {
  profileKind: "existing",
  customerId: "",
  petId: "",
  customerName: "",
  customerPhone: "",
  petName: "",
  petSpecies: "dog",
  petWeightKg: "",
  primaryServiceId: "",
  addonIds: [],
  staffId: "",
  startsAt: "",
  offlineConsentSource: "",
  consentConfirmed: false,
};

function idempotencyKey(): string {
  return `manager-proxy-${crypto.randomUUID()}`;
}

function shanghaiInputToIso(value: string): string {
  return new Date(`${value}:00+08:00`).toISOString();
}

function isoToShanghaiInput(value: string): string {
  return new Date(Date.parse(value) + 8 * 60 * 60_000).toISOString().slice(0, 16);
}

function fieldErrorsFrom(error: ApiError): Record<string, string> {
  const fieldErrors = error.details.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object" || Array.isArray(fieldErrors)) return {};
  return Object.fromEntries(
    Object.entries(fieldErrors).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function ManagerProxyBookingPage(): React.JSX.Element {
  const { markExpired } = useAuth();
  const resource = useManagerResource<ManagerProxyBookingOptionsResponse>(
    "/backoffice/manager/proxy-bookings/options",
    false,
  );
  const requestKey = useRef(idempotencyKey());
  const [draft, setDraft] = useState(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<BookingConflictSuggestion[]>([]);
  const [result, setResult] = useState<ManagerProxyBookingResponse | null>(null);
  const options = resource.data;
  const selectedCustomer = options?.customers.find((item) => item.id === draft.customerId);
  const selectedPet = selectedCustomer?.pets.find((item) => item.id === draft.petId);
  const selectedSpecies =
    draft.profileKind === "existing" ? selectedPet?.species : draft.petSpecies;
  const services = useMemo(
    () =>
      options?.primaryServices.filter(
        (service) => !selectedSpecies || service.applicableSpecies.includes(selectedSpecies),
      ) ?? [],
    [options, selectedSpecies],
  );
  const selectedService = services.find((service) => service.id === draft.primaryServiceId);
  const addons =
    options?.addons.filter((addon) => selectedService?.availableAddonIds.includes(addon.id)) ?? [];

  function changeDraft(next: Partial<ProxyDraft>): void {
    setDraft((current) => ({ ...current, ...next }));
    setError("");
    setFieldErrors({});
    setSuggestions([]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setFieldErrors({});
    setSuggestions([]);
    const profile =
      draft.profileKind === "existing"
        ? { kind: "existing" as const, customerId: draft.customerId, petId: draft.petId }
        : {
            kind: "new" as const,
            customer: { displayName: draft.customerName, phone: draft.customerPhone },
            pet: {
              name: draft.petName,
              species: draft.petSpecies,
              weightKg: Number(draft.petWeightKg),
            },
          };

    try {
      const response = await apiFetch("/backoffice/manager/proxy-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: requestKey.current,
          profile,
          primaryServiceId: draft.primaryServiceId,
          addonIds: draft.addonIds,
          staffId: draft.staffId,
          startsAt: shanghaiInputToIso(draft.startsAt),
          offlineConsentSource: draft.offlineConsentSource,
        }),
      });
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (apiError.status === 401) {
          markExpired();
          return;
        }
        setFieldErrors(fieldErrorsFrom(apiError));
        if (apiError.status === 409 && apiError.code === "BOOKING_TIME_CONFLICT") {
          setSuggestions(
            Array.isArray(apiError.details.suggestions)
              ? (apiError.details.suggestions as BookingConflictSuggestion[])
              : [],
          );
          setError(`${apiError.message}当前选择已保留，请更换时间或员工。`);
          return;
        }
        throw apiError;
      }
      setResult((await response.json()) as ManagerProxyBookingResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "代客预约建立失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  if (resource.forbidden) {
    return (
      <main className="page-shell manager-proxy-page">
        <section className="manager-fact-state manager-fact-state--forbidden">
          <LockClosedIcon />
          <p className="state-code">403 · 无权限</p>
          <h1>没有代客预约权限</h1>
          <p>仅店长可记录线下同意并执行代客预约。</p>
        </section>
      </main>
    );
  }

  if (result) {
    return (
      <main className="page-shell manager-proxy-page">
        <section className="manager-proxy-success">
          <CheckCircledIcon />
          <p>MG-05 · 创建成功</p>
          <h1>代客预约已建立</h1>
          <span>{result.booking.pet.name}的到店核销码</span>
          <strong>{result.verificationCode}</strong>
          <small>{result.verificationWindow.description}</small>
          <p>
            已记录{result.proxyRecord.manager.displayName}按「
            {result.proxyRecord.offlineConsentSource === "phone"
              ? "电话"
              : result.proxyRecord.offlineConsentSource === "chat"
                ? "聊天"
                : "到店"}
            」确认隐私说明 {result.proxyRecord.privacyNoticeVersion}。
          </p>
          <div>
            <Link
              className="manager-primary-link"
              to={`/manager/appointments/${result.booking.id}`}
            >
              查看预约详情
            </Link>
            <Link className="manager-secondary-link" to="/manager/appointments/list">
              返回预约列表
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell manager-proxy-page">
      <header className="manager-detail-header">
        <Link to="/manager/appointments/list">
          <ChevronLeftIcon /> 返回预约列表
        </Link>
        <div>
          <p>MG-05 · 店长代录</p>
          <h1>代客预约</h1>
          <span>适用于电话、聊天或到店达成的预约</span>
        </div>
      </header>

      {resource.loading && !options ? (
        <section className="manager-booking-list-loading manager-shimmer" role="status">
          正在读取代客预约选项
        </section>
      ) : null}
      {resource.error && !options ? (
        <section className="manager-fact-state manager-fact-state--error" role="alert">
          <strong>代客预约选项暂时无法读取</strong>
          <p>{resource.error}</p>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {options ? (
        <form className="manager-proxy-form" onSubmit={(event) => void submit(event)}>
          <section>
            <header>
              <small>01</small>
              <div>
                <h2>顾客与宠物</h2>
                <p>选用已有档案，或一次补齐新顾客的最小资料。</p>
              </div>
            </header>
            <fieldset className="manager-proxy-profile-switch">
              <legend>档案方式</legend>
              <label>
                <input
                  type="radio"
                  name="profile-kind"
                  checked={draft.profileKind === "existing"}
                  onChange={() => changeDraft({ profileKind: "existing", primaryServiceId: "" })}
                />
                使用已有档案
              </label>
              <label>
                <input
                  type="radio"
                  name="profile-kind"
                  checked={draft.profileKind === "new"}
                  onChange={() => changeDraft({ profileKind: "new", primaryServiceId: "" })}
                />
                新建顾客与宠物
              </label>
            </fieldset>
            {draft.profileKind === "existing" ? (
              <div className="manager-proxy-grid">
                <label>
                  <span>已有顾客</span>
                  <select
                    required
                    value={draft.customerId}
                    onChange={(event) =>
                      changeDraft({
                        customerId: event.target.value,
                        petId: "",
                        primaryServiceId: "",
                      })
                    }
                  >
                    <option value="">请选择顾客</option>
                    {options.customers.map((customer) => (
                      <option value={customer.id} key={customer.id}>
                        {customer.displayName} · {customer.phoneMasked}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.customerId ? (
                    <small role="alert">{fieldErrors.customerId}</small>
                  ) : null}
                </label>
                <label>
                  <span>已有宠物</span>
                  <select
                    required
                    value={draft.petId}
                    onChange={(event) =>
                      changeDraft({ petId: event.target.value, primaryServiceId: "" })
                    }
                  >
                    <option value="">请选择宠物</option>
                    {selectedCustomer?.pets.map((pet) => (
                      <option value={pet.id} key={pet.id}>
                        {pet.name} · {pet.species === "cat" ? "猫" : "犬"} · {pet.weightKg} kg
                      </option>
                    ))}
                  </select>
                  {fieldErrors.petId ? <small role="alert">{fieldErrors.petId}</small> : null}
                </label>
              </div>
            ) : (
              <div className="manager-proxy-grid manager-proxy-grid--profile">
                <label>
                  <span>顾客姓名</span>
                  <input
                    required
                    maxLength={30}
                    value={draft.customerName}
                    onChange={(event) => changeDraft({ customerName: event.target.value })}
                  />
                  {fieldErrors.customerName ? (
                    <small role="alert">{fieldErrors.customerName}</small>
                  ) : null}
                </label>
                <label>
                  <span>顾客手机号</span>
                  <input
                    required
                    inputMode="tel"
                    pattern="1[3-9][0-9]{9}"
                    value={draft.customerPhone}
                    onChange={(event) => changeDraft({ customerPhone: event.target.value })}
                  />
                  {fieldErrors.customerPhone ? (
                    <small role="alert">{fieldErrors.customerPhone}</small>
                  ) : null}
                </label>
                <label>
                  <span>宠物名称</span>
                  <input
                    required
                    maxLength={30}
                    value={draft.petName}
                    onChange={(event) => changeDraft({ petName: event.target.value })}
                  />
                  {fieldErrors.petName ? <small role="alert">{fieldErrors.petName}</small> : null}
                </label>
                <label>
                  <span>宠物种类</span>
                  <select
                    value={draft.petSpecies}
                    onChange={(event) =>
                      changeDraft({
                        petSpecies: event.target.value as "dog" | "cat",
                        primaryServiceId: "",
                      })
                    }
                  >
                    <option value="dog">犬</option>
                    <option value="cat">猫</option>
                  </select>
                  {fieldErrors.petSpecies ? (
                    <small role="alert">{fieldErrors.petSpecies}</small>
                  ) : null}
                </label>
                <label>
                  <span>宠物体重（kg）</span>
                  <input
                    required
                    type="number"
                    min="0.1"
                    max="99.99"
                    step="0.01"
                    value={draft.petWeightKg}
                    onChange={(event) => changeDraft({ petWeightKg: event.target.value })}
                  />
                  {fieldErrors.petWeightKg ? (
                    <small role="alert">{fieldErrors.petWeightKg}</small>
                  ) : null}
                </label>
              </div>
            )}
          </section>

          <section>
            <header>
              <small>02</small>
              <div>
                <h2>服务、时间与员工</h2>
                <p>店长可跳过两小时提前量，其他营业与占用规则仍然生效。</p>
              </div>
            </header>
            <div className="manager-proxy-grid">
              <label>
                <span>主要服务</span>
                <select
                  required
                  value={draft.primaryServiceId}
                  onChange={(event) =>
                    changeDraft({ primaryServiceId: event.target.value, addonIds: [] })
                  }
                >
                  <option value="">请选择服务</option>
                  {services.map((service) => (
                    <option value={service.id} key={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.primaryServiceId ? (
                  <small role="alert">{fieldErrors.primaryServiceId}</small>
                ) : null}
              </label>
              <label>
                <span>执行员工</span>
                <select
                  required
                  value={draft.staffId}
                  onChange={(event) => changeDraft({ staffId: event.target.value })}
                >
                  <option value="">请选择员工</option>
                  {options.staff.map((staff) => (
                    <option value={staff.id} key={staff.id}>
                      {staff.displayName}
                    </option>
                  ))}
                </select>
                {fieldErrors.staffId ? <small role="alert">{fieldErrors.staffId}</small> : null}
              </label>
              <label>
                <span>开始时间</span>
                <input
                  required
                  type="datetime-local"
                  min={isoToShanghaiInput(options.window.earliestStartsAt)}
                  max={`${options.window.endsOn}T23:59`}
                  step="1800"
                  value={draft.startsAt}
                  onChange={(event) => changeDraft({ startsAt: event.target.value })}
                />
                {fieldErrors.startsAt ? <small role="alert">{fieldErrors.startsAt}</small> : null}
              </label>
            </div>
            {addons.length > 0 ? (
              <fieldset className="manager-proxy-addons">
                <legend>可选增项</legend>
                {addons.map((addon) => (
                  <label key={addon.id}>
                    <input
                      type="checkbox"
                      checked={draft.addonIds.includes(addon.id)}
                      onChange={(event) =>
                        changeDraft({
                          addonIds: event.target.checked
                            ? [...draft.addonIds, addon.id]
                            : draft.addonIds.filter((id) => id !== addon.id),
                        })
                      }
                    />
                    {addon.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </section>

          <section>
            <header>
              <small>03</small>
              <div>
                <h2>线下同意留痕</h2>
                <p>系统会保存隐私说明版本、同意来源和执行店长。</p>
              </div>
            </header>
            <div className="manager-proxy-consent">
              <strong>
                {options.privacyNotice.title} · {options.privacyNotice.version}
              </strong>
              <p>{options.privacyNotice.summary}</p>
              <label>
                <span>线下同意来源</span>
                <select
                  required
                  value={draft.offlineConsentSource}
                  onChange={(event) =>
                    changeDraft({
                      offlineConsentSource: event.target.value as ManagerOfflineConsentSource,
                    })
                  }
                >
                  <option value="">请选择来源</option>
                  <option value="phone">电话</option>
                  <option value="chat">聊天</option>
                  <option value="in_store">到店</option>
                </select>
              </label>
              <label className="manager-proxy-consent-check">
                <input
                  type="checkbox"
                  checked={draft.consentConfirmed}
                  onChange={(event) => changeDraft({ consentConfirmed: event.target.checked })}
                />
                已向顾客说明《{options.privacyNotice.title}》（{options.privacyNotice.version}），
                并确认顾客线下同意。
              </label>
            </div>
          </section>

          {error ? (
            <p className="manager-proxy-submit-error" role="alert">
              {error}
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <section className="manager-proxy-suggestions" aria-label="相近可用安排">
              <strong>相近可用安排</strong>
              <div>
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={`${suggestion.staff.id}-${suggestion.startsAt}`}
                    onClick={() =>
                      changeDraft({
                        staffId: suggestion.staff.id,
                        startsAt: isoToShanghaiInput(suggestion.startsAt),
                      })
                    }
                  >
                    {suggestion.staff.displayName} ·{" "}
                    {isoToShanghaiInput(suggestion.startsAt).replace("T", " ")}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <footer>
            <span>提交后将立即发出预约通知并产生核销码。</span>
            <button type="submit" disabled={!draft.consentConfirmed || submitting}>
              {submitting ? "正在建立…" : "建立代客预约"}
            </button>
          </footer>
        </form>
      ) : null}
    </main>
  );
}
