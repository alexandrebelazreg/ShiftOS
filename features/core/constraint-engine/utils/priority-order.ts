import type { ConstraintPriority } from "@/features/core/constraint-engine/types"

/**
 * Canonical ordering of priorities, most important first. Data only — provided
 * so a future evaluator can sort/compare constraints consistently without
 * re-deciding the order.
 */
export const CONSTRAINT_PRIORITY_ORDER: readonly ConstraintPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
]
