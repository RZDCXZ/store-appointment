import { DownloadIcon, InfoCircledIcon, ReloadIcon } from "@radix-ui/react-icons";
import type {
  BusinessPeriodDays,
  BusinessSeriesPoint,
  ManagerBusinessMetricsResponse,
  ManagerBusinessSeriesResponse,
} from "@rongguang/contracts";
import { useSearchParams } from "react-router-dom";

import { useBackofficeResource } from "../../backoffice-resource";
import { useFileExport } from "../../use-file-export";

const periodOptions = [7, 30, 90] as const;

function selectedPeriod(searchParams: URLSearchParams): BusinessPeriodDays {
  const value = Number(searchParams.get("period"));
  return periodOptions.includes(value as BusinessPeriodDays) ? (value as BusinessPeriodDays) : 30;
}

function formatRate(value: number | null): string {
  return value === null ? "暂无比例（分母为 0）" : `${(value * 100).toFixed(2)}%`;
}

function formatCurrency(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function rateTrend(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "前期或本期分母为 0，暂不比较";
  const points = (current - previous) * 100;
  if (points > 0) return `较前期增加 ${points.toFixed(2)} 个百分点`;
  if (points < 0) return `较前期减少 ${Math.abs(points).toFixed(2)} 个百分点`;
  return "较前期持平（0.00 个百分点）";
}

function amountTrend(current: number, previous: number): string {
  const difference = current - previous;
  if (difference > 0) return `较前期增加 ${formatCurrency(difference)}`;
  if (difference < 0) return `较前期减少 ${formatCurrency(Math.abs(difference))}`;
  return "较前期持平（¥0.00）";
}

function dateRange(startsOn: string, endsOn: string): string {
  return `${startsOn.replaceAll("-", ".")} – ${endsOn.replaceAll("-", ".")}`;
}

function retainedPeriodMessage(
  message: string,
  retainedPeriod: BusinessPeriodDays | null,
  requestedPeriod: BusinessPeriodDays,
): string {
  return retainedPeriod === null
    ? message
    : `${message}以下保留近 ${retainedPeriod} 天上次结果，未作为近 ${requestedPeriod} 天数据。`;
}

interface MetricCardProps {
  eyebrow: string;
  title: string;
  value: string;
  detail: string;
  formula: string;
  trend: string;
  tone?: "default" | "attention";
  badge?: string;
  note?: string;
}

function MetricCard({
  eyebrow,
  title,
  value,
  detail,
  formula,
  trend,
  tone = "default",
  badge,
  note,
}: MetricCardProps): React.JSX.Element {
  return (
    <article className={`business-metric-card business-metric-card--${tone}`}>
      <header>
        <span>{eyebrow}</span>
        <InfoCircledIcon aria-hidden="true" />
      </header>
      <h2>{title}</h2>
      <div className="business-metric-card__value-row">
        <strong>{value}</strong>
        {badge ? <em>{badge}</em> : null}
      </div>
      <p>{detail}</p>
      <small className="business-metric-card__formula">
        <span>{formula}</span>
        {note ? <b>{note}</b> : null}
      </small>
      <footer>{trend}</footer>
    </article>
  );
}

function DailyChart({
  title,
  description,
  points,
  value,
  format,
}: {
  title: string;
  description: string;
  points: BusinessSeriesPoint[];
  value: (point: BusinessSeriesPoint) => number | null;
  format: (value: number | null) => string;
}): React.JSX.Element {
  const values = points.map(value).filter((item): item is number => item !== null);
  const maximum = Math.max(...values, 0);

  return (
    <section className="business-chart" aria-label={title} role="region">
      <header>
        <div>
          <p>DAILY SERIES</p>
          <h2>{title}</h2>
        </div>
        <span>{description}</span>
      </header>
      {points.length === 0 ? (
        <div className="business-chart__empty">当前周期没有每日趋势数据</div>
      ) : (
        <div className="business-chart__scroll">
          <ol aria-label={`${title}数据点`}>
            {points.map((point) => {
              const rawValue = value(point);
              const formattedValue = format(rawValue);
              const height = rawValue === null || maximum === 0 ? 0 : (rawValue / maximum) * 100;
              return (
                <li
                  aria-label={`${point.localDate}：${formattedValue}`}
                  key={point.localDate}
                  tabIndex={0}
                >
                  <b className="business-chart__tooltip" aria-hidden="true">
                    {formattedValue}
                  </b>
                  <span className="business-chart__plot" aria-hidden="true">
                    <i style={{ height: `${height}%` }} />
                  </span>
                  <small>{point.localDate.slice(5).replace("-", "/")}</small>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function MetricsGrid({ data }: { data: ManagerBusinessMetricsResponse }): React.JSX.Element {
  const { current, previous, revisit90Days } = data;
  return (
    <section className="business-metrics-grid" aria-label="经营核心指标">
      <MetricCard
        eyebrow="CAPACITY"
        title="服务工时利用率"
        value={formatRate(current.utilizationRate)}
        detail={`${current.completedServiceMinutes} 分钟 ÷ ${current.availableStaffMinutes} 分钟`}
        formula="已完成预约计划服务分钟数 ÷（已发布排班分钟数 − 休息 − 生效停班）"
        note="分子不含周转、取消、爽约或服务终止"
        trend={rateTrend(current.utilizationRate, previous.utilizationRate)}
      />
      <MetricCard
        eyebrow="LIST PRICE"
        title="已完成服务标价"
        value={formatCurrency(current.completedListPriceCents)}
        detail={`${current.completedBookingCount} 笔已完成预约价格快照（主要服务与增项）`}
        formula="已完成预约价格快照之和"
        trend={amountTrend(current.completedListPriceCents, previous.completedListPriceCents)}
        badge="非实收金额"
      />
      <MetricCard
        eyebrow="CANCELLATION"
        title="取消率"
        value={formatRate(current.cancellationRate)}
        detail={`${current.cancellationCount} 笔 ÷ ${current.cancellationDenominator} 笔`}
        formula="已取消预约数 ÷ 全部预约数"
        trend={rateTrend(current.cancellationRate, previous.cancellationRate)}
        tone="attention"
      />
      <MetricCard
        eyebrow="NO-SHOW"
        title="爽约率"
        value={formatRate(current.noShowRate)}
        detail={`${current.noShowCount} 笔 ÷ ${current.noShowDenominator} 笔非取消预约`}
        formula="爽约预约数 ÷ 非取消预约数"
        trend={rateTrend(current.noShowRate, previous.noShowRate)}
        tone="attention"
      />
      <MetricCard
        eyebrow="TERMINATION"
        title="服务终止"
        value={`${current.terminationCount} 笔 · ${formatRate(current.terminationRate)}`}
        detail={`${current.terminationCount} 笔 ÷ 全部预约 ${current.terminationDenominator} 笔`}
        formula="服务终止预约数 ÷ 全部预约数"
        trend={rateTrend(current.terminationRate, previous.terminationRate)}
        tone="attention"
      />
      <MetricCard
        eyebrow="90-DAY REVISIT"
        title="90 天复访顾客占比"
        value={`90 天 · ${formatRate(revisit90Days.current.revisitRate)}`}
        detail={`至少完成 2 次：${revisit90Days.current.revisitCustomerCount} 位 ÷ 至少完成 1 次：${revisit90Days.current.completedCustomerCount} 位`}
        formula="近 90 天完成至少 2 次的顾客数 ÷ 完成至少 1 次的顾客数"
        trend={rateTrend(revisit90Days.current.revisitRate, revisit90Days.previous.revisitRate)}
      />
    </section>
  );
}

function MetricsLoading(): React.JSX.Element {
  return (
    <section className="business-metrics-grid" aria-label="正在读取经营指标" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="business-metric-card business-metric-card--loading" key={index} />
      ))}
    </section>
  );
}

function ErrorNotice({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="manager-refresh-notice business-error-notice" role="alert">
      <span>
        <strong>{title}</strong>
        <small>{message}</small>
      </span>
      <button type="button" onClick={onRetry}>
        <ReloadIcon aria-hidden="true" /> {retryLabel}
      </button>
    </div>
  );
}

export function ManagerBusinessPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = selectedPeriod(searchParams);
  const metrics = useBackofficeResource<ManagerBusinessMetricsResponse>(
    `/backoffice/manager/business/metrics?period=${period}`,
    "经营指标读取失败，请稍后重试。",
  );
  const series = useBackofficeResource<ManagerBusinessSeriesResponse>(
    `/backoffice/manager/business/series?period=${period}`,
    "每日趋势读取失败，请稍后重试。",
  );
  const exportAction = useFileExport();
  const metricsData = metrics.data?.periodDays === period ? metrics.data : null;
  const seriesData = series.data?.periodDays === period ? series.data : null;
  const retainedMetricsData =
    metrics.error && metrics.data?.periodDays !== period ? metrics.data : null;
  const retainedSeriesData =
    series.error && series.data?.periodDays !== period ? series.data : null;
  const displayedMetricsData = metricsData ?? retainedMetricsData;
  const displayedSeriesData = seriesData ?? retainedSeriesData;
  const revisionMismatch =
    metricsData !== null &&
    seriesData !== null &&
    metricsData.currentPeriodRevision !== seriesData.currentPeriodRevision;

  function changePeriod(nextPeriod: BusinessPeriodDays): void {
    setSearchParams({ period: String(nextPeriod) });
  }

  async function exportCsv(): Promise<void> {
    await exportAction.start(
      "/backoffice/manager/business/export.csv",
      { period: String(period) },
      `rongguang-business-${period}d.csv`,
      "经营数据导出失败，请稍后重试。",
    );
  }

  return (
    <main className="page-shell manager-business-page">
      <header className="manager-page-header business-page-header">
        <div>
          <p>MG-17 · 经营</p>
          <h1>经营看板</h1>
          <span>依据预约履约事实与已发布产能，查看可复核的周期指标</span>
        </div>
        <div className="manager-page-actions">
          <button
            className="manager-primary-link manager-export-button"
            type="button"
            disabled={exportAction.state.loading}
            onClick={() => void exportCsv()}
          >
            <DownloadIcon aria-hidden="true" />
            {exportAction.state.loading ? "正在导出…" : "导出当前周期 CSV"}
          </button>
          <small>导出当前筛选，并写入审计记录</small>
        </div>
      </header>

      <section className="business-period-bar" aria-label="经营周期">
        <div className="business-period-tabs">
          {periodOptions.map((option) => (
            <button
              type="button"
              aria-pressed={period === option}
              key={option}
              onClick={() => changePeriod(option)}
            >
              近 {option} 天
            </button>
          ))}
        </div>
        {displayedMetricsData ? (
          <p>
            {retainedMetricsData ? (
              <strong>保留近 {retainedMetricsData.periodDays} 天上次结果</strong>
            ) : null}
            本期{" "}
            {dateRange(
              displayedMetricsData.currentWindow.startsOn,
              displayedMetricsData.currentWindow.endsOn,
            )}
            <span>
              对比{" "}
              {dateRange(
                displayedMetricsData.previousWindow.startsOn,
                displayedMetricsData.previousWindow.endsOn,
              )}
            </span>
          </p>
        ) : (
          <p>所有日期按 Asia/Shanghai 业务日统计</p>
        )}
      </section>

      {exportAction.state.error ? (
        <p className="manager-export-status manager-export-status--error" role="alert">
          {exportAction.state.error}
        </p>
      ) : null}
      {exportAction.state.message ? (
        <p className="manager-export-status" role="status">
          {exportAction.state.message}
        </p>
      ) : null}

      {!displayedMetricsData && !metrics.error ? <MetricsLoading /> : null}
      {metrics.error ? (
        <ErrorNotice
          title="经营指标读取失败"
          message={retainedPeriodMessage(
            metrics.error,
            retainedMetricsData?.periodDays ?? null,
            period,
          )}
          retryLabel="重试经营指标"
          onRetry={metrics.refresh}
        />
      ) : null}
      {displayedMetricsData ? <MetricsGrid data={displayedMetricsData} /> : null}

      <div className="business-section-heading">
        <div>
          <p>TREND REVIEW</p>
          <h2>每日趋势</h2>
        </div>
        <span>柱形仅辅助辨识走势，精确值可悬停或聚焦查看</span>
      </div>

      {revisionMismatch ? (
        <ErrorNotice
          title="经营事实版本不一致"
          message="经营指标与每日趋势来自不同事实版本，请重新同步。"
          retryLabel="重新同步经营事实"
          onRetry={() => {
            metrics.refresh();
            series.refresh();
          }}
        />
      ) : null}

      {!displayedSeriesData && !series.error ? (
        <section className="business-chart business-chart--loading" role="status">
          正在读取每日趋势
        </section>
      ) : null}
      {series.error ? (
        <ErrorNotice
          title="每日趋势读取失败"
          message={retainedPeriodMessage(
            series.error,
            retainedSeriesData?.periodDays ?? null,
            period,
          )}
          retryLabel="重试每日趋势"
          onRetry={series.refresh}
        />
      ) : null}
      {displayedSeriesData && !revisionMismatch ? (
        <div className="business-charts-grid">
          <DailyChart
            title="服务工时利用率每日趋势"
            description="已完成计划分钟 ÷ 可用分钟"
            points={displayedSeriesData.points}
            value={(point) => point.utilizationRate}
            format={formatRate}
          />
          <DailyChart
            title="已完成服务标价每日趋势"
            description="标价快照，非实收金额"
            points={displayedSeriesData.points}
            value={(point) => point.completedListPriceCents}
            format={(value) => formatCurrency(value ?? 0)}
          />
        </div>
      ) : null}
    </main>
  );
}
