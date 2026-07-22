import type { EmployeeId } from "@/features/core/models"
import type { BoardDayViewVM } from "@/features/planning/board/model/board-view-model"
import type { ShiftDeltaVM } from "@/features/planning/board/model/shift-edit-diff"
import type { DragBounds, EditableShift } from "@/features/planning/board/model/shift-edit"
import { PlanningCoverageRow } from "@/features/planning/board/ui/PlanningCoverageRow"
import { PlanningEmployeeRow } from "@/features/planning/board/ui/PlanningEmployeeRow"
import { PlanningTimelineHeader } from "@/features/planning/board/ui/PlanningTimelineHeader"

interface PlanningTimelineProps {
  readonly dayView: BoardDayViewVM
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
  /** Editing wiring, present only when the day is open and editable. */
  readonly editableById?: ReadonlyMap<string, EditableShift>
  readonly bounds?: DragBounds
  readonly selectedShiftId?: string | null
  readonly onSelectShift?: (shiftId: string, employeeId: EmployeeId) => void
  readonly onEditShift?: (shiftId: string, next: EditableShift) => void
  readonly deltasByEmployee?: ReadonlyMap<EmployeeId, ShiftDeltaVM>
  readonly lockedShiftIds?: ReadonlySet<string>
}

/**
 * The timeline: hour ruler, the two coverage lines, then one lane per employee.
 * Every part receives the same `hours`, which is why the columns line up.
 */
export function PlanningTimeline({
  dayView,
  onSelectEmployee,
  editableById,
  bounds,
  selectedShiftId,
  onSelectShift,
  onEditShift,
  deltasByEmployee,
  lockedShiftIds,
}: PlanningTimelineProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-[52rem]">
        <div className="flex items-end bg-muted/30">
          <div className="w-48 shrink-0 border-r px-3 py-1 text-xs font-medium text-muted-foreground">
            Heure
          </div>
          <div className="flex-1 pr-2">
            <PlanningTimelineHeader hours={dayView.hours} />
          </div>
        </div>

        <PlanningCoverageRow
          label="Besoin"
          hours={dayView.hours}
          cells={dayView.requiredRow}
          render={(cell) => String(cell.required)}
        />
        <PlanningCoverageRow
          label="Présents"
          hours={dayView.hours}
          cells={dayView.presentRow}
          render={(cell) => String(cell.present)}
        />

        {dayView.rows.map((row) => (
          <PlanningEmployeeRow
            key={row.employeeId}
            row={row}
            hours={dayView.hours}
            onSelect={() => onSelectEmployee(row.employeeId)}
            editableById={editableById}
            bounds={bounds}
            selectedShiftId={selectedShiftId}
            onSelectShift={onSelectShift}
            onEditShift={onEditShift}
            delta={deltasByEmployee?.get(row.employeeId)}
            lockedShiftIds={lockedShiftIds}
          />
        ))}
      </div>
    </div>
  )
}
