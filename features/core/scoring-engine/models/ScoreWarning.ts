import type { ConstraintSeverity } from "@/features/core/constraint-engine/types"

import type { ScoreWarningCode } from "@/features/core/scoring-engine/types"

/**
 * ScoreWarning — a human-readable note about why a planning lost points. These
 * exist so the manager can always understand a score, never just receive a
 * number. Severity reuses the constraint engine's scale (never redefined).
 */
export interface ScoreWarning {
  readonly code: ScoreWarningCode
  readonly severity: ConstraintSeverity
  /** Plain-language explanation surfaced to the manager. */
  readonly message: string
}
