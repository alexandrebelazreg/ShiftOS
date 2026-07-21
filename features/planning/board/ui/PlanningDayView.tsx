import type { EmployeeId } from "@/features/core/models"
import type { BoardDayViewVM } from "@/features/planning/board/model/board-view-model"
import { PlanningTimeline } from "@/features/planning/board/ui/PlanningTimeline"

interface PlanningDayViewProps {
  readonly dayView: BoardDayViewVM
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
}

/** One full day, hour by hour. */
export function PlanningDayView({ dayView, onSelectEmployee }: PlanningDayViewProps) {
  if (dayView.closed || dayView.hours.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {dayView.dateLabel ? `${dayView.dateLabel} — jour fermé.` : "Aucun jour sélectionné."}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">{dayView.dateLabel}</h2>
      <PlanningTimeline dayView={dayView} onSelectEmployee={onSelectEmployee} />
    </div>
  )
}
