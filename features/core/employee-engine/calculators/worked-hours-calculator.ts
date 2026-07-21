import type {
  Assignment,
  AssignmentId,
  EmployeeId,
  IsoDate,
  Minutes,
  Shift,
  ShiftId,
} from "@/features/core/models"

import type { Period } from "@/features/core/employee-engine/types"

/**
 * A worked-time total for one bucket (a day, an ISO week or a month).
 * `minutes` is the exact, canonical value; `hours` is `minutes / 60` provided
 * unrounded for convenience.
 */
export interface WorkedHoursBucket {
  readonly minutes: Minutes
  readonly hours: number
}

export interface DailyWorkedHours extends WorkedHoursBucket {
  readonly date: IsoDate
}

export interface WeeklyWorkedHours extends WorkedHoursBucket {
  /** ISO-8601 week key, e.g. "2026-W29". */
  readonly isoWeek: string
}

export interface MonthlyWorkedHours extends WorkedHoursBucket {
  /** Month key, e.g. "2026-07". */
  readonly month: string
}

/** Codes describing data problems encountered while computing worked hours. */
export const WORKED_HOURS_ISSUE_CODES = [
  "shift_not_found",
  "invalid_segment",
] as const
export type WorkedHoursIssueCode = (typeof WORKED_HOURS_ISSUE_CODES)[number]

/** A non-fatal data issue: the affected input is skipped, computation continues. */
export interface WorkedHoursIssue {
  readonly code: WorkedHoursIssueCode
  readonly message: string
  readonly assignmentId?: AssignmentId
  readonly shiftId?: ShiftId
}

/**
 * Strongly typed worked-hours result: an overall total plus daily / weekly /
 * monthly breakdowns, and any data issues encountered.
 */
export interface WorkedHoursResult {
  readonly employeeId: EmployeeId
  readonly period: Period
  readonly totalMinutes: Minutes
  readonly totalHours: number
  readonly byDay: readonly DailyWorkedHours[]
  readonly byWeek: readonly WeeklyWorkedHours[]
  readonly byMonth: readonly MonthlyWorkedHours[]
  readonly issues: readonly WorkedHoursIssue[]
}

/**
 * WorkedHoursCalculator — worked time for an employee over a period, derived
 * from their assignments and the referenced shifts (normal or split). Pure,
 * stateless and deterministic.
 */
export interface WorkedHoursCalculator {
  calculate(
    employeeId: EmployeeId,
    assignments: readonly Assignment[],
    shifts: readonly Shift[],
    period: Period
  ): WorkedHoursResult
}
