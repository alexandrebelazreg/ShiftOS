import type { Assignment, Employee, Shift } from "@/features/core/models"

import type { Coverage, Demand } from "@/features/core/demand-engine/models"

/**
 * CoverageService — computes the coverage of a demand by a set of assignments.
 * Contract only; an implementation would delegate to `coverageCalculator`.
 */
export interface CoverageService {
  getCoverage(
    demand: Demand,
    assignments: readonly Assignment[],
    shifts: readonly Shift[],
    employees: readonly Employee[]
  ): Promise<Coverage>
}
