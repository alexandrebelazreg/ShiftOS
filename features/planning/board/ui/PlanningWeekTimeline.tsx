import { cn } from "@/lib/utils"

import type {
  BoardHourVM,
  BoardWeekDayVM,
} from "@/features/planning/board/model/board-view-model"
import { PlanningShiftBar } from "@/features/planning/board/ui/PlanningShiftBar"
import { PlanningTimelineHeader } from "@/features/planning/board/ui/PlanningTimelineHeader"

interface PlanningWeekTimelineProps {
  readonly hours: readonly BoardHourVM[]
  readonly days: readonly BoardWeekDayVM[]
}

/**
 * One employee's whole week, one lane per day, all sharing a single ruler.
 *
 * The shared ruler is the point: with each day scaled to its own opening hours,
 * a Saturday bar and a Monday bar of the same length would render differently
 * and invite the wrong conclusion. Here a longer bar always means more hours.
 */
export function PlanningWeekTimeline({ hours, days }: PlanningWeekTimelineProps) {
  if (hours.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Aucun jour ouvert cette semaine.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-[48rem]">
        <div className="flex items-end bg-muted/30">
          <div className="w-36 shrink-0 border-r px-3 py-1 text-xs font-medium text-muted-foreground">
            Jour
          </div>
          <div className="flex-1 pr-2">
            <PlanningTimelineHeader hours={hours} />
          </div>
          <div className="w-20 shrink-0 border-l px-3 py-1 text-right text-xs font-medium text-muted-foreground">
            Total
          </div>
        </div>

        {days.map((day) => (
          <div key={day.date} className={cn("flex items-stretch border-t", day.closed && "bg-muted/20")}>
            <div className="w-36 shrink-0 border-r px-3 py-2">
              <p className="text-sm font-medium">{day.dayLabel}</p>
              <p className="text-xs text-muted-foreground tabular-nums">{day.dateLabel}</p>
            </div>

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
              <div className="relative h-12">
                {day.restLabel ? (
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs italic text-muted-foreground">
                    {day.restLabel}
                  </span>
                ) : (
                  day.shifts.map((shift) => <PlanningShiftBar key={shift.id} shift={shift} />)
                )}
              </div>
            </div>

            <div className="flex w-20 shrink-0 items-center justify-end border-l px-3 text-sm tabular-nums">
              {day.totalLabel}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
