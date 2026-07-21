import type { BoardDayViewVM } from "@/features/planning/board/model/board-view-model"
import { PlanningCoverageRow } from "@/features/planning/board/ui/PlanningCoverageRow"
import { PlanningEmployeeRow } from "@/features/planning/board/ui/PlanningEmployeeRow"
import { PlanningTimelineHeader } from "@/features/planning/board/ui/PlanningTimelineHeader"

interface PlanningTimelineProps {
  readonly dayView: BoardDayViewVM
  readonly onSelectEmployee: (employeeId: BoardDayViewVM["rows"][number]["employeeId"]) => void
}

/**
 * The timeline: hour ruler, the two coverage lines, then one lane per employee.
 * Every part receives the same `hours`, which is why the columns line up.
 */
export function PlanningTimeline({ dayView, onSelectEmployee }: PlanningTimelineProps) {
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
          />
        ))}
      </div>
    </div>
  )
}
