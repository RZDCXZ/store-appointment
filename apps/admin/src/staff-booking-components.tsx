import { Link } from "react-router-dom";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import type { StaffBookingSummary } from "@rongguang/contracts";

import {
  formatShanghaiClock,
  serviceLabel,
  staffPhotoSource,
  staffActionLabels,
  staffStatusLabels,
} from "./staff-booking-presentation";

export function StaffStatusTag({ booking }: { booking: StaffBookingSummary }): React.JSX.Element {
  return (
    <span className={`staff-status-tag staff-status-tag--${booking.status}`}>
      {staffStatusLabels[booking.status]}
    </span>
  );
}

export function StaffActionLabel({ booking }: { booking: StaffBookingSummary }): React.JSX.Element {
  return (
    <span className={`staff-action-label staff-action-label--${booking.action}`}>
      {staffActionLabels[booking.action]}
    </span>
  );
}

export function StaffBookingRow({ booking }: { booking: StaffBookingSummary }): React.JSX.Element {
  return (
    <Link
      className="staff-booking-row"
      to={`/staff/appointments/${booking.id}`}
      aria-label={`查看${booking.pet.name}预约详情`}
    >
      <time>{formatShanghaiClock(booking.startsAt)}</time>
      <span className="staff-booking-row__pet">
        {booking.pet.photoPath ? (
          <img src={staffPhotoSource(booking.pet.photoPath)} alt="" />
        ) : null}
        <span>
          <strong>{booking.pet.name}</strong>
          <small>{serviceLabel(booking.service)}</small>
        </span>
      </span>
      <span className="staff-booking-row__semantics">
        <StaffStatusTag booking={booking} />
        <StaffActionLabel booking={booking} />
      </span>
      <ChevronRightIcon aria-hidden="true" />
    </Link>
  );
}

export function StaffPageLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <section className="staff-loading" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </section>
  );
}

export function StaffPageError({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry: () => void;
}): React.JSX.Element {
  return (
    <section className="staff-state staff-state--error" role="alert">
      <strong>{title}</strong>
      <p>{message}</p>
      <button type="button" onClick={retry}>
        重新读取
      </button>
    </section>
  );
}

export function StaffInlineRefreshError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}): React.JSX.Element {
  return (
    <div className="staff-inline-error" role="alert">
      <span>状态重新读取失败：{message}</span>
      <button type="button" onClick={retry}>
        重试
      </button>
    </div>
  );
}
