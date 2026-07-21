import type { ConstraintSeverity } from "@/features/core/constraint-engine/types"

import type {
  FairnessDimension,
  FairnessWarningCode,
} from "@/features/core/fairness-engine/types"

/**
 * FairnessWarning — a human-readable note about a fairness concern, so a score
 * is never delivered as a bare number. Severity reuses the constraint engine's
 * scale (never redefined).
 */
export interface FairnessWarning {
  readonly code: FairnessWarningCode
  readonly severity: ConstraintSeverity
  /** The dimension concerned, when the warning is dimension-specific. */
  readonly dimension?: FairnessDimension
  /** Plain-language explanation surfaced to the manager. */
  readonly message: string
}
