import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ManagerStaffAccount,
  ManagerStaffResponse,
  ManagerStaffSkillColumn,
  StaffSkillId,
} from "@rongguang/contracts";

import { apiFetch, readApiError } from "../../api";
import { useAuth } from "../../auth-context";
import { PageHeading } from "../../page-components";

interface StaffState {
  data: ManagerStaffResponse | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
}

interface AffectedBooking {
  id: string;
  petName: string;
  serviceName: string;
  startsAt: string;
  resolutionPath: string;
}

interface CreationDraft {
  username: string;
  displayName: string;
  demoPassword: string;
  skillIds: StaffSkillId[];
}

const kindLabels: Record<ManagerStaffSkillColumn["kind"], string> = {
  primary_service: "主要服务",
  addon: "增项",
};

const skillLabels: Record<StaffSkillId, string> = {
  "dog-basic-care": "犬基础洗护",
  "dog-styling": "犬造型美容",
  "cat-care": "猫咪洗护",
  "nail-care": "修甲护理",
  "deshedding-care": "除废毛护理",
  "oral-care": "口腔清洁",
};

const allSkillIds = Object.keys(skillLabels) as StaffSkillId[];

function hours(minutes: number): string {
  const value = minutes / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shiftSummary(member: ManagerStaffAccount): string {
  return `未来 14 天 ${member.shiftSummary.publishedShiftCount} 个班次 · ${hours(
    member.shiftSummary.scheduledMinutes,
  )} 小时`;
}

function nextShift(value: string | null): string {
  if (!value) return "暂无后续已发布班次";
  return `下次班次 ${new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value))}`;
}

function formatStartsAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function covers(member: ManagerStaffAccount, column: ManagerStaffSkillColumn): boolean {
  return column.requiredSkillIds.every((skill) => member.skillIds.includes(skill));
}

function toggleSkill(current: StaffSkillId[], skillId: StaffSkillId): StaffSkillId[] {
  return current.includes(skillId)
    ? current.filter((candidate) => candidate !== skillId)
    : [...current, skillId];
}

function SkillChecks({
  legend,
  selected,
  setSelected,
}: {
  legend: string;
  selected: StaffSkillId[];
  setSelected: (skills: StaffSkillId[]) => void;
}): React.JSX.Element {
  return (
    <fieldset className="staff-skill-checks">
      <legend>{legend}</legend>
      <div>
        {allSkillIds.map((skillId) => (
          <label key={skillId}>
            <input
              checked={selected.includes(skillId)}
              type="checkbox"
              onChange={() => setSelected(toggleSkill(selected, skillId))}
            />
            <span>{skillLabels[skillId]}</span>
            <small>{skillId}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function StaffMatrix({
  data,
  editSkills,
  requestDeactivate,
}: {
  data: ManagerStaffResponse;
  editSkills: (member: ManagerStaffAccount) => void;
  requestDeactivate: (member: ManagerStaffAccount, trigger: HTMLButtonElement) => void;
}): React.JSX.Element {
  return (
    <section className="staff-matrix-panel" aria-labelledby="staff-matrix-title">
      <header>
        <div>
          <p>当前技能事实</p>
          <h2 id="staff-matrix-title">员工技能矩阵</h2>
          <span>员工须覆盖预约内主要服务与全部增项所需技能，才会形成可约容量。</span>
        </div>
      </header>
      <div className="staff-matrix-scroll">
        <table className="staff-matrix">
          <thead>
            <tr>
              <th scope="col">员工账号与班次</th>
              {data.skillColumns.map((column) => (
                <th scope="col" key={column.id}>
                  <span>{column.name}</span>
                  <small>
                    {kindLabels[column.kind]}
                    {column.status === "inactive" ? " · 已停用" : ""}
                  </small>
                </th>
              ))}
              <th scope="col">账号操作</th>
            </tr>
          </thead>
          <tbody>
            {data.staff.map((member) => (
              <tr key={member.id} className={member.status === "inactive" ? "is-inactive" : ""}>
                <th scope="row">
                  <span className="staff-matrix-identity">
                    <i aria-hidden="true">{member.displayName.slice(0, 1)}</i>
                    <span>
                      <strong>{member.displayName}</strong>
                      <small>
                        #{member.employeeNumber} · {member.username}
                      </small>
                      <small>{shiftSummary(member)}</small>
                      <small>{nextShift(member.shiftSummary.nextShiftStartsAt)}</small>
                    </span>
                  </span>
                  <span className={`staff-account-status staff-account-status--${member.status}`}>
                    {member.status === "active" ? "在用" : "已停用"}
                  </span>
                </th>
                {data.skillColumns.map((column) => {
                  const covered = covers(member, column);
                  return (
                    <td key={column.id}>
                      <span
                        aria-label={`${member.displayName}${
                          covered ? "具备" : "尚未覆盖"
                        }${column.name}所需全部技能`}
                        className={covered ? "staff-skill-yes" : "staff-skill-no"}
                      >
                        {covered ? "✓" : "—"}
                      </span>
                    </td>
                  );
                })}
                <td>
                  <span className="staff-row-actions">
                    <button
                      aria-label={`编辑${member.displayName}技能`}
                      type="button"
                      disabled={member.status === "inactive"}
                      onClick={() => editSkills(member)}
                    >
                      编辑技能
                    </button>
                    <button
                      aria-label={`停用${member.displayName}账号`}
                      type="button"
                      disabled={member.status === "inactive"}
                      onClick={(event) => requestDeactivate(member, event.currentTarget)}
                    >
                      停用
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SkillEditor({
  member,
  selected,
  saving,
  close,
  save,
  setSelected,
}: {
  member: ManagerStaffAccount;
  selected: StaffSkillId[];
  saving: boolean;
  close: () => void;
  save: () => void;
  setSelected: (skills: StaffSkillId[]) => void;
}): React.JSX.Element {
  return (
    <section className="staff-editor" aria-labelledby="staff-skill-editor-title">
      <header>
        <div>
          <p>技能覆盖</p>
          <h2 id="staff-skill-editor-title">编辑{member.displayName}的技能</h2>
        </div>
        <button type="button" onClick={close}>
          关闭
        </button>
      </header>
      <SkillChecks legend="当前具备技能" selected={selected} setSelected={setSelected} />
      <footer>
        <span>保存后会立即参与新可约时段计算。</span>
        <button className="primary-button" type="button" disabled={saving} onClick={save}>
          {saving ? "正在保存" : `保存${member.displayName}技能`}
        </button>
      </footer>
    </section>
  );
}

function CreationEditor({
  draft,
  fieldErrors,
  saving,
  close,
  save,
  setDraft,
}: {
  draft: CreationDraft;
  fieldErrors: Record<string, string>;
  saving: boolean;
  close: () => void;
  save: () => void;
  setDraft: (next: CreationDraft) => void;
}): React.JSX.Element {
  return (
    <section className="staff-editor" aria-labelledby="staff-creation-title">
      <header>
        <div>
          <p>演示账号</p>
          <h2 id="staff-creation-title">新增员工</h2>
        </div>
        <button type="button" onClick={close}>
          关闭
        </button>
      </header>
      <div className="staff-account-fields">
        <div>
          <label htmlFor="staff-username">演示账号</label>
          <input
            aria-describedby={fieldErrors.username ? "staff-username-error" : undefined}
            autoComplete="off"
            id="staff-username"
            value={draft.username}
            onChange={(event) => setDraft({ ...draft, username: event.currentTarget.value })}
          />
          {fieldErrors.username ? (
            <small id="staff-username-error">{fieldErrors.username}</small>
          ) : null}
        </div>
        <div>
          <label htmlFor="staff-display-name">员工姓名</label>
          <input
            aria-describedby={fieldErrors.displayName ? "staff-name-error" : undefined}
            autoComplete="off"
            id="staff-display-name"
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.currentTarget.value })}
          />
          {fieldErrors.displayName ? (
            <small id="staff-name-error">{fieldErrors.displayName}</small>
          ) : null}
        </div>
        <div>
          <label htmlFor="staff-demo-password">演示密码</label>
          <input
            aria-describedby={fieldErrors.demoPassword ? "staff-password-error" : undefined}
            autoComplete="new-password"
            id="staff-demo-password"
            type="password"
            value={draft.demoPassword}
            onChange={(event) => setDraft({ ...draft, demoPassword: event.currentTarget.value })}
          />
          {fieldErrors.demoPassword ? (
            <small id="staff-password-error">{fieldErrors.demoPassword}</small>
          ) : null}
        </div>
      </div>
      <SkillChecks
        legend="初始技能"
        selected={draft.skillIds}
        setSelected={(skillIds) => setDraft({ ...draft, skillIds })}
      />
      <footer>
        <span>账号固定为员工角色，密码仅用于本地演示登录。</span>
        <button className="primary-button" type="button" disabled={saving} onClick={save}>
          {saving ? "正在创建" : "创建员工账号"}
        </button>
      </footer>
    </section>
  );
}

function DeactivateDialog({
  member,
  saving,
  close,
  confirm,
}: {
  member: ManagerStaffAccount;
  saving: boolean;
  close: () => void;
  confirm: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="staff-dialog-backdrop">
      <div
        ref={dialogRef}
        aria-labelledby="staff-deactivate-title"
        aria-modal="true"
        className="staff-deactivate-dialog"
        role="alertdialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
          if (event.key !== "Tab") return;
          const buttons =
            dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <p>不可逆账号操作</p>
        <h2 id="staff-deactivate-title">停用{member.displayName}账号</h2>
        <span>停用会立即结束该员工的登录会话并移出新预约容量；历史预约仍保留原员工快照。</span>
        <footer>
          <button ref={cancelRef} type="button" disabled={saving} onClick={close}>
            取消
          </button>
          <button className="danger-button" type="button" disabled={saving} onClick={confirm}>
            {saving ? "正在停用" : `确认停用${member.displayName}账号`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ImpactNotice({
  member,
  bookings,
}: {
  member: ManagerStaffAccount;
  bookings: AffectedBooking[];
}): React.JSX.Element {
  return (
    <section className="staff-impact-notice" role="alert">
      <div>
        <p>停用已阻断</p>
        <h2>
          {member.displayName}仍有 {bookings.length} 笔未来预约
        </h2>
        <span>请逐笔换员工、改期或取消，再返回停用账号。</span>
      </div>
      <ul>
        {bookings.map((booking) => (
          <li key={booking.id}>
            <span>
              <strong>
                {booking.petName} · {booking.serviceName}
              </strong>
              <small>{formatStartsAt(booking.startsAt)}</small>
            </span>
            <Link to={booking.resolutionPath}>处理{booking.petName}的预约</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ManagerStaffPage(): React.JSX.Element {
  const { markExpired } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<StaffState>({
    data: null,
    loading: true,
    error: null,
    forbidden: false,
  });
  const [skillEditor, setSkillEditor] = useState<ManagerStaffAccount | null>(null);
  const [skillDraft, setSkillDraft] = useState<StaffSkillId[]>([]);
  const [creationDraft, setCreationDraft] = useState<CreationDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deactivating, setDeactivating] = useState<ManagerStaffAccount | null>(null);
  const [affected, setAffected] = useState<{
    member: ManagerStaffAccount;
    bookings: AffectedBooking[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deactivateTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    async function load(): Promise<void> {
      setState((current) => ({ ...current, loading: current.data === null, error: null }));
      try {
        const response = await apiFetch("/backoffice/manager/staff", {
          signal: abortController.signal,
        });
        if (!response.ok) {
          const error = await readApiError(response);
          if (error.status === 401) {
            markExpired();
            return;
          }
          setState((current) => ({
            data: error.status === 403 ? null : current.data,
            loading: false,
            error: error.message,
            forbidden: error.status === 403,
          }));
          return;
        }
        setState({
          data: (await response.json()) as ManagerStaffResponse,
          loading: false,
          error: null,
          forbidden: false,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "员工与技能读取失败，请稍后重试。",
          }));
        }
      }
    }
    void load();
    return () => abortController.abort();
  }, [attempt, markExpired]);

  function closeDeactivate(): void {
    setDeactivating(null);
    window.setTimeout(() => deactivateTrigger.current?.focus(), 0);
  }

  async function saveSkills(): Promise<void> {
    if (!skillEditor) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await apiFetch(`/backoffice/manager/staff/${skillEditor.id}/skills`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillIds: [...skillDraft].sort() }),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) markExpired();
        else setMessage(error.message);
        return;
      }
      setState({
        data: (await response.json()) as ManagerStaffResponse,
        loading: false,
        error: null,
        forbidden: false,
      });
      setMessage(`${skillEditor.displayName}的技能已保存，新的可约时段会立即使用当前覆盖。`);
      setSkillEditor(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "技能保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function createStaff(): Promise<void> {
    if (!creationDraft) return;
    setSaving(true);
    setMessage(null);
    setFieldErrors({});
    try {
      const response = await apiFetch("/backoffice/manager/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...creationDraft, skillIds: [...creationDraft.skillIds].sort() }),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) markExpired();
        else {
          const errors = error.details.fieldErrors;
          if (errors && typeof errors === "object")
            setFieldErrors(errors as Record<string, string>);
          setMessage(error.message);
        }
        return;
      }
      const data = (await response.json()) as ManagerStaffResponse;
      setState({ data, loading: false, error: null, forbidden: false });
      const created = data.staff.find((member) => member.username === creationDraft.username);
      setMessage(`${created?.displayName ?? creationDraft.displayName}的员工账号已创建。`);
      setCreationDraft(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "员工账号创建失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateStaff(): Promise<void> {
    if (!deactivating) return;
    const member = deactivating;
    setSaving(true);
    setMessage(null);
    setAffected(null);
    try {
      const response = await apiFetch(`/backoffice/manager/staff/${member.id}/deactivate`, {
        method: "POST",
      });
      if (!response.ok) {
        const error = await readApiError(response);
        if (error.status === 401) markExpired();
        else if (error.status === 409 && error.code === "STAFF_HAS_FUTURE_BOOKINGS") {
          const bookings = error.details.affectedBookings;
          if (Array.isArray(bookings))
            setAffected({ member, bookings: bookings as AffectedBooking[] });
          setMessage(error.message);
          closeDeactivate();
        } else setMessage(error.message);
        return;
      }
      setState({
        data: (await response.json()) as ManagerStaffResponse,
        loading: false,
        error: null,
        forbidden: false,
      });
      setMessage(`${member.displayName}的账号已停用，当前登录会话已失效。`);
      closeDeactivate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号停用失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page-shell staff-management-page">
      <PageHeading
        copy={{
          eyebrow: "MG-13 · 店长员工管理",
          title: "员工与技能",
          description: "维护员工账号、未来班次概览，以及主要服务和增项的技能覆盖。",
        }}
        badge="仅店长可写"
      />
      <div className="staff-management-toolbar">
        <nav className="staff-management-tabs" aria-label="服务管理页面">
          <Link to="/manager/services">服务目录</Link>
          <Link aria-current="page" to="/manager/services/staff">
            员工与技能
          </Link>
        </nav>
        <button
          className="primary-button"
          type="button"
          disabled={!state.data}
          onClick={() => {
            setCreationDraft({ username: "", displayName: "", demoPassword: "", skillIds: [] });
            setSkillEditor(null);
            setFieldErrors({});
            setMessage(null);
          }}
        >
          新增员工
        </button>
      </div>

      {state.loading ? (
        <section className="staff-management-state" aria-label="正在读取员工与技能">
          <span className="state-spinner" aria-hidden="true" />
          <h2>正在读取员工账号与技能矩阵</h2>
        </section>
      ) : null}
      {!state.loading && !state.data && state.error ? (
        <section className="staff-management-state staff-management-state--error" role="alert">
          <p>{state.forbidden ? "403" : "读取失败"}</p>
          <h2>{state.forbidden ? "没有权限管理员工账号" : "员工与技能暂时不可用"}</h2>
          <span>{state.error}</span>
          {!state.forbidden ? (
            <button type="button" onClick={() => setAttempt((current) => current + 1)}>
              重试读取
            </button>
          ) : null}
        </section>
      ) : null}
      {message ? (
        <p className="staff-management-message" role="status">
          {message}
        </p>
      ) : null}
      {creationDraft ? (
        <CreationEditor
          draft={creationDraft}
          fieldErrors={fieldErrors}
          saving={saving}
          close={() => setCreationDraft(null)}
          save={() => void createStaff()}
          setDraft={setCreationDraft}
        />
      ) : null}
      {skillEditor ? (
        <SkillEditor
          member={skillEditor}
          selected={skillDraft}
          saving={saving}
          close={() => setSkillEditor(null)}
          save={() => void saveSkills()}
          setSelected={setSkillDraft}
        />
      ) : null}
      {affected ? <ImpactNotice member={affected.member} bookings={affected.bookings} /> : null}
      {state.data ? (
        <StaffMatrix
          data={state.data}
          editSkills={(member) => {
            setSkillEditor(member);
            setSkillDraft([...member.skillIds]);
            setCreationDraft(null);
            setMessage(null);
          }}
          requestDeactivate={(member, trigger) => {
            deactivateTrigger.current = trigger;
            setDeactivating(member);
            setAffected(null);
            setMessage(null);
          }}
        />
      ) : null}
      {deactivating ? (
        <DeactivateDialog
          member={deactivating}
          saving={saving}
          close={closeDeactivate}
          confirm={() => void deactivateStaff()}
        />
      ) : null}
    </main>
  );
}
