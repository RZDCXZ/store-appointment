import { useState } from "react";
import type {
  EditableScheduleShift,
  PublishedScheduleStaffDay,
  ScheduleBusinessHours,
} from "@rongguang/contracts";

import { ScheduleShiftFields } from "./schedule-shift-fields";
import { useDialogFocus } from "./use-dialog-focus";

export type ScheduleExceptionKind = "adjusted_shift" | "overtime" | "special_break" | "day_off";

export interface ScheduleExceptionInput {
  kind: ScheduleExceptionKind;
  note: string;
  shifts: EditableScheduleShift[];
}

export function ScheduleExceptionEditor({
  title,
  eyebrow,
  saveLabel,
  shifts,
  exception,
  businessHours,
  pending,
  error,
  onCancel,
  onSave,
}: {
  title: string;
  eyebrow: string;
  saveLabel: string;
  shifts: EditableScheduleShift[];
  exception: PublishedScheduleStaffDay["exception"];
  businessHours: ScheduleBusinessHours;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (body: ScheduleExceptionInput) => void;
}): React.JSX.Element {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [kind, setKind] = useState<ScheduleExceptionKind>(exception?.kind ?? "adjusted_shift");
  const [note, setNote] = useState(exception?.note ?? "");
  const [editedShifts, setEditedShifts] = useState<EditableScheduleShift[]>(
    shifts.length > 0
      ? shifts.map((shift) => ({
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          breaks: shift.breaks.map((shiftBreak) => ({ ...shiftBreak })),
        }))
      : [
          {
            startsAt: businessHours.opensAt ?? "09:30",
            endsAt: businessHours.closesAt ?? "18:00",
            breaks: [],
          },
        ],
  );

  return (
    <div className="schedule-editor-backdrop">
      <section
        ref={dialogRef}
        className="schedule-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-exception-editor-title"
      >
        <header>
          <div>
            <p>{eyebrow}</p>
            <h2 id="schedule-exception-editor-title">{title}</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭日期例外编辑">
            关闭
          </button>
        </header>
        <div className="schedule-editor-fields">
          <label>
            例外类型
            <select
              data-dialog-initial-focus
              aria-describedby={error ? "schedule-exception-editor-error" : undefined}
              value={kind}
              onChange={(event) => setKind(event.target.value as ScheduleExceptionKind)}
            >
              <option value="adjusted_shift">调班</option>
              <option value="overtime">加班</option>
              <option value="special_break">临时休息</option>
              <option value="day_off">当天休息</option>
            </select>
          </label>
          <label>
            例外说明
            <textarea
              aria-describedby={error ? "schedule-exception-editor-error" : undefined}
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder="说明本次调整原因"
            />
          </label>
          {kind !== "day_off" ? (
            <ScheduleShiftFields
              shifts={editedShifts}
              businessHours={businessHours}
              errorId={error ? "schedule-exception-editor-error" : undefined}
              onChange={setEditedShifts}
            />
          ) : (
            <p>保存后该员工当天将没有班次。</p>
          )}
        </div>
        {error ? (
          <p id="schedule-exception-editor-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button
            type="button"
            disabled={pending || !note.trim()}
            onClick={() =>
              onSave({
                kind,
                note: note.trim(),
                shifts: kind === "day_off" ? [] : editedShifts,
              })
            }
          >
            {pending ? "正在保存…" : saveLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
