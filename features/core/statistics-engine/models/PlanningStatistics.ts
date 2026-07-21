import type { DateRange, Minutes, PlanningId } from "@/features/core/models"

/**
 * PlanningStatistics — factual roll-up of a whole planning.
 *
 * - `totalWorkedMinutes` / `totalWorkedHours` — summed across every employee.
 * - `assignmentCount`     — in-period assignments in the planning.
 * - `employeeCount`       — employees with at least one assignment.
 * - `averageWorkedHours`  — `totalWorkedHours / employeeCount` (0 when none).
 * - `planningDurationDays`— inclusive number of calendar days in the period.
 * - `coverageRate`        — from the demand engine's coverage (share of
 *   requirements met, `[0, 1]`); `null` when no coverage was supplied. Never
 *   recomputed here.
 */
export interface PlanningStatistics {
  readonly planningId: PlanningId
  readonly period: DateRange

  readonly totalWorkedMinutes: Minutes
  readonly totalWorkedHours: number
  readonly assignmentCount: number
  readonly employeeCount: number
  readonly averageWorkedHours: number
  readonly planningDurationDays: number
  readonly coverageRate: number | null
}
