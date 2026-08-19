import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DownloadIcon, MagnifyingGlassIcon, ReloadIcon } from "@radix-ui/react-icons";
import type { ManagerCustomerListResponse } from "@rongguang/contracts";

import { ApiError, downloadApiFile } from "../../api";
import { useAuth } from "../../auth-context";
import { useBackofficeResource } from "../../backoffice-resource";

function listPath(searchParams: URLSearchParams): string {
  const query = new URLSearchParams();
  const search = searchParams.get("q")?.trim();
  const page = searchParams.get("page")?.trim();
  if (search) query.set("q", search);
  if (page) query.set("page", page);
  const suffix = query.toString();
  return `/backoffice/manager/customers${suffix ? `?${suffix}` : ""}`;
}

function pagePath(search: string, page: number): string {
  const query = new URLSearchParams();
  if (search) query.set("q", search);
  query.set("page", String(page));
  return `/manager/customers?${query.toString()}`;
}

export function ManagerCustomersPage(): React.JSX.Element {
  const { markExpired } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q")?.trim() ?? "";
  const [draft, setDraft] = useState(search);
  const [exportState, setExportState] = useState<{
    loading: boolean;
    message: string | null;
    error: string | null;
  }>({ loading: false, message: null, error: null });
  const resource = useBackofficeResource<ManagerCustomerListResponse>(listPath(searchParams));

  useEffect(() => setDraft(search), [search]);

  function applySearch(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = new URLSearchParams();
    if (draft.trim()) next.set("q", draft.trim());
    next.set("page", "1");
    setSearchParams(next);
  }

  async function exportJson(): Promise<void> {
    setExportState({ loading: true, message: null, error: null });
    try {
      const filename = await downloadApiFile(
        "/backoffice/manager/exports/customers-pets.json",
        { query: search },
        "rongguang-customers-pets.json",
      );
      setExportState({ loading: false, message: `已下载 ${filename}`, error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        markExpired();
        return;
      }
      setExportState({
        loading: false,
        message: null,
        error: error instanceof Error ? error.message : "顾客档案导出失败，请稍后重试。",
      });
    }
  }

  return (
    <main className="page-shell manager-customer-page">
      <header className="manager-page-header">
        <div>
          <p>MG-14 · 顾客</p>
          <h1>顾客档案</h1>
          <span>以脱敏资料检索顾客，并从独立路由恢复宠物与服务历史</span>
        </div>
        <div className="manager-page-actions">
          <span className="manager-sensitive-badge">敏感字段已脱敏</span>
          <button
            className="manager-primary-link manager-export-button"
            type="button"
            disabled={exportState.loading}
            onClick={() => void exportJson()}
          >
            <DownloadIcon aria-hidden="true" />
            {exportState.loading ? "正在导出…" : "导出当前筛选 JSON"}
          </button>
        </div>
      </header>

      <form className="manager-customer-search" onSubmit={applySearch}>
        <label>
          <span>姓名、脱敏手机号或宠物</span>
          <i>
            <MagnifyingGlassIcon aria-hidden="true" />
            <input
              aria-label="搜索顾客或宠物"
              value={draft}
              maxLength={50}
              placeholder="例如：程墨、139****0341、薄荷"
              onChange={(event) => setDraft(event.target.value)}
            />
          </i>
        </label>
        <button type="submit">搜索档案</button>
      </form>

      {exportState.error ? (
        <p className="manager-export-status manager-export-status--error" role="alert">
          {exportState.error}
        </p>
      ) : null}
      {exportState.message ? (
        <p className="manager-export-status" role="status">
          {exportState.message}
        </p>
      ) : null}

      {resource.loading && !resource.data ? (
        <section className="manager-customer-loading manager-shimmer" role="status">
          正在读取顾客档案
        </section>
      ) : null}
      {resource.error ? (
        <div className="manager-refresh-notice" role="alert">
          <span>
            <strong>{resource.forbidden ? "无权限读取顾客档案" : "顾客档案读取失败"}</strong>
            <small>{resource.error}</small>
          </span>
          {!resource.forbidden ? (
            <button type="button" onClick={resource.refresh}>
              <ReloadIcon /> 重试
            </button>
          ) : null}
        </div>
      ) : null}
      {resource.data && resource.data.customers.length === 0 ? (
        <section className="manager-fact-state">
          <strong>{search ? "没有符合条件的顾客" : "还没有顾客档案"}</strong>
          <p>
            {search
              ? "当前搜索已保留，可更换姓名、脱敏手机号或宠物名称。"
              : "顾客建立预约和宠物资料后会显示在这里。"}
          </p>
          {search ? (
            <button
              type="button"
              onClick={() => setSearchParams(new URLSearchParams({ page: "1" }))}
            >
              清空搜索
            </button>
          ) : null}
        </section>
      ) : null}
      {resource.data && resource.data.customers.length > 0 ? (
        <section className="manager-customer-panel">
          <header>
            <div>
              <h2>顾客与宠物</h2>
              <p>共 {resource.data.pagination.totalItems} 位顾客</p>
            </div>
          </header>
          <div className="manager-customer-table">
            <div className="manager-customer-head" aria-hidden="true">
              <span>顾客</span>
              <span>宠物</span>
              <span>未来预约</span>
              <span>服务记录</span>
              <span>操作</span>
            </div>
            {resource.data.customers.map((customer) => (
              <article className="manager-customer-row" key={customer.id}>
                <span className="manager-customer-identity">
                  <strong>{customer.displayName}</strong>
                  <small>{customer.phoneMasked}</small>
                </span>
                <span className="manager-customer-pets">
                  {customer.pets.length > 0 ? (
                    customer.pets.map((pet) => (
                      <Link
                        key={pet.id}
                        aria-label={`查看${pet.name}档案`}
                        to={`/manager/customers/${customer.id}/pets/${pet.id}`}
                      >
                        {pet.photoPath ? (
                          <img src={pet.photoPath} alt="" />
                        ) : (
                          <i aria-hidden="true">宠</i>
                        )}
                        <span>
                          <strong>{pet.name}</strong>
                          <small>
                            {pet.species === "dog" ? "犬" : "猫"}
                            {pet.breed ? ` · ${pet.breed}` : ""}
                          </small>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <small>暂无宠物</small>
                  )}
                </span>
                <strong>{customer.futureBookingCount}</strong>
                <strong>{customer.completedServiceCount}</strong>
                <Link
                  className="manager-customer-row-action"
                  aria-label={`查看${customer.displayName}档案`}
                  to={`/manager/customers/${customer.id}`}
                >
                  查看档案
                </Link>
              </article>
            ))}
          </div>
          <footer className="manager-customer-pagination" aria-label="顾客分页">
            {resource.data.pagination.page > 1 ? (
              <Link to={pagePath(search, resource.data.pagination.page - 1)}>上一页</Link>
            ) : (
              <span>上一页</span>
            )}
            <strong>
              第 {resource.data.pagination.page} /{" "}
              {Math.max(resource.data.pagination.totalPages, 1)} 页
            </strong>
            {resource.data.pagination.page < resource.data.pagination.totalPages ? (
              <Link to={pagePath(search, resource.data.pagination.page + 1)}>下一页</Link>
            ) : (
              <span>下一页</span>
            )}
          </footer>
        </section>
      ) : null}
    </main>
  );
}
