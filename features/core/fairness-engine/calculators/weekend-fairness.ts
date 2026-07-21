import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessContext,
  FairnessDimensionCalculator,
} from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"

/**
 * Weekend fairness — measures how evenly weekend work is shared.
 * Value = the employee's `weekendCount` (0 when they have no statistics).
 *
 * The statistics engine now also exposes per-day `saturdayCount` / `sundayCount`,
 * so dedicated `saturday` / `sunday` fairness dimensions are one-calculator +
 * one-registration additions when needed.
 */
export const weekendFairness: FairnessDimensionCalculator = {
  dimension: "weekend",
  label: "Weekend days",
  valueOf(employeeId: EmployeeId, context: FairnessContext): number {
    return context.statisticsByEmployee.get(employeeId)?.weekendCount ?? 0
  },
}
