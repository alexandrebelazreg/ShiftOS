import { cn } from "@/lib/utils"

import type { BoardDayRowVM, BoardHourVM } from "@/features/planning/board/model/board-view-model"
import { PlanningShiftBar } from "@/features/planning/board/ui/PlanningShiftBar"

interface PlanningEmployeeRowProps {
  readonly row: BoardDayRowVM
  readonly hours: readonly BoardHourVM[]
  readonly onSelect: () => void
}

/**
 * One employee lane in the day view: identity on the left, shift bars laid over
 * the shared hour grid on the right. A day off keeps its lane so the absence is
 * visible rather than merely missing.
 */
export function PlanningEmployeeRow({ row, hours, onSelect }: PlanningEmployeeRowProps) {
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
        <span className="truncate text-sm font-medium">{row.name}</span>
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
              <PlanningShiftBar key={shift.id} shift={shift} onSelect={onSelect} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
