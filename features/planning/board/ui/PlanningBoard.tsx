"use client"

import { useMemo, useState, type ReactNode } from "react"

import type { EmployeeId, IsoDate } from "@/features/core/models"
import type {
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import type { WeekOption } from "@/features/planning/board/model/week"
import { buildPlanningBoard } from "@/features/planning/board/model/board-view-model"
import { PlanningDayView } from "@/features/planning/board/ui/PlanningDayView"
import { PlanningEmployeeView } from "@/features/planning/board/ui/PlanningEmployeeView"
import { PlanningSectorView } from "@/features/planning/board/ui/PlanningSectorView"
import { PlanningSummary } from "@/features/planning/board/ui/PlanningSummary"
import { PlanningToolbar } from "@/features/planning/board/ui/PlanningToolbar"

interface PlanningBoardProps {
  readonly input: PlanningBoardInput
  /** Week navigation belongs to whoever owns the data, not to the board. */
  readonly onPreviousWeek?: () => void
  readonly onNextWeek?: () => void
  readonly weekOptions?: readonly WeekOption[]
  readonly selectedWeek?: string
  readonly onSelectWeek?: (monday: string) => void
  /** Générer / Enregistrer / Publier, rendered inside the control bar. */
  readonly actions?: ReactNode
}

/**
 * The board container.
 *
 * It holds exactly one kind of state — what the user is looking at — and hands
 * it to `buildPlanningBoard`, which produces both views at once from the same
 * data. There is no per-view state and no per-view computation, so switching
 * view, week, sector or day can never make the two disagree.
 *
 * Extension points for the sprints ahead are already shaped by this split: an
 * edit, a drag, a resize or a lock all end up as a change to `input` or to the
 * selection, then a rebuild. No component learns a new responsibility.
 */
export function PlanningBoard({
  input,
  onPreviousWeek,
  onNextWeek,
  weekOptions,
  selectedWeek,
  onSelectWeek,
  actions,
}: PlanningBoardProps) {
  const [selection, setSelection] = useState<PlanningBoardSelection>(() => ({
    view: "sector",
    sectorId: input.sectors[0]?.id ?? null,
    date: input.days.find((day) => !day.closed)?.date ?? null,
    employeeId: null,
  }))

  const board = useMemo(() => buildPlanningBoard(input, selection), [input, selection])

  const update = (patch: Partial<PlanningBoardSelection>) =>
    setSelection((current) => ({ ...current, ...patch }))

  return (
    <div className="space-y-4">
      <PlanningToolbar
        toolbar={board.toolbar}
        onChangeView={(view) => update({ view })}
        onSelectSector={(sectorId) => update({ sectorId })}
        onSelectDate={(date: IsoDate) => update({ date })}
        onPreviousWeek={() => onPreviousWeek?.()}
        onNextWeek={() => onNextWeek?.()}
        weekOptions={weekOptions}
        selectedWeek={selectedWeek}
        onSelectWeek={onSelectWeek}
        actions={actions}
      />

      {/* No fixed side panel: the grid gets the full width, and per-employee
          detail lives in its own view where it has room to breathe. Selecting
          someone here switches to it rather than shrinking the schedule. */}
      {board.toolbar.view === "sector" ? (
        <PlanningSectorView
          sectorView={board.sectorView}
          onSelectEmployee={(employeeId: EmployeeId) =>
            update({ employeeId, view: "employee" })
          }
        />
      ) : board.toolbar.view === "day" ? (
        <PlanningDayView
          dayView={board.dayView}
          onSelectEmployee={(employeeId: EmployeeId) =>
            update({ employeeId, view: "employee" })
          }
        />
      ) : (
        <PlanningEmployeeView
          employeeView={board.employeeView}
          onSelectEmployee={(employeeId: EmployeeId) => update({ employeeId })}
        />
      )}

      {/* The verdict reads AFTER the schedule: a manager looks at the week
          first, then at what to check before publishing it. */}
      <PlanningSummary summary={board.summary} />
    </div>
  )
}
