import type { EmployeeStatistics } from "@/features/core/statistics-engine/models/EmployeeStatistics"
import type { PlanningStatistics } from "@/features/core/statistics-engine/models/PlanningStatistics"
import type { StoreStatistics } from "@/features/core/statistics-engine/models/StoreStatistics"

/**
 * StatisticsReport — the complete output of the statistics engine: one entry per
 * employee, plus the planning- and store-level roll-ups. A single artifact any
 * consumer (fairness, generator, reporting) reads instead of computing its own.
 */
export interface StatisticsReport {
  readonly employees: readonly EmployeeStatistics[]
  readonly planning: PlanningStatistics
  readonly store: StoreStatistics
}
