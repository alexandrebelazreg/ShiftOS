import type { BoardHourVM } from "@/features/planning/board/model/board-view-model"

interface PlanningTimelineHeaderProps {
  readonly hours: readonly BoardHourVM[]
}

/**
 * The hour ruler. Every column takes the width the ViewModel computed, which is
 * the same number the shift bars use — the alignment is shared arithmetic, not
 * two independent guesses.
 */
export function PlanningTimelineHeader({ hours }: PlanningTimelineHeaderProps) {
  return (
    <div className="flex h-8 items-end">
      {hours.map((hour) => (
        <div
          key={hour.startMinutes}
          style={{ width: `${hour.widthPercent}%` }}
          className="border-l border-border/60 pl-1 text-[11px] font-medium tabular-nums text-muted-foreground first:border-l-0"
        >
          {hour.label}
        </div>
      ))}
    </div>
  )
}
