import type { DaySchedule, Shift } from "@/features/core/models"

/**
 * Pure, policy-free classification of a shift. Every predicate is a STRUCTURAL
 * fact read off the shift (and, for opening/closing, the store's configured
 * schedule) — never a business threshold.
 */

/** Earliest segment start time. Lexicographic order on "HH:mm" is chronological. */
export function earliestStart(shift: Shift): string {
  return shift.segments.reduce(
    (min, segment) => (segment.startTime < min ? segment.startTime : min),
    shift.segments[0]?.startTime ?? ""
  )
}

/** End time of the latest-ending segment (accounting for cross-midnight offset). */
export function latestEnd(shift: Shift): string {
  let latest = shift.segments[0]
  for (const segment of shift.segments) {
    const currentOffset = segment.endDayOffset ?? 0
    const latestOffset = latest.endDayOffset ?? 0
    if (
      currentOffset > latestOffset ||
      (currentOffset === latestOffset && segment.endTime > latest.endTime)
    ) {
      latest = segment
    }
  }
  return latest?.endTime ?? ""
}

/** A split shift has two or more segments (the model's own definition). */
export function isSplitShift(shift: Shift): boolean {
  return shift.segments.length >= 2
}

/**
 * A night shift has at least one segment crossing midnight (`endDayOffset` ≥ 1).
 * This is a purely structural definition — no "night hours" threshold, which
 * would be business policy.
 */
export function isNightShift(shift: Shift): boolean {
  return shift.segments.some((segment) => (segment.endDayOffset ?? 0) >= 1)
}

/** The shift opens the day: its earliest start matches the store's opening time. */
export function isOpeningShift(shift: Shift, schedule: DaySchedule | undefined): boolean {
  if (!schedule || schedule.closed || schedule.opensAt === null) return false
  return earliestStart(shift) === schedule.opensAt
}

/** The shift closes the day: its latest end matches the store's closing time. */
export function isClosingShift(shift: Shift, schedule: DaySchedule | undefined): boolean {
  if (!schedule || schedule.closed || schedule.closesAt === null) return false
  return latestEnd(shift) === schedule.closesAt
}
