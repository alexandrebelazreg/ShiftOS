import type { FairnessDimension } from "@/features/core/fairness-engine/types"
import type { EmployeeValue } from "@/features/core/fairness-engine/models/EmployeeValue"

/**
 * FairnessDimensionScore — how fairly ONE dimension is distributed, plus the
 * distribution and stats that produced it (explainability first).
 *
 * `fairness` is `1 - gini`, in `[0, 1]` (1 = perfectly fair). `gini` is the raw
 * inequality. `weight` is the normalized share this dimension carried in the
 * overall score. The `distribution` is every cohort member's value, sorted
 * descending then by id, so the report is stable and readable.
 */
export interface FairnessDimensionScore {
  readonly dimension: FairnessDimension
  readonly fairness: number
  readonly gini: number
  readonly weight: number

  /** Number of cohort members measured. */
  readonly evaluated: number
  readonly total: number
  readonly mean: number
  readonly min: number
  readonly max: number

  readonly distribution: readonly EmployeeValue[]
}
