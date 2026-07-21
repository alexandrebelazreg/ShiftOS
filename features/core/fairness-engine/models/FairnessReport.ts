import type { IsoDate } from "@/features/core/models"

import type { DetectedImbalance } from "@/features/core/fairness-engine/models/DetectedImbalance"
import type { FairnessDimensionScore } from "@/features/core/fairness-engine/models/FairnessDimensionScore"
import type { FairnessWarning } from "@/features/core/fairness-engine/models/FairnessWarning"

/** Compact context describing what was analyzed. */
export interface FairnessReportDetails {
  /** Number of active employees measured. */
  readonly cohortSize: number
  /** Number of dimensions scored. */
  readonly dimensionCount: number
  readonly periodStart: IsoDate
  readonly periodEnd: IsoDate
}

/**
 * FairnessReport — the structured result of a fairness analysis.
 *
 * Deliberately NOT a single number: fairness is multi-dimensional and must stay
 * explainable. `overall` is the one comparable figure (a weighted average of
 * the per-dimension fairness), always accompanied by the breakdown, the flagged
 * imbalances and human-readable warnings.
 *
 * `overall` is in `[0, 1]`, higher is fairer.
 */
export interface FairnessReport {
  /** OverallFairnessScore — weighted average of the dimensions, in `[0, 1]`. */
  readonly overall: number
  /** DimensionScores — one fairness score per measured dimension. */
  readonly dimensions: readonly FairnessDimensionScore[]
  /** Human-readable fairness concerns. */
  readonly warnings: readonly FairnessWarning[]
  /** Employees flagged as significantly away from the mean. */
  readonly imbalances: readonly DetectedImbalance[]
  readonly details: FairnessReportDetails
}
