import { enumerateDates } from "@/features/core/shared"

import type {
  EmployeeStatistics,
  PlanningStatistics,
  StatisticsInput,
} from "@/features/core/statistics-engine/models"
import { round } from "@/features/core/statistics-engine/utils"

/**
 * Roll the per-employee statistics up to the whole planning. Pure aggregation —
 * it sums and averages already-computed facts and reads the coverage rate from
 * the demand engine's coverage; it recomputes nothing.
 */
export function aggregatePlanningStatistics(
  employeeStatistics: readonly EmployeeStatistics[],
  input: StatisticsInput,
  totalAssignments: number
): PlanningStatistics {
  const period = { start: input.planning.periodStart, end: input.planning.periodEnd }

  const totalWorkedMinutes = employeeStatistics.reduce((sum, s) => sum + s.workedMinutes, 0)
  const totalWorkedHours = totalWorkedMinutes / 60
  const employeeCount = employeeStatistics.filter((s) => s.assignmentCount > 0).length

  return {
    planningId: input.planning.id,
    period,
    totalWorkedMinutes,
    totalWorkedHours,
    assignmentCount: totalAssignments,
    employeeCount,
    averageWorkedHours: employeeCount > 0 ? round(totalWorkedHours / employeeCount) : 0,
    planningDurationDays: enumerateDates(period.start, period.end).length,
    coverageRate:
      input.coverage != null
        ? round(input.coverage.statistics.overallCoveragePercentage)
        : null,
  }
}
