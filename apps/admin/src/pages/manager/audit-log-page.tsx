import type { FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { ManagerAuditListResponse, ManagerAuditRecord } from "@rongguang/contracts";

import { useBackofficeResource } from "../../backoffice-resource";
import { PageHeading } from "../../page-components";
import { SystemPageLinks } from "./system-page-links";
import "./audit-log-page.css";

function formatAuditTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function AuditRows({ records }: { records: ManagerAuditRecord[] }): React.JSX.Element {
  return (
    <>
      <div className="audit-record-head" aria-hidden="true">
        <span>时间</span>
        <span>操作者</span>
        <span>对象</span>
        <span>动作</span>
        <span>安全变化摘要</span>
      </div>
      <div className="audit-records" role="list" aria-label="审计事实">
        {records.map((record) => (
          <article className="audit-record" role="listitem" key={record.id}>
            <time dateTime={record.occurredAt}>{formatAuditTime(record.occurredAt)}</time>
            <div>
              <strong>{record.actor.label}</strong>
              <small>{record.actor.id}</small>
            </div>
            <div>
              <strong>{record.subject.label}</strong>
              <small>{record.subject.type}</small>
            </div>
            <div>
              <strong>{record.action.label}</strong>
              <small>{record.action.type}</small>
            </div>
            <ul aria-label="安全变化摘要">
              {record.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </>
  );
}

export function ManagerAuditLogPage(): React.JSX.Element {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const resource = useBackofficeResource<ManagerAuditListResponse>(
    `/backoffice/manager/audits${location.search}`,
    "审计事实暂时无法读取，请稍后重试。",
  );
  const data = resource.data;
  const selectedActor = searchParams.get("actor") ?? "";
  const selectedAction = searchParams.get("action") ?? "";
  const selectedSubjectType = searchParams.get("subjectType") ?? "";
  const hasFilters = ["actor", "action", "subjectType", "subjectId", "from", "to"].some((key) =>
    Boolean(searchParams.get(key)),
  );

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ["actor", "action", "subjectType", "subjectId", "from", "to"] as const) {
      const value = String(form.get(key) ?? "").trim();
      if (value) next.set(key, value);
    }
    next.set("page", "1");
    setSearchParams(next);
  }

  function goToPage(page: number): void {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    setSearchParams(next);
  }

  return (
    <main className="page-shell audit-page">
      <PageHeading
        copy={{
          eyebrow: "MG-16 · 系统与审计",
          title: "审计记录",
          description: "按操作者、动作、对象和上海日期查看重要业务变化与敏感读取。",
        }}
        badge="不可修改事实"
      />

      <SystemPageLinks />

      <form className="audit-filters" key={searchParams.toString()} onSubmit={applyFilters}>
        <label>
          <span>操作者</span>
          <select
            key={`${selectedActor}:${data ? "ready" : "loading"}`}
            name="actor"
            aria-label="操作者"
            defaultValue={selectedActor}
          >
            <option value="">全部操作者</option>
            {data?.filterOptions.actors.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>动作类型</span>
          <select
            key={`${selectedAction}:${data ? "ready" : "loading"}`}
            name="action"
            aria-label="动作类型"
            defaultValue={selectedAction}
          >
            <option value="">全部动作</option>
            {data?.filterOptions.actions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>对象类型</span>
          <select
            key={`${selectedSubjectType}:${data ? "ready" : "loading"}`}
            name="subjectType"
            aria-label="对象类型"
            defaultValue={selectedSubjectType}
          >
            <option value="">全部对象</option>
            {data?.filterOptions.subjectTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>对象编号</span>
          <input
            name="subjectId"
            aria-label="对象编号"
            defaultValue={searchParams.get("subjectId") ?? ""}
            placeholder="输入完整编号"
          />
        </label>
        <label>
          <span>开始日期</span>
          <input
            name="from"
            type="date"
            aria-label="开始日期"
            defaultValue={searchParams.get("from") ?? ""}
          />
        </label>
        <label>
          <span>结束日期</span>
          <input
            name="to"
            type="date"
            aria-label="结束日期"
            defaultValue={searchParams.get("to") ?? ""}
          />
        </label>
        <button type="submit">应用筛选</button>
      </form>

      {resource.loading && !data ? <p className="audit-state">正在读取审计事实…</p> : null}
      {resource.error && !data ? (
        <section className="audit-state" role="alert">
          <h2>{resource.error}</h2>
          <button type="button" onClick={resource.refresh}>
            重新读取
          </button>
        </section>
      ) : null}
      {data ? (
        <section className="audit-log-panel" aria-labelledby="audit-results-title">
          <header>
            <div>
              <p>只读审计事实</p>
              <h2 id="audit-results-title">记录结果</h2>
            </div>
            <div className="audit-result-actions">
              <span>{data.pagination.totalItems} 条</span>
              <button type="button" disabled={resource.refreshing} onClick={resource.refresh}>
                {resource.refreshing ? "正在刷新…" : "刷新记录"}
              </button>
            </div>
          </header>
          {resource.error ? (
            <div className="audit-inline-error" role="alert">
              <span>{resource.error}</span>
              <button type="button" onClick={resource.refresh}>
                重试
              </button>
            </div>
          ) : null}
          {data.records.length > 0 ? (
            <AuditRows records={data.records} />
          ) : (
            <div className="audit-state">
              <h3>{hasFilters ? "筛选条件下没有记录" : "当前没有审计记录"}</h3>
              <p>重要业务变化和敏感读取发生后会在这里形成不可修改事实。</p>
            </div>
          )}
          {data.pagination.totalPages > 1 ? (
            <nav className="audit-pagination" aria-label="审计记录分页">
              <button
                type="button"
                disabled={data.pagination.page <= 1 || resource.refreshing}
                onClick={() => goToPage(data.pagination.page - 1)}
              >
                上一页
              </button>
              <span>
                第 {data.pagination.page} / {data.pagination.totalPages} 页
              </span>
              <button
                type="button"
                disabled={data.pagination.page >= data.pagination.totalPages || resource.refreshing}
                onClick={() => goToPage(data.pagination.page + 1)}
              >
                下一页
              </button>
            </nav>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
