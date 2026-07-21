import type { TimeString, WeekDay } from "@/features/core/models"

/**
 * TimeRange — one opening interval of the day, e.g. `06:00–12:00`.
 */
export interface TimeRange {
  readonly start: TimeString
  readonly end: TimeString
}

/**
 * DayOpeningHours — a single weekday's schedule. Supports MULTIPLE ranges
 * (e.g. `06:00–12:00` then `13:00–20:00`), unlike the core `Store.openingHours`
 * single open/close pair. When `closed`, `ranges` is empty.
 */
export interface DayOpeningHours {
  readonly day: WeekDay
  readonly closed: boolean
  readonly ranges: readonly TimeRange[]
}

/**
 * OpeningHours — a full week, one entry per weekday. Different hours per day are
 * simply different `ranges`.
 */
export type OpeningHours = readonly DayOpeningHours[]
