import type { Assignment, Shift } from "@/features/core/models"

import type { ConstraintContext } from "@/features/core/constraint-engine"
import type { GenerationContext } from "@/features/core/planning-generator/types"

/**
 * Assemble the `ConstraintContext` the constraint engine evaluates. It is a
 * pure projection of the generation context plus the current shifts/assignments
 * — the generator adds no facts of its own. Called repeatedly (with growing
 * assignment sets) while filtering candidates, and once for the final report.
 */
export function buildConstraintContext(
  context: GenerationContext,
  shifts: readonly Shift[],
  assignments: readonly Assignment[]
): ConstraintContext {
  return {
    now: context.settings.now,
    period: context.settings.period,
    store: context.store,
    planning: context.planning,
    employees: context.employees,
    contracts: context.contracts,
    shifts,
    assignments,
    availabilityRules: context.availabilityRules,
    absences: context.absences,
    holidays: context.holidays,
    employeeConstraints: context.employeeConstraints,
  }
}
