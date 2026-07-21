import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessContext,
  FairnessDimensionCalculator,
} from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"

/**
 * Opening fairness — measures how evenly opening shifts are shared.
 * Value = the employee's `openingCount` (0 when they have no statistics).
 */
export const openingFairness: FairnessDimensionCalculator = {
  dimension: "opening",
  label: "Opening shifts",
  valueOf(employeeId: EmployeeId, context: FairnessContext): number {
    return context.statisticsByEmployee.get(employeeId)?.openingCount ?? 0
  },
}
