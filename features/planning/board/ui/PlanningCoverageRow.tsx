import { cn } from "@/lib/utils"

import type { BoardCoverageCellVM, BoardHourVM } from "@/features/planning/board/model/board-view-model"
import { LEVEL_SURFACE } from "@/features/planning/board/ui/level-styles"

interface PlanningCoverageRowProps {
  readonly label: string
  readonly hours: readonly BoardHourVM[]
  readonly cells: readonly BoardCoverageCellVM[]
  readonly render: (cell: BoardCoverageCellVM) => string
}

/**
 * One coverage line — "Besoin" or "Présents" — sharing the timeline grid.
 *
 * The colour of each cell comes from the level the ViewModel assigned; this
 * component compares nothing. A manager reads the deficit by scanning for red.
 */
export function PlanningCoverageRow({ label, hours, cells, render }: PlanningCoverageRowProps) {
  return (
    <div className="flex items-stretch border-t">
      <div className="w-48 shrink-0 border-r px-3 py-2 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="relative flex flex-1">
        {cells.map((cell, index) => (
          <div
            key={cell.startMinutes}
            style={{ width: `${hours[index]?.widthPercent ?? 0}%` }}
            className="border-l border-border/60 p-1 first:border-l-0"
          >
            <div
              className={cn(
                "flex h-7 items-center justify-center rounded border text-xs font-semibold tabular-nums",
                LEVEL_SURFACE[cell.level]
              )}
            >
              {render(cell)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
