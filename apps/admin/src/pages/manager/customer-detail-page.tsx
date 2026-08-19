import { Link, useParams } from "react-router-dom";
import { ReloadIcon } from "@radix-ui/react-icons";
import type {
  ManagerCustomerHistoryResponse,
  ManagerCustomerProfileResponse,
} from "@rongguang/contracts";

import { useBackofficeResource } from "../../backoffice-resource";
import {
  customerBookingStatusLabels,
  formatShanghaiDateTime,
  petProfileSummary,
} from "../../customer-record-presentation";

export function ManagerCustomerDetailPage(): React.JSX.Element {
  const { customerId = "" } = useParams();
  const profile = useBackofficeResource<ManagerCustomerProfileResponse>(
    `/backoffice/manager/customers/${encodeURIComponent(customerId)}`,
  );
  const history = useBackofficeResource<ManagerCustomerHistoryResponse>(
    `/backoffice/manager/customers/${encodeURIComponent(customerId)}/history`,
  );

  return (
    <main className="page-shell manager-customer-detail-page">
      <header className="manager-customer-detail-header">
        <Link to="/manager/customers">← 返回顾客档案</Link>
        {profile.data ? (
          <div>
            <p>MG-14 · 顾客档案</p>
            <h1>{profile.data.customer.displayName}</h1>
            <span>{profile.data.customer.phoneMasked} · 敏感字段已脱敏</span>
          </div>
        ) : (
          <div>
            <p>MG-14 · 顾客档案</p>
            <h1>顾客档案</h1>
          </div>
        )}
      </header>

      {profile.loading && !profile.data ? (
        <section className="manager-customer-loading manager-shimmer" role="status">
          正在读取顾客本人和宠物资料
        </section>
      ) : null}
      {profile.error && !profile.data ? (
        <div className="manager-refresh-notice" role="alert">
          <span>
            <strong>顾客档案读取失败</strong>
            <small>{profile.error}</small>
          </span>
          <button type="button" onClick={profile.refresh}>
            <ReloadIcon /> 重试顾客档案
          </button>
        </div>
      ) : null}

      {profile.data ? (
        <>
          <section className="manager-customer-summary-grid">
            <article>
              <small>联系资料</small>
              <strong>{profile.data.customer.phoneMasked}</strong>
              <p>页面及导出均不展示完整手机号。</p>
            </article>
            <article>
              <small>建档时间</small>
              <strong>{formatShanghaiDateTime(profile.data.customer.createdAt)}</strong>
              <p>顾客本人资料与宠物档案按当前门店授权读取。</p>
            </article>
            <article>
              <small>隐私同意</small>
              <strong>{profile.data.customer.privacyConsents.length} 条</strong>
              {profile.data.customer.privacyConsents.length > 0 ? (
                <ul>
                  {profile.data.customer.privacyConsents.map((consent) => (
                    <li key={`${consent.version}-${consent.consentedAt}`}>
                      {consent.version} ·{" "}
                      {consent.source === "miniapp_booking" ? "小程序预约" : "店长线下建档"} ·{" "}
                      {formatShanghaiDateTime(consent.consentedAt)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>暂无隐私同意事实。</p>
              )}
            </article>
          </section>

          <section className="manager-customer-detail-section">
            <header>
              <div>
                <h2>宠物档案</h2>
                <p>护理注意来自顾客填写；点击宠物进入独立详情路由。</p>
              </div>
            </header>
            {profile.data.pets.length > 0 ? (
              <div className="manager-pet-card-grid">
                {profile.data.pets.map((pet) => (
                  <Link
                    className="manager-pet-card"
                    aria-label={`查看${pet.name}档案`}
                    to={`/manager/customers/${customerId}/pets/${pet.id}`}
                    key={pet.id}
                  >
                    {pet.photoPath ? (
                      <img src={pet.photoPath} alt="" />
                    ) : (
                      <i aria-hidden="true">宠</i>
                    )}
                    <span>
                      <strong>{pet.name}</strong>
                      <small>{petProfileSummary(pet)}</small>
                    </span>
                    <em>{pet.archivedAt ? "已归档" : "查看详情"}</em>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="manager-detail-empty">这位顾客还没有宠物档案。</p>
            )}
          </section>
        </>
      ) : null}

      <section className="manager-customer-detail-section manager-customer-history-section">
        <header>
          <div>
            <h2>预约与服务历史</h2>
            <p>预约快照和门店服务记录按时间保留，更正以追加说明展示。</p>
          </div>
        </header>
        {history.loading && !history.data ? <p role="status">正在读取服务历史…</p> : null}
        {history.error ? (
          <div className="manager-refresh-notice" role="alert">
            <span>
              <strong>服务历史暂时不可用</strong>
              <small>{history.error}</small>
            </span>
            <button type="button" onClick={history.refresh}>
              <ReloadIcon /> 重试服务历史
            </button>
          </div>
        ) : null}
        {history.data &&
        history.data.bookings.length === 0 &&
        history.data.serviceRecords.length === 0 ? (
          <p className="manager-detail-empty">还没有预约或门店服务记录。</p>
        ) : null}
        {history.data ? (
          <div className="manager-customer-history-grid">
            <article>
              <h3>预约历史</h3>
              <ol>
                {history.data.bookings.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>
                        {item.primaryService.name} · {item.staff.displayName}
                      </strong>
                      <small>
                        {item.pet.name} · {customerBookingStatusLabels[item.status]}
                      </small>
                    </span>
                    <time dateTime={item.startsAt}>{formatShanghaiDateTime(item.startsAt)}</time>
                  </li>
                ))}
              </ol>
            </article>
            <article>
              <h3>门店服务记录</h3>
              <ol>
                {history.data.serviceRecords.map((record) => (
                  <li key={record.id}>
                    <span>
                      <strong>
                        {record.primaryService.name} · {record.staff.displayName}
                      </strong>
                      <small>
                        {record.pet.name} · {record.internalText ?? "无内部补充"}
                      </small>
                    </span>
                    <time dateTime={record.actualEndsAt}>
                      {formatShanghaiDateTime(record.actualEndsAt)}
                    </time>
                    {record.notes.map((note) => (
                      <p className="manager-correction-note" key={note.id}>
                        <strong>{note.text}</strong>
                        <small>
                          {note.author.displayName} · {formatShanghaiDateTime(note.createdAt)}
                        </small>
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
            </article>
          </div>
        ) : null}
      </section>
    </main>
  );
}
