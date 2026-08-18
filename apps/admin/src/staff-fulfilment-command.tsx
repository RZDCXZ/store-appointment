import type { StaffBookingDetailResponse } from "@rongguang/contracts";

import { formatShanghaiDateTime } from "./staff-booking-presentation";

export type StaffFulfilmentCommand = "check_in" | "late_check_in" | "no_show";

interface StaffFulfilmentResultData {
  outcome: "checked_in" | "no_show";
  occurredAt: string;
  actor: { displayName: string };
  reason: string | null;
}

export function commandIdempotencyKey(bookingId: string, command: StaffFulfilmentCommand): string {
  const storageKey = `staff-fulfilment:${bookingId}:${command}`;
  const saved = sessionStorage.getItem(storageKey);
  if (saved) return saved;

  const generated = `${command}-${globalThis.crypto.randomUUID()}`;
  sessionStorage.setItem(storageKey, generated);
  return generated;
}

export function recoveredFulfilment(
  detail: StaffBookingDetailResponse,
): StaffFulfilmentResultData | null {
  const event = [...detail.statusHistory]
    .reverse()
    .find((candidate) =>
      ["booking_checked_in", "booking_late_checked_in", "booking_no_show"].includes(candidate.type),
    );
  if (!event) return null;
  const outcome = event.type === "booking_no_show" ? "no_show" : "checked_in";

  return {
    outcome,
    occurredAt: event.occurredAt,
    actor: { displayName: event.actorDisplayName ?? "门店员工" },
    reason: event.reason,
  };
}

export function StaffFulfilmentResult({
  result,
}: {
  result: StaffFulfilmentResultData;
}): React.JSX.Element {
  const noShow = result.outcome === "no_show";

  return (
    <section
      className={`staff-fulfilment-result${noShow ? " staff-fulfilment-result--no-show" : ""}`}
      role="status"
    >
      <small>{noShow ? "人工处理完成" : "核销结果"}</small>
      <h2>{noShow ? "已人工标记爽约" : "已完成到店核销"}</h2>
      <p>
        {formatShanghaiDateTime(result.occurredAt)} · {result.actor.displayName}
      </p>
      {result.reason ? <p>原因：{result.reason}</p> : null}
      <strong>
        {noShow
          ? "仅释放处理时刻之后的实际占用；保留原计划记录，不会自动处罚顾客。"
          : "首次核销时间已保留；重复提交不会追加状态历史。"}
      </strong>
    </section>
  );
}
