import type { Assignment, EmployeeId, Shift } from "@/features/core/models"

import { clamp01, fairnessEngine } from "@/features/core/fairness-engine"
import { statisticsService } from "@/features/core/statistics-engine"
import type { GenerationContext } from "@/features/core/planning-generator/types"

/**
 * Compute each employee's FAIRNESS DEBT for the current partial planning, by
 * REUSING the existing engines — no fairness or statistics calculation is
 * reimplemented here:
 *   Statistics Engine (per-employee facts) → Fairness Engine (distributions).
 *
 * An employee's load is the average of their normalized position across every
 * fairness dimension that has spread (their `value / max`). `0` = carries the
 * least, `1` = carries the most. The ranker turns this into a score of
 * `1 - load`, so the lowest-debt employee ranks highest.
 *
 * Refreshed once per requirement (it is the costly step); intra-requirement
 * workload changes are tracked separately by the current-workload dimension.
 */
export function computeFairnessLoad(
  context: GenerationContext,
  assignments: readonly Assignment[],
  shifts: readonly Shift[]
): ReadonlyMap<EmployeeId, number> {
  const statistics = statisticsService.computeEmployeeStatistics({
    planning: context.planning,
    employees: context.employees,
    assignments,
    shifts,
    store: context.store,
    calendar: { holidays: context.holidays, absences: context.absences },
  })

  const report = fairnessEngine.analyze({
    planning: context.planning,
    employees: context.employees,
    assignments,
    statistics,
  })

  const sum = new Map<EmployeeId, number>()
  const count = new Map<EmployeeId, number>()
  for (const dimension of report.dimensions) {
    if (dimension.max <= 0) continue // no spread → this dimension distinguishes no one
    for (const entry of dimension.distribution) {
      sum.set(entry.employeeId, (sum.get(entry.employeeId) ?? 0) + entry.value / dimension.max)
      count.set(entry.employeeId, (count.get(entry.employeeId) ?? 0) + 1)
    }
  }

  const load = new Map<EmployeeId, number>()
  for (const employee of context.employees) {
    const contributing = count.get(employee.id) ?? 0
    load.set(
      employee.id,
      contributing > 0 ? clamp01((sum.get(employee.id) ?? 0) / contributing) : 0
    )
  }
  return load
}
