import type { DateRange, EmployeeId, Minutes } from "@/features/core/models"

/**
 * EmployeeStatistics — the canonical, factual account of one employee's activity
 * over a planning period. This is the SINGLE SOURCE OF TRUTH; no other module
 * recomputes these figures.
 *
 * Every field is a measured FACT, never a judgement:
 * - `workedMinutes` / `workedHours` — total time worked (exact minutes; hours =
 *   minutes / 60, unrounded).
 * - `workedDays`        — distinct calendar dates with any worked time.
 * - `assignmentCount`   — in-period assignments held.
 * - `openingCount`      — shifts whose earliest start matches the store's opening
 *   time that weekday.
 * - `closingCount`      — shifts whose latest end matches the store's closing
 *   time that weekday.
 * - `splitShiftCount`   — shifts with two or more segments.
 * - `weekendCount`      — distinct Saturday+Sunday dates worked.
 * - `saturdayCount` / `sundayCount` — distinct Saturdays / Sundays worked.
 * - `nightShiftCount`   — shifts with a segment crossing midnight (`endDayOffset`
 *   ≥ 1).
 * - `holidayCount`      — distinct worked dates that are store holidays.
 * - `absenceCount`      — distinct dates the employee is absent within the period.
 * - `coverageContribution` — share of the planning's assignments carried by this
 *   employee, in `[0, 1]`.
 */
export interface EmployeeStatistics {
  readonly employeeId: EmployeeId
  readonly period: DateRange

  readonly workedMinutes: Minutes
  readonly workedHours: number
  readonly workedDays: number
  readonly assignmentCount: number

  readonly openingCount: number
  readonly closingCount: number
  readonly splitShiftCount: number

  readonly weekendCount: number
  readonly saturdayCount: number
  readonly sundayCount: number

  readonly nightShiftCount: number
  readonly holidayCount: number
  readonly absenceCount: number

  readonly coverageContribution: number
}
