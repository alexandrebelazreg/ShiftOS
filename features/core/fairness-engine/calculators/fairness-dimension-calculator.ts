import type { Assignment, Employee, EmployeeId, Planning } from "@/features/core/models"

import type { EmployeeStatistics } from "@/features/core/statistics-engine"
import type { FairnessDimension } from "@/features/core/fairness-engine/types"

/**
 * FairnessContext — the read-only inputs a dimension calculator reasons about.
 * Derived once by the engine from `FairnessInput` and shared across every
 * calculator (notably `statisticsByEmployee` for O(1) lookup).
 */
export interface FairnessContext {
  readonly planning: Planning
  readonly employees: readonly Employee[]
  readonly assignments: readonly Assignment[]
  readonly statistics: readonly EmployeeStatistics[]
  /** `statistics` indexed by employee for O(1) access. */
  readonly statisticsByEmployee: ReadonlyMap<EmployeeId, EmployeeStatistics>
}

/**
 * FairnessDimensionCalculator — the ONE thing you implement to add a fairness
 * dimension. It extracts a single non-negative value per employee (e.g. their
 * opening count); the engine handles everything else (distribution, Gini,
 * fairness, imbalance detection, warnings, weighting).
 *
 * This is what makes dimensions independently pluggable: adding a metric is a
 * new calculator (this interface) plus one registration — nothing else. The
 * calculator carries NO maths and NO policy; it is a pure value extractor.
 *
 * `valueOf` MUST be pure and return a finite, non-negative number (missing data
 * ⇒ `0`, meaning "this employee carried none of it").
 */
export interface FairnessDimensionCalculator {
  readonly dimension: FairnessDimension
  /** Optional human-readable label for reporting. */
  readonly label?: string
  valueOf(employeeId: EmployeeId, context: FairnessContext): number
}
