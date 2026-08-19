import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DownloadIcon, MagnifyingGlassIcon, ReloadIcon } from "@radix-ui/react-icons";
import type { ManagerBookingListResponse, ManagerBookingStatus } from "@rongguang/contracts";

import {
  formatShanghaiClock,
  managerBookingStatusLabels,
} from "../../manager-booking-presentation";
import { useManagerResource } from "../../manager-live-resource";
import { ApiError, downloadApiFile } from "../../api";
import { useAuth } from "../../auth-context";

const statusOptions = Object.entries(managerBookingStatusLabels) as Array<
  [ManagerBookingStatus, string]
>;

function listResourcePath(searchParams: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of ["date", "status", "staffId", "primaryServiceId", "q"] as const) {
    const value = searchParams.get(key)?.trim();
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return `/backoffice/manager/bookings${suffix ? `?${suffix}` : ""}`;
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function ManagerAppointmentListPage(): React.JSX.Element {
  const { markExpired } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draft, setDraft] = useState(() => ({
    date: searchParams.get("date") ?? "",
    status: searchParams.get("status") ?? "",
    staffId: searchParams.get("staffId") ?? "",
    primaryServiceId: searchParams.get("primaryServiceId") ?? "",
    query: searchParams.get("q") ?? "",
  }));
  const resource = useManagerResource<ManagerBookingListResponse>(
    listResourcePath(searchParams),
    false,
  );
  const [exportState, setExportState] = useState<{
    loading: boolean;
    message: string | null;
    error: string | null;
  }>({ loading: false, message: null, error: null });
  const hasFilters = [...searchParams.values()].some(Boolean);

  function applyFilters(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = new URLSearchParams();
    if (draft.date) next.set("date", draft.date);
    if (draft.status) next.set("status", draft.status);
    if (draft.staffId) next.set("staffId", draft.staffId);
    if (draft.primaryServiceId) next.set("primaryServiceId", draft.primaryServiceId);
    if (draft.query.trim()) next.set("q", draft.query.trim());
    setSearchParams(next);
  }

  function resetFilters(): void {
    setDraft({ date: "", status: "", staffId: "", primaryServiceId: "", query: "" });
    setSearchParams(new URLSearchParams());
  }

  async function exportCsv(): Promise<void> {
    const payload: Record<string, string> = {};
    for (const [urlKey, bodyKey] of [
      ["date", "date"],
      ["status", "status"],
      ["staffId", "staffId"],
      ["primaryServiceId", "primaryServiceId"],
      ["q", "query"],
    ] as const) {
      const value = searchParams.get(urlKey)?.trim();
      if (value) payload[bodyKey] = value;
    }

    setExportState({ loading: true, message: null, error: null });
    try {
      const filename = await downloadApiFile(
        "/backoffice/manager/exports/bookings.csv",
        payload,
        "rongguang-bookings.csv",
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
        error: error instanceof Error ? error.message : "预约导出失败，请稍后重试。",
      });
    }
  }

  return (
    <main className="page-shell manager-booking-list-page">
      <header className="manager-page-header">
        <div>
          <p>MG-03 · 预约</p>
          <h1>预约列表</h1>
          <span>筛选当前与历史预约，详情由独立路由恢复</span>
        </div>
        <div className="manager-page-actions">
          <button
            className="manager-secondary-link manager-export-button"
            type="button"
            disabled={exportState.loading}
            onClick={() => void exportCsv()}
          >
            <DownloadIcon aria-hidden="true" />
            {exportState.loading ? "正在导出…" : "导出当前筛选 CSV"}
          </button>
          <Link className="manager-secondary-link" to="/manager/appointments/calendar">
            按员工日历
          </Link>
          <Link className="manager-primary-link" to="/manager/appointments/proxy">
            代客预约
          </Link>
        </div>
      </header>

      <form className="manager-booking-filters" onSubmit={applyFilters}>
        <label className="manager-booking-search">
          <span>搜索顾客或宠物</span>
          <i>
            <MagnifyingGlassIcon aria-hidden="true" />
            <input
              aria-label="搜索顾客或宠物"
              value={draft.query}
              onChange={(event) =>
                setDraft((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="顾客姓名或宠物名称"
            />
          </i>
        </label>
        <label>
          <span>日期</span>
          <input
            aria-label="预约日期"
            type="date"
            value={draft.date}
            onChange={(event) => setDraft((current) => ({ ...current, date: event.target.value }))}
          />
        </label>
        <label>
          <span>状态</span>
          <select
            aria-label="预约状态"
            value={draft.status}
            onChange={(event) =>
              setDraft((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="">全部状态</option>
            {statusOptions.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>员工</span>
          <select
            aria-label="员工"
            value={draft.staffId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, staffId: event.target.value }))
            }
          >
            <option value="">全部员工</option>
            {resource.data?.filterOptions.staff.map((staff) => (
              <option value={staff.id} key={staff.id}>
                {staff.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>主要服务</span>
          <select
            aria-label="主要服务"
            value={draft.primaryServiceId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, primaryServiceId: event.target.value }))
            }
          >
            <option value="">全部主要服务</option>
            {resource.data?.filterOptions.primaryServices.map((service) => (
              <option value={service.id} key={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        <div className="manager-booking-filter-actions">
          <button type="submit">应用筛选</button>
          <button type="button" onClick={resetFilters}>
            重置
          </button>
        </div>
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
        <section className="manager-booking-list-loading manager-shimmer" role="status">
          正在读取预约列表
        </section>
      ) : null}
      {resource.error ? (
        <div className="manager-refresh-notice" role="alert">
          <span>
            <strong>预约列表更新失败</strong>
            <small>{resource.error}</small>
          </span>
          <button type="button" onClick={resource.refresh}>
            <ReloadIcon /> 重试
          </button>
        </div>
      ) : null}
      {resource.data && resource.data.bookings.length === 0 ? (
        <section className="manager-fact-state">
          <strong>{hasFilters ? "没有符合条件的预约" : "还没有预约"}</strong>
          <p>
            {hasFilters
              ? "当前筛选已保留，可以调整关键字、日期或其他条件。"
              : "电话、聊天或到店达成的预约也会进入这里。"}
          </p>
          {hasFilters ? (
            <button type="button" onClick={resetFilters}>
              清空筛选
            </button>
          ) : (
            <Link className="manager-primary-link" to="/manager/appointments/proxy">
              创建代客预约
            </Link>
          )}
        </section>
      ) : null}
      {resource.data && resource.data.bookings.length > 0 ? (
        <section className="manager-booking-list-panel">
          <header>
            <div>
              <h2>筛选结果</h2>
              <p>共 {resource.data.bookings.length} 笔预约</p>
            </div>
          </header>
          <div className="manager-booking-list-table">
            <div className="manager-booking-list-head" aria-hidden="true">
              <span>时间与状态</span>
              <span>宠物 / 顾客</span>
              <span>服务</span>
              <span>员工</span>
              <span>标价</span>
              <span>操作</span>
            </div>
            {resource.data.bookings.map((booking) => (
              <Link
                className="manager-booking-list-row"
                to={`/manager/appointments/${booking.id}`}
                aria-label={`查看${booking.pet.name}预约详情`}
                key={booking.id}
              >
                <span>
                  <strong>
                    {formatShanghaiClock(booking.startsAt)}–{formatShanghaiClock(booking.endsAt)}
                  </strong>
                  <small
                    className={`manager-booking-status manager-booking-status--${booking.status}`}
                  >
                    {managerBookingStatusLabels[booking.status]}
                  </small>
                </span>
                <span className="manager-booking-pet-cell">
                  {booking.pet.photoPath ? <img src={booking.pet.photoPath} alt="" /> : null}
                  <span>
                    <strong>{booking.pet.name}</strong>
                    <small>{booking.customer.displayName}</small>
                  </span>
                </span>
                <span>
                  <strong>{booking.primaryService.name}</strong>
                  <small>
                    {booking.addons.length > 0
                      ? booking.addons.map((addon) => addon.name).join("、")
                      : "无增项"}
                  </small>
                </span>
                <span>{booking.staff.displayName}</span>
                <span>{formatPrice(booking.totalPriceCents)}</span>
                <span className="manager-booking-row-action">查看详情</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
