import type { TimeString } from "@/features/core/models"
import { timeToMinutes } from "@/features/core/shared"

/**
 * True when two same-date time intervals overlap. `endDayOffset` (default 0)
 * extends an interval past midnight, so a night window can overlap an early
 * segment of the following-day representation. Pure and deterministic.
 *
 * Returns `false` if any bound is malformed.
 */
export function timeRangesOverlap(
  aStart: TimeString,
  aEnd: TimeString,
  aEndDayOffset: number | undefined,
  bStart: TimeString,
  bEnd: TimeString,
  bEndDayOffset: number | undefined
): boolean {
  const aStartMin = timeToMinutes(aStart)
  const aEndMin = timeToMinutes(aEnd)
  const bStartMin = timeToMinutes(bStart)
  const bEndMin = timeToMinutes(bEnd)
  if (
    aStartMin === null ||
    aEndMin === null ||
    bStartMin === null ||
    bEndMin === null
  ) {
    return false
  }

  const aEndAbs = aEndMin + (aEndDayOffset ?? 0) * 24 * 60
  const bEndAbs = bEndMin + (bEndDayOffset ?? 0) * 24 * 60

  return aStartMin < bEndAbs && bStartMin < aEndAbs
}
