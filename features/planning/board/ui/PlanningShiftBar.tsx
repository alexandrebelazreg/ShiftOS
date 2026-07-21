import { cn } from "@/lib/utils"

import type { BoardShiftVM } from "@/features/planning/board/model/board-view-model"
import { KIND_SURFACE } from "@/features/planning/board/ui/level-styles"

interface PlanningShiftBarProps {
  readonly shift: BoardShiftVM
  readonly onSelect?: () => void
}

/**
 * One shift drawn on the day timeline.
 *
 * Positions come straight from the ViewModel as percentages of the open window,
 * so a bar starts exactly under its hour rather than approximately. The colour
 * comes from the shift kind the ViewModel decided — opening, closing, plain day
 * or split — so the week reads at a glance.
 *
 * A split shift renders one block per segment, and the gap between them is
 * simply the space the blocks do not cover.
 */
export function PlanningShiftBar({ shift, onSelect }: PlanningShiftBarProps) {
  return (
    <>
      {shift.segments.map((segment, index) => (
        <button
          key={`${shift.id}-${index}`}
          type="button"
          onClick={onSelect}
          style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
          className={cn(
            "absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-md border px-2",
            "text-[11px] font-medium shadow-sm transition",
            "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            KIND_SURFACE[shift.kind]
          )}
          title={`${shift.kindLabel} · ${shift.label} · ${shift.durationLabel}`}
        >
          <span className="truncate tabular-nums">
            {index === 0 ? `${shift.startLabel} – ${shift.endLabel}` : "suite"}
          </span>
        </button>
      ))}
    </>
  )
}
