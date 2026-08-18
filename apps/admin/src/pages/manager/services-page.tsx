import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ManagerPrimaryService,
  ManagerServiceAddon,
  ManagerServiceCatalogResponse,
  PetSize,
  PetSpecies,
  StaffSkillId,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { PageHeading } from "../../page-components";

const speciesLabels: Record<PetSpecies, string> = { dog: "犬", cat: "猫" };
const sizeLabels: Record<PetSize, string> = { small: "小型", medium: "中型", large: "大型" };
const sizes: PetSize[] = ["small", "medium", "large"];
const skillLabels: Record<StaffSkillId, string> = {
  "dog-basic-care": "犬基础洗护",
  "dog-styling": "犬造型美容",
  "cat-care": "猫咪洗护",
  "nail-care": "修甲护理",
  "deshedding-care": "除废毛护理",
  "oral-care": "口腔清洁",
};
const skills = Object.keys(skillLabels) as StaffSkillId[];

type CatalogItem = ManagerPrimaryService | ManagerServiceAddon;
type EditorKind = "primary" | "addon";

interface CatalogState {
  data: ManagerServiceCatalogResponse | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
}

interface SpecificationDraft {
  existing: boolean;
  enabled: boolean;
  priceYuan: string;
  durationMinutes: string;
}

interface EditorDraft {
  name: string;
  description: string;
  applicableSpecies: PetSpecies[];
  requiredSkillIds: StaffSkillId[];
  availableAddonIds: string[];
  specifications: Record<PetSize, SpecificationDraft>;
}

interface EditorState {
  kind: EditorKind;
  itemId: string | null;
  draft: EditorDraft;
}

function emptySpecifications(): Record<PetSize, SpecificationDraft> {
  return {
    small: { existing: false, enabled: true, priceYuan: "", durationMinutes: "" },
    medium: { existing: false, enabled: false, priceYuan: "", durationMinutes: "" },
    large: { existing: false, enabled: false, priceYuan: "", durationMinutes: "" },
  };
}

function newDraft(kind: EditorKind): EditorDraft {
  return {
    name: "",
    description: "",
    applicableSpecies: ["dog"],
    requiredSkillIds: [kind === "primary" ? "dog-basic-care" : "nail-care"],
    availableAddonIds: [],
    specifications: emptySpecifications(),
  };
}

function itemDraft(item: CatalogItem): EditorDraft {
  const specifications = emptySpecifications();
  for (const specification of item.specifications) {
    specifications[specification.petSize] = {
      existing: true,
      enabled: specification.status === "active",
      priceYuan: String(specification.priceCents / 100),
      durationMinutes: String(specification.durationMinutes),
    };
  }
  return {
    name: item.name,
    description: item.description,
    applicableSpecies: [...item.applicableSpecies],
    requiredSkillIds: [...item.requiredSkillIds],
    availableAddonIds: "availableAddonIds" in item ? [...item.availableAddonIds] : [],
    specifications,
  };
}

function toggleValue<T>(values: T[], value: T, checked: boolean): T[] {
  return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
}

