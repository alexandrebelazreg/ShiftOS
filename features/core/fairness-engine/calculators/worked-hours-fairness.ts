import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessContext,
  FairnessDimensionCalculator,
} from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"

/**
 * Worked-hours fairness — measures how evenly total worked time is spread.
 * Value = the employee's `workedMinutes` (0 when they have no statistics).
 */
export const workedHoursFairness: FairnessDimensionCalculator = {
  dimension: "worked_hours",
  label: "Worked hours",
  valueOf(employeeId: EmployeeId, context: FairnessContext): number {
    return context.statisticsByEmployee.get(employeeId)?.workedMinutes ?? 0
  },
}
