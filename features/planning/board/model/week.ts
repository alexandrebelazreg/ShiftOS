import type { IsoDate } from "@/features/core/models"

/**
 * Week arithmetic, ISO-8601.
 *
 * A planning week is always Monday → Sunday. Anchoring a period on "today"
 * produced a week that ran Tuesday → Monday, with columns, dates and the week
 * number all disagreeing; every date handled here is snapped to its Monday so
 * that cannot happen again.
 *
 * Pure functions, UTC throughout, no clock read except where a caller passes
 * one in. React never does this arithmetic.
 */

const DAY_MS = 86_400_000

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

/** The Monday of the ISO week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const current = toUtc(date)
  const offset = (current.getUTCDay() + 6) % 7 // 0 = Monday
  current.setUTCDate(current.getUTCDate() - offset)
  return toIso(current)
}

/** The Sunday closing the ISO week containing `date`. */
export function sundayOf(date: IsoDate): IsoDate {
  const monday = toUtc(mondayOf(date))
  monday.setUTCDate(monday.getUTCDate() + 6)
  return toIso(monday)
}

/** ISO-8601 week number, Thursday rule. */
export function isoWeekNumber(date: IsoDate): number {
  const current = toUtc(date)
  const offset = (current.getUTCDay() + 6) % 7
  current.setUTCDate(current.getUTCDate() - offset + 3) // the week's Thursday
  const firstThursday = new Date(Date.UTC(current.getUTCFullYear(), 0, 4))
  const firstOffset = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstOffset + 3)
  return 1 + Math.round((current.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
}

/** The ISO year the week belongs to, which near January differs from the date's. */
export function isoWeekYear(date: IsoDate): number {
  const current = toUtc(date)
  const offset = (current.getUTCDay() + 6) % 7
  current.setUTCDate(current.getUTCDate() - offset + 3)
  return current.getUTCFullYear()
}

/** Shift a whole number of weeks, staying on Monday. */
export function shiftWeeks(date: IsoDate, weeks: number): IsoDate {
  const monday = toUtc(mondayOf(date))
  monday.setUTCDate(monday.getUTCDate() + weeks * 7)
  return toIso(monday)
}

/** Monday → Sunday for the ISO week containing `date`. */
export function weekPeriod(date: IsoDate): { readonly start: IsoDate; readonly end: IsoDate } {
  return { start: mondayOf(date), end: sundayOf(date) }
}

export interface WeekOption {
  /** The Monday, which is what a caller generates from. */
  readonly value: IsoDate
  readonly weekNumber: number
  readonly label: string
}

const MONTHS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
]

function shortDate(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`
}

/**
 * Selectable weeks, starting `back` weeks before `anchor` and running forward.
 *
 * Offering future weeks is deliberate even though the engine only generates the
 * current one today: the interface should not have to change shape when it can.
 */
export function listWeekOptions(anchor: IsoDate, back = 2, ahead = 8): WeekOption[] {
  const first = shiftWeeks(anchor, -back)
  return Array.from({ length: back + ahead + 1 }, (_, index) => {
    const value = shiftWeeks(first, index)
    return {
      value,
      weekNumber: isoWeekNumber(value),
      label: `S${isoWeekNumber(value)} · ${shortDate(value)} → ${shortDate(sundayOf(value))}`,
    }
  })
}
