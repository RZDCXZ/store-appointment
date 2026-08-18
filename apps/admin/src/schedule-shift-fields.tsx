import type { EditableScheduleShift, ScheduleBusinessHours } from "@rongguang/contracts";

function shiftLabel(index: number, field: "开始" | "结束"): string {
  return index === 0 ? `班次${field}` : `第 ${index + 1} 班次${field}`;
}

function breakLabel(index: number, field: "开始" | "结束"): string {
  return index === 0 ? `休息${field}` : `第 ${index + 1} 段休息${field}`;
}

export function ScheduleShiftFields({
  shifts,
  businessHours,
  onChange,
}: {
  shifts: EditableScheduleShift[];
  businessHours: ScheduleBusinessHours;
  onChange: (shifts: EditableScheduleShift[]) => void;
}): React.JSX.Element {
  function updateShift(index: number, patch: Partial<EditableScheduleShift>): void {
    onChange(
      shifts.map((shift, itemIndex) => (itemIndex === index ? { ...shift, ...patch } : shift)),
    );
  }

  function updateBreak(
    shiftIndex: number,
    breakIndex: number,
    patch: Partial<EditableScheduleShift["breaks"][number]>,
  ): void {
    updateShift(shiftIndex, {
      breaks: shifts[shiftIndex]!.breaks.map((shiftBreak, itemIndex) =>
        itemIndex === breakIndex ? { ...shiftBreak, ...patch } : shiftBreak,
      ),
    });
  }

  return (
    <div className="schedule-shift-editor-list">
      {shifts.map((shift, shiftIndex) => (
        <fieldset key={shiftIndex} className="schedule-shift-editor-row">
          <legend>班次 {shiftIndex + 1}</legend>
          <label>
            {shiftLabel(shiftIndex, "开始")}
            <input
              type="time"
              value={shift.startsAt}
              onChange={(event) => updateShift(shiftIndex, { startsAt: event.target.value })}
            />
          </label>
          <label>
            {shiftLabel(shiftIndex, "结束")}
            <input
              type="time"
              value={shift.endsAt}
              onChange={(event) => updateShift(shiftIndex, { endsAt: event.target.value })}
            />
          </label>
          {shift.breaks.map((shiftBreak, breakIndex) => (
            <div className="schedule-break-editor-row" key={breakIndex}>
              <label>
                {breakLabel(breakIndex, "开始")}
                <input
                  type="time"
                  value={shiftBreak.startsAt}
                  onChange={(event) =>
                    updateBreak(shiftIndex, breakIndex, { startsAt: event.target.value })
                  }
                />
              </label>
              <label>
                {breakLabel(breakIndex, "结束")}
                <input
                  type="time"
                  value={shiftBreak.endsAt}
                  onChange={(event) =>
                    updateBreak(shiftIndex, breakIndex, { endsAt: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  updateShift(shiftIndex, {
                    breaks: shift.breaks.filter((_, itemIndex) => itemIndex !== breakIndex),
                  })
                }
              >
                移除第 {breakIndex + 1} 段休息
              </button>
            </div>
          ))}
          <div className="schedule-shift-editor-actions">
            <button
              type="button"
              onClick={() =>
                updateShift(shiftIndex, {
                  breaks: [...shift.breaks, { startsAt: shift.startsAt, endsAt: shift.endsAt }],
                })
              }
            >
              添加休息
            </button>
            {shifts.length > 1 ? (
              <button
                type="button"
                onClick={() => onChange(shifts.filter((_, itemIndex) => itemIndex !== shiftIndex))}
              >
                移除班次 {shiftIndex + 1}
              </button>
            ) : null}
          </div>
        </fieldset>
      ))}
      {shifts.length < 4 ? (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...shifts,
              {
                startsAt: businessHours.opensAt ?? "09:30",
                endsAt: businessHours.closesAt ?? "18:00",
                breaks: [],
              },
            ])
          }
        >
          添加班次
        </button>
      ) : null}
    </div>
  );
}
