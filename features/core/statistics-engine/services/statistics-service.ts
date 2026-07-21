import type { Assignment, Shift } from "@/features/core/models"
import { isDateInRange } from "@/features/core/shared"

import type {
  EmployeeStatistics,
  StatisticsInput,
  StatisticsReport,
} from "@/features/core/statistics-engine/models"
import { employeeStatisticsCalculator } from "@/features/core/statistics-engine/calculators"
import {
  aggregatePlanningStatistics,
  aggregateStoreStatistics,
} from "@/features/core/statistics-engine/aggregators"

/**
 * StatisticsService — the single entry point of the statistics engine and the
 * single source of truth for planning statistics. It computes every employee's
 * statistics, then the planning- and store-level roll-ups, from one consistent
 * snapshot. Pure and deterministic: same input → same report.
 */
export interface StatisticsService {
  compute(input: StatisticsInput): StatisticsReport
  /** Convenience: just the per-employee statistics (what fairness consumes). */
  computeEmployeeStatistics(input: StatisticsInput): readonly EmployeeStatistics[]
}

export const statisticsService: StatisticsService = {
  compute(input: StatisticsInput): StatisticsReport {
    const totalAssignments = countInPeriodAssignments(input)
    const employees = input.employees.map((employee) =>
      employeeStatisticsCalculator.calculate(employee, input, totalAssignments)
    )

    return {
      employees,
      planning: aggregatePlanningStatistics(employees, input, totalAssignments),
      store: aggregateStoreStatistics(input, totalAssignments),
    }
  },

  computeEmployeeStatistics(input: StatisticsInput): readonly EmployeeStatistics[] {
    const totalAssignments = countInPeriodAssignments(input)
    return input.employees.map((employee) =>
      employeeStatisticsCalculator.calculate(employee, input, totalAssignments)
    )
  },
}

/** Count assignments whose shift falls inside the planning period. */
function countInPeriodAssignments(input: StatisticsInput): number {
  const period = { start: input.planning.periodStart, end: input.planning.periodEnd }
  const shiftById = new Map<Shift["id"], Shift>(input.shifts.map((shift) => [shift.id, shift]))
  let count = 0
  for (const assignment of input.assignments as readonly Assignment[]) {
    const shift = shiftById.get(assignment.shiftId)
    if (shift && isDateInRange(shift.date, period.start, period.end)) count += 1
  }
  return count
}
