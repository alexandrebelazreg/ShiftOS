import type { IsoDate, WeekDay } from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"

/**
 * Pure, sector-agnostic calendar helpers operating on the core `IsoDate`
 * ("YYYY-MM-DD"). All computations are done in UTC so results are deterministic
 * regardless of the host timezone.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True when `value` is a real calendar date in "YYYY-MM-DD" form. */
export function isValidIsoDate(value: string): value is IsoDate {
  if (!DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Inclusive range check. Lexicographic comparison is valid for ISO dates. */
export function isDateInRange(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return date >= start && date <= end
}

/**
 * Every calendar date from `start` to `end` inclusive, in ascending order.
 * Returns an empty array when `start > end`. Deterministic (UTC).
 */
export function enumerateDates(start: IsoDate, end: IsoDate): IsoDate[] {
  if (start > end) return []
  const dates: IsoDate[] = []
  const [y, m, d] = start.split("-").map(Number)
  const cursor = new Date(Date.UTC(y, m - 1, d))
  const last = end
  while (true) {
    const iso = cursor.toISOString().slice(0, 10)
    if (iso > last) break
    dates.push(iso)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

/** Month bucket key, e.g. "2026-07". */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7)
}

/** The week day of an ISO date (calendar order, Monday–Sunday). */
export function weekDayOf(date: IsoDate): WeekDay {
  const utcDay = new Date(`${date}T00:00:00.000Z`).getUTCDay() // 0=Sun … 6=Sat
  const mondayIndex = (utcDay + 6) % 7 // 0=Mon … 6=Sun
  return WEEK_DAYS[mondayIndex]
}

/**
 * ISO-8601 week bucket key, e.g. "2026-W29". Uses the Thursday rule so weeks
 * near a year boundary are attributed to the correct ISO year.
 */
export function isoWeekKey(date: IsoDate): string {
  const [year, month, day] = date.split("-").map(Number)
  const current = new Date(Date.UTC(year, month - 1, day))
  const dayNum = (current.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  // Shift to the Thursday of the current ISO week.
  current.setUTCDate(current.getUTCDate() - dayNum + 3)
  const isoYear = current.getUTCFullYear()

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)

  const week =
    1 + Math.round((current.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
  return `${isoYear}-W${String(week).padStart(2, "0")}`
}