function money(priceCents: number): string {
  return `¥${(priceCents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function CatalogLoading(): React.JSX.Element {
  return (
    <section className="service-catalog-loading" role="status" aria-label="正在读取服务目录">
      <div className="service-catalog-shimmer service-catalog-loading__toolbar" />
      <div className="service-catalog-layout">
        <div className="service-catalog-shimmer service-catalog-loading__card" />
        <div className="service-catalog-shimmer service-catalog-loading__card" />
      </div>
    </section>
  );
}

function CatalogInitialState({
  forbidden,
  message,
  retry,
}: {
  forbidden: boolean;
  message: string;
  retry: () => void;
}): React.JSX.Element {
  return (
    <section className="service-catalog-state" role="alert">
      <p className="state-code">{forbidden ? "403 · 无权限" : "目录读取失败"}</p>
      <h2>{forbidden ? "没有权限管理服务目录" : "暂时无法读取服务目录"}</h2>
      <p>{message}</p>
      {!forbidden ? (
        <button className="primary-button" type="button" onClick={retry}>
          重新读取
        </button>
      ) : null}
    </section>
  );
}

function StatusFacts({ item }: { item: CatalogItem }): React.JSX.Element {
  return (
    <span className="service-status-facts">
      <span
        className={
          item.status === "active"
            ? "service-status service-status--active"
            : "service-status service-status--inactive"
        }
      >
        {item.status === "active" ? "在用" : "已停用"}
      </span>
      {item.referencedByBookings ? <span>历史预约引用</span> : <span>暂无历史引用</span>}
    </span>
  );
}

function SpecificationList({ item }: { item: CatalogItem }): React.JSX.Element {
  return (
    <div className="service-specification-list">
      <h4>服务规格</h4>
      {item.specifications.length > 0 ? (
        item.specifications.map((specification) => (
          <div
            className={`service-specification-row${
              specification.status === "inactive" ? " service-specification-row--inactive" : ""
            }`}
            key={specification.id}
          >
            <span>
              {sizeLabels[specification.petSize]} · {money(specification.priceCents)} ·{" "}
              {specification.durationMinutes} 分钟
            </span>
            <small>
              {[
                specification.status === "inactive" ? "已停用" : null,
                specification.referencedByBookings ? "历史引用" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "新预约可用"}
            </small>
          </div>
        ))
      ) : (
        <p className="service-card-empty">没有启用的服务规格</p>
      )}
    </div>
  );
}

function SkillChips({ item }: { item: CatalogItem }): React.JSX.Element {
  return (
    <div className="service-card-section">
      <h4>员工技能要求</h4>
      <div className="service-chip-row">
        {item.requiredSkillIds.map((skill) => (
          <span className="service-skill-chip" key={skill}>
            {skillLabels[skill]}
          </span>
        ))}
      </div>
    </div>
  );
}

function PrimaryServiceCard({
  addons,
  edit,
  item,
  requestDeactivate,
}: {
  addons: ManagerServiceAddon[];
  edit: () => void;
  item: ManagerPrimaryService;
  requestDeactivate: (trigger: HTMLButtonElement) => void;
}): React.JSX.Element {
  const compatibleAddons = item.availableAddonIds
    .map((id) => addons.find((addon) => addon.id === id))
    .filter((addon): addon is ManagerServiceAddon => Boolean(addon));
  return (
    <article
      className="service-catalog-card"
      aria-label={`主要服务 ${item.name}`}
      data-catalog-item-id={item.id}
    >
      <header>
        <div>
          <p className="service-card-kicker">主要服务</p>
          <h3>{item.name}</h3>
          <p>{item.description || "暂未填写服务说明"}</p>
        </div>
        <StatusFacts item={item} />
      </header>
      <p className="service-species">
        适用：{item.applicableSpecies.map((value) => speciesLabels[value]).join(" / ")}
      </p>
      <SpecificationList item={item} />
      <SkillChips item={item} />
      <div className="service-card-section">
        <h4>可连续完成的增项</h4>
        <div className="service-chip-row">
          {compatibleAddons.length > 0 ? (
            compatibleAddons.map((addon) => <span key={addon.id}>{addon.name}</span>)
          ) : (
            <span className="service-card-muted">未关联增项</span>
          )}
        </div>
      </div>
      <footer>
        <button type="button" onClick={edit}>
          编辑{item.name}
        </button>
        {item.status === "active" ? (
          <button
            className="service-danger-button"
            type="button"
            onClick={(event) => requestDeactivate(event.currentTarget)}
          >
            停用{item.name}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function AddonCard({
  edit,
  item,
  requestDeactivate,
}: {
  edit: () => void;
  item: ManagerServiceAddon;
  requestDeactivate: (trigger: HTMLButtonElement) => void;
}): React.JSX.Element {
  return (
    <article
      className="service-catalog-card service-catalog-card--addon"
      aria-label={`增项 ${item.name}`}
      data-catalog-item-id={item.id}
    >
      <header>
        <div>
          <p className="service-card-kicker">增项</p>
          <h3>{item.name}</h3>
          <p>{item.description || "暂未填写增项说明"}</p>
        </div>
        <StatusFacts item={item} />
      </header>
      <p className="service-species">
        适用：{item.applicableSpecies.map((value) => speciesLabels[value]).join(" / ")}
      </p>
      <SpecificationList item={item} />
      <SkillChips item={item} />
      <footer>
        <button type="button" onClick={edit}>
          编辑{item.name}
        </button>
        {item.status === "active" ? (
          <button
            className="service-danger-button"
            type="button"
            onClick={(event) => requestDeactivate(event.currentTarget)}
          >
            停用{item.name}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

function ServiceEditor({
  catalog,
  close,
  editor,
  fieldErrors,
  save,
  saving,
  setEditor,
}: {
  catalog: ManagerServiceCatalogResponse;
  close: () => void;
  editor: EditorState;
  fieldErrors: Record<string, string>;
  save: () => void;
  saving: boolean;
  setEditor: React.Dispatch<React.SetStateAction<EditorState | null>>;
}): React.JSX.Element {
  const setDraft = (change: (draft: EditorDraft) => EditorDraft) => {
    setEditor((current) => (current ? { ...current, draft: change(current.draft) } : current));
  };
  const title = `${editor.itemId ? "编辑" : "新建"}${editor.kind === "primary" ? "主要服务" : "增项"}`;
  const enabledSpecifications = sizes.filter((size) => editor.draft.specifications[size].enabled);
  return (
    <section className="service-editor" aria-label={title}>
      <header>
        <div>
          <p className="service-card-kicker">MG-12 · 配置表单</p>
          <h2>{title}</h2>
          <p>价格以人民币填写，服务时长不包含门店另预留的周转时间。</p>
        </div>
        <button type="button" onClick={close}>
          关闭表单
        </button>
      </header>
      <div className="service-editor-grid">
        <label className="service-editor-field">
          <span>名称</span>
          <input
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "service-name-error" : undefined}
            value={editor.draft.name}
            onChange={(event) => setDraft((draft) => ({ ...draft, name: event.target.value }))}
          />
          {fieldErrors.name ? (
            <small id="service-name-error" role="alert">
              {fieldErrors.name}
            </small>
          ) : null}
        </label>
        <label className="service-editor-field service-editor-field--wide">
          <span>说明</span>
          <textarea
            aria-label="说明"
            aria-invalid={Boolean(fieldErrors.description)}
            aria-describedby={fieldErrors.description ? "service-description-error" : undefined}
            value={editor.draft.description}
            onChange={(event) =>
              setDraft((draft) => ({ ...draft, description: event.target.value }))
            }
          />
          {fieldErrors.description ? (
            <small id="service-description-error" role="alert">
              {fieldErrors.description}
            </small>
          ) : null}
        </label>
      </div>

      <fieldset
        aria-describedby={
          fieldErrors.applicableSpecies ? "service-applicable-species-error" : undefined
        }
      >
        <legend>适用犬猫</legend>
        <div className="service-editor-checks">
          {(["dog", "cat"] as PetSpecies[]).map((species) => (
            <label key={species}>
              <input
                type="checkbox"
                checked={editor.draft.applicableSpecies.includes(species)}
                onChange={(event) =>
                  setDraft((draft) => ({
                    ...draft,
                    applicableSpecies: toggleValue(
                      draft.applicableSpecies,
                      species,
                      event.target.checked,
                    ),
                  }))
                }
              />
              适用{speciesLabels[species]}
            </label>
          ))}
        </div>
        {fieldErrors.applicableSpecies ? (
          <small id="service-applicable-species-error" role="alert">
            {fieldErrors.applicableSpecies}
          </small>
        ) : null}
      </fieldset>

      <fieldset
        aria-describedby={fieldErrors.requiredSkillIds ? "service-skills-error" : undefined}
      >
        <legend>员工技能要求</legend>
        <div className="service-editor-checks service-editor-checks--skills">
          {skills.map((skill) => (
            <label key={skill}>
              <input
                type="checkbox"
                checked={editor.draft.requiredSkillIds.includes(skill)}
                onChange={(event) =>
                  setDraft((draft) => ({
                    ...draft,
                    requiredSkillIds: toggleValue(
                      draft.requiredSkillIds,
                      skill,
                      event.target.checked,
                    ),
                  }))
                }
              />
              技能：{skillLabels[skill]}
            </label>
          ))}
        </div>
        {fieldErrors.requiredSkillIds ? (
          <small id="service-skills-error" role="alert">
            {fieldErrors.requiredSkillIds}
          </small>
        ) : null}
      </fieldset>

      <fieldset
        aria-describedby={fieldErrors.specifications ? "service-specifications-error" : undefined}
      >
        <legend>服务规格</legend>
        <div className="service-editor-specifications">
          {sizes.map((size) => {
            const specification = editor.draft.specifications[size];
            return (
              <div className="service-editor-specification" key={size}>
                <label>
                  <input
                    type="checkbox"
                    checked={specification.enabled}
                    onChange={(event) =>
                      setDraft((draft) => ({
                        ...draft,
                        specifications: {
                          ...draft.specifications,
                          [size]: {
                            ...draft.specifications[size],
                            enabled: event.target.checked,
                          },
                        },
                      }))
                    }
                  />
                  启用{sizeLabels[size]}规格
                </label>
                <label>
                  <span>{sizeLabels[size]}价格（元）</span>
                  <input
                    type="number"
                    step="0.01"
                    aria-invalid={Boolean(fieldErrors.specifications)}
                    aria-describedby={
                      fieldErrors.specifications ? "service-specifications-error" : undefined
                    }
                    disabled={!specification.enabled && !specification.existing}
                    value={specification.priceYuan}
                    onChange={(event) =>
                      setDraft((draft) => ({
                        ...draft,
                        specifications: {
                          ...draft.specifications,
                          [size]: {
                            ...draft.specifications[size],
                            priceYuan: event.target.value,
                          },
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{sizeLabels[size]}服务分钟数</span>
                  <input
                    type="number"
                    step="5"
                    aria-invalid={Boolean(fieldErrors.specifications)}
                    aria-describedby={
                      fieldErrors.specifications ? "service-specifications-error" : undefined
                    }
                    disabled={!specification.enabled && !specification.existing}
                    value={specification.durationMinutes}
                    onChange={(event) =>
                      setDraft((draft) => ({
                        ...draft,
                        specifications: {
                          ...draft.specifications,
                          [size]: {
                            ...draft.specifications[size],
                            durationMinutes: event.target.value,
                          },
                        },
                      }))
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
        {fieldErrors.specifications ? (
          <small id="service-specifications-error" role="alert">
            {fieldErrors.specifications}
          </small>
        ) : null}
      </fieldset>

      {editor.kind === "primary" ? (
        <fieldset
          aria-describedby={
            fieldErrors.availableAddonIds ? "service-available-addons-error" : undefined
          }
        >
          <legend>关联增项</legend>
          <div className="service-editor-checks">
            {catalog.addons
              .filter((addon) => addon.status === "active")
              .map((addon) => (
                <label key={addon.id}>
                  <input
                    type="checkbox"
                    checked={editor.draft.availableAddonIds.includes(addon.id)}
                    onChange={(event) =>
                      setDraft((draft) => ({
                        ...draft,
                        availableAddonIds: toggleValue(
                          draft.availableAddonIds,
                          addon.id,
                          event.target.checked,
                        ),
                      }))
                    }
                  />
                  关联{addon.name}
                </label>
              ))}
          </div>
          {fieldErrors.availableAddonIds ? (
            <small id="service-available-addons-error" role="alert">
              {fieldErrors.availableAddonIds}
            </small>
          ) : null}
        </fieldset>
      ) : null}

      {fieldErrors.form ? (
        <p className="service-editor-error" role="alert">
          {fieldErrors.form}
        </p>
      ) : null}
      <aside className="service-editor-summary" aria-live="polite">
        <strong>变更后摘要</strong>
        <span>
          适用
          {editor.draft.applicableSpecies.map((species) => speciesLabels[species]).join(" / ") ||
            "未选择"}
          {" · "}
          {editor.draft.requiredSkillIds.length} 项技能
          {editor.kind === "primary"
            ? ` · ${editor.draft.availableAddonIds.length} 个关联增项`
            : ""}
        </span>
        <span>
          {enabledSpecifications.length > 0
            ? enabledSpecifications
                .map((size) => {
                  const specification = editor.draft.specifications[size];
                  return `${sizeLabels[size]} ${money(
                    Math.round(Number(specification.priceYuan || 0) * 100),
                  )} · ${specification.durationMinutes || "—"} 分钟`;
                })
                .join("；")
            : "尚未启用服务规格"}
        </span>
      </aside>
      <footer>
        <button type="button" onClick={close}>
          取消
        </button>
        <button className="primary-button" type="button" disabled={saving} onClick={save}>
          {saving ? "正在保存…" : "保存服务配置"}
        </button>
      </footer>
    </section>
  );
}

function DeactivateConfirmation({
  cancel,
  confirm,
  item,
  saving,
}: {
  cancel: () => void;
  confirm: () => void;
  item: CatalogItem;
  saving: boolean;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  function trapFocus(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [
      ...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].filter((button) => !button.disabled);
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <section
      aria-label={`停用${item.name}`}
      aria-modal="true"
      className="service-deactivate-confirmation"
      onKeyDown={trapFocus}
      ref={dialogRef}
      role="alertdialog"
    >
      <div>
        <strong>确认停用{item.name}？</strong>
        <span>新预约将立即不可选；已有预约继续显示保存时的名称、价格和时长。</span>
      </div>
      <span>
        <button ref={cancelButtonRef} type="button" onClick={cancel}>
          取消
        </button>
        <button className="service-danger-button" type="button" disabled={saving} onClick={confirm}>
          确认停用{item.name}
        </button>
      </span>
    </section>
  );
}

export function ManagerServicesPage(): React.JSX.Element {
  const { markExpired } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CatalogState>({
    data: null,
    loading: true,
    error: null,
    forbidden: false,
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<CatalogItem | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [concurrencyMessage, setConcurrencyMessage] = useState<string | null>(null);
  const deactivateTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    async function load(): Promise<void> {
      setState((current) => ({ ...current, loading: current.data === null, error: null }));
      try {
        const response = await apiFetch("/backoffice/manager/service-catalog", {
          signal: abortController.signal,
        });
        if (!response.ok) {
          const error = await readApiError(response);
          if (error.status === 401) {
            markExpired();
            return;
          }
          setState((current) =>
            error.status === 403
              ? { data: null, loading: false, error: error.message, forbidden: true }
              : { ...current, loading: false, error: error.message, forbidden: false },
          );
          return;
        }
        const data = (await response.json()) as ManagerServiceCatalogResponse;
        setState({ data, loading: false, error: null, forbidden: false });
        setConcurrencyMessage(null);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "服务目录读取失败，请稍后重试。",
            forbidden: false,
          }));
        }
      }
    }
    void load();
    return () => abortController.abort();
  }, [attempt, markExpired]);

  const refresh = () => setAttempt((current) => current + 1);

  function requestDeactivate(item: CatalogItem, trigger: HTMLButtonElement): void {
    deactivateTriggerRef.current = trigger;
    setDeactivating(item);
  }

  function closeDeactivate(): void {
    const itemId = deactivating?.id;
    const trigger = deactivateTriggerRef.current;
    setDeactivating(null);
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
      else if (itemId) {
        document.querySelector<HTMLElement>(`[data-catalog-item-id="${itemId}"] button`)?.focus();
      }
    });
  }

  function openEditor(kind: EditorKind, item?: CatalogItem): void {
    setFieldErrors({});
    setMutationMessage(null);
    setEditor({ kind, itemId: item?.id ?? null, draft: item ? itemDraft(item) : newDraft(kind) });
  }

  async function save(): Promise<void> {
    if (!editor || !state.data) return;
    setSaving(true);
    setFieldErrors({});
    setMutationMessage(null);
    const isPrimary = editor.kind === "primary";
    const collection = isPrimary ? "primary-services" : "addons";
    const path = editor.itemId
      ? `/backoffice/manager/service-catalog/${collection}/${editor.itemId}`
      : `/backoffice/manager/service-catalog/${collection}`;
    const specifications = sizes.flatMap((size) => {
      const specification = editor.draft.specifications[size];
      if (!specification.enabled && !specification.existing) return [];
      return [
        {
          petSize: size,
          priceCents: Math.round(Number(specification.priceYuan) * 100),
          durationMinutes: Number(specification.durationMinutes),
          active: specification.enabled,
        },
      ];
    });
    try {
      const response = await apiFetch(path, {
        method: editor.itemId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: state.data.revision,
          name: editor.draft.name,
          description: editor.draft.description,
          applicableSpecies: editor.draft.applicableSpecies,
          requiredSkillIds: editor.draft.requiredSkillIds,
          ...(isPrimary ? { availableAddonIds: editor.draft.availableAddonIds } : {}),
          specifications,
        }),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) {
          markExpired();
          return;
        }
        if (error.status === 409) {
          setConcurrencyMessage(error.message);
          return;
        }
        const errors = error.details.fieldErrors;
        setFieldErrors(
          isRecord(errors) ? (errors as Record<string, string>) : { form: error.message },
        );
        return;
      }
      const data = (await response.json()) as ManagerServiceCatalogResponse;
      setState({ data, loading: false, error: null, forbidden: false });
      setMutationMessage(editor.itemId ? "服务配置已保存" : "服务配置已创建");
      setEditor(null);
    } catch (error) {
      setFieldErrors({ form: error instanceof Error ? error.message : "服务配置保存失败。" });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeactivate(): Promise<void> {
    if (!deactivating || !state.data) return;
    setSaving(true);
    const collection = "availableAddonIds" in deactivating ? "primary-services" : "addons";
    try {
      const response = await apiFetch(
        `/backoffice/manager/service-catalog/${collection}/${deactivating.id}/deactivate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: state.data.revision }),
        },
      );
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) {
          markExpired();
          return;
        }
        if (error.status === 409) setConcurrencyMessage(error.message);
        else setMutationMessage(error.message);
        return;
      }
      const data = (await response.json()) as ManagerServiceCatalogResponse;
      setState({ data, loading: false, error: null, forbidden: false });
      setMutationMessage(`${deactivating.name}已停用；历史预约仍显示原快照。`);
      closeDeactivate();
    } catch (error) {
      setMutationMessage(error instanceof Error ? error.message : "停用失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell service-catalog-page">
      <PageHeading
        copy={{
          eyebrow: "MG-12 · 店长服务管理",
          title: "服务目录",
          description: "维护主要服务、确定规格、兼容增项与员工技能要求。",
        }}
        badge="仅店长可写"
      />
      <nav className="staff-management-tabs" aria-label="服务管理页面">
        <Link aria-current="page" to="/manager/services">
          服务目录
        </Link>
        <Link to="/manager/services/staff">员工与技能</Link>
      </nav>

      {state.loading ? <CatalogLoading /> : null}
      {!state.loading && !state.data && state.error ? (
        <CatalogInitialState forbidden={state.forbidden} message={state.error} retry={refresh} />
      ) : null}
      {state.data ? (
        <>
          <section className="service-catalog-toolbar">
            <div>
              <strong>保存后仅影响新预约，已有预约保留快照</strong>
              <span>目录版本 {state.data.revision} · 停用项目不会从历史详情消失</span>
            </div>
            <span className="service-catalog-toolbar__actions">
              <button type="button" onClick={() => openEditor("addon")}>
                新建增项
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => openEditor("primary")}
              >
                新建主要服务
              </button>
            </span>
          </section>

          {concurrencyMessage ? (
            <div className="service-catalog-conflict" role="alert">
              <span>
                <strong>{concurrencyMessage}</strong>
                <small>当前页面未覆盖任何人的配置。</small>
              </span>
              <button type="button" onClick={refresh}>
                读取最新目录
              </button>
            </div>
          ) : null}
          {state.error ? (
            <div className="service-catalog-query-error" role="alert">
              <span>
                <strong>最新目录读取失败</strong>
                <small>{state.error} 已保留当前显示内容。</small>
              </span>
              <button type="button" onClick={refresh}>
                重试读取
              </button>
            </div>
          ) : null}
          {mutationMessage ? (
            <p className="service-catalog-message" role="status">
              {mutationMessage}
            </p>
          ) : null}

          {editor ? (
            <ServiceEditor
              catalog={state.data}
              close={() => setEditor(null)}
              editor={editor}
              fieldErrors={fieldErrors}
              save={() => void save()}
              saving={saving}
              setEditor={setEditor}
            />
          ) : null}

          {deactivating ? (
            <DeactivateConfirmation
              cancel={closeDeactivate}
              confirm={() => void confirmDeactivate()}
              item={deactivating}
              saving={saving}
            />
          ) : null}

          {state.data.primaryServices.length === 0 && state.data.addons.length === 0 ? (
            <section className="service-catalog-state service-catalog-state--empty">
              <p className="state-code">空目录</p>
              <h2>服务目录还是空的</h2>
              <p>先创建增项或主要服务，并为每项至少填写一个确定规格。</p>
              <button
                className="primary-button"
                type="button"
                onClick={() => openEditor("primary")}
              >
                新建主要服务
              </button>
            </section>
          ) : (
            <div className="service-catalog-layout">
              <section className="service-catalog-column" aria-label="主要服务与规格">
                <header>
                  <div>
                    <p className="service-card-kicker">主要服务</p>
                    <h2>主要服务与确定规格</h2>
                  </div>
                  <span>{state.data.primaryServices.length} 项</span>
                </header>
                {state.data.primaryServices.map((item) => (
                  <PrimaryServiceCard
                    addons={state.data?.addons ?? []}
                    edit={() => openEditor("primary", item)}
                    item={item}
                    key={item.id}
                    requestDeactivate={(trigger) => requestDeactivate(item, trigger)}
                  />
                ))}
              </section>
              <section className="service-catalog-column" aria-label="增项目录">
                <header>
                  <div>
                    <p className="service-card-kicker">增项</p>
                    <h2>同一员工连续完成</h2>
                  </div>
                  <span>{state.data.addons.length} 项</span>
                </header>
                {state.data.addons.map((item) => (
                  <AddonCard
                    edit={() => openEditor("addon", item)}
                    item={item}
                    key={item.id}
                    requestDeactivate={(trigger) => requestDeactivate(item, trigger)}
                  />
                ))}
              </section>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
