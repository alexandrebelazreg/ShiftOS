import { cn } from "@/lib/utils"

import type { EmployeeId } from "@/features/core/models"
import type { BoardDayRowVM, BoardHourVM } from "@/features/planning/board/model/board-view-model"
import type { ShiftDeltaVM } from "@/features/planning/board/model/shift-edit-diff"
import type { DragBounds, EditableShift } from "@/features/planning/board/model/shift-edit"
import { DELTA_STYLE } from "@/features/planning/board/ui/edit-delta-styles"
import { PlanningShiftBar } from "@/features/planning/board/ui/PlanningShiftBar"

interface PlanningEmployeeRowProps {
  readonly row: BoardDayRowVM
  readonly hours: readonly BoardHourVM[]
  readonly onSelect: () => void
  /** Editing wiring, threaded down only in the day view. */
  readonly editableById?: ReadonlyMap<string, EditableShift>
  readonly bounds?: DragBounds
  readonly selectedShiftId?: string | null
  readonly onSelectShift?: (shiftId: string, employeeId: EmployeeId) => void
  readonly onEditShift?: (shiftId: string, next: EditableShift) => void
  /** The employee's worked-time change since generation. Shown once edited. */
  readonly delta?: ShiftDeltaVM
}

/**
 * One employee lane in the day view: identity on the left, shift bars laid over
 * the shared hour grid on the right. A day off keeps its lane so the absence is
 * visible rather than merely missing.
 *
 * The name button still jumps to the employee view; the bars, when editing is
 * enabled, select and edit a shift in place instead — two different intents that
 * used to share one handler.
 */
export function PlanningEmployeeRow({
  row,
  hours,
  onSelect,
  editableById,
  bounds,
  selectedShiftId,
  onSelectShift,
  onEditShift,
  delta,
}: PlanningEmployeeRowProps) {
  const editing = editableById !== undefined && bounds !== undefined

  return (
    <div className={cn("flex items-stretch border-t", row.selected && "bg-primary/5")}>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-48 shrink-0 items-center gap-2 border-r px-3 py-2 text-left transition hover:bg-muted/50"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
          {row.initials}
        </span>
        <span className="flex-1 truncate text-sm font-medium">{row.name}</span>
        {delta ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              DELTA_STYLE[delta.kind]
            )}
          >
            {delta.label}
          </span>
        ) : null}
      </button>

      <div className="relative flex-1">
        <div className="absolute inset-0 flex" aria-hidden>
          {hours.map((hour) => (
            <div
              key={hour.startMinutes}
              style={{ width: `${hour.widthPercent}%` }}
              className="border-l border-border/40 first:border-l-0"
            />
          ))}
        </div>
        <div className="relative h-11">
          {row.restLabel ? (
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs italic text-muted-foreground">
              {row.restLabel}
            </span>
          ) : (
            row.shifts.map((shift) => (
              <PlanningShiftBar
                key={shift.id}
                shift={shift}
                editable={editing ? editableById!.get(shift.id) : undefined}
                bounds={bounds}
                selected={editing && shift.id === selectedShiftId}
                onSelect={() =>
                  editing ? onSelectShift?.(shift.id, row.employeeId) : onSelect()
                }
                onEdit={
                  editing ? (next) => onEditShift?.(shift.id, next) : undefined
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
