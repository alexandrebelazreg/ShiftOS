import type { StatisticsInput, StoreStatistics } from "@/features/core/statistics-engine/models"
import { round } from "@/features/core/statistics-engine/utils"

/**
 * Roll up store-level statistics for the planning. The coverage rate and gap
 * count come straight from the demand engine's coverage (never recomputed);
 * they are `null`/`0` when no coverage was supplied.
 */
export function aggregateStoreStatistics(
  input: StatisticsInput,
  totalAssignments: number
): StoreStatistics {
  return {
    storeId: input.store.id,
    generatedShifts: input.shifts.length,
    assignmentCount: totalAssignments,
    coverageRate:
      input.coverage != null
        ? round(input.coverage.statistics.overallCoveragePercentage)
        : null,
    coverageGaps: input.coverage != null ? input.coverage.gaps.length : 0,
  }
}
