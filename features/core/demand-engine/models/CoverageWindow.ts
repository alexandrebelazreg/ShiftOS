import type { IsoDate, TimeWindow } from "@/features/core/models"

/**
 * CoverageWindow — a concrete dated time interval that demand is expressed over.
 *
 * Reuses the core `TimeWindow` (start / end / `endDayOffset` for cross-midnight)
 * and pins it to a calendar `date`. No time-interval shape is duplicated.
 */
export interface CoverageWindow extends TimeWindow {
  readonly date: IsoDate
}
