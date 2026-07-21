import type {
  Absence,
  DateRange,
  EmployeeId,
  Holiday,
  IsoDate,
  StoreId,
} from "@/features/core/models"
import { enumerateDates, isDateInRange } from "@/features/core/shared"

/** The set of store-holiday dates, for O(1) membership tests. */
export function holidayDateSet(
  holidays: readonly Holiday[],
  storeId: StoreId
): ReadonlySet<IsoDate> {
  return new Set(holidays.filter((holiday) => holiday.storeId === storeId).map((h) => h.date))
}

/**
 * Distinct calendar dates within `period` the employee is absent for, derived
 * from their absence ranges intersected with the period. Deterministic (UTC).
 */
export function absentDatesInPeriod(
  employeeId: EmployeeId,
  absences: readonly Absence[],
  period: DateRange
): ReadonlySet<IsoDate> {
  const dates = new Set<IsoDate>()
  const mine = absences.filter((absence) => absence.employeeId === employeeId)
  if (mine.length === 0) return dates

  for (const date of enumerateDates(period.start, period.end)) {
    if (mine.some((absence) => isDateInRange(date, absence.range.start, absence.range.end))) {
      dates.add(date)
    }
  }
  return dates
}

/** Round to a fixed number of decimals to strip floating-point noise. */
export function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}
