import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessContext,
  FairnessDimensionCalculator,
} from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"

/**
 * Split-shift fairness — measures how evenly split shifts are shared (they are
 * generally less desirable). Value = the employee's `splitShiftCount`.
 */
export const splitShiftFairness: FairnessDimensionCalculator = {
  dimension: "split_shift",
  label: "Split shifts",
  valueOf(employeeId: EmployeeId, context: FairnessContext): number {
    return context.statisticsByEmployee.get(employeeId)?.splitShiftCount ?? 0
  },
}
