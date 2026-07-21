import type { TimeString } from "@/features/core/models"

/**
 * Pure, sector-agnostic time-of-day helpers operating on the core `TimeString`
 * ("HH:mm", 24h). No dependency on the current time, locale or timezone — every
 * function is deterministic.
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** True when `value` is a well-formed 24h "HH:mm" string. */
export function isValidTimeString(value: string): value is TimeString {
  return TIME_RE.test(value)
}

/** Minutes since midnight for a valid "HH:mm", or `null` when malformed. */
export function timeToMinutes(value: TimeString): number | null {
  if (!isValidTimeString(value)) return null
  const [hours, minutes] = value.split(":")
  return Number(hours) * 60 + Number(minutes)
}

/**
 * Duration in minutes of an interval `[start, end]`.
 *
 * `endDayOffset` supports cross-midnight (night) intervals: 0 (default) means
 * `end` is the same day; 1 means the next day, etc. So `22:00 → 06:00` with
 * `endDayOffset = 1` is 480 minutes.
 *
 * Returns `null` when either bound is malformed, when `endDayOffset` is negative,
 * or when the resulting duration is non-positive — the caller decides how to
 * report it.
 */
export function intervalMinutes(
  start: TimeString,
  end: TimeString,
  endDayOffset = 0
): number | null {
  const startMinutes = timeToMinutes(start)
  const endMinutes = timeToMinutes(end)
  if (startMinutes === null || endMinutes === null) return null
  if (!Number.isInteger(endDayOffset) || endDayOffset < 0) return null
  const duration = endDayOffset * 24 * 60 + endMinutes - startMinutes
  return duration > 0 ? duration : null
}
