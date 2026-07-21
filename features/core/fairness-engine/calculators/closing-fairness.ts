import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessContext,
  FairnessDimensionCalculator,
} from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"

/**
 * Closing fairness — measures how evenly closing shifts are shared.
 * Value = the employee's `closingCount` (0 when they have no statistics).
 */
export const closingFairness: FairnessDimensionCalculator = {
  dimension: "closing",
  label: "Closing shifts",
  valueOf(employeeId: EmployeeId, context: FairnessContext): number {
    return context.statisticsByEmployee.get(employeeId)?.closingCount ?? 0
  },
}
