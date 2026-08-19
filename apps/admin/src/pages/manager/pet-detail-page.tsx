import { Link, useParams } from "react-router-dom";
import { ReloadIcon } from "@radix-ui/react-icons";
import type { ManagerPetDetailResponse } from "@rongguang/contracts";

import { useBackofficeResource } from "../../backoffice-resource";
import {
  customerBookingStatusLabels,
  formatShanghaiDateTime,
  petProfileSummary,
} from "../../customer-record-presentation";

export function ManagerPetDetailPage(): React.JSX.Element {
  const { customerId = "", petId = "" } = useParams();
  const resource = useBackofficeResource<ManagerPetDetailResponse>(
    `/backoffice/manager/customers/${encodeURIComponent(customerId)}/pets/${encodeURIComponent(petId)}`,
  );

  return (
    <main className="page-shell manager-pet-detail-page">
      <header className="manager-customer-detail-header">
        <Link to={`/manager/customers/${customerId}`}>← 返回顾客档案</Link>
        {resource.data ? (
          <div>
            <p>MG-14 · 宠物档案</p>
            <h1>{resource.data.pet.name}</h1>
            <span>
              {resource.data.customer.displayName} · {resource.data.customer.phoneMasked}
            </span>
          </div>
        ) : (
          <div>
            <p>MG-14 · 宠物档案</p>
            <h1>宠物档案</h1>
          </div>
        )}
      </header>

      {resource.loading && !resource.data ? (
        <section className="manager-customer-loading manager-shimmer" role="status">
          正在读取宠物档案
        </section>
      ) : null}
      {resource.error ? (
        <div className="manager-refresh-notice" role="alert">
          <span>
            <strong>宠物档案读取失败</strong>
            <small>{resource.error}</small>
          </span>
          <button type="button" onClick={resource.refresh}>
            <ReloadIcon /> 重试
          </button>
        </div>
      ) : null}

      {resource.data ? (
        <>
          <section className="manager-pet-profile-card">
            {resource.data.pet.photoPath ? (
              <img src={resource.data.pet.photoPath} alt="" />
            ) : (
              <i aria-hidden="true">宠</i>
            )}
            <div>
              <small>当前宠物档案</small>
              <strong>{petProfileSummary(resource.data.pet)}</strong>
              <p>
                {resource.data.pet.sex === "female"
                  ? "母"
                  : resource.data.pet.sex === "male"
                    ? "公"
                    : "性别未填写"}
                {resource.data.pet.birthDate ? ` · 出生于 ${resource.data.pet.birthDate}` : ""}
                {resource.data.pet.coatType
                  ? ` · ${resource.data.pet.coatType === "long" ? "长毛" : resource.data.pet.coatType === "short" ? "短毛" : "其他毛型"}`
                  : ""}
              </p>
            </div>
          </section>

          <section
            className="manager-customer-detail-section manager-pet-care-section"
            role="region"
            aria-labelledby="pet-care-heading"
          >
            <header>
              <div>
                <h2 id="pet-care-heading">护理注意事项（顾客填写）</h2>
                <p>来源为顾客宠物档案，不与门店内部履约记录混合。</p>
              </div>
            </header>
            {resource.data.pet.careTags.length > 0 ? (
              <div className="manager-care-tags">
                {resource.data.pet.careTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
            <p className="manager-care-notes">
              {resource.data.pet.careNotes ?? "顾客未填写额外护理注意。"}
            </p>
          </section>

          <section className="manager-customer-detail-section">
            <header>
              <div>
                <h2>预约历史</h2>
                <p>按宠物关联的预约快照，保留当时服务、员工和状态。</p>
              </div>
            </header>
            {resource.data.bookings.length > 0 ? (
              <ol className="manager-pet-timeline">
                {resource.data.bookings.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>
                        {item.primaryService.name} · {item.staff.displayName}
                      </strong>
                      <small>{customerBookingStatusLabels[item.status]}</small>
                    </span>
                    <time dateTime={item.startsAt}>{formatShanghaiDateTime(item.startsAt)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="manager-detail-empty">这只宠物还没有预约历史。</p>
            )}
          </section>

          <section
            className="manager-customer-detail-section manager-internal-record-section"
            role="region"
            aria-labelledby="internal-record-heading"
          >
            <header>
              <div>
                <h2 id="internal-record-heading">门店服务记录（内部）</h2>
                <p>仅店长可跨预约查看；原记录不覆盖，更正按作者与时间追加。</p>
              </div>
            </header>
            {resource.data.serviceRecords.length > 0 ? (
              <ol className="manager-pet-timeline">
                {resource.data.serviceRecords.map((record) => (
                  <li key={record.id}>
                    <div className="manager-record-heading">
                      <span>
                        <strong>
                          {record.primaryService.name} · {record.staff.displayName}
                        </strong>
                        <small>
                          {formatShanghaiDateTime(record.actualStartsAt)}–
                          {formatShanghaiDateTime(record.actualEndsAt).slice(-5)}
                        </small>
                      </span>
                    </div>
                    <p>{record.internalText ?? "无内部补充"}</p>
                    {record.careTags.length > 0 ? (
                      <div className="manager-care-tags">
                        {record.careTags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {record.notes.length > 0 ? (
                      <ol className="manager-record-corrections" aria-label="追加更正说明">
                        {record.notes.map((note) => (
                          <li key={note.id}>
                            <strong>{note.text}</strong>
                            <small>
                              {note.author.displayName} · {formatShanghaiDateTime(note.createdAt)}
                            </small>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="manager-detail-empty">这只宠物还没有门店服务记录。</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
