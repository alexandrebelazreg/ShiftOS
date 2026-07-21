import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessDimension,
  ImbalanceDirection,
} from "@/features/core/fairness-engine/types"

/**
 * DetectedImbalance — a single employee flagged as significantly away from the
 * mean on a dimension. This is a MEASUREMENT, not a verdict: the engine reports
 * that someone carries much more (or less) than average; it never says whether
 * that is acceptable — that is business policy.
 */
export interface DetectedImbalance {
  readonly dimension: FairnessDimension
  readonly employeeId: EmployeeId
  readonly value: number
  readonly mean: number
  /** Signed relative deviation from the mean: `(value - mean) / mean`. */
  readonly deviation: number
  readonly direction: ImbalanceDirection
}
