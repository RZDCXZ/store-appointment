import { Link, useParams } from "react-router-dom";
import {
  ChevronLeftIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PersonIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import type { StaffBookingDetailResponse } from "@rongguang/contracts";

import {
  formatShanghaiDateTime,
  serviceLabel,
  staffActionLabels,
  staffPhotoSource,
} from "../../staff-booking-presentation";
import {
  StaffActionLabel,
  StaffPageError,
  StaffPageLoading,
  StaffStatusTag,
} from "../../staff-booking-components";
import { useStaffResource } from "../../staff-resource";

const speciesLabels = { dog: "犬", cat: "猫" } as const;
const sizeLabels = { small: "小型", medium: "中型", large: "大型" } as const;
const coatLabels = {
  short: "短毛",
  long: "长毛",
  double: "双层毛",
  curly: "卷毛",
  hairless: "无毛",
  other: "其他",
} as const;

const eventLabels: Record<string, string> = {
  booking_confirmed: "预约已确认",
  booking_rescheduled: "预约已改期",
  booking_cancelled: "预约已取消",
  booking_checked_in: "已使用六位码到店核销",
  booking_late_checked_in: "已手动迟到核销",
  booking_no_show: "已人工标记爽约",
};

export function StaffAppointmentDetailPage(): React.JSX.Element {
  const { bookingId = "" } = useParams();
  const resource = useStaffResource<StaffBookingDetailResponse>(
    `/backoffice/staff/bookings/${encodeURIComponent(bookingId)}`,
  );
  const data = resource.data;
  const booking = data?.booking;

  if (resource.forbidden && !booking) {
    return (
      <main className="page-shell staff-work-page">
        <section className="staff-state staff-state--forbidden">
          <LockClosedIcon />
          <p className="state-code">403 · 无权限</p>
          <h1>没有预约访问权限</h1>
          <p>当前员工只能读取分配给自己的预约。</p>
          <Link className="staff-primary-link" to="/staff/today">
            返回我的今日工作
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell staff-work-page staff-detail-page">
      {resource.loading && !booking ? <StaffPageLoading label="正在读取本人预约详情" /> : null}
      {resource.error && !booking ? (
        <StaffPageError
          title="预约详情暂时无法读取"
          message={resource.error}
          retry={resource.refresh}
        />
      ) : null}
      {booking ? (
        <>
          <header className="staff-detail-header">
            <Link to="/staff/today">
              <ChevronLeftIcon /> 返回今日工作
            </Link>
            <div className="staff-detail-header__semantics">
              <StaffStatusTag booking={booking} />
              <StaffActionLabel booking={booking} />
            </div>
            <h1>{booking.pet.name}的预约</h1>
            <p>预约编号 {booking.id}</p>
          </header>

          {resource.error ? (
            <div className="staff-inline-error" role="alert">
              <span>更新失败，已保留上次读取的履约资料。</span>
              <button type="button" onClick={resource.refresh}>
                重试
              </button>
            </div>
          ) : null}

          <section className={`staff-current-action staff-current-action--${booking.action}`}>
            {booking.action === "late" ? <ExclamationTriangleIcon /> : <ClockIcon />}
            <span>
              <small>当前状态与时间</small>
              <strong>{staffActionLabels[booking.action]}</strong>
              <p>
                {formatShanghaiDateTime(booking.startsAt)}–
                {new Intl.DateTimeFormat("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: "Asia/Shanghai",
                }).format(new Date(booking.endsAt))}
              </p>
            </span>
            {booking.status === "confirmed" ? (
              <Link
                className="staff-primary-link staff-current-action__link"
                to={`/staff/appointments/${booking.id}/${booking.action === "late" ? "late" : "check-in"}`}
              >
                {booking.action === "late" ? "处理迟到" : "输入核销码"}
              </Link>
            ) : null}
          </section>

          <section className="staff-detail-section staff-pet-profile">
            <header>
              <span>
                <small>履约对象</small>
                <h2>宠物资料</h2>
              </span>
              {booking.pet.photoPath ? (
                <img src={staffPhotoSource(booking.pet.photoPath)} alt={booking.pet.name} />
              ) : null}
            </header>
            <dl>
              <div>
                <dt>名称</dt>
                <dd>{booking.pet.name}</dd>
              </div>
              <div>
                <dt>种类</dt>
                <dd>{speciesLabels[booking.pet.species]}</dd>
              </div>
              <div>
                <dt>体重 / 体型</dt>
                <dd>
                  {booking.pet.weightKg}kg · {sizeLabels[booking.pet.petSize]}
                </dd>
              </div>
              <div>
                <dt>品种</dt>
                <dd>{booking.pet.breed ?? "未填写"}</dd>
              </div>
              <div>
                <dt>毛发类型</dt>
                <dd>{booking.pet.coatType ? coatLabels[booking.pet.coatType] : "未填写"}</dd>
              </div>
            </dl>
          </section>

          <section className="staff-care-section">
            <header>
              <ExclamationTriangleIcon />
              <h2>护理信息</h2>
            </header>
            <div className="staff-care-tags">
              {booking.pet.careTags.length > 0 ? (
                booking.pet.careTags.map((tag) => <span key={tag}>{tag}</span>)
              ) : (
                <span>无护理标签</span>
              )}
            </div>
            <h3>护理注意事项</h3>
            <p>{booking.pet.careNotes ?? "顾客未填写护理注意事项。"}</p>
            <small>护理信息用于安全与偏好提示，不是医疗病历或诊断。</small>
          </section>

          <div className="staff-detail-grid">
            <section className="staff-detail-section">
              <header>
                <PersonIcon />
                <h2>顾客联系信息</h2>
              </header>
              <strong>{booking.customer.displayName}</strong>
              <p className="staff-masked-phone">{booking.customer.phoneMasked}</p>
              {booking.status === "confirmed" || booking.status === "checked_in" ? (
                <Link
                  className="staff-secondary-link"
                  to={`/staff/appointments/${booking.id}/phone`}
                >
                  <LockClosedIcon /> 揭示完整号码
                </Link>
              ) : (
                <small>已结束预约不再提供完整手机号揭示。</small>
              )}
            </section>

            <section className="staff-detail-section">
              <header>
                <ReaderIcon />
                <h2>本次服务</h2>
              </header>
              <strong>{serviceLabel(booking.service)}</strong>
              <p>计划服务 {booking.service.durationMinutes} 分钟</p>
              <small>员工页面不展示经营金额或门店管理操作。</small>
            </section>
          </div>

          <section className="staff-detail-section staff-history-section">
            <header>
              <ReaderIcon />
              <h2>历史门店服务记录</h2>
            </header>
            {data.petServiceHistory.length > 0 ? (
              <ol>
                {data.petServiceHistory.map((record) => (
                  <li key={record.bookingId}>
                    <time>{formatShanghaiDateTime(record.completedAt)}</time>
                    <p>
                      {record.staffName} · {record.serviceName}
                      {record.addonNames.length > 0 ? ` + ${record.addonNames.join(" + ")}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="staff-empty-copy">这只宠物还没有已完成的门店服务记录。</p>
            )}
          </section>

          <section className="staff-detail-section staff-history-section">
            <header>
              <ClockIcon />
              <h2>状态与变更历史</h2>
            </header>
            {data.statusHistory.length > 0 ? (
              <ol>
                {data.statusHistory.map((event) => (
                  <li key={event.id}>
                    <time>{formatShanghaiDateTime(event.occurredAt)}</time>
                    <p>
                      {eventLabels[event.type] ?? event.type}
                      {event.reason ? ` · ${event.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="staff-empty-copy">暂无可显示的状态历史。</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
